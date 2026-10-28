/** Parameters, scenarios and comparison modes. Pure data + builders (no physics). */

import { gradeById, materialById, MU0, B_SAT_IRON } from './constants'
import type { ArraySpec } from './magnet'
import type { FinSpec, TableRequest } from './solver'

export type Scenario = 'rail' | 'tube' | 'pendulum' | 'disc'
export type BrakeKind = 'none' | 'eddy' | 'friction'

export interface Params {
  scenario: Scenario
  mode: string
  validation: boolean
  // --- plate / fin
  materialId: string
  thicknessMm: number
  slots: number
  slotDepthPct: number
  // --- magnets
  gradeId: string
  source: 'permanent' | 'electromagnet'
  NI: number // ampere-turns (electromagnet option)
  gapMm: number // clearance between pole face and plate, each side
  magA: number // pole length along motion [mm]
  magB: number // pole height [mm]
  magC: number // magnet thickness [mm]
  pitchMm: number // pole pitch τp [mm]
  pairs: number
  /** rail: 'until-stop' = effectively infinite magnet array, 'finite' = `pairs` poles */
  zoneMode: 'until-stop' | 'finite'
  // --- solver / model options (Advanced)
  grid: '60x20' | '120x40' | '240x80'
  thicknessModel: 'skin' | 'thin'
  // --- rail cart
  v0: number
  mass: number
  muPad: number
  clampKN: number
  /** rail, eddy vs friction: how the friction force is chosen */
  matchBy: 'peak-force' | 'stop-distance' | 'manual'
  /** rail, eddy vs friction: size the brake bodies from hardware, or give both the same m·c */
  thermalMass: 'realistic' | 'equal'
  // --- tube
  magShape: 'sphere' | 'cylinder'
  magDiaMm: number
  magLenMm: number
  pipeOdMm: number
  wallMm: number
  pipeLenCm: number
  // --- pendulum
  pendLen: number // [m]
  theta0: number // [deg]
  pendMass: number // [kg]
  // --- disc
  discRmm: number
  discMass: number
  discRpm: number
  // alt: overrides for the bottom lane (only the key the mode varies is used)
  alt: Partial<Params>
}

const base: Params = {
  scenario: 'rail', mode: 'brake', validation: false,
  materialId: 'cu', thicknessMm: 5, slots: 0, slotDepthPct: 80,
  gradeId: 'N42', source: 'permanent', NI: 8000, gapMm: 5,
  magA: 120, magB: 100, magC: 20, pitchMm: 200, pairs: 50, zoneMode: 'until-stop', grid: '120x40', thicknessModel: 'skin',
  v0: 12, mass: 400, muPad: 0.4, clampKN: 8, matchBy: 'peak-force', thermalMass: 'realistic',
  magShape: 'sphere', magDiaMm: 12, magLenMm: 12, pipeOdMm: 15, wallMm: 1, pipeLenCm: 100,
  pendLen: 0.8, theta0: 30, pendMass: 1.5,
  discRmm: 150, discMass: 3, discRpm: 1800,
  alt: {},
}

export const DEFAULTS: Record<Scenario, Params> = {
  rail: { ...base, mode: 'friction', alt: { materialId: 'al', gradeId: 'N52', thicknessMm: 10, gapMm: 15, slots: 5 } },
  tube: { ...base, scenario: 'tube', mode: 'pipe', materialId: 'cu', alt: { materialId: 'al', wallMm: 2, gradeId: 'N52' } },
  pendulum: {
    ...base, scenario: 'pendulum', mode: 'slots', materialId: 'al', thicknessMm: 3, gapMm: 6, slotDepthPct: 90,
    magA: 40, magB: 40, magC: 25, pairs: 1, pitchMm: 80, pendMass: 3,
    alt: { slots: 8, materialId: 'cu', gapMm: 14, gradeId: 'N52' },
  },
  disc: {
    ...base, scenario: 'disc', mode: 'brake', materialId: 'cu', thicknessMm: 3, gapMm: 8,
    magA: 25, magB: 25, magC: 10, pairs: 1, pitchMm: 50, discMass: 12, discRmm: 200, discRpm: 1500,
    alt: { materialId: 'al', gradeId: 'N52', gapMm: 16 },
  },
}

