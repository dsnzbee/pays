/** Minimal canvas line plot: axes, ticks, multiple series, optional live dots. */

import { COLORS, FONT } from './common'

export interface Series {
  xs: number[]
  ys: number[]
  color: string
  dash?: number[]
  width?: number
}
export interface Dot {
  x: number
  y: number
  color: string
}
export interface Mark {
  x: number
  y: number
  label: string
  color: string
}
export interface PlotSpec {
  series: Series[]
  dots?: Dot[]
  marks?: Mark[]
  yMinAuto?: boolean
  xMid?: number // draw a vertical zero/reference line at this x
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
}

const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

/** Smallest "nice" step (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10^n) that is ≥ v. */
function niceStep(v: number): number {
  if (v <= 0 || !isFinite(v)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  return (STEPS.find((s) => s * p >= v * 0.9999) ?? 10) * p
}

function fmt(v: number): string {
  const a = Math.abs(v)
  if (a >= 10000) return `${Math.round(v / 1000)}k`
  if (a >= 1000) return `${parseFloat((v / 1000).toFixed(1))}k`
  return `${parseFloat(v.toFixed(a >= 10 ? 0 : 2))}`
}

export function drawPlot(canvas: HTMLCanvasElement, spec: PlotSpec) {
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth
  const cssH = canvas.clientHeight
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
  }
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const L = 40, R = 12, T = 8, B = 22
  const pw = cssW - L - R
  const ph = cssH - T - B

  const xMin = spec.xMin ?? 0
  let yMin = spec.yMin ?? 0
  let xData = 0
  let yData = 0
  let yLow = 0
  for (const sr of spec.series) {
    for (let i = 0; i < sr.xs.length; i++) {
      if (sr.xs[i] > xData) xData = sr.xs[i]
      if (sr.ys[i] > yData) yData = sr.ys[i]
      if (sr.ys[i] < yLow) yLow = sr.ys[i]
    }
  }
  if (spec.yMinAuto && yLow < 0) {
    const step = niceStep(Math.max(yData, -yLow) * 1.05)
    yMin = -step
    yData = step
  }
  // 4 equal divisions with "nice" tick values
  const xMax = spec.xMax ?? xMin + 4 * niceStep(Math.max(xData - xMin, 0.5) / 4)
  const yMax = spec.yMax ?? (spec.yMinAuto && yMin < 0 ? -yMin : yMin + 4 * niceStep(Math.max((yData - yMin) * 1.04, 1e-3) / 4))

  const X = (x: number) => L + ((x - xMin) / (xMax - xMin)) * pw
  const Y = (y: number) => T + ph - ((y - yMin) / (yMax - yMin)) * ph

  // grid + ticks
  ctx.font = `500 12px ${FONT}`
  ctx.fillStyle = COLORS.muted
  ctx.strokeStyle = '#2e2e2e'
  ctx.lineWidth = 1
  ctx.textAlign = 'right'
  for (let i = 0; i <= 4; i++) {
    const y = yMin + ((yMax - yMin) * i) / 4
    ctx.beginPath()
    ctx.moveTo(L, Math.round(Y(y)) + 0.5)
    ctx.lineTo(L + pw, Math.round(Y(y)) + 0.5)
    ctx.stroke()
    ctx.fillText(fmt(y), L - 5, Y(y) + 3)
  }
  ctx.textAlign = 'center'
  for (let i = 0; i <= 4; i++) {
    const x = xMin + ((xMax - xMin) * i) / 4
    ctx.fillText(fmt(x), X(x), cssH - 6)
  }
  ctx.strokeStyle = '#444'
  ctx.beginPath()
  ctx.moveTo(L + 0.5, T)
  ctx.lineTo(L + 0.5, T + ph)
  ctx.lineTo(L + pw, T + ph)
  ctx.stroke()

  // series
  ctx.save()
  ctx.beginPath()
  ctx.rect(L, T - 2, pw + 2, ph + 4)
  ctx.clip()
  for (const s of spec.series) {
    if (s.xs.length < 2) continue
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width ?? 1.6
    ctx.setLineDash(s.dash ?? [])
    ctx.beginPath()
    for (let i = 0; i < s.xs.length; i++) {
      const px = X(s.xs[i])
      const py = Y(s.ys[i])
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
  }
  ctx.setLineDash([])
  if (spec.xMid !== undefined) {
    ctx.strokeStyle = '#3a3a3a'
    ctx.beginPath()
    ctx.moveTo(X(spec.xMid), T)
    ctx.lineTo(X(spec.xMid), T + ph)
    ctx.stroke()
  }
  for (const d of spec.dots ?? []) {
    ctx.fillStyle = d.color
    ctx.beginPath()
    ctx.arc(X(d.x), Y(d.y), 3.2, 0, Math.PI * 2)
    ctx.fill()
  }
  for (const m of spec.marks ?? []) {
    ctx.fillStyle = m.color
    ctx.beginPath()
    ctx.arc(X(m.x), Y(m.y), 3.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = `600 12px ${FONT}`
    ctx.textAlign = X(m.x) > L + pw * 0.6 ? 'right' : 'left'
    ctx.fillText(m.label, X(m.x) + (X(m.x) > L + pw * 0.6 ? -7 : 7), Y(m.y) - 6)
  }
  ctx.restore()
}
