import { RefObject, useEffect, useRef } from 'react'
import type { Simulation } from '../physics/sim'
import { drawPlanSection } from '../render/insets'

/** Optional card: cross-section through the pole centres (B across the gap, J as ⊙/⊗, F against v). */
export function CrossSection({ sim }: { sim: RefObject<Simulation | null> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const c = ref.current
      const s = sim.current
      if (!c || !s || now - last < 70) return
      last = now
      const lane = s.lanes.find((l) => l.cfg.brake === 'eddy' && l.table) ?? s.lanes[1]
      const dpr = window.devicePixelRatio || 1
      const w = c.clientWidth
      const h = c.clientHeight
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
      }
      const ctx = c.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      drawPlanSection(ctx, lane, 0, 0, w, h)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [sim])
  return <canvas ref={ref} className="xsec" />
}
