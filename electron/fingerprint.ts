// ── Native fingerprint service (U.R.U. 4500 / DigitalPersona U.are.U SDK) ──
// Replaces the Windows Hello WebAuthn flow. Talks directly to the U.are.U SDK's
// dpfpdd.dll (device capture) and dpfj.dll (template creation + identification)
// through koffi (Node-API FFI — no native rebuild needed in Electron).
//
// IMPORTANT ARCHITECTURE NOTE: this module runs inside a Node worker thread
// (see fingerprint.worker.ts), NOT in the Electron main process. Two reasons:
//   1. dpfpdd_capture is a blocking call (waits up to the timeout for a finger),
//      so it must not block the main process / renderer.
//   2. koffi's registered callbacks (koffi.register) and its .async() worker
//      machinery both crash on some Windows machines, while plain koffi FFI
//      calls inside a regular Node worker_thread work reliably.
// Because it runs in a worker, this module must NOT import 'electron' (app is
// not available there) — the DLL search dirs are passed in via the constructor.
//
// Flow: capture an ANSI-381 FID image (dpfpdd_capture), convert it to an
// ANSI-378 FMD template (dpfj_create_fmd_from_fid) which is stored in the app
// DB. Check-in captures a finger and runs dpfj_identify against all member
// templates (1:N), returning the matching member.

import koffi from 'koffi'
import fs from 'fs'
import path from 'path'

// ── Constants (from dpfpdd.h / dpfj.h, cross-checked against the uareu-node
// wrapper that was tested with the U.R.U. 4500 and the official SDK header) ──
const DPFPDD_SUCCESS = 0
const MAX_DEVICE_NAME_LENGTH = 1024 // char name[MAX_DEVICE_NAME_LENGTH] in DPFPDD_DEV_INFO
const MAX_STRING_LENGTH = 128
const MAX_DEVICE_NUMBER = 5
const DPFPDD_IMG_FMT_ANSI381 = 0x001b0401
const DPFPDD_IMG_PROC_DEFAULT = 0
const DPFJ_SUCCESS = 0
const DPFJ_FMD_ANSI_378_2004 = 0x001b0001
const DPFJ_ENGINE_DPFJ = 0
const DPFJ_PROBABILITY_ONE = 0x7fffffff
const MAX_FMD_SIZE = 1562 // 26 (record hdr) + 4 (view hdr) + 255*6 (minutiae) + 2

// SDK errors use the 0x05BA facility: DPERROR(err) = err | (0x05BA << 16)
const DP_FACILITY = 0x05ba
const dperr = (code: number) => code | (DP_FACILITY << 16)
const DPFPDD_E_MORE_DATA = dperr(0x0d) // buffer too small — required size in the size param
// dpfj errors share the 0x05BA facility — DPFJ_E_MORE_DATA is the same value as
// DPFPDD_E_MORE_DATA (both DPERROR(0x0d)); aliased for readability in dpfj code.
const DPFJ_E_MORE_DATA = DPFPDD_E_MORE_DATA
const DPFPDD_E_INVALID_PARAMETER = dperr(0x14)
const DPFPDD_E_INVALID_DEVICE = dperr(0x15)
const DPFPDD_E_DEVICE_BUSY = dperr(0x1e)
const DPFPDD_E_DEVICE_FAILURE = dperr(0x1f)

// Capture image buffer. The SDK returns DPFPDD_E_MORE_DATA if too small and
// writes the required size back; we grow on demand. Generous initial size
// covers typical 500 dpi FID captures (~100-200 KB).
const INITIAL_IMAGE_CAPACITY = 512 * 1024
const CAPTURE_SLICE_MS = 1000 // per-dpfpdd_capture timeout slice (cancel-responsive)

// ── koffi type declarations (layouts match the official SDK headers exactly) ──
const DPFPDD_VER_INFO = koffi.struct('DPFPDD_VER_INFO', {
  major: 'int32',
  minor: 'int32',
  maintenance: 'int32',
})

const DPFPDD_HW_DESCR = koffi.struct('DPFPDD_HW_DESCR', {
  vendor_name: koffi.array('char', MAX_STRING_LENGTH, 'String'),
  product_name: koffi.array('char', MAX_STRING_LENGTH, 'String'),
  serial_num: koffi.array('char', MAX_STRING_LENGTH, 'String'),
})

