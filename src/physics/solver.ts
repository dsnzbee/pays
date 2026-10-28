/**
 * 2D eddy-current solver for a thin conducting plate in the x–z plane.
 *
 * LOW MAGNETIC REYNOLDS NUMBER FORMULATION (Rm ≪ 1: the eddy currents' own field
 * is neglected, so B is just the applied magnet field)
 *   Frame of the magnets (static B).  Plate velocity v = v·x̂.
 *   Ohm's law in a moving conductor:   J = σ(E + v×B),   E = −∇φ  (static B ⇒ curl-free E)
 *   With v = (v,0,0), B = (Bx,By,Bz):  v×B = (0, −v·Bz, v·By)
 *   For a thin plate (in-plane currents only) only B_y matters:
 *        J_x = −σ ∂φ/∂x ,       J_z = σ(−∂φ/∂z + v·B_y)
 *   Charge conservation ∇·J = 0 gives the Poisson equation
 *        ∇²φ = ∂(v·B_y)/∂z              (source = ∇·(v×B))
 *   Boundary condition on the plate edges and slot walls: J·n = 0  (Neumann).
 *
 * LINEARITY: J ∝ v and σ factors out of φ, so we solve once per plate position
 * with v = 1 and σ̂ ∈ {0,1} (slot mask):  ĵ = (−∇φ̂, ·) ;  then for real values
 *        J = σ·v·ĵ ,   F = σ·d·v·K̂ ,   P = σ·d·v²·P̂
 *   K̂ = ∬ ĵ_z B_y dA        (force magnitude per σ·d·v; F_x = −d∬J_z B_y dA)
 *   P̂ = ∬ |ĵ|² dA           (Joule power per σ·d·v²)
 *   At convergence the discrete identity K̂ = P̂ (P = F·v) holds exactly:
 *   it follows from Σ φ·(∇·J) = 0, so it is a check on the solver residual.
 *
 * DISCRETISATION: cell-centred finite volumes (nx × nz), face conductance 0 if
 * either neighbouring cell is a slot. The symmetric system is solved by preconditioned
 * conjugate gradients (SSOR preconditioner, warm start from the previous plate position).
 * Plain SOR needed >1000 sweeps for slotted plates and left a 2–4 % K̂–P̂ residual.
 *
 * STREAM FUNCTION: J = ∇×(ψ ŷ) ⇒ J_x = ∂ψ/∂z, J_z = −∂ψ/∂x. ψ is constant on
 * the plate boundary, so contours of ψ are the current streamlines (they show
 * the counter-rotating vortices at the pole edges).
 */

import { ArraySpec, arrayLength, buildFieldTable, fieldProfile, gapCentreField } from './magnet'

export interface FinSpec {
  Lf: number // plate length along x [m]
  Hf: number // plate height along z [m]
  nx: number
  nz: number
  slots: number // number of slots cut from the bottom edge
  slotDepth: number // fraction of Hf (0..1)
  slotWidth: number // [m]
}

export interface TableRequest {
  magnet: ArraySpec
  fin: FinSpec
  /** 'Until stop' mode: array without an end. Entry ramp at the start, then the periodic interior tiled forever. */
  infinite?: boolean
}

/** Serializable result (typed arrays are transferred from the worker). */
export interface BrakeTable {
  nx: number
  nz: number
  Lf: number
  Hf: number
  dx: number
  dz: number
  mask: Uint8Array
  maskFrac: number // conductive area fraction
  Lambda: number // array length
  pitch: number
  period: number // 2·pitch (field pattern period) — used for the interior
  u0: number
  du: number
  half: number // entry table covers u ∈ [u0, half]
  uStable: number // periodic interior starts here (if usePeriodic)
  usePeriodic: boolean
  nEntry: number
  nPer: number
  entryK: Float32Array
  entryP: Float32Array
  perK: Float32Array
  perP: Float32Array
  entryJm: Float32Array // per-sample max |ĵ|
  entryPsiM: Float32Array // per-sample max |ψ̂|
  perJm: Float32Array
  perPsiM: Float32Array
  entryPsi: Float32Array // nEntry × (nx+1)(nz+1)
  entryJ: Float32Array // nEntry × nx·nz  (|ĵ|, cell-centred)
  perPsi: Float32Array
  perJ: Float32Array
  Bc1: number // gap-centre field per unit Br
  profileX: Float32Array
  profileB: Float32Array
  maxIter: number
  solveMs: number
  maxResidual: number
}

