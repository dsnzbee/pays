import { useState } from 'react'
import type { Row } from '../physics/lanes'
import type { Simulation } from '../physics/sim'
import { EnergyBars, MatchNote, ThermalTable } from './Energy'

/** Six core metrics by default; the rest behind "More". */
export function Readouts({ sim }: { sim: Simulation }) {
  const [more, setMore] = useState(false)
  const [a, b] = sim.lanes
  const ra = a.rows()
  const rb = b.rows()
  const labels = [...ra.map((r) => r.label), ...rb.map((r) => r.label).filter((l) => !ra.some((r) => r.label === l))]
  const find = (rows: Row[], l: string) => rows.find((r) => r.label === l)
  const isCore = (l: string) => !!(find(ra, l)?.core || find(rb, l)?.core)
  const shown = more ? labels : labels.filter(isCore)
  const rest = labels.length - labels.filter(isCore).length
  return (
    <>
      <table className="cmp">
        <thead>
          <tr>
            <th></th>
            <th>{a.cfg.short}</th>
            <th>{b.cfg.short}</th>
          </tr>
        </thead>
        <tbody>
          {(more ? [...labels.filter(isCore), ...labels.filter((l) => !isCore(l))] : shown).map((l) => {
            const x = find(ra, l)
            const y = find(rb, l)
            const heat = (x ?? y)?.heat
            return (
              <tr key={l}>
                <td>{l}</td>
                <td className={'top-col' + (heat ? ' heat' : '')}>{x ? x.value : '—'}<span className="u">{x?.unit}</span></td>
                <td className={heat ? 'heat' : ''}>{y ? y.value : '—'}<span className="u">{y?.unit}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rest > 0 && <button className="link" onClick={() => setMore((m) => !m)}>{more ? 'Fewer' : `More (${rest})`}</button>}
      <MatchNote sim={sim} />
      <EnergyBars sim={sim} />
      <ThermalTable sim={sim} />
    </>
  )
}
