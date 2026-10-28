import { MutableRefObject, RefObject, useEffect, useRef } from 'react'
import { drawScene, drawSolving, newAnim } from '../render/drawScene'
import { Layers, text } from '../render/common'
import type { Simulation } from '../physics/sim'

export interface Status {
  solving: boolean
  progress: number
}

interface Props {
  sim: RefObject<Simulation | null>
  status: MutableRefObject<Status>
  layers: RefObject<Layers>
  onTick: () => void
}

/** Owns the single rAF loop: advances the physics, draws the lanes, pings the UI at ~10 Hz. */
export function SimCanvas({ sim, status, layers, onTick }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const tickRef = useRef(onTick)
  tickRef.current = onTick

  useEffect(() => {
    const canvas = ref.current!
    const anim = newAnim()
    let raf = 0
    let prev = performance.now()
    let lastTick = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - prev) / 1000)
      prev = now
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0 || h === 0) return
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const s = sim.current
      if (!s) {
        drawSolving(ctx, w, h, status.current.progress)
        return
      }
      s.advance(dt)
      drawScene(ctx, w, h, s, anim, dt, layers.current!)
      if (status.current.solving) text(ctx, `Solving 2D field… ${Math.round(status.current.progress * 100)} %`, w / 2, 24, 12, '#8fd3e0', 500, 'center')
      if (now - lastTick > 100) {
        lastTick = now
        tickRef.current()
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [sim, status, layers])

  return <canvas ref={ref} />
}
