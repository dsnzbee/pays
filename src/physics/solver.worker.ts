/// <reference lib="webworker" />
import { buildBrakeTable, BrakeTable, TableRequest } from './solver'

/** Typed-array buffers of a table, for zero-copy transfer back to the UI thread. */
export function transferList(t: BrakeTable): ArrayBuffer[] {
  return [
    t.mask, t.entryK, t.entryP, t.perK, t.perP, t.entryJm, t.entryPsiM, t.perJm, t.perPsiM,
    t.entryPsi, t.entryJ, t.perPsi, t.perJ, t.profileX, t.profileB,
  ].map((a) => a.buffer as ArrayBuffer)
}

self.onmessage = (e: MessageEvent<{ id: number; req: TableRequest }>) => {
  const { id, req } = e.data
  const table = buildBrakeTable(req, (f) => (self as unknown as Worker).postMessage({ id, progress: f }))
  ;(self as unknown as Worker).postMessage({ id, table }, transferList(table))
}
