import { RefObject, useEffect, useRef, useState } from 'react'
import { drawPlot, PlotSpec } from '../render/plot'
import { COLORS } from '../render/common'
import { T_AMBIENT } from '../physics/constants'
import type { Simulation } from '../physics/sim'

type Kind = 'v' | 'fv' | 'T' | 'B'

function buildSpec(kind: Kind, sim: Simulation): PlotSpec {
  const h = sim.hist
  const [a, b] = sim.lanes
  const TOP = COLORS.muted
  const BOT = COLORS.text
  if (kind === 'v') {
    const series: PlotSpec['series'] = [
      { xs: h.t, ys: h.v[0], color: TOP, dash: [4, 3] },
      { xs: h.t, ys: h.v[1], color: BOT },
    ]
    if (sim.validation) {
      // analytic reference: v0·e^{-t/τ} (rail, disc) or v_t(1−e^{-t/τ}) (tube), only for lanes that have one
      for (let i = 0; i < 2; i++) {
        const ys = h.vA[i]
        if (ys.some((y) => y === y)) series.push({ xs: h.t, ys, color: COLORS.cool, width: 1.1, dash: [2, 3] })
      }
    }
    return { series, dots: [{ x: sim.time, y: a.v, color: TOP }, { x: sim.time, y: b.v, color: BOT }] }
  }
  if (kind === 'T') {
    return {
      yMin: T_AMBIENT,
      series: [
        { xs: h.t, ys: h.T[0], color: COLORS.warm, dash: [4, 3] },
        { xs: h.t, ys: h.T[1], color: COLORS.warm },
      ],
      dots: [{ x: sim.time, y: a.T, color: COLORS.warm }, { x: sim.time, y: b.T, color: COLORS.warm }],
    }
  }
  if (kind === 'B') {
    const series: PlotSpec['series'] = []
    sim.lanes.forEach((l, i) => {
      if (!l.table || l.cfg.brake !== 'eddy') return
      const xs = Array.from(l.table.profileX).map((x) => x * 100) // cm
      const ys = Array.from(l.table.profileB).map((v) => v * l.s)
      series.push({ xs, ys, color: i === 0 ? TOP : BOT, dash: i === 0 ? [4, 3] : undefined })
    })
    return { series, yMinAuto: true, xMin: series.length ? -10 : 0 }
  }
  // F–v: model curve (thin dotted) + the path actually travelled (thick)
  let vMax = 0.1
  for (const l of sim.lanes) for (const v of (l === a ? h.v[0] : h.v[1])) vMax = Math.max(vMax, v)
  vMax *= 1.08
  const series: PlotSpec['series'] = []
  const marks: PlotSpec['marks'] = []
  sim.lanes.forEach((l, i) => {
    const xs: number[] = []
    const ys: number[] = []
    let best = 0
    let bestV = 0
    const vEnd = l.cfg.p.scenario === 'tube' && isFinite((l as any).vT) ? Math.max(vMax, 1.3 * (l as any).vT) : vMax
    for (let k = 0; k <= 80; k++) {
      const v = (k / 80) * vEnd
      const F = l.forceCurve(v)
      if (F === null) return
      xs.push(v)
      ys.push(F)
      if (F > best) { best = F; bestV = v }
    }
    series.push({ xs, ys, color: i === 0 ? TOP : BOT, width: 0.9, dash: [1.5, 3] })
    if (bestV > 0 && bestV < vEnd * 0.97 && l.cfg.brake === 'eddy') marks.push({ x: bestV, y: best, label: `peak ${best >= 1000 ? (best / 1000).toFixed(1) + ' kN' : best.toFixed(0) + ' N'} @ ${bestV.toFixed(1)} m/s`, color: COLORS.cool })
  })
  series.push({ xs: h.v[0], ys: h.F[0], color: TOP, dash: [4, 3] }, { xs: h.v[1], ys: h.F[1], color: BOT })
  return {
    series,
    marks,
    xMax: undefined,
    dots: [{ x: a.v, y: a.F, color: TOP }, { x: b.v, y: b.F, color: BOT }],
  }
}

export function Graph({ sim, kind, className = 'graph' }: { sim: RefObject<Simulation | null>; kind: Kind; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < 60 || !ref.current || !sim.current) return
      last = now
      drawPlot(ref.current, buildSpec(kind, sim.current))
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [sim, kind])
  return <canvas ref={ref} className={className} />
}

const TABS: { id: Kind; label: string; title: string }[] = [
  { id: 'v', label: 'v(t)', title: 'Speed, m/s vs s' },
  { id: 'fv', label: 'F(v)', title: 'Braking force, N vs m/s · dotted = model' },
  { id: 'T', label: 'T(t)', title: 'Temperature, °C vs s' },
  { id: 'B', label: 'B(x)', title: 'Field B_y, T vs cm along the track' },
]

/** One graph at a time, chosen from a small tab bar. */
export function Graphs({ sim, tick }: { sim: RefObject<Simulation | null>; tick: number }) {
  void tick
  const [kind, setKind] = useState<Kind>('v')
  const s = sim.current
  const hasField = !!s?.lanes.some((l) => l.table && l.cfg.brake === 'eddy')
  const tabs = TABS.filter((t) => t.id !== 'B' || hasField)
  const active = tabs.some((t) => t.id === kind) ? kind : 'v'
  let valLine: string | null = null
  if (s && s.validation && active === 'v') {
    const l = s.lanes.find((x) => x.vA === x.vA)
    if (l) {
      const ref = s.params.scenario === 'tube' ? Math.max(l.vA, 1e-9) : Math.max(l.vA, 1e-3 * s.params.v0)
      valLine = `analytic ${s.params.scenario === 'tube' ? 'v_t(1 − e^(−t/τ))' : 'v₀·e^(−t/τ)'} · live error ${(((l.v - l.vA) / ref) * 100).toFixed(5)} %`
    }
  }
  return (
    <div className="graphs">
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={'tab' + (t.id === active ? ' on' : '')} onClick={() => setKind(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="graph-title">{tabs.find((t) => t.id === active)!.title}</div>
      <Graph sim={sim} kind={active} />
      <div className="legend">
        <span><i style={{ borderColor: COLORS.muted, borderTopStyle: 'dashed' }} />Top lane</span>
        <span><i style={{ borderColor: COLORS.text }} />Bottom lane</span>
        {s?.validation && active === 'v' && <span><i style={{ borderColor: COLORS.cool, borderTopStyle: 'dotted' }} />Analytic</span>}
      </div>
      {valLine && <p className="hint">{valLine}</p>}
    </div>
  )
}
