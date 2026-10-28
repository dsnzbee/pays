/**
 * Lenz tube, minimal: whole pipe to scale (left) and an isotropic close-up around the magnet
 * with the induced ring currents (right). One force arrow (magnetic drag, upward).
 */

import { materialById } from '../physics/constants'
import type { TubeLane } from '../physics/lanes'
import { COLORS, Layers, WARM_RGB, arrow, clamp01, css, mixRGB, scaleBar, text } from './common'
import { HEADER_H } from './drawRail'

export function drawTubeLane(ctx: CanvasRenderingContext2D, W: number, H: number, lane: TubeLane, layers: Layers, phase: number) {
  const { a, w, L } = lane.geometry
  const p = lane.cfg.p
  const tint = mixRGB(materialById(p.materialId).tint, WARM_RGB, clamp01((lane.T - 25) / 30))
  const top = HEADER_H + 8
  const bottom = H - 24
  ctx.lineWidth = 1

  // ---------- overview (to scale)
  const ppm = (bottom - top) / (L + 0.04)
  const ox = 48
  const yOf = (z: number) => top + 0.02 * ppm + z * ppm
  const OD = p.pipeOdMm / 1000
  const pw = Math.max(8, OD * ppm)
  ctx.fillStyle = css(tint)
  ctx.fillRect(ox - pw / 2, yOf(0), Math.max(1, w * ppm), L * ppm)
  ctx.fillRect(ox + pw / 2 - Math.max(1, w * ppm), yOf(0), Math.max(1, w * ppm), L * ppm)
  ctx.fillStyle = COLORS.text
  ctx.beginPath()
  ctx.arc(ox, yOf(Math.min(lane.pos, L)), 3, 0, Math.PI * 2)
  ctx.fill()

  // ---------- close-up (isotropic, 14 cm window centred on the magnet)
  const zoom = (bottom - top) / 0.14
  const cx = W * 0.56
  const cy = (top + bottom) / 2
  const half = (OD / 2) * zoom
  const wallPx = Math.max(2, w * zoom)
  ctx.fillStyle = css(tint)
  ctx.fillRect(cx - half, top, wallPx, bottom - top)
  ctx.fillRect(cx + half - wallPx, top, wallPx, bottom - top)
  // rings: J ∝ dΦ/dz ∝ z/(a²+z²)^{5/2}, antisymmetric about the magnet
  const rx = (OD / 2 - w / 2) * zoom
  const ry = rx * 0.22
  const amp = Math.sqrt(clamp01(lane.Jmax / 1.2e6))
  if (amp > 0.01) {
    for (let k = -6; k <= 6; k++) {
      if (k === 0) continue
      const zr = (k * a) / 3
      const f = zr / a / Math.pow(1 + (zr / a) ** 2, 2.5) / 0.4293
      const al = clamp01(Math.abs(f)) * amp
      if (al < 0.05) continue
      const yy = cy + zr * zoom
      ctx.strokeStyle = `rgba(143,211,224,${(0.1 + 0.25 * al).toFixed(3)})`
      ctx.beginPath()
      ctx.ellipse(cx, yy, rx, ry, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = `rgba(143,211,224,${(0.2 + 0.3 * al).toFixed(3)})`
      for (let q = 0; q < 3; q++) {
        const th = (Math.sign(f) * (phase * 0.5 + q / 3) * Math.PI * 2) % (Math.PI * 2)
        ctx.beginPath()
        ctx.arc(cx + rx * Math.cos(th), yy + ry * Math.sin(th), 1.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  const mr = (p.magDiaMm / 2000) * zoom
  ctx.beginPath()
  if (p.magShape === 'sphere') ctx.arc(cx, cy, mr, 0, Math.PI * 2)
  else ctx.roundRect(cx - mr, cy - (p.magLenMm / 2000) * zoom, mr * 2, (p.magLenMm / 1000) * zoom, 3)
  ctx.fillStyle = '#7c7c7e'
  ctx.fill()
  ctx.strokeStyle = '#9a9a9c'
  ctx.stroke()
  // the one force arrow: magnetic drag on the magnet, pointing up (opposing the fall)
  if (lane.F > 1e-4) arrow(ctx, cx + mr + 18, cy + 4, cx + mr + 18, cy - 12 - 60 * clamp01(lane.F / (lane.magnetMass * 9.81)), COLORS.text, 2, 8)
  if (layers.velocity && lane.v > 0.002) arrow(ctx, cx - mr - 18, cy - 20, cx - mr - 18, cy + 10 + Math.min(40, lane.v * 300), COLORS.muted, 1, 7)
  if (layers.labels) {
    text(ctx, 'N', cx, cy - mr * 0.2, 12, '#111', 600, 'center')
    text(ctx, 'S', cx, cy + mr * 0.7, 12, '#111', 600, 'center')
    text(ctx, `${(lane.pos * 100).toFixed(0)} cm of ${(L * 100).toFixed(0)} cm`, ox + pw / 2 + 12, yOf(Math.min(lane.pos, L)) + 4, 12, COLORS.muted, 500)
  }
  if (layers.scale) scaleBar(ctx, cx - 90, bottom - 4, zoom, 80)
}
