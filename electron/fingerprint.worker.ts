// ── Fingerprint worker thread ──
// Hosts the native U.are.U fingerprint service. The main process spawns this
// worker (see main.ts) and proxies renderer IPC requests to it. Running the
// blocking dpfpdd_capture here keeps the main process / renderer fully
// responsive while waiting for a finger, and avoids koffi's registered-callback
// machinery (koffi.register / .async), which crashes on some Windows machines.
//
// Message protocol (JSON via postMessage):
//   { id, type: 'status' }                       → FpStatus
//   { id, type: 'capture', timeoutMs }           → CaptureResult
//   { id, type: 'cancel' }                       → aborts the current capture
//   { id, type: 'create-fmd', imageBase64 }      → { fmdBase64 } | { error }
//   { id, type: 'identify', fmdBase64, templates } → { index } | { error }
//   { id, type: 'shutdown' }                     → releases the reader/libs
// Replies use the same id: { id, ok, data } or { id, ok: false, error }.

import { parentPort, workerData } from 'worker_threads'
import { FingerprintService } from './fingerprint'

const libDirs: string[] = (workerData && Array.isArray(workerData.libDirs) ? workerData.libDirs : []) as string[]
const service = new FingerprintService({ libDirs })

// Cancel flag consulted by the capture loop between slices. Because the worker
// is single-threaded, the 'cancel' message can only be processed once the
// blocking dpfpdd_capture slice returns — cancel latency is at most one
// CAPTURE_SLICE_MS, after which the loop sees the flag and bails out.
let cancelled = false

function reply(id: number, ok: boolean, data?: any, error?: string) {
  try {
    parentPort?.postMessage(ok ? { id, ok, data } : { id, ok: false, error: error || 'Fingerprint worker error' })
  } catch {
    // parentPort may be gone during shutdown
  }
}

parentPort?.on('message', async (msg: any) => {
  if (!msg || typeof msg.id !== 'number') return
  try {
    switch (msg.type) {
      case 'status': {
        reply(msg.id, true, await service.getStatus())
        break
      }
      case 'capture': {
        cancelled = false
        const result = await service.capture(msg.timeoutMs || 30000, () => cancelled)
        if ('sample' in result) {
          reply(msg.id, true, result)
        } else {
          reply(msg.id, false, undefined, result.reason === 'device' ? result.message : result.reason)
        }
        break
      }
      case 'cancel': {
        cancelled = true
        service.cancelCapture()
        reply(msg.id, true)
        break
      }
      case 'create-fmd': {
        const res = service.createFmdFromFid(String(msg.imageBase64 || ''))
        if ('error' in res) {
          reply(msg.id, false, undefined, res.error)
        } else {
          reply(msg.id, true, { fmdBase64: res.fmdBase64, size: res.size })
        }
        break
      }
      case 'identify': {
        const templates: { fmdBase64: string }[] = Array.isArray(msg.templates) ? msg.templates : []
        const res = service.identify(String(msg.fmdBase64 || ''), templates)
        if ('error' in res) {
          reply(msg.id, false, undefined, res.error)
        } else {
          reply(msg.id, true, { index: res.index })
        }
        break
      }
      case 'shutdown': {
        await service.shutdown()
        reply(msg.id, true)
        break
      }
      default:
        reply(msg.id, false, undefined, `Unknown fingerprint worker message type: ${msg.type}`)
    }
  } catch (error: any) {
    reply(msg.id, false, undefined, error?.message || String(error))
  }
})

// If the worker is ever terminated externally, release the reader/libs.
process.on('beforeExit', () => {
  service.shutdown().catch(() => {})
})
