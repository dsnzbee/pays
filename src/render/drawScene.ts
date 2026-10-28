/** Scene dispatcher: two lanes (8 px gap), header (pill, one big speed, one muted caption), "solving" overlay. */

import type { DiscLane, Lane, PendulumLane, RailLane, TubeLane } from '../physics/lanes'
import type { Simulation } from '../physics/sim'
import { COLORS, FONT, Layers, pill, roundRect, text } from './common'
import { drawDiscLane, drawPendulumLane } from './drawPendDisc'
import { drawRailLane } from './drawRail'
import { drawTubeLane } from './drawTube'

export interface AnimState {
  phase: [number, number]
  discAngle: [number, number]
}
export const newAnim = (): AnimState => ({ phase: [0, 0], discAngle: [0, 0] })

const LANE_BG = '#202020'

export function drawSolving(ctx: CanvasRenderingContext2D, W: number, H: number, progress: number) {
  ctx.clearRect(0, 0, W, H)
  roundRect(ctx, 0, 0, W, H, 12)
  ctx.fillStyle = LANE_BG
  ctx.fill()
  text(ctx, 'Solving the 2D eddy-current field…', W / 2, H / 2 - 10, 14, COLORS.text, 600, 'center')
  ctx.fillStyle = '#2e2e2e'
  ctx.fillRect(W / 2 - 120, H / 2 + 8, 240, 2)
  ctx.fillStyle = COLORS.cool
  ctx.fillRect(W / 2 - 120, H / 2 + 8, 240 * Math.max(0.03, Math.min(1, progress)), 2)
}

/** pill (top-left), one large speed readout (top-right), one muted caption under it. */
function header(ctx: CanvasRenderingContext2D, W: number, lane: Lane, sim: Simulation) {
  pill(ctx, lane.cfg.label, 16, 16)
  const sc = sim.params.scenario
  const speedTxt = sc === 'tube' && lane.v < 1 ? lane.v.toFixed(3) : sc === 'disc' ? `${Math.round(((lane as DiscLane).omega * 60) / (2 * Math.PI))}` : (lane.stopped && sc === 'rail' ? 0 : lane.v) < 10 ? (lane.stopped && sc === 'rail' ? 0 : lane.v).toFixed(2) : lane.v.toFixed(1)
  const unit = sc === 'disc' ? 'rpm' : 'm/s'
  ctx.font = `500 14px ${FONT}`
  const uw = ctx.measureText(unit).width
  text(ctx, unit, W - 16, 40, 14, COLORS.muted, 500, 'right')
  text(ctx, speedTxt, W - 16 - uw - 6, 40, 40, COLORS.text, 600, 'right')
  const coasting = (sc === 'rail' || sc === 'disc') && lane.cfg.brake === 'none'
  let cap = ''
  if (lane.stopped && sc === 'rail') cap = `Stopped after ${lane.stopTime.toFixed(2)} s · ${lane.stopPos.toFixed(1)} m of braking`
  else if (lane.stopped && sc === 'tube') cap = `Reached the bottom in ${lane.stopTime.toFixed(2)} s`
  else if (lane.stopped && sc === 'pendulum') cap = `Settled in ${lane.stopTime.toFixed(2)} s`
  else if (lane.stopped && sc === 'disc') cap = `Stopped in ${lane.stopTime.toFixed(2)} s`
  else {
    const dist = sc === 'rail' ? ` · ${(lane as RailLane).travelled.toFixed(1)} m` : sc === 'tube' ? ` · ${(lane.pos * 100).toFixed(0)} cm` : sc === 'pendulum' ? ` · ${(((lane as PendulumLane).theta * 180) / Math.PI).toFixed(0)}°` : ''
    cap = `${coasting ? 'Not braking · ' : ''}t = ${lane.t.toFixed(2)} s${dist}`
  }
  text(ctx, cap, W - 16, 58, 12, COLORS.muted, 500, 'right')
}

export function drawScene(ctx: CanvasRenderingContext2D, W: number, H: number, sim: Simulation, anim: AnimState, realDt: number, layers: Layers) {
  ctx.clearRect(0, 0, W, H)
  const sc = sim.params.scenario
  const gap = 8
  const tube = sc === 'tube'
  const laneW = tube ? (W - gap) / 2 : W
  const laneH = tube ? H : (H - gap) / 2
  for (let i = 0; i < 2; i++) {
    const lane = sim.lanes[i]
    if (sim.running && !sim.finished && !lane.frozen) {
      anim.phase[i] = (anim.phase[i] + realDt * sim.speed * 0.25) % 1 // slow streamline drift
      if (sc === 'disc') anim.discAngle[i] += (lane as DiscLane).omega * realDt * sim.speed
    }
    ctx.save()
    ctx.translate(tube ? i * (laneW + gap) : 0, tube ? 0 : i * (laneH + gap))
    roundRect(ctx, 0, 0, laneW, laneH, 12)
    ctx.fillStyle = LANE_BG
    ctx.fill()
    ctx.save()
    roundRect(ctx, 0, 0, laneW, laneH, 12)
    ctx.clip()
    if (sc === 'rail') drawRailLane(ctx, laneW, laneH, lane as RailLane, layers, anim.phase[i])
    else if (sc === 'tube') drawTubeLane(ctx, laneW, laneH, lane as TubeLane, layers, anim.phase[i])
    else if (sc === 'pendulum') drawPendulumLane(ctx, laneW, laneH, lane as PendulumLane, layers, anim.phase[i])
    else drawDiscLane(ctx, laneW, laneH, lane as DiscLane, layers, anim.phase[i], anim.discAngle[i])
    header(ctx, laneW, lane, sim)
    ctx.restore()
    ctx.restore()
  }
}
