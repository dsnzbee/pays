/**
 * Draws the 2D solver solution on the plate: |J| heat-map (grey → cool accent)
 * and current streamlines (contours of the stream function ψ).
 * The solution for the current plate position is looked up in the cached
 * BrakeTable (never re-solved here) and scaled by the live current amplitude.
 */

import type { Lane } from '../physics/lanes'
import { BrakeTable, locate } from '../physics/solver'
import { COOL_RGB } from './common'

const J_REF = 4e7 // A/m² that maps to full brightness (sqrt scale)

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Pick {
  psi: Float32Array
  j: Float32Array
  key: string
  mirror: boolean
}

export function pickSample(t: BrakeTable, u: number): Pick | null {
  const L = locate(t, u)
  if (L.kind === 0) return null
  const si = Math.round(L.sf)
  const W = t.nz + 1
  const psiN = (t.nx + 1) * W
  const jN = t.nx * t.nz
  const psi = L.kind === 1 ? t.entryPsi.subarray(si * psiN, (si + 1) * psiN) : t.perPsi.subarray(si * psiN, (si + 1) * psiN)
  const j = L.kind === 1 ? t.entryJ.subarray(si * jN, (si + 1) * jN) : t.perJ.subarray(si * jN, (si + 1) * jN)
  return { psi, j, key: `${L.kind}:${si}:${L.mirror ? 1 : 0}`, mirror: L.mirror }
}

// ---------------------------------------------------------------- heat map

const heatCache = new WeakMap<Lane, { canvas: HTMLCanvasElement; key: string }>()

function heatCanvas(lane: Lane, pk: Pick | null, bgRGB: [number, number, number], showHeat: boolean): HTMLCanvasElement {
  const t = lane.table!
  let e = heatCache.get(lane)
  if (!e) {
    const c = document.createElement('canvas')
    c.width = t.nx
    c.height = t.nz
    e = { canvas: c, key: '' }
    heatCache.set(lane, e)
  }
  const amp = lane.lam
  const key = `${pk?.key}:${showHeat ? Math.round(Math.log2(amp + 1) * 12) : 'x'}`
  if (e.key === key) return e.canvas
  e.key = key
  const ctx = e.canvas.getContext('2d')!
  const img = ctx.createImageData(t.nx, t.nz)
  const d = img.data
  for (let i = 0; i < t.nx; i++) {
    const ii = pk?.mirror ? t.nx - 1 - i : i
    for (let j = 0; j < t.nz; j++) {
      const row = t.nz - 1 - j
      const px = (row * t.nx + i) * 4
      if (!t.mask[ii * t.nz + j]) {
        d[px] = bgRGB[0]; d[px + 1] = bgRGB[1]; d[px + 2] = bgRGB[2]; d[px + 3] = 255
        continue
      }
      const jn = pk && showHeat ? Math.sqrt(Math.min(1, (amp * pk.j[ii * t.nz + j]) / J_REF)) : 0
      d[px] = COOL_RGB[0]; d[px + 1] = COOL_RGB[1]; d[px + 2] = COOL_RGB[2]
      d[px + 3] = Math.round(jn * 190)
    }
  }
  ctx.putImageData(img, 0, 0)
  return e.canvas
}

// ---------------------------------------------------------------- streamlines (marching squares)

const pathCache = new WeakMap<Lane, Map<string, Path2D>>()

function contourPath(t: BrakeTable, pk: Pick, r: Rect): Path2D {
  const nx = t.nx
  const nz = t.nz
  const W = nz + 1
  const path = new Path2D()
  let pmax = 0
  for (let i = 0; i < pk.psi.length; i++) pmax = Math.max(pmax, Math.abs(pk.psi[i]))
  if (pmax < 1e-12) return path
  const step = pmax / 5.5
  const X = (i: number) => r.x + ((pk.mirror ? nx - i : i) / nx) * r.w
  const Y = (j: number) => r.y + r.h - (j / nz) * r.h
  const psi = pk.psi
  const v = (i: number, j: number) => psi[i * W + j]
  for (let m = -5; m <= 5; m++) {
    if (m === 0) continue
    const lev = (m > 0 ? m - 0.5 : m + 0.5) * step
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const a = v(i, j) - lev
        const b = v(i + 1, j) - lev
        const c = v(i + 1, j + 1) - lev
        const d = v(i, j + 1) - lev
        const code = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0)
        if (code === 0 || code === 15) continue
        // edge crossing points
        const pts: [number, number][] = []
        const lerpX = (i0: number, ja: number, va: number, vb: number): [number, number] => [X(i0 + va / (va - vb)), Y(ja)]
        const lerpY = (ia: number, j0: number, va: number, vb: number): [number, number] => [X(ia), Y(j0 + va / (va - vb))]
        if (a > 0 !== b > 0) pts.push(lerpX(i, j, a, b)) // bottom
        if (b > 0 !== c > 0) pts.push(lerpY(i + 1, j, b, c)) // right
        if (c > 0 !== d > 0) pts.push(lerpX(i, j + 1, d, c)) // top
        if (d > 0 !== a > 0) pts.push(lerpY(i, j, a, d)) // left
        for (let q = 0; q + 1 < pts.length; q += 2) {
          path.moveTo(pts[q][0], pts[q][1])
          path.lineTo(pts[q + 1][0], pts[q + 1][1])
        }
      }
    }
  }
  return path
}

// ---------------------------------------------------------------- public

export interface FieldOpts {
  streamlines: boolean
  /** |J| heat-map layer (off by default) */
  heat: boolean
  /** colour of the plate underneath (material tint warmed by temperature) */
  base: string
  bg: [number, number, number]
  /** slow drift phase for the streamlines (0..1, advanced by the caller) */
  drift: number
}

// The solution is looked up at most ~7×/s so streamlines drift calmly instead of flickering
// when the plate moves several table samples per frame.
const held = new WeakMap<Lane, { pk: Pick | null; at: number }>()

/** Draw the plate (and, optionally, the solver solution) into rect `r`. */
export function drawFinField(ctx: CanvasRenderingContext2D, lane: Lane, r: Rect, o: FieldOpts) {
  const t = lane.table
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(r.x, r.y, r.w, r.h, 2)
  ctx.clip()
  ctx.fillStyle = o.base
  ctx.fillRect(r.x, r.y, r.w, r.h)
  if (t) {
    const now = performance.now()
    let h = held.get(lane)
    if (!h || now - h.at > 140) {
      h = { pk: lane.cfg.brake === 'eddy' ? pickSample(t, lane.fieldU) : null, at: now }
      held.set(lane, h)
    }
    const pk = h.pk
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(heatCanvas(lane, pk, o.bg, o.heat), r.x, r.y, r.w, r.h)
    if (o.streamlines && pk && lane.lam > 1e3) {
      let m = pathCache.get(lane)
      if (!m) pathCache.set(lane, (m = new Map()))
      const key = `${pk.key}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`
      let path = m.get(key)
      if (!path) {
        path = contourPath(t, pk, r)
        if (m.size > 80) m.clear()
        m.set(key, path)
      }
      const fade = Math.min(1, lane.lam * 2e-8) // fades out as the vehicle slows
      ctx.strokeStyle = `rgba(143,211,224,${(0.12 + 0.2 * fade).toFixed(3)})` // ≤ 0.35
      ctx.lineWidth = 1
      ctx.setLineDash([6, 6])
      ctx.lineDashOffset = -o.drift * 12
      ctx.stroke(path)
      ctx.setLineDash([])
    }
  }
  ctx.restore()
}
