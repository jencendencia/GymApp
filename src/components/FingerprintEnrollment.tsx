import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FingerprintIcon, FingerprintScanRings } from './FingerprintArt'
import './FingerprintEnrollment.css'

/**
 * Windows Hello-style 3-tap fingerprint enrollment (P2 6.9).
 *
 * Walks the user through exactly ENROLL_STEPS (3) successful scans. After every
 * tap the fingerprint SVG fills 1/3 more, a step dot lights up, and a short
 * chime confirms the capture before advancing to the next tap. Once all 3 are
 * captured a success panel appears; the parent is notified with every change
 * so it can persist the templates (or leave enrollment untouched/cleared).
 *
 * The capture mechanics are injected via `captureFinger` so this module can be
 * reused for members (Member form), staff/admin (Users), and anywhere else.
 */

export interface FingerprintSlotData {
  /** Base64 ANSI-378 FMD template captured from the reader */
  fmdBase64: string | null
  quality: number
}

export const ENROLL_STEPS = 3

export const emptyFingerSlots = (): FingerprintSlotData[] =>
  Array.from({ length: ENROLL_STEPS }, () => ({ fmdBase64: null, quality: 0 }))

/** Short pleasant chime confirming a successful scan. */
export function playEnrollmentChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new AudioCtx()
    const note = (freq: number, at: number, dur = 0.35) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(at)
      osc.stop(at + dur + 0.05)
    }
    note(660, ctx.currentTime, 0.18)
    note(990, ctx.currentTime + 0.12, 0.3)
    setTimeout(() => ctx.close(), 1000)
  } catch {
    // Audio unavailable — ignore
  }
}

interface FingerprintEnrollmentProps {
  /** Pre-fill with existing enrollments (edit mode). */
  initialFingers?: FingerprintSlotData[]
  /**
   * Capture exactly one finger. Resolve with the template on success, null when
   * the user cancelled / no finger was placed (silent), or throw an Error with a
   * friendly message for fatal failures (reader missing, capture error).
   */
  captureFinger: () => Promise<FingerprintSlotData | null>
  /** Fired after every successful capture (and when cleared) with the full slot set. */
  onEnrolled: (fingers: FingerprintSlotData[]) => void
  /** Short helper text under the status line. */
  hint?: string
  /** Compact variant for sidebars / narrow modals. */
  compact?: boolean
}

