import type { Simulation } from '../physics/sim'

const kJ = (x: number) => (Math.abs(x) >= 1e3 ? `${(x / 1e3).toFixed(2)} kJ` : `${x.toFixed(x < 10 ? 2 : 1)} J`)

/** One bar per lane splitting the initial energy E0 into heat in the brake / other losses / energy still left. */
export function EnergyBars({ sim }: { sim: Simulation }) {
  const rows = sim.lanes.map((l) => ({ l, e: l.energySplit() }))
  if (rows.some((r) => !r.e)) return null
  const rail = sim.params.scenario === 'rail'
  const lossName = rail ? 'rolling loss' : sim.params.scenario === 'disc' ? 'bearing loss' : 'other loss'
  const keName = sim.params.scenario === 'pendulum' ? 'mechanical left' : 'kinetic left'
  const a = rows[0].e!
  const b = rows[1].e!
  const diff = Math.abs(a.heat - b.heat) / Math.max(a.E0, 1e-12)
  const bothBrake = sim.lanes.every((l) => l.cfg.brake !== 'none')
  return (
    <div className="ebars">
      <div className="ebars-title">Where the energy went <span>(E₀ = {kJ(a.E0)})</span></div>
      {rows.map(({ l, e }) => {
        const E = Math.max(e!.E0, 1e-12)
        const pct = (x: number) => `${Math.max(0, (x / E) * 100).toFixed(2)}%`
        return (
          <div className="ebar-row" key={l.cfg.short}>
            <div className="ebar-name">{l.cfg.short}</div>
            <div className="ebar" role="img" aria-label={`${l.cfg.short}: heat ${kJ(e!.heat)}, ${lossName} ${kJ(e!.loss)}, ${keName} ${kJ(e!.ke)}`}>
              <i className="heat" style={{ width: pct(e!.heat) }} />
              <i className="loss" style={{ width: pct(e!.loss) }} />
              <i className="ke" style={{ width: pct(e!.ke) }} />
            </div>
            <div className="ebar-val">
              <span className="heat">{kJ(e!.heat)}</span> · {kJ(e!.loss)} · {kJ(e!.ke)}
            </div>
          </div>
        )
      })}
      <div className="legend">
        <span><i className="sw heat" />heat in brake</span>
        <span><i className="sw loss" />{lossName}</span>
        <span><i className="sw ke" />{keName}</span>
      </div>
      {bothBrake && <p className="hint">Heat totals differ by {(diff * 100).toFixed(2)} % of E₀: the same energy has to go somewhere, only the {lossName} differs.</p>}
    </div>
  )
}

/** ΔT = E/(m·c) for every brake body, with the temperature rise the simulation actually measures. */
export function ThermalTable({ sim }: { sim: Simulation }) {
  const rows = sim.lanes.flatMap((l) => l.thermal().map((t) => ({ lane: l.cfg.short, ...t })))
  if (rows.length === 0) return null
  return (
    <div className="therm">
      <div className="ebars-title">ΔT = E / (m·c) <span>(calc: heat received so far ÷ m·c)</span></div>
      <table className="cmp small">
        <thead>
          <tr><th></th><th>m (kg)</th><th>m·c (kJ/K)</th><th>ΔT calc (K)</th><th>ΔT meas (K)</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.lane + r.name}>
              <td>{r.lane === r.name ? r.name : `${r.lane} · ${r.name}`}</td>
              <td>{r.mass.toFixed(r.mass < 1 ? 2 : 1)}</td>
              <td>{(r.C / 1000).toFixed(2)}</td>
              <td className="heat">{r.dTpred.toFixed(1)}</td>
              <td className="heat">{r.dTmeas.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">The measured rise is a little below E/(m·c) because the body also loses heat to the air (h·A·ΔT).</p>
    </div>
  )
}

/** Eddy vs friction: how the friction force was chosen, and the distance ratio against the theoretical 2. */
export function MatchNote({ sim }: { sim: Simulation }) {
  const c = sim.calib
  if (!c) return null
  const ratio = sim.distanceRatio
  const val = sim.params.validation
  const kN = (x: number) => `${(x / 1000).toFixed(2)} kN`
  const how =
    c.matchBy === 'peak-force'
      ? `Equal peak force: friction F = ${kN(c.fricForce)}, the largest force the eddy lane reaches.`
      : c.matchBy === 'stop-distance'
        ? `Equal stopping distance: friction F = ${kN(c.fricForce)} makes both stop after ${c.eddyDist.toFixed(2)} m.`
        : `Manual: friction F = μ·N = ${kN(c.fricForce)}.`
  const sat = c.eddyPeak < 0.95 * c.idealPeak
  return (
    <div className="match">
      <p className="hint first">{how} Equivalent clamp N = F/μ = {kN(c.clampN)}.</p>
      {c.matchBy === 'peak-force' && (
        <div className="ratio">
          <span>Eddy distance / friction distance</span>
          <b>= {ratio === null ? '…' : ratio.toFixed(2)} <em>(theory: 2)</em></b>
        </div>
      )}
      <p className="hint">
        Eddy force F = k·v fades with speed, so x = m·v₀/k. Friction force is constant, so x = m·v₀²/2F. With F = k·v₀ this is exactly a ratio of 2.
        {c.matchBy === 'peak-force' && !val && (sat
          ? ` Here the eddy force saturates at high speed (peak ${kN(c.eddyPeak)} instead of k·v₀ = ${kN(c.idealPeak)}), plus rolling loss and heating, so the ratio is not 2. Validation mode removes them.`
          : ' Rolling loss and heating move it slightly away from 2; validation mode removes them.')}
      </p>
    </div>
  )
}