const DPFPDD_HW_ID = koffi.struct('DPFPDD_HW_ID', {
  vendor_id: 'int16',
  product_id: 'int16',
})

const DPFPDD_HW_VERSION = koffi.struct('DPFPDD_HW_VERSION', {
  hw_ver: DPFPDD_VER_INFO,
  fw_ver: DPFPDD_VER_INFO,
  bcd_rev: 'int16',
})

const DPFPDD_DEV_INFO = koffi.struct('DPFPDD_DEV_INFO', {
  size: 'uint32',
  name: koffi.array('char', MAX_DEVICE_NAME_LENGTH, 'String'),
  descr: DPFPDD_HW_DESCR,
  id: DPFPDD_HW_ID,
  ver: DPFPDD_HW_VERSION,
  modality: 'uint32',
  technology: 'uint32',
})

const DPFPDD_DEV_CAPS = koffi.struct('DPFPDD_DEV_CAPS', {
  size: 'uint32',
  can_capture_image: 'int32',
  can_stream_image: 'int32',
  can_extract_features: 'int32',
  can_match: 'int32',
  can_identify: 'int32',
  has_fp_storage: 'int32',
  indicator_type: 'uint32',
  has_pwr_mgmt: 'int32',
  has_calibration: 'int32',
  piv_compliant: 'int32',
  resolution_cnt: 'uint32',
  resolutions: koffi.array('uint32', 1), // SDK declares unsigned int resolutions[1]
})

const DPFPDD_CAPTURE_PARAM = koffi.struct('DPFPDD_CAPTURE_PARAM', {
  size: 'uint32',
  image_fmt: 'uint32',
  image_proc: 'uint32',
  image_res: 'uint32',
})

const DPFPDD_IMAGE_INFO = koffi.struct('DPFPDD_IMAGE_INFO', {
  size: 'uint32',
  width: 'uint32',
  height: 'uint32',
  res: 'uint32',
  bpp: 'uint32',
})

const DPFPDD_CAPTURE_RESULT = koffi.struct('DPFPDD_CAPTURE_RESULT', {
  size: 'uint32',
  success: 'int32',
  quality: 'uint32',
  score: 'uint32',
  info: DPFPDD_IMAGE_INFO,
})

const DPFJ_CANDIDATE = koffi.struct('DPFJ_CANDIDATE', {
  size: 'uint32',
  fmd_idx: 'uint32',
  view_idx: 'uint32',
})

// ── Public types ──
export interface FingerprintSample {
  success: boolean
  qualityCode: number
  error: number
  width: number
  height: number
  resolution: number
  imageSize: number
  /** ANSI-381 FID bytes (base64) — input for createFmdFromFid */
  imageBase64: string
}

export interface FpStatusStep {
  name: string
  ok: boolean
  message: string
}

export interface FpStatus {
  available: boolean
  readerName: string
  steps: FpStatusStep[]
}

export type CaptureResult =
  | { ok: true; sample: FingerprintSample }
  | { ok: false; reason: 'unavailable' | 'device' | 'timeout' | 'cancelled'; message?: string }

export interface FingerprintServiceOptions {
  /** Extra directories to search for dpfpdd.dll / dpfj.dll (e.g. app userData). */
  libDirs?: string[]
}

export class FingerprintService {
  private dpfpdd: any = null
  private dpfj: any = null
  private handle: any = null
  private readerName = ''
  private initialized = false
  private extraLibDirs: string[]

  constructor(options: FingerprintServiceOptions = {}) {
    this.extraLibDirs = options.libDirs || []
  }

  // Locate the SDK DLLs: userData/bin, next to the exe, next to this module,
  // the working dir, or the OS search path (bare names).
  private resolveLibDirs(): { dpfpdd: string | null; dpfj: string | null } {
    const candidates = [
      ...this.extraLibDirs.map((d) => path.join(d, 'bin')),
      ...this.extraLibDirs,
      path.join(path.dirname(process.execPath), 'bin'),
      path.join(__dirname, '../bin'),
      path.join(process.cwd(), 'bin'),
      '', // bare name → OS search path
    ]
    const find = (file: string): string | null => {
      for (const dir of candidates) {
        const full = dir ? path.join(dir, file) : file
        try {
          if (!dir || (fs.existsSync(full) && fs.statSync(full).isFile())) return full
        } catch {
          // keep searching
        }
      }
      return null
    }
    return { dpfpdd: find('dpfpdd.dll'), dpfj: find('dpfj.dll') }
  }

