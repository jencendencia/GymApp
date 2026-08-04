import React from 'react'

/**
 * Shared fingerprint artwork + progressive-fill state (P2 6.9).
 *
 * `FingerprintIcon` renders the classic fingerprint glyph with a dynamic fill:
 * pass `progress` (0..1) and the icon "fills in" from the bottom up — 33% per
 * tap during 3-step enrollment, 100% while the kiosk scans. The two layers use
 * `currentColor` so the active (accent) and empty (muted) colors are styled via
 * CSS classes:
 *   .fp-fill-empty { color: <muted>; }   .fp-fill-active { color: <accent>; }
 */

export const FINGERPRINT_PATH =
  'M17.81 4.47c-.08 0-.16-.02-.23-.06C15.66 3.42 14 3 12.01 3c-1.98 0-3.86.47-5.57 1.41-.24.13-.54.04-.68-.2-.13-.24-.04-.55.2-.68C7.82 2.52 9.86 2 12.01 2c2.13 0 3.99.47 6.03 1.52.25.13.34.43.21.67-.09.18-.26.28-.44.28zM3.5 9.72c-.1 0-.2-.03-.29-.09-.23-.16-.28-.47-.12-.7.99-1.4 2.25-2.5 3.75-3.27C9.98 4.04 14 4.03 17.15 5.65c1.5.77 2.76 1.86 3.75 3.25.16.22.11.54-.12.7-.23.16-.54.11-.7-.12-.9-1.26-2.04-2.25-3.39-2.94-2.87-1.47-6.54-1.47-9.4.01-1.36.7-2.5 1.7-3.4 2.96-.08.14-.23.21-.39.21zm6.25 12.07c-.13 0-.26-.05-.35-.15-.87-.87-1.34-1.43-2.01-2.64-.69-1.23-1.05-2.73-1.05-4.34 0-2.97 2.54-5.39 5.66-5.39s5.66 2.42 5.66 5.39c0 .28-.22.5-.5.5s-.5-.22-.5-.5c0-2.42-2.09-4.39-4.66-4.39-2.57 0-4.66 1.97-4.66 4.39 0 1.44.32 2.77.93 3.85.64 1.15 1.08 1.64 1.85 2.42.19.2.19.51 0 .71-.11.1-.24.15-.37.15zm7.17-1.85c-1.19 0-2.24-.3-3.1-.89-1.49-1.01-2.38-2.65-2.38-4.39 0-.28.22-.5.5-.5s.5.22.5.5c0 1.41.72 2.74 1.94 3.56.71.48 1.54.71 2.54.71.24 0 .64-.03 1.04-.1.27-.05.53.13.58.41.05.27-.13.53-.41.58-.57.11-1.07.12-1.21.12zM14.91 22c-.04 0-.09-.01-.13-.02-4.91-1.31-7.78-6.24-7.78-9.44 0-1.66 1.34-3 3-3s3 1.34 3 3c0 1.42-1.16 2.58-2.58 2.58-1.42 0-2.58-1.16-2.58-2.58 0-1.66-1.34-3-3-3s-3 1.34-3 3c0 3.65 3.25 8.96 8.35 10.29.27.07.43.35.35.61-.05.23-.26.37-.46.37z'

interface FingerprintIconProps {
  /** Fill amount 0..1 — the glyph fills from the bottom up (0.33 per tap for 3-step enrollment). */
  progress?: number
  className?: string
  style?: React.CSSProperties
}

export function FingerprintIcon({ progress = 1, className = '', style }: FingerprintIconProps) {
  const clipId = React.useId()
  const p = Math.max(0, Math.min(1, progress || 0))
  const fillY = 24 - 24 * p // reveal from the bottom up
  return (
    <svg viewBox="0 0 24 24" className={`fp-fill-svg ${className}`} style={style} aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y={fillY} width="24" height={24 * p} />
        </clipPath>
      </defs>
      <path className="fp-fill-empty" d={FINGERPRINT_PATH} fill="currentColor" opacity={p >= 1 ? 0 : 1} />
      <g clipPath={`url(#${clipId})`}>
        <path className="fp-fill-active" d={FINGERPRINT_PATH} fill="currentColor" />
      </g>
    </svg>
  )
}

/** Pulsing radar rings shown while a fingerprint capture is in flight. */
export function FingerprintScanRings({ className = '' }: { className?: string }) {
  return (
    <div className={`fp-scan-rings ${className}`} aria-hidden="true">
      <div className="fp-scan-ring r1" />
      <div className="fp-scan-ring r2" />
      <div className="fp-scan-ring r3" />
    </div>
  )
}
