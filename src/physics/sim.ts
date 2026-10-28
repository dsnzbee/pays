/** Two-lane simulation driver. No rendering or UI in here. */

import { LaneConfig, Params, buildLaneConfigs, DEFAULTS, geometryOf } from './config'
import { DiscLane, Lane, PendulumLane, RailLane, TubeLane } from './lanes'
import { CRR, G } from './constants'
import { getTable } from './tables'

export interface History {
  t: number[]
  v: [number[], number[]]
  F: [number[], number[]]
  T: [number[], number[]]
  vA: [number[], number[]] // analytic reference (validation mode)
}

const DT = 0.001 // RK4 step [s]
const REC = 0.02 // history sampling interval [s]
const T_MAX: Record<Params['scenario'], number> = { rail: 90, tube: 60, pendulum: 40, disc: 30 }

/** How the friction lane was matched to the eddy lane (rail, eddy vs friction). */
export interface Calibration {
  matchBy: Params['matchBy']
  /** friction braking force used [N] */
  fricForce: number
  /** equivalent clamp force N = F/μk [N] */
  clampN: number
  /** ideal linear-model peak eddy force k̄·v₀ [N] */
  idealPeak: number
  /** peak eddy force actually reached in a full run (lower than idealPeak once the force saturates) [N] */
  eddyPeak: number
  /** eddy braking distance from a pre-run [m] */
  eddyDist: number
}

export class Simulation {
  /** set for rail, eddy vs friction */
  calib?: Calibration
  lanes: [Lane, Lane]
  params: Params
  time = 0
  running = true
  speed = 1
  hist: History = { t: [], v: [[], []], F: [[], []], T: [[], []], vA: [[], []] }
  private acc = 0
  private lastRec = -1

  constructor(params: Params, lanes: [Lane, Lane]) {
    this.params = params
    this.lanes = lanes
    this.record()
  }

  get tMax() {
    return T_MAX[this.params.scenario]
  }
  get finished() {
    // a lane without a brake (coasting) can never stop; the run ends when every braking lane has stopped
    const sc = this.params.scenario
    const coasts = (l: Lane) => (sc === 'rail' || sc === 'disc') && l.cfg.brake === 'none'
    return this.time >= this.tMax || this.lanes.every((l) => l.stopped || coasts(l))
  }
  /** eddy distance / friction distance once both have stopped (theory for equal peak force: 2) */
  get distanceRatio(): number | null {
    if (!this.calib) return null
    const [fr, ed] = this.lanes
    return fr.stopped && ed.stopped && fr.stopPos > 0 ? ed.stopPos / fr.stopPos : null
  }
  get validation() {
    return this.params.validation && this.params.scenario !== 'pendulum'
  }

  /** Advance by a wall-clock interval (scaled by the speed multiplier). */
  advance(realDt: number) {
    if (!this.running || this.finished) return
    this.acc += Math.min(realDt, 0.05) * this.speed
    while (this.acc >= DT && !this.finished) {
      for (const l of this.lanes) l.step(DT)
      this.time += DT
      this.acc -= DT
      if (this.time - this.lastRec >= REC) this.record()
    }
    if (this.finished) this.record()
  }

  private record() {
    this.lastRec = this.time
    const h = this.hist
    h.t.push(this.time)
    for (let i = 0; i < 2; i++) {
      const l = this.lanes[i]
      h.v[i].push(l.v)
      h.F[i].push(l.F)
      h.T[i].push(l.T)
      h.vA[i].push(l.vA)
    }
  }
}

export const defaultParams = (): Params => ({ ...DEFAULTS.rail })

/** Step a lane to rest (headless) and return it. */
function runToStop(l: RailLane, tMax = 90): RailLane {
  while (!l.stopped && l.t < tMax) l.step(DT)
  return l
}

/**
 * Rail, eddy vs friction: choose the friction force by the 'Match by' rule.
 *  peak force:    F = the largest force the eddy lane reaches (= k̄·v₀ when the force is linear)
 *  stop distance: F such that the friction lane stops where the eddy lane stops (secant on the pre-run)
 *  manual:        μ·N from the sliders
 */
function calibrate(p: Params, cfgs: [LaneConfig, LaneConfig], eddyTable: Awaited<ReturnType<typeof getTable>>): [LaneConfig, LaneConfig, Calibration] {
  const eddy = runToStop(new RailLane(cfgs[1], eddyTable))
  const eddyDist = eddy.stopped ? eddy.stopPos : eddy.brakedDistance
  const eq = p.thermalMass === 'equal' ? { C: eddy.bodyC, hA: eddy.bodyHA } : undefined
  const mk = (F: number | undefined): LaneConfig => ({ ...cfgs[0], fricForce: F, eqThermal: eq })
  const manualF = p.muPad * p.clampKN * 1000
  let F = manualF
  if (p.matchBy === 'peak-force') F = eddy.peakF
  else if (p.matchBy === 'stop-distance') {
    const crr = p.validation ? 0 : CRR * p.mass * G
    F = Math.max((p.mass * p.v0 * p.v0) / (2 * eddyDist) - crr, 1)
    for (let it = 0; it < 4; it++) {
      const fr = runToStop(new RailLane(mk(F), null))
      const x = fr.stopped ? fr.stopPos : fr.brakedDistance
      if (Math.abs(x / eddyDist - 1) < 1e-4) break
      F = Math.max((F + crr) * (x / eddyDist) - crr, 1) // x ∝ 1/(F + C_rr m g)
    }
  }
  const cal: Calibration = { matchBy: p.matchBy, fricForce: F, clampN: F / p.muPad, idealPeak: eddy.peakIdeal, eddyPeak: eddy.peakF, eddyDist }
  return [mk(p.matchBy === 'manual' ? undefined : F), cfgs[1], cal]
}

/** Build both lanes (solving the 2D field in the worker if needed) and the simulation. */
export async function createSimulation(p: Params, progress?: (f: number) => void): Promise<Simulation> {
  const cfgs = buildLaneConfigs(p)
  const lanes: Lane[] = []
  let done = 0
  const needs = cfgs.map((c) => (p.scenario === 'tube' ? false : p.scenario === 'rail' || p.scenario === 'disc' ? c.brake === 'eddy' : true))
  const total = Math.max(1, needs.filter(Boolean).length)
  const tables = await Promise.all(
    cfgs.map((c, i) =>
      needs[i]
        ? getTable(c.p, (f) => progress?.((done + f) / total)).then((t) => {
            done++
            return t
          })
        : Promise.resolve(null),
    ),
  )
  let calib: Calibration | undefined
  if (p.scenario === 'rail' && p.mode === 'friction' && tables[1]) {
    const [c0, c1, cal] = calibrate(p, cfgs, tables[1])
    cfgs[0] = c0
    cfgs[1] = c1
    calib = cal
  }
  cfgs.forEach((c, i) => {
    const t = tables[i]
    if (p.scenario === 'tube') lanes.push(new TubeLane(c))
    else if (p.scenario === 'pendulum') lanes.push(new PendulumLane(c, t!))
    else if (p.scenario === 'disc') lanes.push(new DiscLane(c, t))
    else lanes.push(new RailLane(c, t))
  })
  const sim = new Simulation(p, lanes as [Lane, Lane])
  sim.calib = calib
  return sim
}

export { geometryOf }
