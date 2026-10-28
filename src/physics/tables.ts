/**
 * Brake-table service: runs the 2D solver in a Web Worker and caches results by
 * geometry. The solver is NEVER run per frame; tables are recomputed only when
 * the geometry (magnets, gap, plate thickness, slots, …) changes. Material,
 * Br, mass and speed only rescale a cached table.
 */

import { Params, tableKey, tableRequest } from './config'
import { BrakeTable, buildBrakeTable } from './solver'

const cache = new Map<string, Promise<BrakeTable>>()
let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (t: BrakeTable) => void; progress?: (f: number) => void }>()

function getWorker(): Worker | null {
  if (worker) return worker
  if (typeof Worker === 'undefined') return null
  try {
    worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; progress?: number; table?: BrakeTable }>) => {
      const job = pending.get(e.data.id)
      if (!job) return
      if (e.data.table) {
        pending.delete(e.data.id)
        job.resolve(e.data.table)
      } else if (e.data.progress !== undefined) job.progress?.(e.data.progress)
    }
    return worker
  } catch {
    return null
  }
}

export function getTable(p: Params, progress?: (f: number) => void): Promise<BrakeTable> {
  const key = tableKey(p)
  const hit = cache.get(key)
  if (hit) {
    progress?.(1)
    return hit
  }
  const req = tableRequest(p)
  const w = getWorker()
  const promise = new Promise<BrakeTable>((resolve) => {
    if (!w) {
      resolve(buildBrakeTable(req, progress))
      return
    }
    const id = nextId++
    pending.set(id, { resolve, progress })
    w.postMessage({ id, req })
  })
  cache.set(key, promise)
  if (cache.size > 16) cache.delete(cache.keys().next().value as string)
  return promise
}
