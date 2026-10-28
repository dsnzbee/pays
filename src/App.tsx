import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULTS, Params, SCENARIOS, Scenario } from './physics/config'
import { Simulation, createSimulation } from './physics/sim'
import { DEFAULT_LAYERS, Layers } from './render/common'
import { SimCanvas, Status } from './ui/SimCanvas'
import { Controls } from './ui/Controls'
import { PresentStrip } from './ui/PresentStrip'
import { Theory } from './ui/Theory'

// Optional URL switches for demos/screenshots:
//   ?scenario=tube&mode=pipe&validation=1&seek=3&pause=1&theory=1&panel=0&present=1&layers=heat,labels
const query = new URLSearchParams(window.location.search)
const sc0 = (SCENARIOS.find((s) => s.id === query.get('scenario'))?.id ?? 'rail') as Scenario
const initialParams: Params = {
  ...DEFAULTS[sc0],
  mode: SCENARIOS.find((s) => s.id === sc0)!.modes.find((m) => m.id === query.get('mode'))?.id ?? DEFAULTS[sc0].mode,
  validation: query.get('validation') === '1',
  zoneMode: query.get('zone') === 'finite' ? 'finite' : 'until-stop',
  matchBy: (['peak-force', 'stop-distance', 'manual'].includes(query.get('match') ?? '') ? query.get('match') : DEFAULTS[sc0].matchBy) as Params['matchBy'],
  thermalMass: query.get('thermal') === 'equal' ? 'equal' : 'realistic',
}
const initialLayers: Layers = { ...DEFAULT_LAYERS }
for (const k of (query.get('layers') ?? '').split(',')) if (k in initialLayers) initialLayers[k as keyof Layers] = true

export function App() {
  const [params, setParams] = useState<Params>(initialParams)
  const [panel, setPanel] = useState(query.get('panel') !== '0')
  const [present, setPresent] = useState(query.get('present') === '1')
  const [theory, setTheory] = useState(query.get('theory') === '1')
  const [layers, setLayers] = useState<Layers>(initialLayers)
  const [tick, setTick] = useState(0)
  const sim = useRef<Simulation | null>(null)
  const layersRef = useRef<Layers>(layers)
  layersRef.current = layers
  const status = useRef<Status>({ solving: true, progress: 0 })
  const build = useRef({ id: 0, timer: 0 as unknown as ReturnType<typeof setTimeout>, speed: 1, running: query.get('pause') !== '1' })

  /** (Re)build the simulation for `p`; debounced so slider drags don't trigger a solve per step. */
  const rebuild = useCallback((p: Params, delay = 220, seek = 0) => {
    const b = build.current
    clearTimeout(b.timer)
    const id = ++b.id
    b.timer = setTimeout(() => {
      status.current = { solving: true, progress: 0 }
      createSimulation(p, (f) => {
        if (id === b.id) status.current.progress = f
      }).then((s) => {
        if (id !== b.id) return
        s.speed = b.speed
        while (s.time < seek && !s.finished) s.advance(0.05) // ?seek=… fast-forward (demos/screenshots)
        s.running = b.running
        sim.current = s
        status.current = { solving: false, progress: 1 }
        setTick((t) => t + 1)
      })
    }, delay)
  }, [])

  useEffect(() => {
    rebuild(initialParams, 0, parseFloat(query.get('seek') ?? '') || 0)
  }, [rebuild])

  const paramsRef = useRef(params)
  paramsRef.current = params
  const togglePlay = useCallback(() => {
    const s = sim.current
    if (!s) return
    if (s.finished) rebuild(paramsRef.current, 0)
    else {
      s.running = !s.running
      build.current.running = s.running
      setTick((t) => t + 1)
    }
  }, [rebuild])

  // keyboard: Space play/pause, R reset, P present
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return
      if (e.code === 'Space') togglePlay()
      else if (e.key === 'r' || e.key === 'R') rebuild(paramsRef.current, 0)
      else if (e.key === 'p' || e.key === 'P') setPresent((v) => !v)
      else return
      e.preventDefault()
      ;(document.activeElement as HTMLElement | null)?.blur?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, rebuild])

  const update = (p: Params) => {
    setParams(p)
    rebuild(p)
  }
  const onTick = useCallback(() => setTick((t) => (t + 1) % 1e9), [])
  const s = sim.current
  const showPanel = panel && !present

  return (
    <div className="app">
      <header className="header">
        <div className="title">Eddy current braking</div>
        <div className="header-actions">
          <button className={'btn' + (present ? ' active' : '')} onClick={() => setPresent((v) => !v)}>{present ? 'Exit present' : 'Present'}</button>
          <button className={'btn' + (theory ? ' active' : '')} onClick={() => setTheory((v) => !v)}>Theory</button>
          {!present && <button className="btn" onClick={() => setPanel((v) => !v)}>{panel ? 'Hide panel' : 'Show panel'}</button>}
        </div>
      </header>
      <div className="body">
        <main className={'stage' + (present ? ' present' : '')}>
          <div className="lanes">
            <SimCanvas sim={sim} status={status} layers={layersRef} onTick={onTick} />
          </div>
          {present && <PresentStrip sim={sim} tick={tick} />}
        </main>
        {showPanel && (
          <aside className="panel">
            <Controls
              params={params}
              simRef={sim}
              tick={tick}
              solving={status.current.solving}
              layers={layers}
              onLayers={(patch) => setLayers((l) => ({ ...l, ...patch }))}
              onParams={(patch) => update({ ...params, ...patch })}
              onAlt={(patch) => update({ ...params, alt: { ...params.alt, ...patch } })}
              onScenario={(id) => update({ ...DEFAULTS[id], validation: params.validation && id !== 'pendulum' })}
              onReset={() => rebuild(params, 0)}
              onTogglePlay={togglePlay}
              onSpeed={(v) => {
                if (s) s.speed = v
                build.current.speed = v
                setTick((t) => t + 1)
              }}
            />
          </aside>
        )}
      </div>
      {theory && s && <Theory sim={s} onClose={() => setTheory(false)} />}
    </div>
  )
}
