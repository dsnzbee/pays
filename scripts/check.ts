/**
 * Physics self-checks:  npm run check
 *  1. magnet field vs the analytic on-axis block formula
 *  2. 2D solver: zero force for an infinite strip, div J = 0 / P = F·v residual, grid convergence
 *  3. every scenario: energy conservation, P = F·v, stop times
 *  4. validation mode vs the analytic exponential
 */
import { blockBy } from '../src/physics/magnet'
import { buildBrakeTable, kHatMean, makeWorkspace, solveSample } from '../src/physics/solver'
import { createSimulation } from '../src/physics/sim'
import { RailLane, STOP_V } from '../src/physics/lanes'
import { DEFAULTS, Params, SCENARIOS, ZONE_START } from '../src/physics/config'

let failed = 0
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
  if (!ok) failed++
}

async function main() {
  // 1. magnet
  {
    const a = 0.04, b = 0.04, c = 0.02
    const ana = (yp: number) => (1 / Math.PI) * (Math.atan((a * b) / (2 * yp * Math.sqrt(4 * yp * yp + a * a + b * b))) - Math.atan((a * b) / (2 * (yp + c) * Math.sqrt(4 * (yp + c) ** 2 + a * a + b * b))))
    let worst = 0
    for (const yp of [0.005, 0.01, 0.02, 0.05]) worst = Math.max(worst, Math.abs(blockBy(0, c / 2 + yp, 0, -a / 2, a / 2, -c / 2, c / 2, -b / 2, b / 2) - ana(yp)))
    check('cuboid B_y vs analytic on-axis', worst < 1e-9, `max abs error ${worst.toExponential(1)} T per T of Br`)
  }
  // 2. solver
  {
    const nx = 60, nz = 40
    const By = new Float32Array(nx * nz)
    for (let i = 0; i < nx; i++) for (let j = 10; j < 30; j++) By[i * nz + j] = 1
    const r = solveSample(new Uint8Array(nx * nz).fill(1), By, nx, nz, 0.01, 0.005, new Float64Array(nx * nz), makeWorkspace(nx * nz))
    check('infinite strip gives zero force', r.K < 1e-9, `K = ${r.K.toExponential(1)}`)
    const mg = { a: 0.12, b: 0.1, c: 0.02, pitch: 0.2, pairs: 50, gap: 0.015, backIron: true }
    const fin = { Lf: 0.5, Hf: 0.2, nx: 120, nz: 40, slots: 0, slotDepth: 0.7, slotWidth: 0.004 }
    const t1 = buildBrakeTable({ magnet: mg, fin })
    check('P = F·v (solver residual)', t1.maxResidual < 1e-4, `max |K̂−P̂|/K̂ = ${t1.maxResidual.toExponential(1)}`)
    const tc = buildBrakeTable({ magnet: mg, fin: { ...fin, nx: 60, nz: 20 } })
    const tf = buildBrakeTable({ magnet: mg, fin: { ...fin, nx: 240, nz: 80 } })
    const e1 = Math.abs(kHatMean(t1) - kHatMean(tf)) / kHatMean(tf)
    const e0 = Math.abs(kHatMean(tc) - kHatMean(tf)) / kHatMean(tf)
    check('grid convergence', e1 < 0.01 && e1 < e0, `120×40 vs 240×80: ${(e1 * 100).toFixed(2)} %   (60×20: ${(e0 * 100).toFixed(2)} %)`)
    const ts = buildBrakeTable({ magnet: mg, fin: { ...fin, slots: 5, slotDepth: 0.8 } })
    check('slots reduce the force', kHatMean(ts) < 0.5 * kHatMean(t1), `K̂ ratio slotted/solid = ${(kHatMean(ts) / kHatMean(t1)).toFixed(3)}`)
    check('solver time (solid, 127 positions)', t1.solveMs < 8000, `${t1.solveMs.toFixed(0)} ms (in the browser this runs in a worker)`)
  }
  // 3. scenarios
  const run = async (p: Params, title: string) => {
    const sim = await createSimulation(p)
    let maxP = 0
    while (!sim.finished) {
      sim.advance(0.05)
      for (const l of sim.lanes) if (Math.abs(l.pErr) > maxP) maxP = Math.abs(l.pErr)
    }
    for (const l of sim.lanes) {
      const scale = Math.max(Math.abs(l.E0), l.Qheat, 1e-6)
      check(`${title} · ${l.cfg.short}: energy`, Math.abs(l.energyErr) / scale < 1e-6, `|E0 − (E + Q)|/E0 = ${(Math.abs(l.energyErr) / scale).toExponential(1)}`)
    }
    check(`${title}: P = F·v`, maxP < 1, `max deviation ${maxP.toExponential(1)} %`)
    return sim
  }
  await run(DEFAULTS.rail, 'rail')
  await run({ ...DEFAULTS.rail, zoneMode: 'finite' }, 'rail/finite zone')
  const fr = await run({ ...DEFAULTS.rail, mode: 'friction' }, 'rail/friction')
  check('friction brake stops the cart', fr.lanes[0].stopped && fr.lanes[0].T > 30, `stopped=${fr.lanes[0].stopped} in ${fr.lanes[0].stopTime.toFixed(2)} s, disc ${fr.lanes[0].T.toFixed(1)} °C vs eddy fin ${fr.lanes[1].T.toFixed(1)} °C`)
  await run({ ...DEFAULTS.rail, mode: 'slots', slots: 0, alt: { slots: 5 } }, 'rail/slots')
  // 'Until stop' mode: every preset must come to rest (v < 0.01 m/s) while still inside the (infinite) brake zone
  {
    const modes = SCENARIOS.find((x) => x.id === 'rail')!.modes.map((m) => m.id)
    const variants: [string, Partial<Params>][] = [['default', {}], ['30 m/s, 2000 kg', { v0: 30, mass: 2000 }], ['2 m/s, 50 kg', { v0: 2, mass: 50 }], ['weak N35, 15 mm gap', { gradeId: 'N35', gapMm: 15 }]]
    for (const mode of modes) {
      for (const [vn, over] of variants) {
        const sim = await createSimulation({ ...DEFAULTS.rail, zoneMode: 'until-stop', mode, ...over })
        while (!sim.finished) sim.advance(0.05)
        for (const l of sim.lanes) {
          if (l.cfg.brake === 'none') continue
          const inZone = l.pos + 0.25 >= ZONE_START // fin (0.5 m long) overlaps the poles
          check(`until-stop · ${mode} · ${vn} · ${l.cfg.short}`, l.stopped && l.v < 0.01 && inZone, `v = ${l.v.toFixed(4)} m/s, stopped in ${l.stopTime.toFixed(2)} s at ${l.stopPos.toFixed(1)} m`)
        }
      }
    }
  }
  // Fair eddy vs friction comparison
  {
    const base = { ...DEFAULTS.rail, mode: 'friction' }
    const finish = async (over: Partial<Params>) => {
      const sim = await createSimulation({ ...base, ...over })
      while (!sim.finished) sim.advance(0.05)
      return sim
    }
    // validation conditions (uniform field, no rolling resistance, no heating, linear force): x_eddy / x_friction = 2
    for (const [vn, over] of [['12 m/s, 400 kg', {}], ['30 m/s, 2000 kg', { v0: 30, mass: 2000 }], ['2 m/s, 50 kg', { v0: 2, mass: 50 }]] as [string, Partial<Params>][]) {
      const sim = await finish({ validation: true, matchBy: 'peak-force', ...over })
      const r = sim.distanceRatio ?? NaN
      // both distances are measured down to v = STOP_V, which gives exactly 2 / (1 + STOP_V/v0) → 2 as STOP_V → 0
      const th = 2 / (1 + STOP_V / (over.v0 ?? DEFAULTS.rail.v0))
      check(`equal peak force, validation · ${vn}: x_eddy / x_friction = 2`, Math.abs(r - th) / th < 0.002 && Math.abs(r - 2) < 0.02, `ratio ${r.toFixed(4)} (theory 2; 2/(1+v_stop/v0) = ${th.toFixed(4)}); F_friction ${sim.calib!.fricForce.toFixed(0)} N, k·v0 ${sim.calib!.idealPeak.toFixed(0)} N`)
    }
    // real conditions: each match rule does what it says, and both lanes dissipate the same energy
    for (const [vn, over] of [['default', {}], ['30 m/s, 2000 kg', { v0: 30, mass: 2000 }], ['weak N35, 15 mm gap', { gradeId: 'N35', gapMm: 15 }]] as [string, Partial<Params>][]) {
      for (const matchBy of ['peak-force', 'stop-distance'] as const) {
        const sim = await finish({ matchBy, ...over })
        const [fr, ed] = sim.lanes
        const c = sim.calib!
        const heatDiff = Math.abs(fr.Qheat - ed.Qheat) / fr.E0
        check(`${matchBy} · ${vn}: identical heat totals`, heatDiff < 0.01, `heat ${(fr.Qheat / 1000).toFixed(2)} vs ${(ed.Qheat / 1000).toFixed(2)} kJ, differ by ${(heatDiff * 100).toFixed(3)} % of E0`)
        if (matchBy === 'peak-force') check(`peak-force · ${vn}: friction peak = eddy peak`, Math.abs((fr as RailLane).peakF - (ed as RailLane).peakF) / (ed as RailLane).peakF < 0.01, `${(fr as RailLane).peakF.toFixed(0)} N vs ${(ed as RailLane).peakF.toFixed(0)} N (ideal k·v0 ${c.idealPeak.toFixed(0)} N)`)
        else check(`stop-distance · ${vn}: same stopping distance`, Math.abs(fr.stopPos - ed.stopPos) / ed.stopPos < 0.01, `${fr.stopPos.toFixed(2)} m vs ${ed.stopPos.toFixed(2)} m`)
      }
    }
    // equal m·c: same heat capacity, so the same ΔT for the same energy (disc, pad and fin)
    const eq = await finish({ thermalMass: 'equal', matchBy: 'stop-distance' })
    const [fr, ed] = eq.lanes
    const dTs = [...fr.thermal(), ...ed.thermal()]
    const ref = ed.thermal()[0].dTmeas
    const worst = Math.max(...dTs.map((t) => Math.abs(t.dTmeas - ref) / ref))
    check('equal m·c: same ΔT for disc, pad and fin', worst < 0.03, `ΔT ${dTs.map((t) => `${t.name} ${t.dTmeas.toFixed(2)} K`).join(', ')} (max deviation ${(worst * 100).toFixed(2)} %)`)
    const cdiff = Math.abs(fr.thermal().reduce((s, t) => s + t.C, 0) - ed.thermal()[0].C) / ed.thermal()[0].C
    check('equal m·c: equal heat capacity', cdiff < 1e-9, `friction ${fr.thermal().reduce((s, t) => s + t.C, 0).toFixed(1)} J/K, fin ${ed.thermal()[0].C.toFixed(1)} J/K`)
    // ΔT = E/(m·c) predicts the measured rise (the small difference is convection)
    const real = await finish({})
    const bad = real.lanes.flatMap((l) => l.thermal()).filter((t) => Math.abs(t.dTpred - t.dTmeas) / t.dTpred > 0.03)
    check('ΔT = E/(m·c) vs measured rise', bad.length === 0, real.lanes.flatMap((l) => l.thermal()).map((t) => `${t.name} ${t.dTpred.toFixed(2)} / ${t.dTmeas.toFixed(2)} K`).join(', '))
  }
  await run(DEFAULTS.tube, 'tube')
  await run(DEFAULTS.pendulum, 'pendulum')
  await run(DEFAULTS.disc, 'disc')
  // 4. validation
  for (const sc of ['rail', 'tube', 'disc'] as const) {
    const sim = await createSimulation({ ...DEFAULTS[sc], validation: true })
    const l = sim.lanes[1]
    let worst = 0
    while (!l.stopped && sim.time < 60) {
      sim.advance(0.05)
      if (l.vA === l.vA && l.vA > 0.02 * Math.max(l.vA, 1e-9) && l.vA > 1e-3) worst = Math.max(worst, Math.abs((l.v - l.vA) / l.vA) * 100)
    }
    check(`validation ${sc}: v(t) vs analytic`, worst < 0.01, `max error ${worst.toExponential(1)} %`)
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed')
  process.exit(failed ? 1 : 0)
}
main()
