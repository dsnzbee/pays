/** Waltenhofen pendulum and rotating disc, minimal: the moving plate with streamlines, one force arrow. */

import { geometryOf } from '../physics/config'
import type { DiscLane, PendulumLane } from '../physics/lanes'
import { COLORS, Layers, arrow, circleSym, css, scaleBar, subtleV, text } from './common'
import { drawFinField } from './fieldViz'
import { HEADER_H } from './drawRail'
import { finColor } from './insets'

export function drawPendulumLane(ctx: CanvasRenderingContext2D, W: number, H: number, lane: PendulumLane, layers: Layers, drift: number) {
  const geo = geometryOf(lane.cfg.p)
  const g = geo.magnet
  const { Lf, Hf } = geo.fin
  const L = lane.length
  const ppm = Math.min((H - HEADER_H - 48) / (L + Hf / 2 + 0.06), W / 3)
  const px = W * 0.5
  const py = HEADER_H + 8
  ctx.lineWidth = 1

  ctx.fillStyle = '#3a3a3c'
  ctx.fillRect(px - 50, py - 6, 100, 4)
  // fixed magnet block at the bottom of the swing
  const mx = px
  const my = py + L * ppm
  const mw = g.a * ppm
  const mh = g.b * ppm
  ctx.fillStyle = '#2b2b2d'
  ctx.fillRect(mx - mw / 2 - 0.025 * ppm, my - mh / 2 - 0.025 * ppm, mw + 0.05 * ppm, mh + 0.05 * ppm)
  ctx.fillStyle = subtleV(ctx, my - mh / 2, my + mh / 2, 140)
  ctx.fillRect(mx - mw / 2, my - mh / 2, mw, mh)

  const th = lane.theta
  ctx.save()
  ctx.translate(px, py)
  ctx.rotate(-th)
  ctx.strokeStyle = '#6a6a6c'
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, (L - Hf / 2) * ppm)
  ctx.stroke()
  const rect = { x: -(Lf / 2) * ppm, y: (L - Hf / 2) * ppm, w: Lf * ppm, h: Hf * ppm }
  drawFinField(ctx, lane, rect, { streamlines: true, heat: layers.heat, base: css(finColor(lane)), bg: [30, 30, 30], drift })
  ctx.restore()

  // near magnet face (see-through) over the plate
  ctx.globalAlpha = 0.28
  ctx.fillStyle = '#9a9a9c'
  ctx.fillRect(mx - mw / 2, my - mh / 2, mw, mh)
  ctx.globalAlpha = 1
  ctx.strokeStyle = 'rgba(210,210,210,0.35)'
  ctx.strokeRect(mx - mw / 2 + 0.5, my - mh / 2 + 0.5, mw - 1, mh - 1)
  if (layers.bfield) circleSym(ctx, mx, my, Math.min(5, mw * 0.25), true, COLORS.cool, 1)

  if (lane.F > 0.2) {
    const dir = -(Math.sign(lane.y[1]) || 1)
    const len = 16 + 30 * Math.min(1, Math.log10(1 + lane.F / 3) / 1.5)
    arrow(ctx, px, my + mh / 2 + 22, px + dir * len, my + mh / 2 + 22, COLORS.text, 2, 8)
  }
  if (layers.labels) {
    text(ctx, `θ = ${((th * 180) / Math.PI).toFixed(1)}°`, px + 14, py + 24, 12, COLORS.muted, 500)
    text(ctx, lane.cfg.p.slots > 0 ? `${lane.cfg.p.slots} slots` : 'solid plate', 16, H - 12, 12, COLORS.muted, 500)
  }
  if (layers.scale) scaleBar(ctx, W - 130, H - 18, ppm, 100)
}

export function drawDiscLane(ctx: CanvasRenderingContext2D, W: number, H: number, lane: DiscLane, layers: Layers, drift: number, angle: number) {
  const geo = geometryOf(lane.cfg.p)
  const g = geo.magnet
  const { R, rm } = lane.radii
  const Rpx = Math.min(W * 0.32, (H - HEADER_H - 40) / 2)
  const ppm = Rpx / R
  const cx = W * 0.5
  const cy = HEADER_H + (H - HEADER_H) / 2
  ctx.lineWidth = 1

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, Rpx, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = css(finColor(lane))
  ctx.fillRect(cx - Rpx, cy - Rpx, 2 * Rpx, 2 * Rpx)
  ctx.translate(cx, cy)
  ctx.rotate(-angle)
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  for (let k = 0; k < 6; k++) {
    ctx.rotate(Math.PI / 3)
    ctx.beginPath()
    ctx.moveTo(Rpx * 0.12, 0)
    ctx.lineTo(Rpx * 0.92, 0)
    ctx.stroke()
  }
  ctx.restore()
  ctx.strokeStyle = '#6a6a6c'
  ctx.beginPath()
  ctx.arc(cx, cy, Rpx, 0, Math.PI * 2)
  ctx.stroke()

  const mxp = cx + rm * ppm
  const myp = cy
  const eddy = lane.cfg.brake === 'eddy'
  if (eddy && lane.table) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, Rpx - 1, 0, Math.PI * 2)
    ctx.clip()
    ctx.translate(mxp, myp)
    ctx.rotate(-Math.PI / 2)
    const rect = { x: -(lane.table.Lf / 2) * ppm, y: -(lane.table.Hf / 2) * ppm, w: lane.table.Lf * ppm, h: lane.table.Hf * ppm }
    drawFinField(ctx, lane, rect, { streamlines: true, heat: layers.heat, base: 'rgba(0,0,0,0)', bg: [30, 30, 30], drift })
    ctx.restore()
    const mw = g.a * ppm
    const mh = g.b * ppm
    ctx.globalAlpha = 0.28
    ctx.fillStyle = '#9a9a9c'
    ctx.fillRect(mxp - mh / 2, myp - mw / 2, mh, mw)
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(210,210,210,0.35)'
    ctx.strokeRect(mxp - mh / 2 + 0.5, myp - mw / 2 + 0.5, mh - 1, mw - 1)
    if (layers.bfield) circleSym(ctx, mxp, myp, Math.min(5, mw * 0.25), true, COLORS.cool, 1)
  }
  if (lane.F > 0.5) arrow(ctx, mxp - 0.05 * ppm - 16, myp - 8, mxp - 0.05 * ppm - 16, myp + 12 + 24 * Math.min(1, Math.log10(1 + lane.F / 5) / 1.5), COLORS.text, 2, 8)
  if (layers.velocity && lane.v > 0.1) arrow(ctx, mxp + 30, myp + 20, mxp + 30, myp - 24, COLORS.muted, 1, 7)
  if (layers.labels) text(ctx, `${((lane.omega * 60) / (2 * Math.PI)).toFixed(0)} rpm · ${lane.T.toFixed(1)} °C`, cx, cy + Rpx + 22, 12, COLORS.muted, 500, 'center')
  if (layers.scale) scaleBar(ctx, W - 130, H - 18, ppm, 100)
}