  // Load the SDK DLLs (idempotent).
  private ensureLibs(): string | null {
    if (this.dpfpdd && this.dpfj) return null
    const { dpfpdd, dpfj } = this.resolveLibDirs()
    if (!dpfpdd || !dpfj) {
      return 'DigitalPersona U.are.U SDK DLLs (dpfpdd.dll / dpfj.dll) not found. Drop them in a "bin" folder next to the app, or install the U.are.U SDK.'
    }
    try {
      this.dpfpdd = koffi.load(dpfpdd)
      this.dpfj = koffi.load(dpfj)
    } catch (error: any) {
      this.dpfpdd = null
      this.dpfj = null
      return `Failed to load U.are.U SDK DLLs: ${error?.message || error}`
    }
    return null
  }

  // Declare the native functions once the libs are loaded.
  private declareFunctions() {
    if (this.dpfpdd.funcs || this.dpfj.funcs) return
    this.dpfpdd.funcs = true
    this.dpfj.funcs = true

    // dpfpdd.dll (DPFPDD_DEV is void*; on x64 the handle is 8 bytes)
    this.dpfpdd.dpfpdd_init = this.dpfpdd.func('dpfpdd_init', 'int', [])
    this.dpfpdd.dpfpdd_exit = this.dpfpdd.func('dpfpdd_exit', 'int', [])
    this.dpfpdd.dpfpdd_query_devices = this.dpfpdd.func('dpfpdd_query_devices', 'int', ['void *', 'void *'])
    this.dpfpdd.dpfpdd_open = this.dpfpdd.func('dpfpdd_open', 'int', ['void *', 'void *'])
    this.dpfpdd.dpfpdd_close = this.dpfpdd.func('dpfpdd_close', 'int', ['void *'])
    this.dpfpdd.dpfpdd_get_device_capabilities = this.dpfpdd.func('dpfpdd_get_device_capabilities', 'int', ['void *', 'void *'])
    this.dpfpdd.dpfpdd_capture = this.dpfpdd.func('dpfpdd_capture', 'int', ['void *', 'void *', 'uint32', 'void *', 'void *', 'void *'])
    this.dpfpdd.dpfpdd_cancel = this.dpfpdd.func('dpfpdd_cancel', 'int', ['void *'])

    // dpfj.dll
    this.dpfj.dpfj_create_fmd_from_fid = this.dpfj.func('dpfj_create_fmd_from_fid', 'int', ['int32', 'void *', 'uint32', 'int32', 'void *', 'void *'])
    this.dpfj.dpfj_identify = this.dpfj.func('dpfj_identify', 'int', ['int32', 'void *', 'uint32', 'int32', 'int32', 'uint32', 'void *', 'void *', 'int32', 'void *', 'void *'])
  }

  // Initialize the device library + enumerate readers. Safe to call repeatedly.
  async getStatus(): Promise<FpStatus> {
    const steps: FpStatusStep[] = []
    const push = (name: string, ok: boolean, message: string) => steps.push({ name, ok, message })

    const libErr = this.ensureLibs()
    if (libErr) {
      push('SDK DLLs', false, libErr)
      return { available: false, readerName: '', steps }
    }
    push('SDK DLLs', true, 'dpfpdd.dll / dpfj.dll loaded')
    this.declareFunctions()

    if (!this.initialized) {
      const rc = this.dpfpdd.dpfpdd_init()
      if (rc !== DPFPDD_SUCCESS) {
        push('Library init', false, `dpfpdd_init failed (code ${rc})`)
        return { available: false, readerName: '', steps }
      }
      this.initialized = true
    }
    push('Library init', true, 'dpfpdd_init ok')

    try {
      const devs = this.enumerateDevices()
      if (devs.length === 0) {
        push('Reader', false, 'No fingerprint reader detected. Check that the U.R.U. 4500 is plugged in and using the U.are.U driver.')
        return { available: false, readerName: '', steps }
      }
      this.readerName = devs[0].name || 'Fingerprint Reader'
      push('Reader', true, this.readerName)
    } catch (error: any) {
      push('Reader', false, `Reader detection failed: ${error?.message || error}`)
      return { available: false, readerName: '', steps }
    }

    return { available: true, readerName: this.readerName, steps }
  }

