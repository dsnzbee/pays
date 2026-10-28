/**
 * Lane dynamics for all scenarios, integrated with classical RK4 (fixed step).
 * The state vector also carries the energy bookkeeping (heat, rolling loss,
 * temperature), so energy conservation is checked *by the integrator itself*:
 *     KE (+PE) + Q_fin + Q_loss = E0     (error is reported in the table).
 *
 * Common conventions: speed v ≥ 0 is the magnitude of the plate–magnet relative
 * velocity; F is the magnitude of the braking force; k = F/v [N·s/m].
 */

import { BRAKE_DISC, BRAKE_PAD, CRR, G, H_CONV, MU0, RHO_NDFEB, T_AMBIENT, T_REF, discHeatShare, gradeById, materialById } from './constants'
import { LaneConfig, ZONE_START, fieldScale, geometryOf } from './config'
import { BrakeTable, kHat, kHatMean, pHat, sampleQty } from './solver'
import { regimeAt } from './regime'

const EPS_V = 0.004 // smoothing speed for Coulomb-type forces [m/s]
export const STOP_V = 0.01 // a rail lane is 'stopped' (and frozen) below this speed [m/s]
const AIR_RHO = 1.2

export interface Row {
  label: string
  unit: string
  value: string
  heat?: boolean
  /** shown in the default (short) readout list */
  core?: boolean
}

/** Where the initial energy E0 has gone: heat in the brake, other losses, still kinetic (or mechanical). */
export interface EnergySplit {
  E0: number
  heat: number
  loss: number
  ke: number
}

/** ΔT = E/(m·c) bookkeeping of one brake body (fin, disc, pad). */
export interface ThermalBody {
  name: string
  mass: number // kg
  C: number // m·c [J/K]
  Q: number // heat received so far [J]
  dTpred: number // Q / C [K]
  dTmeas: number // measured temperature rise [K]
}

const f = (v: number, d = 0) => (isFinite(v) ? v.toFixed(d) : '∞')

const regShort = (l: string) => (l.startsWith('low') ? 'linear' : l.startsWith('trans') ? 'transition' : 'saturated')

export abstract class Lane {
  cfg: LaneConfig
  table: BrakeTable | null
  s = 1 // field scale (≈ Br)
  t = 0
  y: Float64Array
  private k1: Float64Array
  private k2: Float64Array
  private k3: Float64Array
  private k4: Float64Array
  private tmp: Float64Array

  // ---- common outputs (refreshed after every step)
  v = 0
  pos = 0
  F = 0
  k = 0
  P = 0
  T = T_AMBIENT
  Qheat = 0 // heat generated in the plate by the brake [J]
  Qloss = 0 // other losses (rolling / air) [J]
  emf = 0
  Jmax = 0
  lam = 0 // current amplitude σ·v·B_scale·(d_eff/d)·G : J = lam · ĵ  [A/m² per unit ĵ]
  I = 0
  Rm = 0
  regime = ''
  dEff = 0
  delta = Infinity
  w = Infinity
  Bgap = 0
  pErr = 0 // (P_Joule − F·v)/(F·v) [%]
  E0 = 0
  energyErr = 0
  stopped = false
  stopTime = 0
  stopPos = 0
  // validation (analytic reference)
  kConst = 0
  vA = NaN
  xA = NaN

  constructor(cfg: LaneConfig, table: BrakeTable | null, n: number) {
    this.cfg = cfg
    this.table = table
    this.y = new Float64Array(n)
    this.k1 = new Float64Array(n)
    this.k2 = new Float64Array(n)
    this.k3 = new Float64Array(n)
    this.k4 = new Float64Array(n)
    this.tmp = new Float64Array(n)
    if (table) this.s = fieldScale(cfg.p, table.Bc1)
    this.Bgap = table ? this.s * table.Bc1 : 0
  }

  protected abstract deriv(y: Float64Array, dy: Float64Array): void
  /** refresh outputs from the current state */
  protected abstract finalize(): void
  abstract rows(): Row[]
  /** brake force at speed v for the graph's model curve (null = none) */
  abstract forceCurve(v: number): number | null
  /** analytic reference (validation mode) at the current time */
  protected abstract analytic(): void
  /** energy split E0 → heat / loss / kinetic (null where it does not apply) */
  energySplit(): EnergySplit | null {
    return null
  }
  /** brake bodies for the ΔT = E/(m·c) readout */
  thermal(): ThermalBody[] {
    return []
  }
  get frozen() {
    return false
  }
  /** plate-centre coordinate relative to the start of the magnet array (drives the field picture) */
  get fieldU(): number {
    return 0
  }

