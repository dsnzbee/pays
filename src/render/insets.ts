/**
 * "Cross-section" card (side panel, optional layer): horizontal cut through the
 * pole centres, looking down. Magnet N | gap | fin | gap | magnet S in the steel U-channel, B arrows
 *      across the gap, J_z drawn as ⊙/⊗ inside the fin and the force F (Lenz).
 */

import { geometryOf } from '../physics/config'
import { materialById } from '../physics/constants'
import type { Lane } from '../physics/lanes'
import { polaritySign } from '../physics/magnet'
import { COLORS, WARM_RGB, arrow, circleSym, clamp01, css, mixRGB, text } from './common'
import { pickSample } from './fieldViz'

export function finColor(lane: Lane): [number, number, number] {
  const tint = materialById(lane.cfg.p.materialId).tint
  const hot = clamp01((lane.T - 25) / 50)
  return mixRGB(tint, WARM_RGB, hot * 0.85)
}

// ---------------------------------------------------------------- plan section

export function drawPlanSection(ctx: CanvasRenderingContext2D, lane: Lane, x: number, y: number, w: number, h: number) {
  const p = lane.cfg.p
  const g = geometryOf(p).magnet
  const t = lane.table
  const Lf = t?.Lf ?? 0.5
  text(ctx, 'Cross-section · plan view, gap ×10', x, y + 9, 12, COLORS.muted, 500)
  const top = y + 18
  const hh = h - 22
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, top, w, hh, 6)
  ctx.clip()
  ctx.fillStyle = '#1b1b1b'
  ctx.fillRect(x, top, w, hh)

  const iron = 8e-3
  const clr = p.gapMm / 1000
  const d = p.thicknessMm / 1000
  const c = g.c
  const totalMm = 2 * (iron + c + clr) + d
  const sy = (w - 16) / totalMm // px per metre across the gap
  const cx = x + w / 2
  const dPx = d * sy
  const clrPx = clr * sy
  const cPx = c * sy
  const ironPx = iron * sy
  const finL = cx - dPx / 2
  const finR = cx + dPx / 2
  const magInL = finL - clrPx // inner faces of the magnets
  const magInR = finR + clrPx
  const span = Lf + 0.12
  const ppx = (hh - 28) / span // px per metre along the motion axis
  const yc = top + hh / 2 + 6
  const u = lane.fieldU
  const Ys = (X: number) => yc - (X - u) * ppx // world X → screen y (motion = up the page)
  const eddy = lane.cfg.brake === 'eddy'
  const nP = geometryOf(p).infinite ? 1e6 : g.pairs
  const iLo = Math.max(0, Math.floor((u - Lf / 2 - g.a) / g.pitch))
  const iHi = Math.min(nP - 1, Math.ceil((u + Lf / 2 + 0.06) / g.pitch))

  // steel U-channel arms (full height of the view) — the web is below the plane of the section
  ctx.fillStyle = '#3a3a3c'
  ctx.fillRect(magInL - cPx - ironPx, top, ironPx, hh)
  ctx.fillStyle = '#3a3a3c'
  ctx.fillRect(magInR + cPx, top, ironPx, hh)

  if (eddy) {
    for (let i = iLo; i <= iHi; i++) {
      const X0 = i * g.pitch
      const yTop = Ys(X0 + g.a)
      const yBot = Ys(X0)
      if (yBot < top - 4 || yTop > top + hh + 4) continue
      const sgn = polaritySign(i)
      // magnets: inner face colour shows polarity (light = N face, dark = S face)
      const nCol = '#a4a4a4'
      const sCol = '#555'
      ctx.fillStyle = sgn > 0 ? nCol : sCol
      ctx.fillRect(magInL - cPx, yTop, cPx, yBot - yTop)
      ctx.fillStyle = sgn > 0 ? sCol : nCol
      ctx.fillRect(magInR, yTop, cPx, yBot - yTop)
      ctx.strokeStyle = '#2a2a2a'
      ctx.lineWidth = 1
      ctx.strokeRect(magInL - cPx + 0.5, yTop + 0.5, cPx - 1, yBot - yTop - 1)
      ctx.strokeRect(magInR + 0.5, yTop + 0.5, cPx - 1, yBot - yTop - 1)
      const ym = (yTop + yBot) / 2
      if (yBot - yTop > 14) {
        text(ctx, sgn > 0 ? 'N' : 'S', magInL - cPx / 2, ym + 4, 11, '#111', 700, 'center')
        text(ctx, sgn > 0 ? 'S' : 'N', magInR + cPx / 2, ym + 4, 11, '#111', 700, 'center')
      }
    }
  }

  // fin slab
  const finTop = Ys(u + Lf / 2)
  const finBot = Ys(u - Lf / 2)
  ctx.fillStyle = css(finColor(lane))
  ctx.fillRect(finL, finTop, dPx, finBot - finTop)
  ctx.strokeStyle = '#111'
  ctx.strokeRect(finL + 0.5, finTop + 0.5, dPx - 1, finBot - finTop - 1)

  // B arrows across the gap (one per pole, N → S) drawn over the fin
  if (eddy) {
    for (let i = iLo; i <= iHi; i++) {
      const X0 = i * g.pitch
      const ym = Ys(X0 + g.a / 2)
      if (ym < top + 6 || ym > top + hh - 6) continue
      const sgn = polaritySign(i)
      const x0 = sgn > 0 ? magInL - 1 : magInR + 1
      const x1 = sgn > 0 ? magInR + 1 : magInL - 1
      arrow(ctx, x0, ym, x1, ym, COLORS.cool, 1.4, 6)
    }
    text(ctx, 'B', cx + 14, top + 14, 11, COLORS.cool, 700)
  }

  // J_z symbols inside the fin (from the real solution at mid-height)
  if (eddy && t && lane.lam > 1e3) {
    const pk = pickSample(t, u)
    if (pk) {
      const W = t.nz + 1
      const jm = Math.floor(t.nz / 2)
      const raw: number[] = []
      const step = 9
      let maxA = 1e-12
      for (let i = 0; i < t.nx; i += step) {
        const ii = pk.mirror ? t.nx - 1 - i : i
        const jz = -(pk.psi[(ii + 1) * W + jm] - pk.psi[ii * W + jm]) / t.dx
        raw.push(jz)
        maxA = Math.max(maxA, Math.abs(jz))
      }
      // calibrate the global sign: J_z under a pole must follow that pole's B_y (J = σ v×B, v>0)
      let sign = 1
      let best = 0
      for (let i = iLo; i <= iHi; i++) {
        const Xc = i * g.pitch + g.a / 2
        const xi = (Xc - (u - Lf / 2)) / Lf
        if (xi < 0.05 || xi > 0.95) continue
        const k = Math.min(raw.length - 1, Math.max(0, Math.round((xi * t.nx) / step)))
        const cand = raw[k] * polaritySign(i)
        if (Math.abs(cand) > best) {
          best = Math.abs(cand)
          sign = Math.sign(cand)
        }
      }
      for (let k = 0; k < raw.length; k++) {
        const xi = ((k * step + 0.5) / t.nx) // 0..1 along the plate from trailing to leading edge
        const X = u - Lf / 2 + xi * Lf
        const jz = raw[k] * sign
        const a = Math.abs(jz) / maxA
        if (a < 0.08) continue
        circleSym(ctx, cx, Ys(X), 1.5 + 3.4 * Math.sqrt(a), jz < 0, 'rgba(15,15,15,0.9)', 1.2)
      }
    }
  }

  // v and F arrows (left margin): F opposes v — the Lenz result
  const ax = x + 14
  arrow(ctx, ax, yc + 10, ax, yc - 32, COLORS.text, 1.6, 6)
  text(ctx, 'v', ax + 6, yc - 26, 10, COLORS.text, 700)
  if (lane.F > 0.5) {
    const len = 14 + 34 * clamp01(Math.log10(1 + lane.F / 200) / 1.5)
    arrow(ctx, ax + 18, yc + 10 - 36, ax + 18, yc + 10 - 36 + len, COLORS.text, 2.2, 7)
    text(ctx, 'F', ax + 26, yc - 22 + len * 0.55, 11, COLORS.text, 700)
  }
  ctx.restore()
  ctx.strokeStyle = COLORS.border
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, top + 0.5, w - 1, hh - 1)
  // labels under the section
  if (eddy) text(ctx, 'steel U-channel', x + 8, top + hh - 6, 9, COLORS.muted, 500, 'left')
  else text(ctx, lane.cfg.brake === 'friction' ? 'friction pads — no eddy currents' : 'no magnets installed', cx, top + 22, 10, COLORS.muted, 500, 'center')
}