  // Enumerate connected readers using the SDK's documented two-step pattern:
  //   1. probe with count=0 and a NULL buffer → DPFPDD_E_MORE_DATA + required count
  //   2. allocate exactly that many entries, pre-set each entry's `size` field to
  //      sizeof(DPFPDD_DEV_INFO), then call again.
  // Verified against dpfpdd.h and the official UareUSampleCpp Enumeration.h: the
  // SDK rejects a direct call with a larger capacity (e.g. count=5) or entries
  // with a zeroed `size` field (DPFPDD_E_INVALID_PARAMETER / 0x80070002).
  private enumerateDevices(): { name: string; nameBuf: Buffer; data: Buffer }[] {
    const devInfoSize = koffi.sizeof(DPFPDD_DEV_INFO)
    const countBuf = Buffer.alloc(4)

    // Step 1 — probe: returns DPFPDD_E_MORE_DATA and writes the required count
    countBuf.writeUInt32LE(0, 0)
    const probeRc = this.dpfpdd.dpfpdd_query_devices(countBuf, null)
    if (probeRc !== DPFPDD_SUCCESS && probeRc !== DPFPDD_E_MORE_DATA) {
      throw new Error(`dpfpdd_query_devices failed (code ${probeRc})`)
    }
    const count = Math.min(countBuf.readUInt32LE(0), MAX_DEVICE_NUMBER)
    if (count === 0) return []

    // Step 2 — fill: pre-set each entry's `size` field so the SDK accepts the array
    const devsBuf = Buffer.alloc(count * devInfoSize)
    for (let i = 0; i < count; i++) devsBuf.writeUInt32LE(devInfoSize, i * devInfoSize)
    const rc = this.dpfpdd.dpfpdd_query_devices(countBuf, devsBuf)
    if (rc !== DPFPDD_SUCCESS && rc !== DPFPDD_E_MORE_DATA) {
      throw new Error(`dpfpdd_query_devices failed (code ${rc})`)
    }

    const list: { name: string; nameBuf: Buffer; data: Buffer }[] = []
    const outCount = Math.min(countBuf.readUInt32LE(0), count)
    for (let i = 0; i < outCount; i++) {
      const slice = devsBuf.subarray(i * devInfoSize, (i + 1) * devInfoSize)
      let info: any = {}
      try {
        info = koffi.decode(slice, DPFPDD_DEV_INFO)
      } catch {
        continue
      }
      // Keep the raw name bytes — dpfpdd_open identifies readers by this buffer
      // (uareu-node passes readerInfo.data.name.buffer). The name field sits
      // right after the uint32 `size` field.
      const nameBuf = slice.subarray(4, 4 + MAX_DEVICE_NAME_LENGTH)
      list.push({ name: String(info.name || '').replace(/\0+$/, '').trim(), nameBuf, data: slice })
    }
    return list
  }

  // Open the first reader. Returns null + message on failure.
  private openReader(): string | null {
    if (this.handle) return null
    try {
      const devs = this.enumerateDevices()
      if (devs.length === 0) return 'No fingerprint reader detected.'
      // dpfpdd_open takes the raw device name buffer (char* dev_name).
      const handleBuf = Buffer.alloc(8) // DPFPDD_DEV = void* (8 bytes on x64)
      const rc = this.dpfpdd.dpfpdd_open(devs[0].nameBuf, handleBuf)
      if (rc !== DPFPDD_SUCCESS) return `Failed to open reader "${devs[0].name}" (code ${rc})`
      this.handle = handleBuf.readBigUInt64LE(0)
      if (!this.handle) return 'Reader returned an invalid handle.'
      this.readerName = devs[0].name || 'Fingerprint Reader'
      return null
    } catch (error: any) {
      return `Failed to open reader: ${error?.message || error}`
    }
  }