export function makeMask(f: FinSpec): Uint8Array {
  const m = new Uint8Array(f.nx * f.nz).fill(1)
  const dx = f.Lf / f.nx
  const wCells = Math.max(1, Math.round(f.slotWidth / dx))
  const depth = Math.round(f.slotDepth * f.nz)
  for (let k = 0; k < f.slots; k++) {
    const xc = ((k + 1) / (f.slots + 1)) * f.nx
    const i0 = Math.round(xc - wCells / 2)
    for (let i = i0; i < i0 + wCells; i++) {
      if (i < 0 || i >= f.nx) continue
      for (let j = 0; j < depth; j++) m[i * f.nz + j] = 0
    }
  }
  return m
}

export interface Workspace {
  diag: Float64Array
  b: Float64Array
  r: Float64Array
  z: Float64Array
  p: Float64Array
  q: Float64Array
  y: Float64Array
}
export const makeWorkspace = (n: number): Workspace => ({
  diag: new Float64Array(n), b: new Float64Array(n), r: new Float64Array(n), z: new Float64Array(n),
  p: new Float64Array(n), q: new Float64Array(n), y: new Float64Array(n),
})

interface SampleOut {
  K: number
  P: number
  iters: number
  Jm: number // max |ĵ|
  PsiM: number // max |ψ̂| (circulating current of the strongest vortex / (σ·d·v))
}

/**
 * Solve one plate position. `By` is the cell-centred field of the plate cells
 * ([i*nz + j], per unit Br). `phi` is the warm start (in/out).
 * Optionally writes ψ (nodes) and |ĵ| (cells).
 */