export interface ModeDef {
  id: string
  name: string
  /** the Params key that differs between the two lanes (shown as a second slider/select) */
  varies?: 'materialId' | 'gradeId' | 'thicknessMm' | 'gapMm' | 'slots' | 'wallMm'
}

export const SCENARIOS: { id: Scenario; name: string; blurb: string; modes: ModeDef[] }[] = [
  {
    id: 'rail', name: 'Linear brake (fin between magnet rows)', blurb: 'Cart with a conductive fin passing between two rows of NdFeB magnets.',
    modes: [
      { id: 'brake', name: 'Eddy brake vs no brake' },
      { id: 'friction', name: 'Eddy brake vs friction brake' },
      { id: 'slots', name: 'Solid vs slotted fin', varies: 'slots' },
      { id: 'material', name: 'Fin material', varies: 'materialId' },
      { id: 'grade', name: 'Magnet grade', varies: 'gradeId' },
      { id: 'thickness', name: 'Fin thickness', varies: 'thicknessMm' },
      { id: 'gap', name: 'Air gap', varies: 'gapMm' },
    ],
  },
  {
    id: 'tube', name: 'Magnet falling in a pipe (Lenz tube)', blurb: 'Dipole magnet dropped down a thin-walled pipe.',
    modes: [
      { id: 'pipe', name: 'Copper pipe vs PVC pipe' },
      { id: 'material', name: 'Pipe material', varies: 'materialId' },
      { id: 'wall', name: 'Wall thickness', varies: 'wallMm' },
      { id: 'grade', name: 'Magnet grade', varies: 'gradeId' },
    ],
  },
  {
    id: 'pendulum', name: 'Waltenhofen pendulum', blurb: 'Plate swinging through a magnet gap; solid vs slotted.',
    modes: [
      { id: 'slots', name: 'Solid vs slotted plate', varies: 'slots' },
      { id: 'material', name: 'Plate material', varies: 'materialId' },
      { id: 'gap', name: 'Air gap', varies: 'gapMm' },
      { id: 'grade', name: 'Magnet grade', varies: 'gradeId' },
    ],
  },
  {
    id: 'disc', name: 'Rotating disc brake', blurb: 'Spinning disc with a magnet pair at radius r_m.',
    modes: [
      { id: 'brake', name: 'Eddy brake vs no brake' },
      { id: 'material', name: 'Disc material', varies: 'materialId' },
      { id: 'grade', name: 'Magnet grade', varies: 'gradeId' },
      { id: 'gap', name: 'Air gap', varies: 'gapMm' },
    ],
  },
]
export const modeDef = (p: Params): ModeDef => SCENARIOS.find((s) => s.id === p.scenario)!.modes.find((m) => m.id === p.mode) ?? SCENARIOS.find((s) => s.id === p.scenario)!.modes[0]

export interface LaneConfig {
  label: string
  short: string
  brake: BrakeKind
  p: Params // effective parameters of this lane
  /** friction lane: braking force [N] chosen by the 'Match by' rule (undefined = μ·N from the sliders) */
  fricForce?: number
  /** friction lane, 'equal m·c': the heat capacity [J/K] and cooling hA [W/K] of the eddy fin to copy */
  eqThermal?: { C: number; hA: number }
}