  // Best-effort first supported resolution from device capabilities, falling back
  // to 500 dpi (the U.are.U 4500's native resolution — the official SDK samples
  // hardcode 500). 0 must never be returned: dpfpdd_capture rejects image_res=0
  // with DPFPDD_E_INVALID_PARAMETER (verified against a live reader).
  private getDefaultResolution(): number {
    try {
      if (!this.handle) return 500
      // DPFPDD_DEV_CAPS has a flexible resolutions[] tail — probe with a generous
      // buffer and grow to whatever size the SDK reports (on DPFPDD_E_MORE_DATA
      // the required size is written back into the `size` field).
      let capsBuf = Buffer.alloc(4096)
      capsBuf.writeUInt32LE(4096, 0)
      let rc = this.dpfpdd.dpfpdd_get_device_capabilities(this.handle, capsBuf)
      if (rc === DPFPDD_E_MORE_DATA) {
        const required = capsBuf.readUInt32LE(0)
        if (required > 0 && required <= 65536) {
          capsBuf = Buffer.alloc(required)
          capsBuf.writeUInt32LE(required, 0)
          rc = this.dpfpdd.dpfpdd_get_device_capabilities(this.handle, capsBuf)
        }
      }
      if (rc !== DPFPDD_SUCCESS) return 500
      const caps: any = koffi.decode(capsBuf, DPFPDD_DEV_CAPS)
      return Number(caps.resolution_cnt) > 0 ? Number(caps.resolutions[0]) || 500 : 500
    } catch {
      return 500
    }
  }