export function solveSample(
  mask: Uint8Array, By: Float32Array, nx: number, nz: number, dx: number, dz: number,
  phi: Float64Array, ws: Workspace, psiOut?: Float32Array, jOut?: Float32Array, tolRel = 3e-6, maxIter = 600,
): SampleOut {
  const cx = dz / dx
  const cz = dx / dz
  const N = nx * nz
  // Linear system A·φ = b (A = discrete −∇·σ̂∇, symmetric positive semi-definite, singular only
  // up to a constant per connected piece). b_c = −dx·(σ_n B_n − σ_s B_s): the ∇·(v×B) source.
  const diag = ws.diag
  const rhsB = ws.b
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const c = i * nz + j
      let sum = 0
      let b = 0
      if (!mask[c]) { diag[c] = 0; rhsB[c] = 0; continue }
      if (i < nx - 1 && mask[c + nz]) sum += cx
      if (i > 0 && mask[c - nz]) sum += cx
      if (j < nz - 1 && mask[c + 1]) { sum += cz; b -= dx * 0.5 * (By[c] + By[c + 1]) }
      if (j > 0 && mask[c - 1]) { sum += cz; b += dx * 0.5 * (By[c] + By[c - 1]) }
      diag[c] = sum
      rhsB[c] = b
    }
  }
  const { r, z, p, q, y } = ws
  const applyA = (x: Float64Array, out: Float64Array) => {
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const c = i * nz + j
        if (diag[c] === 0) { out[c] = 0; continue }
        let v = diag[c] * x[c]
        if (i < nx - 1 && mask[c + nz]) v -= cx * x[c + nz]
        if (i > 0 && mask[c - nz]) v -= cx * x[c - nz]
        if (j < nz - 1 && mask[c + 1]) v -= cz * x[c + 1]
        if (j > 0 && mask[c - 1]) v -= cz * x[c - 1]
        out[c] = v
      }
    }
  }
  // SSOR(ω=1) preconditioner:  z = (D−U)^{-1} D (D−L)^{-1} r
  const precond = (rin: Float64Array, zout: Float64Array) => {
    for (let c = 0; c < N; c++) {
      if (diag[c] === 0) { y[c] = 0; continue }
      const i = (c / nz) | 0
      const j = c - i * nz
      let v = rin[c]
      if (i > 0 && mask[c - nz]) v += cx * y[c - nz]
      if (j > 0 && mask[c - 1]) v += cz * y[c - 1]
      y[c] = v / diag[c]
    }
    for (let c = N - 1; c >= 0; c--) {
      if (diag[c] === 0) { zout[c] = 0; continue }
      const i = (c / nz) | 0
      const j = c - i * nz
      let v = diag[c] * y[c]
      if (i < nx - 1 && mask[c + nz]) v += cx * zout[c + nz]
      if (j < nz - 1 && mask[c + 1]) v += cz * zout[c + 1]
      zout[c] = v / diag[c]
    }
  }
  applyA(phi, q)
  let bnorm = 0
  for (let c = 0; c < N; c++) { r[c] = rhsB[c] - q[c]; bnorm += rhsB[c] * rhsB[c] }
  bnorm = Math.sqrt(bnorm) + 1e-300
  precond(r, z)
  let rz = 0
  for (let c = 0; c < N; c++) { p[c] = z[c]; rz += r[c] * z[c] }
  let it = 0
  for (; it < maxIter; it++) {
    let rn = 0
    for (let c = 0; c < N; c++) rn += r[c] * r[c]
    if (Math.sqrt(rn) < tolRel * bnorm) break
    applyA(p, q)
    let pq = 0
    for (let c = 0; c < N; c++) pq += p[c] * q[c]
    if (pq <= 0) break
    const alpha = rz / pq
    for (let c = 0; c < N; c++) { phi[c] += alpha * p[c]; r[c] -= alpha * q[c] }
    precond(r, z)
    let rzNew = 0
    for (let c = 0; c < N; c++) rzNew += r[c] * z[c]
    const beta = rzNew / rz
    rz = rzNew
    for (let c = 0; c < N; c++) p[c] = z[c] + beta * p[c]
  }

  // Face currents (σ̂ = 1, v = 1):  jx on x-faces (nx-1)×nz,  jz on z-faces nx×(nz-1)
  let K = 0
  let P = 0
  const area = dx * dz
  const jxF = new Float64Array((nx + 1) * nz) // index i*nz+j : face on the left of cell i (0 and nx are walls = 0)
  const jzF = new Float64Array(nx * (nz + 1)) // index i*(nz+1)+j : face below cell j (0 and nz are walls = 0)
  for (let i = 1; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const c = i * nz + j
      if (mask[c] && mask[c - nz]) {
        const jx = -(phi[c] - phi[c - nz]) / dx
        jxF[i * nz + j] = jx
        P += jx * jx * area
      }
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 1; j < nz; j++) {
      const c = i * nz + j
      if (mask[c] && mask[c - 1]) {
        const byf = 0.5 * (By[c] + By[c - 1])
        const jz = -(phi[c] - phi[c - 1]) / dz + byf
        jzF[i * (nz + 1) + j] = jz
        P += jz * jz * area
        K += jz * byf * area
      }
    }
  }

  let PsiM = 0
  let Jm = 0
  if (psiOut) {
    // ψ(i, j+1) = ψ(i, j) + jx(i, j)·dz  (corner index i = 0..nx, j = 0..nz)
    const W = nz + 1
    for (let i = 0; i <= nx; i++) {
      let psi = 0
      psiOut[i * W] = 0
      for (let j = 0; j < nz; j++) {
        psi += jxF[i * nz + j] * dz
        psiOut[i * W + j + 1] = psi
        if (Math.abs(psi) > PsiM) PsiM = Math.abs(psi)
      }
    }
  }
  if (jOut) {
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const jx = 0.5 * (jxF[i * nz + j] + jxF[(i + 1) * nz + j])
        const jz = 0.5 * (jzF[i * (nz + 1) + j] + jzF[i * (nz + 1) + j + 1])
        const jm = mask[i * nz + j] ? Math.hypot(jx, jz) : 0
        jOut[i * nz + j] = jm
        if (jm > Jm) Jm = jm
      }
    }
  }
  return { K, P, iters: it, Jm, PsiM }
}