function FingerprintEnrollment({
  initialFingers,
  captureFinger,
  onEnrolled,
  hint,
  compact,
}: FingerprintEnrollmentProps) {
  const [fingers, setFingers] = useState<FingerprintSlotData[]>(() => {
    if (initialFingers && initialFingers.length === ENROLL_STEPS) {
      return initialFingers.map(f => ({ fmdBase64: f.fmdBase64 ?? null, quality: f.quality || 0 }))
    }
    return emptyFingerSlots()
  })
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justCaptured, setJustCaptured] = useState(false)
  const [autoAdvance, setAutoAdvance] = useState(false)
  const mountedRef = useRef(true)
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
      window.electronAPI?.stopFingerprintCapture?.().catch(() => {})
    }
  }, [])

  const enrolledCount = fingers.filter(f => f.fmdBase64).length
  const nextSlot = fingers.findIndex(f => !f.fmdBase64)
  const complete = enrolledCount === ENROLL_STEPS

  const scanNext = useCallback(async () => {
    if (scanning || complete) return
    const slot = fingers.findIndex(f => !f.fmdBase64)
    if (slot < 0) return
    setScanning(true)
    setError(null)
    try {
      const captured = await captureFinger()
      if (!mountedRef.current) return
      if (!captured || !captured.fmdBase64) {
        // cancelled / no finger — stop auto-advancing so we don't loop forever
        setAutoAdvance(false)
        return
      }
      const next = fingers.map((f, i) =>
        i === slot ? { fmdBase64: captured.fmdBase64!, quality: captured.quality || 0 } : f
      )
      setFingers(next)
      onEnrolled(next)
      playEnrollmentChime()
      setJustCaptured(true)
      setTimeout(() => mountedRef.current && setJustCaptured(false), 650)
      // Keep the flow going: after a short beat, listen for the next tap.
      setAutoAdvance(next.some(f => !f.fmdBase64))
    } catch (e: any) {
      if (mountedRef.current) {
        setError(e?.message || 'Fingerprint capture failed. Check the scanner and try again.')
        setAutoAdvance(false)
      }
    } finally {
      if (mountedRef.current) setScanning(false)
    }
  }, [fingers, scanning, complete, captureFinger, onEnrolled])

  // Auto-advance to the next slot shortly after a successful tap
  useEffect(() => {
    if (!autoAdvance || scanning || complete) return
    const t = setTimeout(() => scanNext(), 900)
    scanTimerRef.current = t
    return () => clearTimeout(t)
  }, [autoAdvance, scanning, complete, scanNext, enrolledCount])

  const handleStart = () => {
    setAutoAdvance(true)
    scanNext()
  }

  const handleCancelScan = () => {
    setAutoAdvance(false)
    setScanning(false)
    window.electronAPI?.stopFingerprintCapture?.().catch(() => {})
  }

  const handleClear = () => {
    setAutoAdvance(false)
    setScanning(false)
    setError(null)
    const fresh = emptyFingerSlots()
    setFingers(fresh)
    onEnrolled(fresh)
  }

  const progress = enrolledCount / ENROLL_STEPS

  return (
    <div className={`fp-enroll${compact ? ' fp-enroll-compact' : ''}${complete ? ' fp-enroll-done' : ''}`}>
      <div className="fp-enroll-visual">
        <div className={`fp-enroll-icon-wrap${scanning ? ' scanning' : ''}${justCaptured ? ' captured' : ''}`}>
          <FingerprintIcon progress={progress} className="fp-enroll-icon" />
          {scanning && <FingerprintScanRings />}
        </div>

        {/* 3-step progress indicator */}
        <div className="fp-step-dots">
          {fingers.map((f, i) => (
            <span
              key={i}
              className={`fp-step-dot${f.fmdBase64 ? ' filled' : ''}${scanning && i === nextSlot ? ' active' : ''}`}
            >
              {f.fmdBase64 ? '✓' : i + 1}
            </span>
          ))}
        </div>
        <div className="fp-progress-track">
          <div className="fp-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      <div className="fp-enroll-status">
        {complete ? (
          <div className="fp-enroll-success">
            <div className="fp-success-check">✓</div>
            <span className="fp-success-title">Fingerprints registered</span>
            <span className="fp-success-hint">
              {hint || `Member can now check in at the kiosk using any of the ${ENROLL_STEPS} enrolled fingers.`}
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleClear}>
              Re-enroll
            </button>
          </div>
        ) : scanning ? (
          <div className="fp-scanning-state">
            <span className="fp-status-title">Waiting for fingerprint…</span>
            <span className="fp-status-hint">
              Tap {enrolledCount + 1} of {ENROLL_STEPS}. Hold the finger flat and lift after the beep.
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleCancelScan}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="fp-idle-state">
            <span className="fp-status-title">
              {enrolledCount === 0 ? `Enroll up to ${ENROLL_STEPS} fingers` : `${enrolledCount} of ${ENROLL_STEPS} captured`}
            </span>
            <span className="fp-status-hint">
              {hint || 'Registering 3 fingers lets the member check in even if one finger is dirty or injured.'}
            </span>
            <div className="fp-enroll-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={handleStart}>
                {enrolledCount === 0 ? 'Start Enrollment' : `Scan Finger ${nextSlot + 1}`}
              </button>
              {enrolledCount > 0 && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleClear}>
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
        {error && <span className="fp-enroll-error">{error}</span>}
      </div>
    </div>
  )
}

export default FingerprintEnrollment
