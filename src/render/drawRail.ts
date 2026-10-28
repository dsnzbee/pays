/**
 * Rail scenario, minimal: to-scale vehicle, rail, magnet rows, fin, one force arrow and
 * faint streamlines. Everything else lives behind the panel's "Layers" switches.
 * Local vehicle coordinates are metres, y up from the rail head. 1 px strokes only (2 px force arrow).
 */

import { ZONE_START, geometryOf } from '../physics/config'
import type { RailLane } from '../physics/lanes'
import { polaritySign } from '../physics/magnet'
import { COLORS, Layers, arrow, circleSym, css, scaleBar, subtleV, text } from './common'
import { drawFinField } from './fieldViz'
import { finColor } from './insets'

export const HEADER_H = 64

export function drawRailLane(ctx: CanvasRenderingContext2D, W: number, H: number, lane: RailLane, layers: Layers, drift: number) {
  const p = lane.cfg.p
  const geo = geometryOf(p)
  const g = geo.magnet
  const Lf = geo.fin.Lf
  const Hf = geo.fin.Hf
  const brake = lane.cfg.brake
  const validation = p.validation

  const ppm = Math.min(W / 4.2, (H - HEADER_H - 56) / 1.32)
  const avail = H - HEADER_H - 12
  const yRail = HEADER_H + (avail - 1.32 * ppm) / 2 + 0.87 * ppm
  const yGround = yRail + 0.45 * ppm
  const camX = W * 0.35 // the vehicle stays ~35 % from the left while the track scrolls
  const sx = (x: number) => camX + (x - lane.pos) * ppm
  const wx = (px: number) => lane.pos + (px - camX) / ppm
  const x0 = wx(-40)
  const x1 = wx(W + 40)
  const Y = (m: number) => yRail - m * ppm
  const lw = 1

  ctx.lineWidth = lw
  // ---- ground, distance ticks (every 5 m, label every 10 m), faint start line
  ctx.strokeStyle = '#2e2e2e'
  ctx.beginPath()
  ctx.moveTo(0, yGround)
  ctx.lineTo(W, yGround)
  for (let m = Math.ceil(x0 / 5) * 5; m <= x1; m += 5) {
    const px = Math.round(sx(m)) + 0.5
    ctx.moveTo(px, yGround)
    ctx.lineTo(px, yGround + 5)
  }
  ctx.stroke()
  for (let m = Math.ceil(x0 / 10) * 10; m <= x1; m += 10) text(ctx, `${m} m`, sx(m), yGround + 20, 12, COLORS.muted, 500, 'center')
  const startX = ZONE_START // pads and magnets both start acting here
  if (sx(startX) > -2 && sx(startX) < W) {
    ctx.strokeStyle = '#303030'
    ctx.setLineDash([2, 4])
    ctx.beginPath()
    ctx.moveTo(Math.round(sx(startX)) + 0.5, Y(0.95))
    ctx.lineTo(Math.round(sx(startX)) + 0.5, yGround)
    ctx.stroke()
    ctx.setLineDash([])
    if (layers.labels) text(ctx, 'braking starts', sx(startX) + 6, Y(0.95) + 12, 12, COLORS.muted, 500)
  }

  // ---- rail and light trestle posts
  ctx.strokeStyle = '#2a2a2a'
  ctx.beginPath()
  for (let s = Math.ceil(x0 / 2.5) * 2.5; s <= x1; s += 2.5) {
    ctx.moveTo(Math.round(sx(s)) + 0.5, Y(-0.045))
    ctx.lineTo(Math.round(sx(s)) + 0.5, yGround)
  }
  ctx.stroke()
  ctx.fillStyle = subtleV(ctx, Y(0), Y(-0.045), 96)
  ctx.fillRect(0, Y(0), W, 0.045 * ppm)

  // ---- magnet rows + steel channel (eddy lane)
  const finTop = -0.04
  const finBot = finTop - Hf
  const yFinT = Y(finTop)
  const yFinB = Y(finBot)
  const finMid = (finTop + finBot) / 2
  const zMagTop = finMid + g.b / 2
  const infinite = geo.infinite || validation
  const nPoles = infinite ? 1e9 : g.pairs
  const i0 = Math.max(0, Math.floor((x0 - ZONE_START) / g.pitch) - 1)
  const i1 = Math.min(nPoles - 1, Math.ceil((x1 - ZONE_START) / g.pitch) + 1)
  const zoneR = infinite ? 1e9 : ZONE_START + (g.pairs - 1) * g.pitch + g.a
  const magnet = (i: number, alpha: number, symbols: boolean) => {
    const px = sx(ZONE_START + i * g.pitch)
    const pw = g.a * ppm
    const py = Y(zMagTop)
    const ph = g.b * ppm
    const pol = polaritySign(i)
    ctx.globalAlpha = alpha
    ctx.fillStyle = subtleV(ctx, py, py + ph, pol > 0 ? 150 : 100)
    ctx.fillRect(px, py, pw, ph)
    ctx.globalAlpha = 1
    ctx.strokeStyle = alpha < 1 ? 'rgba(210,210,210,0.35)' : '#222'
    ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1)
    if (symbols && pw > 12) circleSym(ctx, px + pw / 2, py + ph / 2, Math.min(5, pw * 0.22), pol > 0, 'rgba(143,211,224,0.85)', 1)
  }
  if (brake === 'eddy') {
    const ax0 = Math.max(-4, sx(ZONE_START) - 4)
    const ax1 = Math.min(W + 4, sx(zoneR) + 4)
    if (ax1 > ax0) {
      ctx.fillStyle = '#2b2b2d'
      ctx.fillRect(ax0, Y(zMagTop + 0.02), ax1 - ax0, (g.b + 0.04) * ppm) // channel (far arm)
      ctx.fillRect(ax0, Y(finMid - g.b / 2 - 0.02), ax1 - ax0, 0.035 * ppm) // channel web
    }
    for (let i = i0; i <= i1; i++) magnet(i, 1, false) // far row
  } else if (brake === 'friction') {
    // caliper on the vehicle: two pads clamping the fin
    const cxp = sx(lane.pos)
    ctx.fillStyle = '#4a4a4c'
    ctx.fillRect(cxp - 0.05 * ppm, yFinT - 7, 0.1 * ppm, 6)
    ctx.fillRect(cxp - 0.05 * ppm, yFinB + 1, 0.1 * ppm, 6)
  }

  // ---- fin (flat, tinted by material, warmed by temperature) with the solver's streamlines
  const cx = sx(lane.pos)
  ctx.fillStyle = '#3c3c3e'
  ctx.fillRect(cx - 0.02 * ppm, Y(0.36), 0.04 * ppm, yFinT - Y(0.36) + 2) // strut from the car
  const finRect = { x: cx - (Lf / 2) * ppm, y: yFinT, w: Lf * ppm, h: Hf * ppm }
  drawFinField(ctx, lane, finRect, { streamlines: true, heat: layers.heat, base: css(finColor(lane)), bg: [30, 30, 30], drift })
  ctx.strokeStyle = '#1a1a1a'
  ctx.strokeRect(finRect.x + 0.5, finRect.y + 0.5, finRect.w - 1, finRect.h - 1)

  if (brake === 'eddy') {
    for (let i = i0; i <= i1; i++) magnet(i, 0.28, layers.bfield) // near row, see-through
  }

  // ---- vehicle: flat silhouette, 1 px outline
  const P = (m: number, h: number): [number, number] => [cx + m * ppm, Y(h)]
  const poly = (pts: [number, number][]) => {
    ctx.beginPath()
    pts.forEach(([m, h], i) => {
      const [px, py] = P(m, h)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.closePath()
  }
  poly([[-1.2, 0.36], [1.2, 0.36], [1.2, 0.64], [1.08, 0.8], [0.86, 0.87], [-1.14, 0.87], [-1.2, 0.8]])
  ctx.fillStyle = '#2a2a2c'
  ctx.fill()
  ctx.strokeStyle = '#5c5c5e'
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.fillStyle = '#19191a'
  for (const [a, b] of [[-1.0, -0.4], [-0.32, 0.28], [0.36, 0.8]]) {
    const [wx0, wy0] = P(a, 0.78)
    ctx.fillRect(wx0, wy0, (b - a) * ppm, 0.15 * ppm)
  }
  const wr = 0.13
  for (const bx of [-0.78, 0.78]) {
    const [fx, fy] = P(bx - 0.36, 0.3)
    ctx.fillStyle = '#222224'
    ctx.fillRect(fx, fy, 0.72 * ppm, 0.1 * ppm)
    ctx.strokeStyle = '#4a4a4c'
    ctx.strokeRect(fx + 0.5, fy + 0.5, 0.72 * ppm - 1, 0.1 * ppm - 1)
    for (const wo of [-0.22, 0.22]) {
      const [wxp, wyp] = P(bx + wo, wr)
      ctx.beginPath()
      ctx.arc(wxp, wyp, wr * ppm, 0, Math.PI * 2)
      ctx.fillStyle = '#1e1e20'
      ctx.fill()
      ctx.strokeStyle = '#7a7a7c'
      ctx.stroke()
      const ang = lane.pos / wr
      ctx.beginPath()
      ctx.moveTo(wxp - Math.cos(ang) * wr * ppm * 0.85, wyp - Math.sin(ang) * wr * ppm * 0.85)
      ctx.lineTo(wxp + Math.cos(ang) * wr * ppm * 0.85, wyp + Math.sin(ang) * wr * ppm * 0.85)
      ctx.stroke()
    }
  }

  // ---- the one force arrow (opposes motion), 2 px
  if (lane.F > 1) {
    const len = 16 + 38 * Math.min(1, Math.log10(1 + lane.F / 100) / 1.6)
    const ay = (yFinT + yFinB) / 2
    arrow(ctx, finRect.x - 6, ay, finRect.x - 6 - len, ay, COLORS.text, 2, 8)
  }

  // ---- optional layers
  if (layers.velocity && lane.v > 0.05) {
    const [ax, ay] = P(1.28, 0.62)
    arrow(ctx, ax, ay, ax + 14 + Math.min(100, lane.v * 6), ay, COLORS.muted, 1, 7)
  }
  if (layers.labels) {
    text(ctx, `${p.mass} kg`, cx, Y(0.55), 12, COLORS.muted, 500, 'center')
    text(ctx, `${lane.T.toFixed(1)} °C`, cx, yFinB + 24, 12, lane.T > 26 ? COLORS.warm : COLORS.muted, 500, 'center')
    if (brake === 'eddy' && sx(ZONE_START) < W && sx(zoneR) > 0) text(ctx, 'magnet zone', 16, yFinB + 24, 12, COLORS.muted, 500)
    if (brake === 'friction') text(ctx, 'friction pads', 16, yFinB + 24, 12, COLORS.muted, 500)
  }
  if (layers.scale) scaleBar(ctx, W - 130, yGround - 14, ppm, 100)
}
