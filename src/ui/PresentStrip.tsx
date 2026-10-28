import { RefObject } from 'react'
import type { Simulation } from '../physics/sim'
import { Graph } from './Graphs'

/** Slim strip under the lanes in Present mode: v(t) for both lanes and both stopping results. */
export function PresentStrip({ sim, tick }: { sim: RefObject<Simulation | null>; tick: number }) {
  void tick
  const s = sim.current
  if (!s) return null
  const sc = s.params.scenario
  return (
    <div className="strip">
      <div className="strip-graph"><Graph sim={sim} kind="v" className="graph wide" /></div>
      <div className="strip-text">
        {s.lanes.map((l, i) => (
          <div key={i} className="strip-row">
            <span className="strip-name">{l.cfg.label}</span>
            <span className="strip-val">
              {l.stopped
                ? sc === 'rail'
                  ? `${l.stopPos.toFixed(1)} m · ${l.stopTime.toFixed(2)} s`
                  : `${l.stopTime.toFixed(2)} s`
                : sc === 'rail' && l.cfg.brake === 'none'
                  ? 'not braking'
                  : 'braking…'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
