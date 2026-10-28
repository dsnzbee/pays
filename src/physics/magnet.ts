/**
 * NdFeB permanent-magnet field model (Coulombian / surface-charge picture).
 *
 * A uniformly magnetised cuboid (magnetisation M = Br/μ0 along +y) is equivalent
 * to two oppositely charged faces. Integrating the 1/r² field of a rectangular
 * charged face gives a closed form (Yang et al. 1990; Camacho & Sosa 2013).
 * For a block [x1,x2]×[y1,y2]×[z1,z2] with M along y, outside the block:
 *
 *   B_y = Br/(4π) · Σ_{i,j,k∈{1,2}} (−1)^{i+j+k} · atan( (x−x_i)(z−z_k) / ((y−y_j)·r_ijk) )
 *   r_ijk = √((x−x_i)² + (y−y_j)² + (z−z_k)²)
 *
 * GEOMETRY ("U-channel" brake): two facing rows of blocks, one on each side of
 * the fin (the fin sits in the plane y = 0, motion along x, vertical z).
 * Poles alternate in polarity along x with pole pitch τp: the facing blocks of
 * a pair are magnetised in the SAME direction (N faces S across the gap).
 * The steel U-channel (back iron) is modelled with the method of images for a
 * flux-guiding plane of infinite permeability: a block magnetised normal to
 * the plane has an image of the same sign, so the effective thickness doubles
 * (c → 2c). This neglects steel saturation and leakage past the channel web.
 *
 * Everything is returned per unit Br (i.e. for Br = 1 T); B is linear in Br.
 */

export interface ArraySpec {
  a: number // pole length along x [m]
  b: number // pole height along z [m]
  c: number // magnet thickness along y [m]
  pitch: number // pole pitch τp [m] (centre to centre)
  pairs: number // number of poles along x (each = one facing pair)
  gap: number // distance between the two facing pole faces [m] (= fin thickness + 2·clearance)
  backIron: boolean
}

/** B_y of one block per unit Br (see header). */
export function blockBy(
  x: number, y: number, z: number,
  x1: number, x2: number, y1: number, y2: number, z1: number, z2: number,
): number {
  let s = 0
  for (let i = 0; i < 2; i++) {
    const dx = x - (i ? x2 : x1)
    for (let j = 0; j < 2; j++) {
      const dy = y - (j ? y2 : y1)
      for (let k = 0; k < 2; k++) {
        const dz = z - (k ? z2 : z1)
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz)
        const sgn = (i + j + k) % 2 === 0 ? -1 : 1
        s += sgn * Math.atan((dx * dz) / (dy * r))
      }
    }
  }
  return s / (4 * Math.PI)
}

/** Left edge of pole i. */
export const poleX = (s: ArraySpec, i: number) => i * s.pitch
/** Total array length Λ from the left edge of the first pole to the right edge of the last. */
export const arrayLength = (s: ArraySpec) => (s.pairs - 1) * s.pitch + s.a
export const polaritySign = (i: number) => (i % 2 === 0 ? 1 : -1)

/**
 * B_y at (X, y = 0, z) in the fin mid-plane, per unit Br.
 * `zc` = vertical centre of the magnets; poles `iFrom..iTo` are summed
 * (indices outside 0..pairs−1 are allowed: used for an "infinite" array).
 */
export function arrayBy(s: ArraySpec, X: number, z: number, zc: number, iFrom: number, iTo: number): number {
  const cEff = s.backIron ? 2 * s.c : s.c
  const y1 = s.gap / 2
  const y2 = y1 + cEff
  let sum = 0
  for (let i = iFrom; i <= iTo; i++) {
    const x1 = poleX(s, i)
    // top and bottom blocks give equal B_y at y = 0 (mirror symmetry of the axial vector M)
    sum += (polaritySign(i)) * blockBy(X, 0, z, x1, x1 + s.a, y1, y2, zc - s.b / 2, zc + s.b / 2)
  }
  return 2 * sum
}

/** Index window of poles that matter at position X (field decays ~e^{-πd/τp} along the array). */
export function poleWindow(s: ArraySpec, X: number, infinite: boolean): [number, number] {
  const reach = 5 * s.pitch + s.a
  let i0 = Math.floor((X - reach) / s.pitch)
  let i1 = Math.ceil((X + reach) / s.pitch)
  if (!infinite) {
    i0 = Math.max(0, i0)
    i1 = Math.min(s.pairs - 1, i1)
  }
  return [i0, i1]
}

/**
 * Field table for the solver: B_y(X_c, z_j) for columns c = 0..ncols-1 at
 * X_c = X0 + (c+½)·dx and rows z_j = (j+½)·dz. Layout col-major: [c*nz + j].
 */
export function buildFieldTable(
  s: ArraySpec, X0: number, ncols: number, dx: number, nz: number, dz: number, zc: number, infinite: boolean,
): Float32Array {
  const out = new Float32Array(ncols * nz)
  for (let c = 0; c < ncols; c++) {
    const X = X0 + (c + 0.5) * dx
    const [i0, i1] = poleWindow(s, X, infinite)
    for (let j = 0; j < nz; j++) out[c * nz + j] = i1 < i0 ? 0 : arrayBy(s, X, (j + 0.5) * dz, zc, i0, i1)
  }
  return out
}

/** B_y(x) along the track at mid-height of the fin, per unit Br. */
export function fieldProfile(s: ArraySpec, zc: number, n = 240, nPoles = 4) {
  const span = Math.min(arrayLength(s), (nPoles - 1) * s.pitch + s.a) + 2 * s.pitch * 0.5
  const x0 = -0.5 * s.pitch
  const dx = span / n
  const xs = new Float32Array(n)
  const bs = new Float32Array(n)
  for (let k = 0; k < n; k++) {
    const X = x0 + (k + 0.5) * dx
    const [i0, i1] = poleWindow(s, X, false)
    xs[k] = X
    bs[k] = i1 < i0 ? 0 : arrayBy(s, X, zc, zc, i0, i1)
  }
  return { xs, bs }
}

/** Peak |B_y| at the gap centre (centre of the first pole), per unit Br. */
export function gapCentreField(s: ArraySpec, zc: number): number {
  const X = s.a / 2
  const [i0, i1] = poleWindow({ ...s, pairs: Math.max(s.pairs, 9) }, X, false)
  return arrayBy({ ...s, pairs: Math.max(s.pairs, 9) }, X, zc, zc, i0, i1)
}
