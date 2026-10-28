/** Shared canvas helpers and palette. */

export const COLORS = {
  bg: '#1a1a1a',
  lane: '#1e1e1e',
  panel: '#242424',
  border: '#333',
  text: '#e8e8e8',
  muted: '#8a8a8a',
  warm: '#e8a26a',
  cool: '#8fd3e0',
}
export const COOL_RGB: [number, number, number] = [143, 211, 224]
export const WARM_RGB: [number, number, number] = [232, 162, 106]
export const FONT = "Gilroy, Manrope, system-ui, -apple-system, 'Segoe UI', sans-serif"

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

export function mixRGB(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = clamp01(t)
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}
export const css = (c: [number, number, number], a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

export function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, width = 2, head = 7) {
  const ang = Math.atan2(y1 - y0, x1 - x0)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1 - Math.cos(ang) * head * 0.6, y1 - Math.sin(ang) * head * 0.6)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x1 - Math.cos(ang - 0.42) * head, y1 - Math.sin(ang - 0.42) * head)
  ctx.lineTo(x1 - Math.cos(ang + 0.42) * head, y1 - Math.sin(ang + 0.42) * head)
  ctx.closePath()
  ctx.fill()
}

/** Subtle greyscale metallic gradient (vertical highlight band). */
export function metalV(ctx: CanvasRenderingContext2D, y0: number, y1: number, base: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1)
  const L = (d: number) => `rgb(${base + d},${base + d},${base + d + 2})`
  g.addColorStop(0, L(22))
  g.addColorStop(0.35, L(6))
  g.addColorStop(0.55, L(-2))
  g.addColorStop(1, L(-14))
  return g
}
export function metalH(ctx: CanvasRenderingContext2D, x0: number, x1: number, base: number): CanvasGradient {
  const g = ctx.createLinearGradient(x0, 0, x1, 0)
  const L = (d: number) => `rgb(${base + d},${base + d},${base + d + 2})`
  g.addColorStop(0, L(14))
  g.addColorStop(0.4, L(4))
  g.addColorStop(1, L(-12))
  return g
}

export function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, weight = 500, align: CanvasTextAlign = 'left') {
  ctx.font = `${weight} ${size}px ${FONT}`
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.fillText(s, x, y)
}

export function pill(ctx: CanvasRenderingContext2D, label: string, x: number, y: number): number {
  ctx.font = `600 12px ${FONT}`
  const tw = ctx.measureText(label).width
  roundRect(ctx, x, y, tw + 24, 26, 13)
  ctx.fillStyle = '#2a2a2a'
  ctx.fill()
  ctx.strokeStyle = '#444'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = COLORS.text
  ctx.textAlign = 'left'
  ctx.fillText(label, x + 12, y + 17)
  return x + tw + 24
}

/** ⊗ (into the page) or ⊙ (out of the page) symbol. */
export function circleSym(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, into: boolean, color: string, lw = 1.1) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = lw
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  if (into) {
    const q = r * 0.55
    ctx.beginPath()
    ctx.moveTo(cx - q, cy - q); ctx.lineTo(cx + q, cy + q)
    ctx.moveTo(cx + q, cy - q); ctx.lineTo(cx - q, cy + q)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(cx, cy, Math.max(1, r * 0.3), 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Round "nice" length for a scale bar (1, 2, 5 × 10^n metres) not longer than maxMeters. */
export function niceLength(maxMeters: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(maxMeters)))
  for (const m of [5, 2, 1]) if (m * p <= maxMeters) return m * p
  return p
}

export function scaleBar(ctx: CanvasRenderingContext2D, x: number, y: number, ppm: number, maxPx: number, unit: 'auto' = 'auto') {
  void unit
  const L = niceLength(maxPx / ppm)
  const w = L * ppm
  ctx.strokeStyle = COLORS.muted
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4)
  ctx.moveTo(x, y); ctx.lineTo(x + w, y)
  ctx.moveTo(x + w, y - 4); ctx.lineTo(x + w, y + 4)
  ctx.stroke()
  const label = L >= 1 ? `${L} m` : L >= 0.01 ? `${Math.round(L * 100)} cm` : `${Math.round(L * 1000)} mm`
  text(ctx, label, x + w / 2, y - 8, 10, COLORS.muted, 600, 'center')
}

/** Optional canvas layers (all off by default; toggled in the panel's "Layers" section). */
export interface Layers {
  heat: boolean // |J| heat-map on the fin
  bfield: boolean // B-field symbols (⊗ / ⊙) on the poles
  section: boolean // cross-section card in the side panel
  velocity: boolean // velocity arrow
  scale: boolean // scale bar
  labels: boolean // text labels (mass, zone, temperature, start line…)
}
export const DEFAULT_LAYERS: Layers = { heat: false, bfield: false, section: false, velocity: false, scale: false, labels: false }

/** Very subtle metallic tone (±5 grey levels) for magnets and rail. */
export function subtleV(ctx: CanvasRenderingContext2D, y0: number, y1: number, base: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1)
  g.addColorStop(0, `rgb(${base + 5},${base + 5},${base + 6})`)
  g.addColorStop(1, `rgb(${base - 5},${base - 5},${base - 4})`)
  return g
}