export function buildLaneConfigs(p: Params): [LaneConfig, LaneConfig] {
  const md = modeDef(p)
  const eff = (over: Partial<Params> = {}): Params => ({ ...p, ...over })
  const altOf = (): Partial<Params> => (md.varies ? { [md.varies]: p.alt[md.varies] ?? (DEFAULTS[p.scenario].alt as any)[md.varies] } : {})
  const mk = (label: string, short: string, brake: BrakeKind, q: Params): LaneConfig => ({ label, short, brake, p: q })

  if (p.mode === 'brake') {
    return [mk(p.scenario === 'disc' ? 'Without eddy brake' : 'Without eddy brake', 'No brake', 'none', eff()), mk('With eddy brake', 'Eddy brake', 'eddy', eff())]
  }
  if (p.mode === 'friction') return [mk('Friction brake (pads)', 'Friction', 'friction', eff()), mk('Eddy brake', 'Eddy', 'eddy', eff())]
  if (p.mode === 'pipe') {
    return [mk('PVC pipe (free fall)', 'PVC', 'eddy', eff({ materialId: 'plastic' })), mk(`${materialById(p.materialId).name} pipe`, materialById(p.materialId).name, 'eddy', eff())]
  }
  const a = eff()
  const b = eff(altOf())
  const lab = (q: Params): [string, string] => {
    switch (md.varies) {
      case 'materialId': return [`${materialById(q.materialId).name}`, materialById(q.materialId).name]
      case 'gradeId': return [`Magnets ${q.gradeId} (Br ${gradeById(q.gradeId).Br} T)`, q.gradeId]
      case 'thicknessMm': return [`${q.thicknessMm} mm fin`, `${q.thicknessMm} mm`]
      case 'gapMm': return [`${q.gapMm} mm air gap`, `${q.gapMm} mm`]
      case 'slots': return [q.slots === 0 ? 'Solid plate' : `Slotted plate (${q.slots} slots)`, q.slots === 0 ? 'Solid' : `${q.slots} slots`]
      case 'wallMm': return [`${q.wallMm} mm wall`, `${q.wallMm} mm`]
      default: return ['', '']
    }
  }
  const [la, sa] = lab(a)
  const [lb, sb] = lab(b)
  return [mk(la, sa, 'eddy', a), mk(lb, sb, 'eddy', b)]
}

// ---------------------------------------------------------------- geometry → solver request

export interface Geometry {
  /** rail only: magnet array has no end (generated ahead of the cart) */
  infinite: boolean
  magnet: ArraySpec
  fin: FinSpec
  /** x of the first pole's left edge in the world frame (rail), else 0 [m] */
  zoneStart: number
}

export const ZONE_START = 1.0 // [m] rail: first pole starts here (the cart starts at x = 0)

export function geometryOf(p: Params): Geometry {
  const d = p.thicknessMm / 1000
  const clr = p.gapMm / 1000
  const pitch = Math.max(p.pitchMm, p.magA + 4) / 1000
  const magnet: ArraySpec = {
    a: p.magA / 1000, b: p.magB / 1000, c: p.magC / 1000, pitch, pairs: p.scenario === 'pendulum' || p.scenario === 'disc' ? 1 : p.pairs,
    gap: d + 2 * clr, backIron: true,
  }
  const finDims = p.scenario === 'pendulum' ? { Lf: 0.14, Hf: 0.1, slotWidth: 0.003 } : p.scenario === 'disc' ? { Lf: 0.3, Hf: 0.12, slotWidth: 0.004 } : { Lf: 0.5, Hf: 0.2, slotWidth: 0.004 }
  const [gx, gz] = p.grid.split('x').map(Number)
  const fin: FinSpec = { ...finDims, nx: gx, nz: gz, slots: p.scenario === 'disc' ? 0 : p.slots, slotDepth: p.slotDepthPct / 100 }
  return { infinite: p.scenario === 'rail' && p.zoneMode === 'until-stop', magnet, fin, zoneStart: ZONE_START }
}

export const tableRequest = (p: Params): TableRequest => {
  const g = geometryOf(p)
  return { magnet: g.magnet, fin: g.fin, infinite: g.infinite }
}

/** Cache key: everything the 2D solution depends on (material / Br / mass are NOT in it). */
export const tableKey = (p: Params): string => {
  const r = tableRequest(p)
  return JSON.stringify([r.magnet.a, r.magnet.b, r.magnet.c, r.magnet.pitch, r.infinite ? 'inf' : r.magnet.pairs, +r.magnet.gap.toFixed(6), r.fin.Lf, r.fin.Hf, r.fin.nx, r.fin.nz, r.fin.slots, r.fin.slotDepth])
}

// ---------------------------------------------------------------- source strength

/** Field scale s: B(x,z) = s · B̂(x,z) where B̂ is the table's field for Br = 1 T. */
export function fieldScale(p: Params, Bc1: number): number {
  if (p.source === 'electromagnet') {
    const g = p.thicknessMm / 1000 + 2 * (p.gapMm / 1000)
    const Btarget = Math.min((MU0 * p.NI) / g, B_SAT_IRON)
    return Btarget / Math.max(Bc1, 1e-9)
  }
  return gradeById(p.gradeId).Br
}