  // Blocking capture loop. Each dpfpdd_capture call waits up to CAPTURE_SLICE_MS;
  // between slices we yield so a 'cancel' message can be processed and check the
  // isCancelled callback. Returns a good-quality sample, a timeout, or an error.
  async capture(
    timeoutMs: number,
    isCancelled?: () => boolean,
  ): Promise<CaptureResult> {
    const libErr = this.ensureLibs()
    if (libErr) return { ok: false, reason: 'unavailable', message: libErr }
    this.declareFunctions()

    if (!this.initialized) {
      const rc = this.dpfpdd.dpfpdd_init()
      if (rc !== DPFPDD_SUCCESS) return { ok: false, reason: 'device', message: `dpfpdd_init failed (code ${rc})` }
      this.initialized = true
    }
    const openErr = this.openReader()
    if (openErr) return { ok: false, reason: 'device', message: openErr }

    const paramBuf = Buffer.alloc(koffi.sizeof(DPFPDD_CAPTURE_PARAM))
    paramBuf.writeUInt32LE(koffi.sizeof(DPFPDD_CAPTURE_PARAM), 0)
    paramBuf.writeUInt32LE(DPFPDD_IMG_FMT_ANSI381, 4)
    paramBuf.writeUInt32LE(DPFPDD_IMG_PROC_DEFAULT, 8)
    paramBuf.writeUInt32LE(this.getDefaultResolution(), 12)

    // DPFPDD_CAPTURE_RESULT's `size` field must be pre-set (the SDK rejects it
    // otherwise — same requirement as DPFPDD_DEV_INFO in enumerateDevices).
    const resultBuf = Buffer.alloc(koffi.sizeof(DPFPDD_CAPTURE_RESULT))
    resultBuf.writeUInt32LE(koffi.sizeof(DPFPDD_CAPTURE_RESULT), 0)
    const imgSizeBuf = Buffer.alloc(4)
    let imgBuf = Buffer.alloc(INITIAL_IMAGE_CAPACITY)

    const deadline = Date.now() + Math.max(timeoutMs, 0)
    while (Date.now() < deadline) {
      if (isCancelled?.()) return { ok: false, reason: 'cancelled' }

      imgSizeBuf.writeUInt32LE(imgBuf.length, 0)
      let rc: number
      try {
        rc = this.dpfpdd.dpfpdd_capture(this.handle, paramBuf, CAPTURE_SLICE_MS, resultBuf, imgSizeBuf, imgBuf)
      } catch (error: any) {
        return { ok: false, reason: 'device', message: `Capture call failed: ${error?.message || error}` }
      }

      if (rc === DPFPDD_SUCCESS) {
        const result: any = koffi.decode(resultBuf, DPFPDD_CAPTURE_RESULT)
        if (Number(result.success) === 1) {
          const size = Number(imgSizeBuf.readUInt32LE(0)) || 0
          // This SDK build leaves image_size at the input buffer capacity on
          // success (the actual size is only written on MORE_DATA), so the image
          // bytes include the whole padded buffer. Trim to the ANSI-381 "FIR"
          // record length so the sample carries the exact image (dpfj rejects
          // fid_size mismatches with DPFJ_E_INVALID_FID).
          const trimmed = this.trimAnsi381Fid(imgBuf)
          const imageSize = trimmed.length !== imgBuf.length ? trimmed.length : size
          if (imageSize > 0 && imageSize <= imgBuf.length) {
            const info: any = result.info || {}
            return {
              ok: true,
              sample: {
                success: true,
                qualityCode: Number(result.quality) || 0,
                error: 0,
                width: Number(info.width) || 0,
                height: Number(info.height) || 0,
                resolution: Number(info.res) || 0,
                imageSize,
                imageBase64: trimmed.subarray(0, imageSize).toString('base64'),
              },
            }
          }
        }
        // Capture "completed" but no good image (no finger / bad quality) → retry
      } else if (rc === DPFPDD_E_MORE_DATA) {
        const needed = Number(imgSizeBuf.readUInt32LE(0)) || 0
        if (needed > imgBuf.length) imgBuf = Buffer.alloc(Math.max(needed, imgBuf.length * 2))
      } else if (rc === DPFPDD_E_INVALID_DEVICE || rc === DPFPDD_E_DEVICE_BUSY || rc === DPFPDD_E_DEVICE_FAILURE || rc === DPFPDD_E_INVALID_PARAMETER) {
        return { ok: false, reason: 'device', message: `Reader error (code ${rc})` }
      }
      // Other non-zero codes (e.g. DPFPDD_E_FAILURE on timeout) → keep scanning

      // Yield so the worker's event loop can process a queued cancel message.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { ok: false, reason: 'timeout', message: 'No finger detected within the capture window.' }
  }

  // Cancel an in-flight capture from another thread (the blocking capture call
  // itself returns on its own slice timeout; this makes the next check return).
  cancelCapture(): void {
    if (!this.handle) return
    try {
      this.dpfpdd.dpfpdd_cancel(this.handle)
    } catch {
      // ignore — reader may already be idle
    }
  }

  // ANSI-381 "FIR" FIDs self-declare their record length at header offset 10
  // (big-endian). dpfpdd_capture in this SDK build returns the whole padded image
  // buffer (image_size is only written on MORE_DATA), so trim to the declared
  // length — dpfj rejects fid_size mismatches with DPFJ_E_INVALID_FID.
  private trimAnsi381Fid(buf: Buffer): Buffer {
    if (buf.length > 64 && buf.toString('latin1', 0, 4) === 'FIR\u0000') {
      const recLen = buf.readUInt32BE(10)
      if (recLen > 64 && recLen <= buf.length) return buf.subarray(0, recLen)
    }
    return buf
  }

  // Convert a captured ANSI-381 FID to an ANSI-378 FMD template (base64).
  createFmdFromFid(imageBase64: string): { fmdBase64: string; size: number } | { error: string } {
    const libErr = this.ensureLibs()
    if (libErr) return { error: libErr }
    this.declareFunctions()
    try {
      // Defensive: the capture path already trims, but slice any padded input to
      // the ANSI-381 "FIR" record length so fid_size matches — a mismatch makes
      // dpfj return DPFJ_E_INVALID_FID.
      const fid = this.trimAnsi381Fid(Buffer.from(imageBase64, 'base64'))
      // FMD buffer: grow to the SDK-required size on DPFJ_E_MORE_DATA (dense
      // fingerprints can produce templates larger than MAX_FMD_SIZE).
      let fmdBuf = Buffer.alloc(MAX_FMD_SIZE)
      const fmdSizeBuf = Buffer.alloc(4)
      fmdSizeBuf.writeUInt32LE(fmdBuf.length, 0)
      let rc = this.dpfj.dpfj_create_fmd_from_fid(
        DPFPDD_IMG_FMT_ANSI381,
        fid,
        fid.length,
        DPFJ_FMD_ANSI_378_2004,
        fmdBuf,
        fmdSizeBuf,
      )
      if (rc === DPFJ_E_MORE_DATA) {
        const required = fmdSizeBuf.readUInt32LE(0)
        if (required <= 0 || required > 4 * 1024 * 1024) {
          return { error: `dpfj_create_fmd_from_fid failed (code ${rc})` }
        }
        fmdBuf = Buffer.alloc(required)
        fmdSizeBuf.writeUInt32LE(required, 0)
        rc = this.dpfj.dpfj_create_fmd_from_fid(
          DPFPDD_IMG_FMT_ANSI381,
          fid,
          fid.length,
          DPFJ_FMD_ANSI_378_2004,
          fmdBuf,
          fmdSizeBuf,
        )
      }
      if (rc !== DPFJ_SUCCESS) return { error: `dpfj_create_fmd_from_fid failed (code ${rc})` }
      const size = fmdSizeBuf.readUInt32LE(0)
      if (size <= 0 || size > fmdBuf.length) return { error: `Invalid template size (${size})` }
      return { fmdBase64: fmdBuf.subarray(0, size).toString('base64'), size }
    } catch (error: any) {
      return { error: `Template creation failed: ${error?.message || error}` }
    }
  }

  // Identify a captured probe FMD against a list of member FMD templates.
  // Returns the index of the matched template or -1 (mirrors uareu-node's
  // 11-arg dpfj_identify signature; format-aware).
  identify(fmdBase64: string, templates: { fmdBase64: string }[]): { index: number } | { error: string } {
    const libErr = this.ensureLibs()
    if (libErr) return { error: libErr }
    this.declareFunctions()
    if (templates.length === 0) return { index: -1 }
    const probe = Buffer.from(fmdBase64, 'base64')
    const fmds: Buffer[] = templates.map((t) => Buffer.from(t.fmdBase64, 'base64'))
    const ptrSize = koffi.sizeof('void *')
    const fmdsPtrBuf = koffi.alloc('void *', fmds.length)
    const sizesBuf = Buffer.alloc(fmds.length * 4)
    const memBlocks: any[] = []
    try {
      for (let i = 0; i < fmds.length; i++) {
        const mem = koffi.alloc('uint8', fmds[i].length)
        memBlocks.push(mem)
        koffi.encode(mem, 'uint8', fmds[i], fmds[i].length)
        koffi.encode(fmdsPtrBuf, i * ptrSize, 'void *', mem)
        sizesBuf.writeUInt32LE(fmds[i].length, i * 4)
      }
      // candidate_cnt is [in] allocated slots / [out] matches found — the SDK
      // rejects a zeroed capacity. DPFJ_CANDIDATE.size must also be pre-set
      // (this SDK rejects zeroed structs, see enumerateDevices/capture).
      const candCountBuf = Buffer.alloc(4)
      candCountBuf.writeUInt32LE(1, 0)
      const candidateBuf = Buffer.alloc(koffi.sizeof(DPFJ_CANDIDATE))
      candidateBuf.writeUInt32LE(koffi.sizeof(DPFJ_CANDIDATE), 0)
      const threshold = Math.floor(DPFJ_PROBABILITY_ONE / 100000)
      const rc = this.dpfj.dpfj_identify(
        DPFJ_FMD_ANSI_378_2004,
        probe,
        probe.length,
        DPFJ_ENGINE_DPFJ,
        DPFJ_FMD_ANSI_378_2004,
        fmds.length,
        fmdsPtrBuf,
        sizesBuf,
        threshold,
        candCountBuf,
        candidateBuf,
      )
      if (rc !== DPFJ_SUCCESS) return { error: `dpfj_identify failed (code ${rc})` }
      const candidateCount = candCountBuf.readUInt32LE(0)
      if (candidateCount === 0) return { index: -1 }
      const candidate: any = koffi.decode(candidateBuf, DPFJ_CANDIDATE)
      return { index: Number(candidate.fmd_idx) }
    } catch (error: any) {
      return { error: `Identification failed: ${error?.message || error}` }
    } finally {
      for (const mem of memBlocks) {
        try { koffi.free(mem) } catch { /* ignore */ }
      }
      try { koffi.free(fmdsPtrBuf) } catch { /* ignore */ }
    }
  }

  // Release everything (on app quit).
  async shutdown(): Promise<void> {
    if (this.handle) {
      try { this.dpfpdd.dpfpdd_close(this.handle) } catch { /* ignore */ }
      this.handle = null
    }
    if (this.initialized) {
      try { this.dpfpdd.dpfpdd_exit() } catch { /* ignore */ }
      this.initialized = false
    }
  }
}
