import { RefObject } from 'react'
import { DEFAULTS, Params, SCENARIOS, Scenario, modeDef } from '../physics/config'
import { GRADES, MATERIALS } from '../physics/constants'
import type { Simulation } from '../physics/sim'
import type { Layers } from '../render/common'
import { CrossSection } from './CrossSection'
import { Graphs } from './Graphs'
import { Readouts } from './Readouts'
import { Section } from './Section'
import type { Lane } from '../physics/lanes'
import { geometryOf } from '../physics/config'

type Key = keyof Params
type Alt = Partial<Params>

interface Props {
  params: Params
  simRef: RefObject<Simulation | null>
  tick: number
  solving: boolean
  layers: Layers
  onLayers: (patch: Partial<Layers>) => void
  onParams: (patch: Partial<Params>) => void
  onAlt: (patch: Alt) => void
  onScenario: (s: Scenario) => void
  onReset: () => void
  onTogglePlay: () => void
  onSpeed: (s: number) => void
}

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5]

const LAYER_DEFS: { key: keyof Layers; label: string }[] = [
  { key: 'heat', label: '|J| heat-map on the fin' },
  { key: 'bfield', label: 'B-field symbols (⊗ ⊙)' },
  { key: 'section', label: 'Cross-section card' },
  { key: 'velocity', label: 'Velocity arrow' },
  { key: 'scale', label: 'Scale bar' },
  { key: 'labels', label: 'Labels' },
]