const NSTEP = 3 // plate-position step in cells

/** Compute the full position-dependent brake table for an array + plate. */
export function buildBrakeTable(req: TableRequest, onProgress?: (f: number) => void): BrakeTable {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const { fin } = req
  const infinite = !!req.infinite
  const uStableReq = fin.Lf / 2 + 3 * req.magnet.pitch
  // infinite array: the entry samples only need enough real poles to cover the entry region
  const mg: ArraySpec = infinite
    ? { ...req.magnet, pairs: Math.ceil((uStableReq + fin.Lf / 2 + 7 * req.magnet.pitch) / req.magnet.pitch) + 2 }
    : req.magnet
  const { nx, nz, Lf, Hf } = fin
  const dx = Lf / nx
  const dz = Hf / nz
  const zc = Hf / 2
  const du = NSTEP * dx
  const mask = makeMask(fin)
  let conductive = 0
  for (const m of mask) conductive += m
  const Lambda = infinite ? 1e9 : arrayLength(mg)
  const margin = Math.max(0.06, 3 * mg.gap)
  const u0 = -Lf / 2 - margin
  const uStable = Lf / 2 + 3 * mg.pitch
  const usePeriodic = uStable < Lambda / 2
  const half = usePeriodic ? uStable : Lambda / 2
  const nEntry = Math.max(2, Math.ceil((half - u0) / du) + 1)
  const period = 2 * mg.pitch
  const nPer = usePeriodic ? Math.ceil(period / du) + 1 : 0

  const phi = new Float64Array(nx * nz)
  const ws = makeWorkspace(nx * nz)
  const W = nz + 1
  let maxIter = 0

  const run = (nS: number, X0: number, infinite: boolean, progressBase: number, progressSpan: number) => {
    const ncols = nS * NSTEP + nx
    const field = buildFieldTable(mg, X0, ncols, dx, nz, dz, zc, infinite)
    const K = new Float32Array(nS)
    const P = new Float32Array(nS)
    const Jm = new Float32Array(nS)
    const PsiM = new Float32Array(nS)
    const psi = new Float32Array(nS * (nx + 1) * W)
    const J = new Float32Array(nS * nx * nz)
    for (let s = 0; s < nS; s++) {
      const By = field.subarray(s * NSTEP * nz, (s * NSTEP + nx) * nz)
      const r = solveSample(mask, By, nx, nz, dx, dz, phi, ws, psi.subarray(s * (nx + 1) * W, (s + 1) * (nx + 1) * W), J.subarray(s * nx * nz, (s + 1) * nx * nz))
      K[s] = r.K
      P[s] = r.P
      Jm[s] = r.Jm
      PsiM[s] = r.PsiM
      maxIter = Math.max(maxIter, r.iters)
      if (onProgress && s % 8 === 0) onProgress(progressBase + (progressSpan * s) / nS)
    }
    return { K, P, Jm, PsiM, psi, J }
  }

  // entry samples: plate centre u_s = u0 + s·du, plate spans X ∈ [u_s − Lf/2, u_s + Lf/2]
  const entry = run(nEntry, u0 - Lf / 2, false, 0, 0.85)
  // interior samples (periodic): infinite array
  const per = usePeriodic
    ? run(nPer, uStable - Lf / 2, true, 0.85, 0.15)
    : { K: new Float32Array(0), P: new Float32Array(0), Jm: new Float32Array(0), PsiM: new Float32Array(0), psi: new Float32Array(0), J: new Float32Array(0) }

  let maxResidual = 0
  for (let s = 0; s < nEntry; s++) {
    if (entry.K[s] > 1e-12) maxResidual = Math.max(maxResidual, Math.abs(entry.K[s] - entry.P[s]) / entry.K[s])
  }
  const prof = fieldProfile(mg, zc)
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return {
    nx, nz, Lf, Hf, dx, dz, mask, maskFrac: conductive / (nx * nz),
    Lambda, pitch: mg.pitch, period, u0, du, half, uStable, usePeriodic, nEntry, nPer,
    entryK: entry.K, entryP: entry.P, perK: per.K, perP: per.P,
    entryJm: entry.Jm, entryPsiM: entry.PsiM, perJm: per.Jm, perPsiM: per.PsiM,
    entryPsi: entry.psi, entryJ: entry.J, perPsi: per.psi, perJ: per.J,
    Bc1: gapCentreField(mg, zc), profileX: prof.xs, profileB: prof.bs,
    maxIter, solveMs: now - t0, maxResidual,
  }
}