  step(dt: number) {
    if (this.frozen) return
    const n = this.y.length
    const { y, k1, k2, k3, k4, tmp } = this
    this.deriv(y, k1)
    for (let i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * dt * k1[i]
    this.deriv(tmp, k2)
    for (let i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * dt * k2[i]
    this.deriv(tmp, k3)
    for (let i = 0; i < n; i++) tmp[i] = y[i] + dt * k3[i]
    this.deriv(tmp, k4)
    for (let i = 0; i < n; i++) y[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
    this.t += dt
    this.finalize()
    if (this.cfg.p.validation) this.analytic()
  }
}

// =================================================================== RAIL

export class RailLane extends Lane {
  private mat = materialById('cu')
  private d: number
  private m: number
  private C: number
  private hA: number
  private Kmean: number
  private brake: LaneConfig['brake']
  private val: boolean
  private fricF: number // friction braking force [N]
  private v0: number
  private x0: number
  private onset: number // x at which the brake (magnet zone or pads) starts acting [m]
  private tOnset = 0
  private braking = false
  private gam = 1 // fraction of the friction heat that goes into the disc (rest: pads)
  private Cpad = 1
  /** peak braking force over the run so far [N] */
  peakF = 0
  /** brake body: heat capacity m·c [J/K], mass [kg], cooling hA [W/K] (disc + pads for the friction lane) */
  bodyC = 1
  bodyMass = 0
  bodyHA = 0
  bodyName = ''
  discMass = 0
  padMass = 0

  constructor(cfg: LaneConfig, table: BrakeTable | null) {
    super(cfg, table, 6) // x, v, Qbrake, Qroll, T(fin | disc), T(pad)
    const p = cfg.p
    this.mat = materialById(p.materialId)
    this.d = p.thicknessMm / 1000
    this.m = p.mass
    this.brake = cfg.brake
    this.val = p.validation
    this.fricF = cfg.fricForce ?? p.muPad * p.clampKN * 1000
    this.v0 = p.v0
    this.Kmean = table ? kHatMean(table) : 0
    if (this.brake === 'friction') {
      // disc + pad pair. Realistic: sized from the vehicle mass. Equal m·c: total capacity = the eddy fin's,
      // split in the heat-partition ratio so that disc, pad and fin all warm by the same ΔT = E/C.
      this.gam = discHeatShare()
      const eq = cfg.eqThermal
      if (eq) {
        this.C = this.gam * eq.C
        this.Cpad = (1 - this.gam) * eq.C
        this.hA = eq.hA
        this.discMass = this.C / BRAKE_DISC.cp
        this.padMass = this.Cpad / BRAKE_PAD.cp
      } else {
        this.discMass = Math.max(BRAKE_DISC.minMass, BRAKE_DISC.massFrac * this.m)
        this.padMass = BRAKE_PAD.massRatio * this.discMass
        this.C = this.discMass * BRAKE_DISC.cp
        this.Cpad = this.padMass * BRAKE_PAD.cp
        this.hA = H_CONV * BRAKE_DISC.areaPerKg * this.discMass
      }
      this.bodyC = this.C + this.Cpad
      this.bodyMass = this.discMass + this.padMass
      this.bodyHA = this.hA
      this.bodyName = 'Friction disc + pads'
    } else if (table) {
      const V = table.Lf * table.Hf * table.maskFrac * this.d
      this.C = this.mat.rho * this.mat.cp * V
      this.hA = H_CONV * 2 * table.Lf * table.Hf * table.maskFrac
      this.bodyC = this.C
      this.bodyMass = this.mat.rho * V
      this.bodyHA = this.hA
      this.bodyName = 'Eddy fin'
    } else {
      this.C = 1
      this.hA = 0
    }
    this.x0 = this.val && table ? ZONE_START + (table.usePeriodic ? table.uStable + 0.5 : table.Lambda / 2) : 0
    // both brakes start acting at the same instant: when the fin's leading edge reaches the first magnet
    // (validation starts inside the zone). Braking time and distance are measured from there.
    this.onset = this.val ? this.x0 : ZONE_START - geometryOf(p).fin.Lf / 2
    this.y[0] = this.x0
    this.y[1] = this.v0
    this.y[4] = T_AMBIENT
    this.y[5] = T_AMBIENT
    this.E0 = 0.5 * this.m * this.v0 ** 2
    this.kConst = this.s * this.s * this.mat.sigma * this.d * this.Kmean
    this.finalize()
  }

  /** brake coefficient and regime at the given state */
  private coeff(x: number, v: number, T: number) {
    const sigma = this.val ? this.mat.sigma : this.mat.sigma / (1 + this.mat.alpha * (T - T_REF))
    const tb = this.table!
    if (this.val) return { k: this.kConst, sigma, reg: regimeAt(sigma, this.d, 0, tb.pitch, this.cfg.p.thicknessModel === 'thin'), Kh: this.Kmean, G: 1 }
    const u = x - ZONE_START
    const Kh = kHat(tb, u)
    const reg = regimeAt(sigma, this.d, v, tb.pitch, this.cfg.p.thicknessModel === 'thin')
    return { k: this.s * this.s * sigma * reg.dEff * Kh * reg.G, sigma, reg, Kh, G: reg.G }
  }

  protected deriv(y: Float64Array, dy: Float64Array) {
    const x = y[0]
    const v = Math.max(y[1], 0)
    let F = 0
    if (this.brake === 'eddy' && this.table) F = this.coeff(x, v, y[4]).k * v
    let Ff = 0
    // the pads are on the vehicle and clamp at the same line where the magnet zone starts, until stop
    if (this.brake === 'friction' && x >= this.onset) Ff = this.fricF * Math.tanh(v / EPS_V)
    const Fr = this.val ? 0 : CRR * this.m * G * Math.tanh(v / EPS_V)
    dy[0] = v
    dy[1] = -(F + Ff + Fr) / this.m
    dy[2] = (F + Ff) * v
    dy[3] = Fr * v
    // eddy: all heat in the fin. friction: fraction γ into the disc, 1 − γ into the pads (Charron)
    dy[4] = this.val ? 0 : ((F + this.gam * Ff) * v - this.hA * (y[4] - T_AMBIENT)) / this.C
    dy[5] = this.val || this.brake !== 'friction' ? 0 : ((1 - this.gam) * Ff * v) / this.Cpad
  }

  protected finalize() {
    const y = this.y
    if (y[1] < 0) y[1] = 0
    this.pos = y[0]
    this.v = y[1]
    this.T = y[4]
    this.Qheat = y[2]
    this.Qloss = y[3]
    this.energyErr = this.E0 - (0.5 * this.m * this.v ** 2 + y[2] + y[3])
    this.F = this.k = this.P = this.emf = this.Jmax = this.I = this.pErr = this.lam = 0
    if (!this.braking && y[0] >= this.onset) {
      this.braking = true
      this.tOnset = this.t
    }
    if (this.brake === 'eddy' && this.table) {
      const c = this.coeff(y[0], this.v, y[4])
      const u = y[0] - ZONE_START
      this.k = c.k
      this.F = c.k * this.v
      this.P = this.F * this.v
      this.regime = regShort(c.reg.label)
      this.Rm = c.reg.Rm
      this.dEff = c.reg.dEff
      this.delta = c.reg.delta
      this.w = c.reg.w
      this.emf = (this.Bgap * this.v * this.cfg.p.magB) / 1000
      const lam = c.sigma * this.v * this.s * (c.reg.dEff / this.d) * c.G
      this.lam = lam
      this.Jmax = lam * sampleQty(this.table, u, 'Jm')
      this.I = this.d * lam * sampleQty(this.table, u, 'PsiM')
      const PJ = c.sigma * c.reg.dEff * pHat(this.table, this.val ? 0 : u) * this.s * this.s * c.G * this.v * this.v
      this.pErr = this.F > 1e-9 && !this.val ? ((PJ - this.P) / this.P) * 100 : 0
    } else if (this.brake === 'friction' && y[0] >= this.onset) {
      this.F = this.fricF * Math.tanh(this.v / EPS_V)
      this.P = this.F * this.v
      this.k = this.v > 0 ? this.F / this.v : 0
    }
    if (this.F > this.peakF) this.peakF = this.F
    if (!this.stopped && this.v < STOP_V && this.t > 0.05) {
      this.stopped = true // lane is frozen from here on
      this.stopTime = this.t - this.tOnset // braking time, from the moment the brake starts acting
      this.stopPos = y[0] - this.onset // braking distance
    }
    if (this.stopped) this.F = this.P = this.k = this.Jmax = this.I = this.lam = this.emf = 0 // at rest: no force, no current
  }

  /** speed shown in the UI: exactly 0 once the lane has stopped */
  get vShown() {
    return this.stopped ? 0 : this.v
  }

  get frozen() {
    return this.stopped
  }

  /** Ideal braking distance: eddy  x = m·v₀/k̄ (low-speed, uniform field);  friction  x = m·v₀²/(2(F + C_rr m g)). */
  get xStopAnalytic(): number {
    if (this.brake === 'eddy') return (this.m * this.v0) / this.kConst
    if (this.brake === 'friction') return (this.m * this.v0 * this.v0) / (2 * (this.fricF + (this.val ? 0 : CRR * this.m * G)))
    return NaN
  }
  /** friction force F [N] (friction lane) */
  get frictionForce() {
    return this.fricF
  }
  /** ideal peak eddy force k̄·v₀ [N] (linear model, cold fin) */
  get peakIdeal() {
    return this.kConst * this.v0
  }
  /** braking distance so far (from the line where the brake starts) [m] */
  get brakedDistance() {
    return Math.max(0, this.y[0] - this.onset)
  }

  energySplit(): EnergySplit | null {
    return { E0: this.E0, heat: this.y[2], loss: this.y[3], ke: 0.5 * this.m * this.v ** 2 }
  }

  thermal(): ThermalBody[] {
    if (this.brake === 'none') return []
    const Q = this.y[2]
    if (this.brake === 'eddy') return [{ name: 'Fin', mass: this.bodyMass, C: this.C, Q, dTpred: Q / this.C, dTmeas: this.T - T_AMBIENT }]
    return [
      { name: 'Disc', mass: this.discMass, C: this.C, Q: this.gam * Q, dTpred: (this.gam * Q) / this.C, dTmeas: this.T - T_AMBIENT },
      { name: 'Pads', mass: this.padMass, C: this.Cpad, Q: (1 - this.gam) * Q, dTpred: ((1 - this.gam) * Q) / this.Cpad, dTmeas: this.y[5] - T_AMBIENT },
    ]
  }
  get padT() {
    return this.y[5]
  }

  protected analytic() {
    if (this.brake !== 'eddy') return
    const tau = this.m / this.kConst
    this.vA = this.v0 * Math.exp(-this.t / tau)
    this.xA = this.v0 * tau * (1 - Math.exp(-this.t / tau))
  }

  get fieldU() {
    return this.y[0] - ZONE_START
  }
  /** distance travelled since the start [m] */
  get travelled() {
    return this.y[0] - this.x0
  }

  forceCurve(v: number): number | null {
    if (this.brake === 'friction') return this.fricF
    if (this.brake !== 'eddy' || !this.table) return null
    const sigma = this.mat.sigma / (1 + this.mat.alpha * (this.T - T_REF))
    const reg = regimeAt(sigma, this.d, v, this.table.pitch, this.cfg.p.thicknessModel === 'thin')
    return this.s * this.s * sigma * reg.dEff * this.Kmean * reg.G * v
  }

  rows(): Row[] {
    const xa = this.xStopAnalytic
    const rows: Row[] = [
      { label: 'Speed v', unit: 'm/s', value: f(this.vShown, 2), core: true },
      { label: 'Braking force F', unit: 'N', value: f(this.F), core: true },
      { label: 'Braking distance  sim / ideal', unit: 'm', value: this.brake === 'none' ? '—' : `${this.stopped ? f(this.stopPos, 1) : '…'} / ${f(xa, 1)}`, core: true },
      { label: 'Braking time', unit: 's', value: this.stopped ? f(this.stopTime, 2) : '—', core: true },
      { label: 'Temperature', unit: '°C', value: f(this.T, 1), heat: true, core: true },
      { label: 'Energy check', unit: 'J', value: f(this.energyErr, 4), core: true },
      { label: 'Distance travelled', unit: 'm', value: f(this.pos - this.x0, 1) },
      { label: 'Peak braking force', unit: 'N', value: this.brake === 'none' ? '—' : f(this.peakF) },
      { label: 'Pad temperature', unit: '°C', value: this.brake === 'friction' ? f(this.y[5], 1) : '—', heat: true },
      { label: 'Deceleration', unit: 'm/s²', value: f(this.F / this.m, 2) },
      { label: 'Coefficient k = F/v', unit: 'N·s/m', value: f(this.k) },
      { label: 'Field B (gap centre)', unit: 'T', value: this.brake === 'eddy' ? f(this.Bgap, 3) : '—' },
      { label: 'Induced EMF  ε = B·b·v', unit: 'V', value: f(this.emf, 2) },
      { label: 'Peak current density J', unit: 'A/mm²', value: f(this.Jmax / 1e6, 1) },
      { label: 'Vortex current I', unit: 'A', value: f(this.I) },
      { label: 'Rm = μ₀σvd', unit: '', value: this.brake === 'eddy' ? f(this.Rm, 2) : '—' },
      { label: 'Regime', unit: '', value: this.brake === 'eddy' ? this.regime : '—' },
      { label: 'Skin depth δ', unit: 'mm', value: this.brake === 'eddy' && isFinite(this.delta) ? f(this.delta * 1000, 1) : '—' },
      { label: 'Joule power P', unit: 'kW', value: f(this.P / 1000, 1), heat: true },
      { label: 'P = F·v check', unit: '%', value: this.brake === 'eddy' && !this.val ? f(this.pErr, 4) : '—' },
      { label: 'Kinetic energy', unit: 'kJ', value: f((0.5 * this.m * this.v ** 2) / 1000, 2) },
      { label: 'Heat in plate/disc', unit: 'kJ', value: f(this.Qheat / 1000, 2), heat: true },
    ]
    if (this.val && this.brake === 'eddy') {
      const tau = this.m / this.kConst
      const err = this.vA > 1e-3 * this.v0 ? ((this.v - this.vA) / this.vA) * 100 : ((this.v - this.vA) / this.v0) * 100
      rows.push(
        { label: 'τ = m/k  (analytic)', unit: 's', value: f(tau, 3) },
        { label: 'v analytic', unit: 'm/s', value: f(this.vA, 3) },
        { label: 'v error', unit: '%', value: f(err, 4) },
        { label: 'x_stop = m·v₀/k (analytic)', unit: 'm', value: f((this.m * this.v0) / this.kConst, 3) },
      )
    }
    return rows
  }
}

// =================================================================== TUBE (Lenz tube)

/**
 * Magnet = point dipole on the axis of a thin-walled pipe (mean radius a, wall w).
 * Flux through a ring at axial distance z:  Φ(z) = μ0 p a² / (2 (a²+z²)^{3/2})
 * EMF of that ring  ε = v dΦ/dz ;  J = σ ε /(2πa) ;  P = ∫ J²/σ dV
 *   ⇒ F = P/v = (45/1024) μ0² p² σ w v / a⁴     (Levin et al., Am. J. Phys. 74, 2006)
 */
export class TubeLane extends Lane {
  private mat
  private m: number
  private a: number
  private wall: number
  private L: number
  private p: number // dipole moment [A·m²]
  private k0: number // low-speed coefficient at σ20
  private Af: number
  private Cd: number
  private C: number
  private hA: number
  private val: boolean
  vT = Infinity
  arrived = false
  exitSpeed = 0

  constructor(cfg: LaneConfig) {
    super(cfg, null, 5) // z, v, Qpipe, Qair, T
    const p = cfg.p
    this.mat = materialById(p.materialId)
    const r = p.magDiaMm / 2000
    const V = p.magShape === 'sphere' ? (4 / 3) * Math.PI * r ** 3 : Math.PI * r * r * (p.magLenMm / 1000)
    this.m = RHO_NDFEB * V
    this.p = (gradeById(p.gradeId).Br * V) / MU0
    this.a = (p.pipeOdMm - p.wallMm) / 2000
    this.wall = p.wallMm / 1000
    this.L = p.pipeLenCm / 100
    this.k0 = ((45 / 1024) * MU0 ** 2 * this.p ** 2 * this.mat.sigma * this.wall) / this.a ** 4
    this.Af = Math.PI * r * r
    this.Cd = p.magShape === 'sphere' ? 0.47 : 0.8
    const OD = p.pipeOdMm / 1000
    const ID = OD - 2 * this.wall
    this.C = this.mat.rho * this.mat.cp * (Math.PI / 4) * (OD * OD - ID * ID) * this.L
    this.hA = H_CONV * Math.PI * OD * this.L
    this.val = p.validation
    this.kConst = this.k0
    this.Bgap = (MU0 * this.p) / (4 * Math.PI * this.a ** 3) * 2 // on-axis dipole field at distance a: μ0 p /(2π a³)
    this.y[4] = T_AMBIENT
    this.E0 = 0
    this.finalize()
  }

  get frozen() {
    return this.arrived
  }

  private kAt(T: number, v: number) {
    const sigmaRatio = this.val ? 1 : 1 / (1 + this.mat.alpha * (T - T_REF))
    void v
    return this.k0 * sigmaRatio
  }

  protected deriv(y: Float64Array, dy: Float64Array) {
    const v = Math.max(y[1], 0)
    const k = this.kAt(y[4], v)
    const air = this.val ? 0 : 0.5 * AIR_RHO * this.Cd * this.Af * v * v
    dy[0] = v
    dy[1] = G - (k * v + air) / this.m
    dy[2] = k * v * v
    dy[3] = air * v
    dy[4] = this.val ? 0 : (k * v * v - this.hA * (y[4] - T_AMBIENT)) / this.C
  }

  protected finalize() {
    const y = this.y
    if (y[1] < 0) y[1] = 0
    this.pos = y[0]
    this.v = y[1]
    this.T = y[4]
    this.Qheat = y[2]
    this.Qloss = y[3]
    this.k = this.kAt(y[4], this.v)
    this.F = this.k * this.v
    this.P = this.F * this.v
    this.vT = this.k > 1e-12 ? (this.m * G) / this.k : Infinity
    this.Rm = MU0 * this.mat.sigma * this.v * this.wall
    this.regime = regShort(this.Rm < 0.2 ? 'low' : this.Rm < 2 ? 'trans' : 'high')
    // max ring EMF: |dΦ/dz| peaks at z = a/2:  0.429 μ0 p / a²
    this.emf = (0.4293 * MU0 * this.p * this.v) / this.a ** 2
    const sigma = this.mat.sigma / (1 + this.mat.alpha * (this.T - T_REF))
    this.Jmax = (sigma * this.emf) / (2 * Math.PI * this.a)
    this.I = this.Jmax * this.wall * this.a * 0.5 // ≈ current in one effective ring (width ~ a/2)
    this.energyErr = this.E0 - (0.5 * this.m * this.v ** 2 - this.m * G * y[0] + y[2] + y[3])
    if (!this.arrived && y[0] >= this.L) {
      this.arrived = true
      this.stopped = true
      this.stopTime = this.t
      this.stopPos = this.L
      this.exitSpeed = this.v
    }
  }

  protected analytic() {
    const tau = this.m / this.kConst
    const vt = (this.m * G) / this.kConst
    this.vA = vt * (1 - Math.exp(-this.t / tau))
    this.xA = vt * (this.t - tau * (1 - Math.exp(-this.t / tau)))
  }

  forceCurve(v: number): number | null {
    return this.k0 > 1e-12 ? this.k0 * v : null
  }

  get magnetMass() {
    return this.m
  }
  get dipole() {
    return this.p
  }
  get geometry() {
    return { a: this.a, w: this.wall, L: this.L }
  }

  rows(): Row[] {
    const rows: Row[] = [
      { core: true, label: 'Speed v', unit: 'm/s', value: f(this.v, 3) },
      { label: 'Fallen distance', unit: 'm', value: f(this.pos, 3) },
      { core: true, label: 'Drag force F = k·v', unit: 'N', value: f(this.F, 4) },
      { label: 'Weight m·g', unit: 'N', value: f(this.m * G, 4) },
      { label: 'Coefficient k', unit: 'N·s/m', value: f(this.k, 3) },
      { core: true, label: 'Terminal speed v_t = mg/k', unit: 'm/s', value: isFinite(this.vT) ? f(this.vT, 3) : '∞ (free fall)' },
      { label: 'Dipole moment p', unit: 'A·m²', value: f(this.p, 3) },
      { label: 'Peak ring EMF', unit: 'mV', value: f(this.emf * 1000, 3) },
      { label: 'Peak current density J', unit: 'A/mm²', value: f(this.Jmax / 1e6, 3) },
      { label: 'Rm = μ₀σvw', unit: '', value: f(this.Rm, 4) },
      { label: 'Joule power P', unit: 'mW', value: f(this.P * 1000, 2), heat: true },
      { core: true, label: 'Pipe temperature', unit: '°C', value: f(this.T, 3), heat: true },
      { label: 'Heat in pipe', unit: 'mJ', value: f(this.Qheat * 1000, 2), heat: true },
      { core: true, label: 'Energy error', unit: 'mJ', value: f(this.energyErr * 1000, 4) },
      { core: true, label: 'Time to reach bottom', unit: 's', value: this.arrived ? f(this.stopTime, 2) : '—' },
      { label: 'Exit speed', unit: 'm/s', value: this.arrived ? f(this.exitSpeed, 3) : '—' },
    ]
    if (this.val) {
      const tau = this.m / this.kConst
      const err = this.vA > 1e-3 * ((this.m * G) / this.kConst) ? ((this.v - this.vA) / this.vA) * 100 : 0
      rows.push(
        { label: 'τ = m/k  (analytic)', unit: 's', value: f(tau, 3) },
        { label: 'v analytic', unit: 'm/s', value: f(this.vA, 4) },
        { label: 'v error', unit: '%', value: f(err, 4) },
      )
    }
    return rows
  }
}

// =================================================================== PENDULUM (Waltenhofen)

export class PendulumLane extends Lane {
  private mat
  private d: number
  private m: number
  private L: number
  private C: number
  private hA: number
  private theta0: number
  private Kc: number

  constructor(cfg: LaneConfig, table: BrakeTable) {
    super(cfg, table, 4) // θ, ω, Qfin, T
    const p = cfg.p
    this.mat = materialById(p.materialId)
    this.d = p.thicknessMm / 1000
    this.m = p.pendMass
    this.L = p.pendLen
    this.theta0 = (p.theta0 * Math.PI) / 180
    const V = table.Lf * table.Hf * table.maskFrac * this.d
    this.C = this.mat.rho * this.mat.cp * V + 1e-3 // heat capacity of the plate only
    this.hA = H_CONV * 2 * table.Lf * table.Hf * table.maskFrac
    this.Kc = kHat(table, table.Lambda / 2)
    this.y[0] = this.theta0
    this.y[3] = T_AMBIENT
    this.E0 = this.m * G * this.L * (1 - Math.cos(this.theta0))
    this.kConst = this.s * this.s * this.mat.sigma * this.d * this.Kc
    this.finalize()
  }

  private coeff(theta: number, om: number, T: number) {
    const tb = this.table!
    const sigma = this.mat.sigma / (1 + this.mat.alpha * (T - T_REF))
    const x = this.L * Math.sin(theta)
    const u = x + tb.Lambda / 2
    const v = Math.abs(this.L * om)
    const reg = regimeAt(sigma, this.d, v, tb.pitch, this.cfg.p.thicknessModel === 'thin')
    return { k: this.s * this.s * sigma * reg.dEff * kHat(tb, u) * reg.G, sigma, reg, u, v }
  }

  protected deriv(y: Float64Array, dy: Float64Array) {
    const c = this.coeff(y[0], y[1], y[3])
    dy[0] = y[1]
    // θ'' = −(g/L) sinθ − (k/m)·θ'   (torque = F·L, I = m L²)
    dy[1] = -(G / this.L) * Math.sin(y[0]) - (c.k / this.m) * y[1]
    dy[2] = c.k * c.v * c.v
    dy[3] = (c.k * c.v * c.v - this.hA * (y[3] - T_AMBIENT)) / this.C
  }

  protected finalize() {
    const y = this.y
    const c = this.coeff(y[0], y[1], y[3])
    this.pos = this.L * Math.sin(y[0])
    this.v = c.v
    this.T = y[3]
    this.Qheat = y[2]
    this.k = c.k
    this.F = c.k * c.v
    this.P = this.F * c.v
    this.Rm = c.reg.Rm
    this.regime = regShort(c.reg.label)
    this.dEff = c.reg.dEff
    this.delta = c.reg.delta
    this.w = c.reg.w
    this.emf = this.Bgap * c.v * (this.cfg.p.magB / 1000)
    const lam = c.sigma * c.v * this.s * (c.reg.dEff / this.d) * c.reg.G
    this.lam = lam
    this.Jmax = lam * sampleQty(this.table!, c.u, 'Jm')
    this.I = this.d * lam * sampleQty(this.table!, c.u, 'PsiM')
    const PJ = c.sigma * c.reg.dEff * pHat(this.table!, c.u) * this.s * this.s * c.reg.G * c.v * c.v
    this.pErr = this.F > 1e-9 ? ((PJ - this.P) / this.P) * 100 : 0
    const mech = this.m * G * this.L * (1 - Math.cos(y[0])) + 0.5 * this.m * this.L ** 2 * y[1] ** 2
    this.energyErr = this.E0 - (mech + y[2])
    if (!this.stopped && mech < 0.01 * this.E0 && this.t > 0.2) {
      this.stopped = true
      this.stopTime = this.t
      this.stopPos = (y[0] * 180) / Math.PI
    }
  }

  protected analytic() {}

  energySplit(): EnergySplit | null {
    const y = this.y
    return { E0: this.E0, heat: y[2], loss: 0, ke: this.m * G * this.L * (1 - Math.cos(y[0])) + 0.5 * this.m * this.L ** 2 * y[1] ** 2 }
  }

  get fieldU() {
    return this.L * Math.sin(this.y[0]) + this.table!.Lambda / 2
  }

  forceCurve(v: number): number | null {
    const tb = this.table!
    const sigma = this.mat.sigma / (1 + this.mat.alpha * (this.T - T_REF))
    const reg = regimeAt(sigma, this.d, v, tb.pitch, this.cfg.p.thicknessModel === 'thin')
    return this.s * this.s * sigma * reg.dEff * this.Kc * reg.G * v
  }

  get theta() {
    return this.y[0]
  }
  get length() {
    return this.L
  }

  rows(): Row[] {
    return [
      { label: 'Angle θ', unit: '°', value: f((this.y[0] * 180) / Math.PI, 1) },
      { core: true, label: 'Plate speed v = L·θ̇', unit: 'm/s', value: f(this.v, 3) },
      { core: true, label: 'Brake force F', unit: 'N', value: f(this.F, 2) },
      { label: 'Coefficient k (plate at x)', unit: 'N·s/m', value: f(this.k, 1) },
      { label: 'Gap field B', unit: 'T', value: f(this.Bgap, 3) },
      { label: 'Peak current density J', unit: 'A/mm²', value: f(this.Jmax / 1e6, 2) },
      { label: 'Vortex current I', unit: 'A', value: f(this.I, 1) },
      { label: 'Rm = μ₀σvd', unit: '', value: f(this.Rm, 3) },
      { label: 'Regime', unit: '', value: this.regime },
      { label: 'Joule power P', unit: 'W', value: f(this.P, 1), heat: true },
      { label: 'P = F·v check', unit: '%', value: f(this.pErr, 4) },
      { core: true, label: 'Plate temperature', unit: '°C', value: f(this.T, 2), heat: true },
      { core: true, label: 'Mechanical energy', unit: 'J', value: f(this.m * G * this.L * (1 - Math.cos(this.y[0])) + 0.5 * this.m * this.L ** 2 * this.y[1] ** 2, 3) },
      { label: 'Heat in plate', unit: 'J', value: f(this.Qheat, 3), heat: true },
      { core: true, label: 'Energy error', unit: 'J', value: f(this.energyErr, 5) },
      { core: true, label: 'Settled (<1 % energy) after', unit: 's', value: this.stopped ? f(this.stopTime, 2) : '—' },
    ]
  }
}

// =================================================================== DISC

export class DiscLane extends Lane {
  private mat
  private d: number
  private Rd: number
  private rm: number
  private Idisc: number
  private C: number
  private hA: number
  private brake: LaneConfig['brake']
  private val: boolean
  private Kc: number
  private w0: number
  private uC: number

  constructor(cfg: LaneConfig, table: BrakeTable | null) {
    super(cfg, table, 4) // ω, Qfin, Qbearing, T
    const p = cfg.p
    this.mat = materialById(p.materialId)
    this.d = p.thicknessMm / 1000
    this.Rd = p.discRmm / 1000
    this.rm = 0.75 * this.Rd
    this.Idisc = 0.5 * p.discMass * this.Rd ** 2
    this.brake = cfg.brake
    this.val = p.validation
    this.C = this.mat.rho * this.mat.cp * Math.PI * this.Rd ** 2 * this.d
    this.hA = H_CONV * 2 * Math.PI * this.Rd ** 2
    this.uC = table ? table.Lambda / 2 : 0
    this.Kc = table ? kHat(table, this.uC) : 0
    this.w0 = (p.discRpm * 2 * Math.PI) / 60
    this.y[0] = this.w0
    this.y[3] = T_AMBIENT
    this.E0 = 0.5 * this.Idisc * this.w0 ** 2
    this.kConst = this.s * this.s * this.mat.sigma * this.d * this.Kc
    this.finalize()
  }

  private coeff(om: number, T: number) {
    const tb = this.table!
    const sigma = this.val ? this.mat.sigma : this.mat.sigma / (1 + this.mat.alpha * (T - T_REF))
    const v = Math.abs(om) * this.rm
    if (this.val) return { k: this.kConst, sigma, reg: regimeAt(sigma, this.d, 0, tb.pitch, this.cfg.p.thicknessModel === 'thin'), v, G: 1 }
    const reg = regimeAt(sigma, this.d, v, tb.pitch, this.cfg.p.thicknessModel === 'thin')
    return { k: this.s * this.s * sigma * reg.dEff * this.Kc * reg.G, sigma, reg, v, G: reg.G }
  }

  protected deriv(y: Float64Array, dy: Float64Array) {
    const om = Math.max(y[0], 0)
    let k = 0
    if (this.brake === 'eddy' && this.table) k = this.coeff(om, y[3]).k
    const v = om * this.rm
    const F = k * v
    const tauB = this.val ? 0 : 0.002 * Math.tanh(om / 0.5) // bearing friction [N·m]
    // I dω/dt = −F·r_m − τ_bearing
    dy[0] = -(F * this.rm + tauB) / this.Idisc
    dy[1] = F * v
    dy[2] = tauB * om
    dy[3] = this.val ? 0 : (F * v - this.hA * (y[3] - T_AMBIENT)) / this.C
  }

  protected finalize() {
    const y = this.y
    if (y[0] < 0) y[0] = 0
    this.v = y[0] * this.rm
    this.pos = y[0]
    this.T = y[3]
    this.Qheat = y[1]
    this.Qloss = y[2]
    this.F = this.k = this.P = this.emf = this.Jmax = this.I = this.pErr = 0
    if (this.brake === 'eddy' && this.table) {
      const c = this.coeff(y[0], y[3])
      this.k = c.k
      this.F = c.k * this.v
      this.P = this.F * this.v
      this.Rm = c.reg.Rm
      this.regime = regShort(c.reg.label)
      this.dEff = c.reg.dEff
      this.delta = c.reg.delta
      this.w = c.reg.w
      this.emf = this.Bgap * this.v * (this.cfg.p.magB / 1000)
      const lam = c.sigma * this.v * this.s * (c.reg.dEff / this.d) * c.G
      this.lam = lam
      this.Jmax = lam * sampleQty(this.table, this.uC, 'Jm')
      this.I = this.d * lam * sampleQty(this.table, this.uC, 'PsiM')
      const PJ = c.sigma * c.reg.dEff * pHat(this.table, this.uC) * this.s * this.s * c.G * this.v * this.v
      this.pErr = this.F > 1e-9 && !this.val ? ((PJ - this.P) / this.P) * 100 : 0
    }
    this.energyErr = this.E0 - (0.5 * this.Idisc * y[0] ** 2 + y[1] + y[2])
    if (!this.stopped && y[0] < 0.05 * this.w0 && this.t > 0.05) {
      this.stopped = true
      this.stopTime = this.t
    }
  }

  protected analytic() {
    if (this.brake !== 'eddy') return
    const tau = this.Idisc / (this.kConst * this.rm * this.rm)
    this.vA = this.w0 * this.rm * Math.exp(-this.t / tau)
  }

  energySplit(): EnergySplit | null {
    return { E0: this.E0, heat: this.y[1], loss: this.y[2], ke: 0.5 * this.Idisc * this.y[0] ** 2 }
  }

  get fieldU() {
    return this.uC
  }

  forceCurve(v: number): number | null {
    if (this.brake !== 'eddy' || !this.table) return null
    const sigma = this.mat.sigma / (1 + this.mat.alpha * (this.T - T_REF))
    const reg = regimeAt(sigma, this.d, v, this.table.pitch, this.cfg.p.thicknessModel === 'thin')
    return this.s * this.s * sigma * reg.dEff * this.Kc * reg.G * v
  }

  get omega() {
    return this.y[0]
  }
  get radii() {
    return { R: this.Rd, rm: this.rm }
  }

  rows(): Row[] {
    const rows: Row[] = [
      { core: true, label: 'Angular speed ω', unit: 'rad/s', value: f(this.y[0], 1) },
      { label: 'Speed', unit: 'rpm', value: f((this.y[0] * 60) / (2 * Math.PI), 0) },
      { label: 'Rim speed at r_m', unit: 'm/s', value: f(this.v, 2) },
      { core: true, label: 'Brake force F', unit: 'N', value: f(this.F, 1) },
      { core: true, label: 'Braking torque τ = F·r_m', unit: 'N·m', value: f(this.F * this.rm, 3) },
      { label: 'Coefficient k', unit: 'N·s/m', value: f(this.k, 1) },
      { label: 'Field B', unit: 'T', value: this.brake === 'eddy' ? f(this.Bgap, 3) : '—' },
      { label: 'Peak current density J', unit: 'A/mm²', value: f(this.Jmax / 1e6, 2) },
      { label: 'Rm = μ₀σvd', unit: '', value: this.brake === 'eddy' ? f(this.Rm, 2) : '—' },
      { label: 'Regime', unit: '', value: this.brake === 'eddy' ? this.regime : '—' },
      { label: 'Joule power P', unit: 'W', value: f(this.P, 0), heat: true },
      { core: true, label: 'Disc temperature', unit: '°C', value: f(this.T, 2), heat: true },
      { label: 'Kinetic energy', unit: 'J', value: f(0.5 * this.Idisc * this.y[0] ** 2, 1) },
      { label: 'Heat in disc', unit: 'J', value: f(this.Qheat, 1), heat: true },
      { core: true, label: 'Energy error', unit: 'J', value: f(this.energyErr, 5) },
      { core: true, label: 'Below 5 % speed after', unit: 's', value: this.stopped ? f(this.stopTime, 2) : '—' },
    ]
    if (this.val && this.brake === 'eddy') {
      const tau = this.Idisc / (this.kConst * this.rm * this.rm)
      rows.push({ label: 'τ = I/(k·r_m²) (analytic)', unit: 's', value: f(tau, 3) })
    }
    return rows
  }
}