export function Controls(props: Props) {
  const { params: p, simRef, onParams, onAlt } = props
  const sim = simRef.current
  const sc = p.scenario
  const md = modeDef(p)
  const alt = (k: Key) => (p.alt[k] ?? (DEFAULTS[sc].alt as Alt)[k]) as never

  const Slider = (k: Key, label: string, unit: string, min: number, max: number, step: number, digits = 0) => {
    const varied = md.varies === k
    const one = (value: number, lab: string, set: (v: number) => void) => (
      <div className="field" key={lab}>
        <div className="field-head">
          <label>{lab}</label>
          <output>{value.toFixed(digits)}{unit ? ' ' + unit : ''}</output>
        </div>
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(+e.target.value)} />
      </div>
    )
    return (
      <>
        {one(p[k] as number, label + (varied ? ' · top' : ''), (v) => onParams({ [k]: v }))}
        {varied && one(alt(k) as number, label + ' · bottom', (v) => onAlt({ [k]: v }))}
      </>
    )
  }

  const Select = (k: Key, label: string, options: { id: string; name: string }[]) => {
    const varied = md.varies === k
    const one = (value: string, lab: string, set: (v: string) => void) => (
      <div className="field" key={lab}>
        <div className="field-head"><label>{lab}</label></div>
        <select value={value} onChange={(e) => set(e.target.value)}>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
    )
    return (
      <>
        {one(p[k] as string, label + (varied ? ' · top' : ''), (v) => onParams({ [k]: v }))}
        {varied && one(alt(k) as string, label + ' · bottom', (v) => onAlt({ [k]: v }))}
      </>
    )
  }

  const materials = MATERIALS.map((m) => ({ id: m.id, name: `${m.name} (σ ${m.sigma >= 1 ? (m.sigma / 1e6).toFixed(1) + ' MS/m' : '≈ 0'})` }))
  const grades = GRADES.map((g) => ({ id: g.id, name: `${g.name} (Br ${g.Br} T)` }))
  const hasArray = sc !== 'tube'
  const scDef = SCENARIOS.find((s) => s.id === sc)!
  const bTxt = sim ? sim.lanes.map((l) => (l.cfg.brake === 'eddy' ? l.Bgap.toFixed(3) : '—')).join(' | ') : ''

  return (
    <>
      <Section title="Scenario and comparison" defaultOpen>
        <div className="field">
          <select value={sc} onChange={(e) => props.onScenario(e.target.value as Scenario)}>
            {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="field">
          <div className="field-head"><label>Compare</label></div>
          <select value={p.mode} onChange={(e) => onParams({ mode: e.target.value })}>
            {scDef.modes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {sc === 'rail' && p.mode === 'friction' && (
          <div className="field">
            <div className="field-head"><label>Match by</label></div>
            <select value={p.matchBy} onChange={(e) => onParams({ matchBy: e.target.value as Params['matchBy'] })}>
              <option value="peak-force">Equal peak force (default)</option>
              <option value="stop-distance">Equal stopping distance</option>
              <option value="manual">Manual (μ and clamp force)</option>
            </select>
          </div>
        )}
        <div className="row play-row">
          <button className="btn primary" onClick={props.onTogglePlay}>
            {sim?.finished ? 'Restart' : sim?.running ? 'Pause' : 'Play'}
          </button>
          <button className="btn" onClick={props.onReset}>Reset</button>
        </div>
        <div className="speeds">
          {SPEEDS.map((s) => (
            <button key={s} className={'btn' + (sim?.speed === s ? ' active' : '')} onClick={() => props.onSpeed(s)}>{s}×</button>
          ))}
        </div>
        <p className="hint">Space play/pause · R reset · P present{props.solving ? ' · solving 2D field…' : ''}</p>
      </Section>

      <Section title="Readouts" defaultOpen>
        {sim && <Readouts sim={sim} />}
        <Graphs sim={simRef} tick={props.tick} />
      </Section>

      <Section title="Vehicle">
        {sc === 'rail' && (
          <>
            {Slider('v0', 'Initial speed', 'm/s', 2, 30, 1)}
            {Slider('mass', 'Mass', 'kg', 50, 2000, 10)}
            {p.mode === 'friction' && Slider('muPad', 'Pad friction μk', '', 0.3, 0.5, 0.01, 2)}
            {p.mode === 'friction' && p.matchBy === 'manual' && Slider('clampKN', 'Clamping force N', 'kN', 1, 20, 0.5, 1)}
            {p.mode === 'friction' && p.matchBy !== 'manual' && sim?.calib && (
              <p className="hint">Friction force set by “Match by”: F = {(sim.calib.fricForce / 1000).toFixed(2)} kN, so N = F/μk = {(sim.calib.clampN / 1000).toFixed(1)} kN.</p>
            )}
          </>
        )}
        {sc === 'tube' && (
          <>
            <div className="field">
              <div className="field-head"><label>Magnet shape</label></div>
              <select value={p.magShape} onChange={(e) => onParams({ magShape: e.target.value as Params['magShape'] })}>
                <option value="sphere">Sphere</option>
                <option value="cylinder">Cylinder</option>
              </select>
            </div>
            {Slider('magDiaMm', 'Diameter', 'mm', 6, 20, 1)}
            {p.magShape === 'cylinder' && Slider('magLenMm', 'Length', 'mm', 6, 40, 1)}
          </>
        )}
        {sc === 'pendulum' && (
          <>
            {Slider('pendLen', 'Length L', 'm', 0.4, 1.5, 0.05, 2)}
            {Slider('theta0', 'Release angle', '°', 5, 60, 1)}
            {Slider('pendMass', 'Mass', 'kg', 0.5, 10, 0.5, 1)}
          </>
        )}
        {sc === 'disc' && (
          <>
            {Slider('discRmm', 'Radius R', 'mm', 100, 300, 10)}
            {Slider('discMass', 'Mass', 'kg', 2, 30, 1)}
            {Slider('discRpm', 'Initial speed', 'rpm', 300, 3000, 100)}
          </>
        )}
      </Section>

      <Section title="Magnets">
        {hasArray ? (
          <>
            <div className="field">
              <div className="field-head"><label>Source</label></div>
              <select value={p.source} onChange={(e) => onParams({ source: e.target.value as Params['source'] })}>
                <option value="permanent">Permanent magnets</option>
                <option value="electromagnet">Electromagnet  B = μ₀NI/g (≤ 1.6 T)</option>
              </select>
            </div>
            {p.source === 'permanent' ? Select('gradeId', 'Grade', grades) : Slider('NI', 'Ampere-turns NI', 'A·t', 500, 30000, 500)}
            {Slider('magA', 'Pole length', 'mm', 20, 160, 5)}
            {Slider('magB', 'Pole height', 'mm', 20, 140, 5)}
            {Slider('magC', 'Magnet thickness', 'mm', 5, 40, 1)}
            {sc === 'rail' && Slider('pitchMm', 'Pole pitch τp', 'mm', 60, 400, 10)}
            {Slider('gapMm', 'Air gap (each side)', 'mm', 1, 30, 1)}
            <div className="field-head"><label>B at gap centre</label><output>{bTxt} T</output></div>
          </>
        ) : (
          Select('gradeId', 'Grade', grades)
        )}
      </Section>

      <Section title="Conductor">
        {sc === 'tube' ? (
          <>
            {p.mode === 'pipe' ? Select('materialId', 'Pipe material', materials.filter((m) => m.id !== 'plastic')) : Select('materialId', 'Pipe material', materials)}
            {Slider('pipeOdMm', 'Outer diameter', 'mm', 14, 30, 1)}
            {Slider('wallMm', 'Wall thickness w', 'mm', 0.5, 4, 0.5, 1)}
            {Slider('pipeLenCm', 'Length', 'cm', 30, 150, 5)}
          </>
        ) : (
          <>
            {Select('materialId', 'Material', materials)}
            {Slider('thicknessMm', 'Thickness d', 'mm', 1, 20, 1)}
            {(sc === 'rail' || sc === 'pendulum') && Slider('slots', 'Slots (from the free edge)', '', 0, 12, 1)}
            {(sc === 'rail' || sc === 'pendulum') && (p.slots > 0 || p.alt.slots) ? Slider('slotDepthPct', 'Slot depth', '%', 20, 95, 5) : null}
            {sc === 'rail' && <BrakeBodies sim={sim} p={p} onParams={onParams} />}
          </>
        )}
      </Section>

      {sc === 'rail' && (
        <Section title="Brake zone">
          <div className="field">
            <div className="field-head"><label>Magnet zone</label></div>
            <select value={p.zoneMode} onChange={(e) => onParams({ zoneMode: e.target.value as Params['zoneMode'] })}>
              <option value="until-stop">Until stop (endless array)</option>
              <option value="finite">Finite (N pairs)</option>
            </select>
          </div>
          {p.zoneMode === 'finite' && Slider('pairs', 'Number of pole pairs', '', 4, 80, 1)}
          <p className="hint">{p.zoneMode === 'until-stop' ? 'Magnets are generated ahead of the cart; the friction brake acts from t = 0 until stop.' : 'The cart can roll out of the last pair.'}</p>
        </Section>
      )}

      <Section title="Layers">
        {LAYER_DEFS.map((l) => (
          <label className="check" key={l.key}>
            <input type="checkbox" checked={props.layers[l.key]} onChange={(e) => props.onLayers({ [l.key]: e.target.checked })} />
            <span>{l.label}</span>
          </label>
        ))}
        {props.layers.section && hasArray && <CrossSection sim={simRef} />}
      </Section>

      <Section title="Advanced">
        <div className="field">
          <div className="field-head"><label>Solver grid</label></div>
          <select value={p.grid} onChange={(e) => onParams({ grid: e.target.value as Params['grid'] })}>
            <option value="60x20">60 × 20 (fast, ~1 % error)</option>
            <option value="120x40">120 × 40 (default)</option>
            <option value="240x80">240 × 80 (slow, reference)</option>
          </select>
        </div>
        <div className="field">
          <div className="field-head"><label>Thickness model</label></div>
          <select value={p.thicknessModel} onChange={(e) => onParams({ thicknessModel: e.target.value as Params['thicknessModel'] })}>
            <option value="skin">Skin effect: d_eff = δ·tanh(d/δ)</option>
            <option value="thin">Thin plate only: d_eff = d</option>
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={p.validation} disabled={sc === 'pendulum'} onChange={(e) => onParams({ validation: e.target.checked })} />
          <span>Validation mode<em>uniform field · low Rm · no friction · no heating · analytic overlay</em></span>
        </label>
        {p.source === 'permanent' && sc !== 'tube' && null}
      </Section>
    </>
  )
}

/** Fin (and, in eddy vs friction, disc + pad) mass and heat capacity m·c; the thermal-mass option. */
function BrakeBodies({ sim, p, onParams }: { sim: Simulation | null; p: Params; onParams: (patch: Partial<Params>) => void }) {
  const fin = geometryOf(p).fin
  const bodies = sim ? sim.lanes.flatMap((l: Lane) => l.thermal().map((t) => ({ lane: l, ...t }))) : []
  return (
    <>
      <p className="hint">Fin {fin.Lf.toFixed(2)} × {fin.Hf.toFixed(2)} m × {p.thicknessMm} mm</p>
      {bodies.map((b) => (
        <div className="field-head" key={b.lane.cfg.short + b.name}>
          <label>{b.lane.cfg.short} · {b.name}</label>
          <output>{b.mass.toFixed(b.mass < 1 ? 2 : 1)} kg · {(b.C / 1000).toFixed(2)} kJ/K</output>
        </div>
      ))}
      {p.mode === 'friction' && (
        <div className="field">
          <div className="field-head"><label>Thermal mass</label></div>
          <select value={p.thermalMass} onChange={(e) => onParams({ thermalMass: e.target.value as Params['thermalMass'] })}>
            <option value="realistic">Realistic (disc sized from hardware)</option>
            <option value="equal">Equal m·c (same ΔT for the same energy)</option>
          </select>
          <p className="hint">ΔT = E/(m·c). Realistic: cast-iron disc 1.6 % of the vehicle mass plus a pad pair. Equal m·c: the friction brake gets the fin’s heat capacity.</p>
        </div>
      )}
    </>
  )
}