/** Where a fin-centre coordinate u falls in the table. */
export interface Locate {
  kind: 0 | 1 | 2 // 0 = outside (no field), 1 = entry table, 2 = periodic table
  sf: number // fractional sample index
  mirror: boolean
}

export function locate(t: BrakeTable, u: number): Locate {
  const um = t.Lambda - u
  if (u <= t.half) {
    if (u < t.u0) return { kind: 0, sf: 0, mirror: false }
    return { kind: 1, sf: Math.min(t.nEntry - 1, (u - t.u0) / t.du), mirror: false }
  }
  if (um <= t.half) {
    if (um < t.u0) return { kind: 0, sf: 0, mirror: true }
    return { kind: 1, sf: Math.min(t.nEntry - 1, (um - t.u0) / t.du), mirror: true }
  }
  const q = (((u - t.uStable) % t.period) + t.period) % t.period
  return { kind: 2, sf: Math.min(t.nPer - 1, q / t.du), mirror: false }
}

function lerp(a: Float32Array, sf: number) {
  const i = Math.floor(sf)
  const f = sf - i
  return i + 1 < a.length ? a[i] * (1 - f) + a[i + 1] * f : a[i]
}

/** K̂(u) [T²·m²]: force per (σ·d·v) per unit Br². */
export function kHat(t: BrakeTable, u: number): number {
  const L = locate(t, u)
  if (L.kind === 0) return 0
  return lerp(L.kind === 1 ? t.entryK : t.perK, L.sf)
}
export function pHat(t: BrakeTable, u: number): number {
  const L = locate(t, u)
  if (L.kind === 0) return 0
  return lerp(L.kind === 1 ? t.entryP : t.perP, L.sf)
}

/** Interpolated per-sample quantity ('Jm' | 'PsiM') at u. */
export function sampleQty(t: BrakeTable, u: number, which: 'Jm' | 'PsiM'): number {
  const L = locate(t, u)
  if (L.kind === 0) return 0
  const a = which === 'Jm' ? (L.kind === 1 ? t.entryJm : t.perJm) : L.kind === 1 ? t.entryPsiM : t.perPsiM
  return lerp(a, L.sf)
}

/** Mean K̂ over one interior period (used by the "uniform field" validation mode). */
export function kHatMean(t: BrakeTable): number {
  if (t.usePeriodic) {
    const n = Math.max(1, Math.round(t.period / t.du))
    let s = 0
    for (let i = 0; i < n; i++) s += t.perK[i]
    return s / n
  }
  let mx = 0
  for (const k of t.entryK) mx = Math.max(mx, k)
  return mx
}

/** Peak |ĵ| over a whole table (normalisation for the heat-map). */
export function jHatMax(t: BrakeTable): number {
  let mx = 0
  for (const v of t.entryJ) if (v > mx) mx = v
  for (const v of t.perJ) if (v > mx) mx = v
  return mx
}
