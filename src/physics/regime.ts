/**
 * High-speed regime of an eddy-current brake: skin effect + Reitz thin-sheet saturation.
 *
 * With alternating poles of pitch τp the plate sees a field that changes at
 *      ω = π v / τp           (one field reversal per pole pitch → f = v/(2τp))
 * and the field penetrates a distance (skin depth)
 *      δ = √( 2 / (μ0 σ ω) ).
 * MODEL USED (an engineering interpolation between two known limits):
 *   1. Effective conducting thickness   d_eff = δ·tanh(d/δ)
 *        d ≪ δ → d_eff ≈ d  (thin plate, full thickness conducts)
 *        d ≫ δ → d_eff ≈ δ  (thick plate: only a skin carries the current)
 *   2. Reitz thin-sheet saturation of the sheet's own reaction field
 *        G(v) = 1 / (1 + (v/w)²),   w = 2 / (μ0 σ d_eff)
 *   3. Force  F = σ·d_eff·K̂·B²·v·G(v),   K̂ from the 2D solver.
 * Why: the exact solution for a plate of finite thickness under a travelling
 * field (Reitz 1970, Wouterse 1991) needs the field diffusion equation in y;
 * the tanh form reproduces its two asymptotes — F ∝ 1/v for thin sheets and
 * F ∝ v^(−1/2) for thick plates — without a second PDE.
 *
 * Magnetic Reynolds number (as requested): Rm = μ0 σ v d.
 */

import { MU0 } from './constants'

export interface Regime {
  omega: number
  delta: number
  dEff: number
  w: number // Reitz characteristic speed (≡ the "critical speed" v_c of the peak)
  G: number
  Rm: number
  label: 'low-speed (linear)' | 'transition' | 'high-speed (saturated)'
}

export const RM_LOW = 0.2
export const RM_HIGH = 2

export function regimeAt(sigma: number, d: number, v: number, pitch: number, thinOnly = false): Regime {
  const s = Math.max(sigma, 1e-12)
  const omega = (Math.PI * Math.abs(v)) / pitch
  const delta = omega > 1e-9 ? Math.sqrt(2 / (MU0 * s * omega)) : Infinity
  const dEff = !thinOnly && isFinite(delta) ? delta * Math.tanh(d / delta) : d
  const w = 2 / (MU0 * s * dEff)
  const G = 1 / (1 + (v / w) ** 2)
  const Rm = MU0 * s * Math.abs(v) * d
  const label = Rm < RM_LOW ? 'low-speed (linear)' : Rm < RM_HIGH ? 'transition' : 'high-speed (saturated)'
  return { omega, delta, dEff, w, G, Rm, label }
}

/** Brake coefficient k [N·s/m] (F = k v) for plate conductance σ·d_eff and field scale s. */
export function brakeCoefficient(sigma: number, regime: Regime, Khat: number, s: number): number {
  return sigma * regime.dEff * Khat * s * s * regime.G
}
