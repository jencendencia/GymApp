import React, { useState, useEffect, useRef, useCallback } from 'react'
import './Kiosk.css'
import jsQR from 'jsqr'
import { Member, Plan, DailyReport, StaffFingerprintTemplateInfo, SmsStatus } from '../types/electron'
import { log } from '../lib/logger'
import { todayLocal, todayLocalOf } from '../lib/dates'
import { formatMoney } from '../lib/format'
import { FingerprintIcon, FingerprintScanRings } from './FingerprintArt'
import KioskExecReport from './KioskExecReport'

interface KioskProps {
  onRefresh: () => void
}

type KioskState = 'idle' | 'match-found' | 'no-match' | 'expired' | 'blocked' | 'staff-verified'

const AUTO_SCAN_DELAY = 600 // ms delay before auto-scanning
const AUTO_CLOSE_SECONDS = 6
// Backoff before re-arming the fingerprint scanner after a cancelled/failed scan.
// Slower than the initial delay so a fast-failing prompt can't cause the kiosk to
// rapidly flicker between screens trying to re-scan.
const RETRY_DELAY = 2500 // ms
// Backoff when there are no members / no registered fingerprints yet. Scanning
// every 600ms hammered the main process with IPC + DB writes constantly (each
// get-members also runs an auto-expire UPDATE) — that churn could stall frames
// on the kiosk and read as flicker. 5s still picks up new enrollments quickly.
const EMPTY_SCAN_RETRY = 5000 // ms

// Payment methods that require a transaction reference number
const METHODS_REQUIRING_REF = ['card', 'gcash', 'maya', 'bank_transfer']

// Promo / tip messages rotated on the idle screen (P2 5.1)
const PROMOS = [
  { icon: '💪', text: 'Every rep counts — you got this!' },
  { icon: '🏆', text: 'Consistency beats intensity. See you every day!' },
  { icon: '💧', text: 'Stay hydrated during your workout.' },
  { icon: '⏰', text: 'New to the gym? Ask the front desk for a tour.' },
  { icon: '📣', text: 'Refer a friend and earn rewards!' },
  { icon: '🧘', text: 'Don\'t forget to stretch after your session.' },
]

// Check if this is running in the dedicated kiosk window
const isKioskWindow = () => {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    return params.get('mode') === 'kiosk'
  }
  return false
}

function Kiosk({ onRefresh }: KioskProps) {
  const [state, setState] = useState<KioskState>('idle')
  const [kioskLogo, setKioskLogo] = useState('')
  const [matchedMember, setMatchedMember] = useState<Member | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showManualSearch, setShowManualSearch] = useState(false)
  const [countdown, setCountdown] = useState(AUTO_CLOSE_SECONDS)
  const [matchKey, setMatchKey] = useState(0)
  const [showMemberIdInput, setShowMemberIdInput] = useState(false)
  const [memberIdInput, setMemberIdInput] = useState('')
  const [memberIdError, setMemberIdError] = useState('')
  const [memberIdLoading, setMemberIdLoading] = useState(false)
  // Inline 'scanning' indicator on the idle screen. The idle screen stays mounted
  // while the native fingerprint prompt is up (no screen swap), so the kiosk never
  // flickers between the idle and a full-screen 'Scanning...' view.
  const [scanActive, setScanActive] = useState(false)
  const [blockedMessage, setBlockedMessage] = useState('')
  // P2 6.9: staff fingerprint at the kiosk — verified screen / executive report
  const [staffVerifiedUser, setStaffVerifiedUser] = useState<{ name: string; role: string } | null>(null)
  const [showExecReport, setShowExecReport] = useState(false)
  const [execReport, setExecReport] = useState<DailyReport | null>(null)
  const [execReportLoading, setExecReportLoading] = useState(false)
  const [execReportError, setExecReportError] = useState<string | null>(null)
  const [execAdminName, setExecAdminName] = useState('')
  // Live fingerprint rescan inside the blocked modal
  const [blockedRescanning, setBlockedRescanning] = useState(false)
  // Renewal modal state
  const [showRenewModal, setShowRenewModal] = useState(false)
  const [renewPlans, setRenewPlans] = useState<Plan[]>([])
  const [renewPlanId, setRenewPlanId] = useState(0)
  const [renewPaymentMethod, setRenewPaymentMethod] = useState('cash')
  const [renewTxnRef, setRenewTxnRef] = useState('')
  const [renewAmount, setRenewAmount] = useState(0)
  const [renewing, setRenewing] = useState(false)
  const [renewError, setRenewError] = useState('')
  // P2 5.8: free-month redemption (100 reward points) state
  const [showRedeemModal, setShowRedeemModal] = useState(false)
  const [redeeming, setRedeeming] = useState(false)
  const [redeemError, setRedeemError] = useState('')
  // Kiosk settings wired from Settings page
  const [kioskSettings, setKioskSettings] = useState({
    scannerEnabled: true,
    showMemberPhotos: true,
    enableNotifications: true,
    autoLockTimeout: 0,
  })
  // QR code scanning state
  const [showQrScanner, setShowQrScanner] = useState(false)
  const [qrError, setQrError] = useState('')
  const [qrScanning, setQrScanning] = useState(false)
  // Guest / trial check-in state (P2 5.1)
  const [showGuestModal, setShowGuestModal] = useState(false)
  const [guestForm, setGuestForm] = useState({ name: '', phone: '', type: 'guest' as 'guest' | 'trial' })
  const [guestSubmitting, setGuestSubmitting] = useState(false)
  const [guestSuccess, setGuestSuccess] = useState(false)
  const [guestCount, setGuestCount] = useState(0)
  // Cloud SMS (PhilSMS) gateway status — kiosk status dot (PHILSMS_SETUP_GUIDE.md)
  const [smsStatus, setSmsStatus] = useState<SmsStatus | null>(null)
  // Idle promo slideshow (P2 5.1)
  const [promoIndex, setPromoIndex] = useState(0)
  const [promoInterval, setPromoInterval] = useState<ReturnType<typeof setInterval> | null>(null)
  const qrVideoRef = useRef<HTMLVideoElement>(null)
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)
  const qrStreamRef = useRef<MediaStream | null>(null)
  const qrFrameRef = useRef<number>(0)
  const memberIdInputRef = useRef<HTMLInputElement>(null)
  const autoScanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const isScanning = useRef(false)
  // Mirrors showManualSearch || showMemberIdInput with the LATEST value so the
  // async scan loop can consult it — a useCallback closure would be stale.
  const inputOpenRef = useRef(false)
  // Latest scanner-enabled setting, so the self-scheduling scan loop can stop
  // immediately if staff disable the scanner mid-session.
  const scannerEnabledRef = useRef(true)
  const stateRef = useRef(state)
  // False once the kiosk window unmounts (e.g. the window is closed mid-capture).
  // Guards scheduleNext + handleRealScan so a pending capture can never re-arm
  // the scanner on an unmounted component (that would loop IPC calls forever).
  const mountedRef = useRef(true)
  // Latest matched member + exec-report-open flag so the async scan loop and the
  // staff-override handler always see fresh values (never a stale closure).
  const matchedMemberRef = useRef<Member | null>(null)
  const execReportOpenRef = useRef(false)
  const staffVerifiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Staff template cache: re-fetched at most once every 20s so the continuous
  // scan loop doesn't double its IPC/DB churn (member templates are still
  // fetched every cycle — pre-existing behavior).
  const staffTemplatesRef = useRef<StaffFingerprintTemplateInfo[]>([])
  const staffTemplatesFetchedAtRef = useRef(0)

  // Mark unmounted + clear any pending scan timer when the kiosk closes
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (autoScanTimer.current) {
        clearTimeout(autoScanTimer.current)
        autoScanTimer.current = null
      }
      if (staffVerifiedTimer.current) {
        clearTimeout(staffVerifiedTimer.current)
        staffVerifiedTimer.current = null
      }
    }
  }, [])

  // Keep refs in sync for the self-scheduling scan loop
  useEffect(() => {
    matchedMemberRef.current = matchedMember
  }, [matchedMember])

  useEffect(() => {
    execReportOpenRef.current = showExecReport
  }, [showExecReport])

  // Load kiosk logo + settings from the Settings page
  useEffect(() => {
    const loadKioskConfig = async () => {
      try {
        const logo = await window.electronAPI.getSetting('kioskLogo')
        if (logo) setKioskLogo(logo)
      } catch {}
      try {
        const data = await window.electronAPI.getSettings()
        const scannerEnabled = data.scannerEnabled !== 'false'
        scannerEnabledRef.current = scannerEnabled
        setKioskSettings({
          scannerEnabled,
          showMemberPhotos: data.showMemberPhotos !== 'false',
          enableNotifications: data.enableNotifications === 'true',
          autoLockTimeout: Number(data.autoLockTimeout) || 0,
        })
      } catch {}
    }
    loadKioskConfig()
  }, [])

  // Live PhilSMS gateway status (broadcast from the main process on boot +
  // every 60s). Shown as a small status dot on the kiosk screen.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onSmsStatus((status) => setSmsStatus(status))
    window.electronAPI.getSmsStatus().then(setSmsStatus).catch(() => {})
    return unsubscribe
  }, [])

  // Keep stateRef in sync
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Keep the input-open flag in sync (see inputOpenRef) so an in-flight scan can
  // never re-arm the scanner over the member-ID input / manual search box.
  useEffect(() => {
    inputOpenRef.current = showManualSearch || showMemberIdInput
  }, [showManualSearch, showMemberIdInput])

  // Cleanup camera stream when the QR scanner closes/unmounts
  useEffect(() => {
    return () => {
      if (qrStreamRef.current) {
        qrStreamRef.current.getTracks().forEach(t => t.stop())
        qrStreamRef.current = null
      }
      cancelAnimationFrame(qrFrameRef.current)
    }
  }, [])

  useEffect(() => {
    if (!showQrScanner) {
      if (qrStreamRef.current) {
        qrStreamRef.current.getTracks().forEach(t => t.stop())
        qrStreamRef.current = null
      }
      cancelAnimationFrame(qrFrameRef.current)
    }
  }, [showQrScanner])

  // Load today's guest count for display (P2 5.1)
  useEffect(() => {
    (async () => {
      try {
        const count = await window.electronAPI.getGuestCheckinsCount()
        setGuestCount(count)
      } catch {}
    })()
  }, [state === 'match-found'])

  // Promo slideshow rotation on the idle screen (P2 5.1)
  useEffect(() => {
    if (state !== 'idle') return
    if (promoInterval) clearInterval(promoInterval)
    const t = setInterval(() => {
      setPromoIndex(prev => (prev + 1) % PROMOS.length)
    }, 7000)
    setPromoInterval(t)
    return () => clearInterval(t)
  }, [state])

  // Play a short success chime when a member checks in (P2 5.1)
  const playSuccessSound = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      const ctx = new AudioCtx()
      const notes = [523.25, 659.25, 783.99] // C5 E5 G5 major chord arpeggio
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        const start = ctx.currentTime + i * 0.12
        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(start)
        osc.stop(start + 0.55)
      })
      setTimeout(() => ctx.close(), 1500)
    } catch {
      // Audio unavailable — ignore
    }
  }, [])

  // Track last user activity for the kiosk auto-lock (autoLockTimeout setting)
  const lastActivityRef = useRef(Date.now())
  useEffect(() => {
    const recordActivity = () => { lastActivityRef.current = Date.now() }
    window.addEventListener('pointerdown', recordActivity)
    window.addEventListener('keydown', recordActivity)
    return () => {
      window.removeEventListener('pointerdown', recordActivity)
      window.removeEventListener('keydown', recordActivity)
    }
  }, [])

  // Auto-lock: return to idle after autoLockTimeout minutes without activity
  useEffect(() => {
    const timeoutMinutes = kioskSettings.autoLockTimeout
    if (!timeoutMinutes || timeoutMinutes <= 0) return
    const checkTimer = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current
      if (idleMs >= timeoutMinutes * 60 * 1000) {
        if (stateRef.current !== 'idle' && !showRenewModal) {
          resetToIdle()
        }
        lastActivityRef.current = Date.now()
      }
    }, 15000)
    return () => clearInterval(checkTimer)
  }, [kioskSettings.autoLockTimeout, showRenewModal])

  // Auto-focus member ID input when shown
  useEffect(() => {
    if (showMemberIdInput && memberIdInputRef.current) {
      memberIdInputRef.current.focus()
    }
  }, [showMemberIdInput])

  // Auto-scan in any state (except when the manual search box or member-ID input
  // is open, the scanner is disabled, or a check-in was blocked). Scanning ALSO
  // continues while the executive report modal is up — members can still check in
  // and staff can scan without having to close it.
  useEffect(() => {
    if (!kioskSettings.scannerEnabled || state === 'blocked') return
    if (showManualSearch || showMemberIdInput) return
    autoScanTimer.current = setTimeout(() => {
      handleRealScan()
    }, AUTO_SCAN_DELAY)
    return () => {
      if (autoScanTimer.current) {
        clearTimeout(autoScanTimer.current)
        autoScanTimer.current = null
      }
    }
  }, [state, showManualSearch, showMemberIdInput, matchKey, kioskSettings.scannerEnabled, showExecReport])

  // The CHECK-IN BLOCKED screen auto-starts a live fingerprint rescan (no click
  // needed) and keeps listening while it stays up: the member can retry their own
  // check-in and staff/admin can authorize the override — all without touching a
  // button. Re-arms itself on every completed attempt until the screen clears.
  useEffect(() => {
    if (state !== 'blocked' || blockedRescanning) return
    if (!kioskSettings.scannerEnabled) return
    const t = setTimeout(() => {
      handleBlockedRescan()
    }, AUTO_SCAN_DELAY)
    return () => clearTimeout(t)
  }, [state, blockedRescanning, kioskSettings.scannerEnabled])

  // Countdown timer for match-found auto-close. Paused while the redeem modal
  // is open so a member has time to redeem their reward (P2 5.8) — the modal
  // closing re-arms a fresh 6s countdown.
  useEffect(() => {
    if (state === 'match-found' && !showRedeemModal) {
      setCountdown(AUTO_CLOSE_SECONDS)
      countdownTimer.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            // Time's up - auto close
            clearInterval(countdownTimer.current!)
            countdownTimer.current = null
            handleConfirmCheckin()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => {
      if (countdownTimer.current) {
        clearInterval(countdownTimer.current)
        countdownTimer.current = null
      }
    }
  }, [state === 'match-found', matchKey, showRedeemModal])

  // A staff/admin fingerprint was matched at the kiosk:
  //  - Blocked check-in context → staff authorizes the override immediately
  //    (no need to leave the blocked modal).
  //  - Admin otherwise → Daily Executive Report modal (never a member check-in).
  //  - Staff otherwise → brief "Staff Verified" screen, kiosk keeps scanning.
  // NOTE: a plain function (not useCallback) on purpose — it only reads refs and
  // calls stable callbacks, so the async scan loop never sees stale state.
  const performStaffAction = async (staff: StaffFingerprintTemplateInfo, context: 'blocked' | 'normal') => {
    const staffName = staff.display_name || staff.username
    if (context === 'blocked') {
      const member = matchedMemberRef.current
      if (!member) {
        resetToIdle()
        return
      }
      await window.electronAPI.createCheckin({
        member_id: member.id,
        method: 'manual',
        match_confidence: 1.0,
        status: 'override',
      })
      log.checkinOverride(member.id, member.name)
      log.action({
        action: 'staff_fingerprint_auth',
        entity_type: 'staff',
        entity_id: staff.staff_id,
        details: JSON.stringify({ staff_name: staffName, role: staff.role, context: 'override', member_name: member.name }),
      })
      setBlockedMessage('')
      setState('match-found')
      playSuccessSound()
      notifyCheckin(member)
      onRefresh()
      return
    }
    if (staff.role === 'admin') {
      log.action({
        action: 'staff_fingerprint_auth',
        entity_type: 'staff',
        entity_id: staff.staff_id,
        details: JSON.stringify({ staff_name: staffName, role: staff.role, context: 'exec_report' }),
      })
      setExecAdminName(staffName)
      setExecReport(null)
      setExecReportError(null)
      setShowExecReport(true)
      loadExecReport()
      return
    }
    log.action({
      action: 'staff_fingerprint_auth',
      entity_type: 'staff',
      entity_id: staff.staff_id,
      details: JSON.stringify({ staff_name: staffName, role: staff.role, context: 'verified' }),
    })
    // Only regular staff reach this branch (admins return earlier with the report).
    // If the exec report modal is up, close it so the verified screen shows.
    if (execReportOpenRef.current) setShowExecReport(false)
    setStaffVerifiedUser({ name: staffName, role: 'Staff' })
    setState('staff-verified')
    if (staffVerifiedTimer.current) clearTimeout(staffVerifiedTimer.current)
    staffVerifiedTimer.current = setTimeout(() => {
      if (stateRef.current === 'staff-verified') resetToIdle()
    }, 6000)
  }

  // Real fingerprint check-in via the native U.are.U 4500 SDK — capture a finger
  // directly from the reader, build a probe template, and 1:N match it against
  // every enrolled member template. Unlimited members, no Windows Hello prompts.
  //
  // The scanner is SELF-SCHEDULING: every outcome re-arms the next capture, so
  // the kiosk scans continuously in EVERY state — idle, the match-found modal,
  // no-match, expired. That means the next member can place a finger while the
  // previous member's confirmation is still on screen (no 10s wait), and a
  // failed match re-scans automatically (no 'Try Again' click needed).
  // Fetch (and cache) enrolled staff/admin fingerprint templates for 1:N matching.
  const getStaffTemplates = async (): Promise<StaffFingerprintTemplateInfo[]> => {
    if (staffTemplatesRef.current.length === 0 || Date.now() - staffTemplatesFetchedAtRef.current > 20000) {
      try {
        staffTemplatesRef.current = await window.electronAPI.getAllStaffFingerprintTemplates()
      } catch {
        staffTemplatesRef.current = []
      }
      staffTemplatesFetchedAtRef.current = Date.now()
    }
    return staffTemplatesRef.current
  }

  const handleRealScan = useCallback(async () => {
    if (!mountedRef.current) return
    if (isScanning.current) return
    // Don't start a capture if an input was opened while we were waiting
    if (inputOpenRef.current) return
    isScanning.current = true

    const currentState = stateRef.current

    // Re-arm the scanner after this attempt. Always re-arms (continuous scan)
    // unless an input is open or the scanner was disabled; back-off delays
    // prevent flicker on fast failures.
    const scheduleNext = (delay: number) => {
      if (!mountedRef.current || inputOpenRef.current || !scannerEnabledRef.current) return
      autoScanTimer.current = setTimeout(() => handleRealScan(), delay)
    }

    try {
      // Load every enrolled member + staff template for 1:N matching (P2 6.9).
      // Stay on the current state during prep work — no UI flicker.
      const [templates, staffTemplates] = await Promise.all([
        window.electronAPI.getAllFingerprintTemplates(),
        getStaffTemplates(),
      ])

      if (templates.length === 0 && staffTemplates.length === 0) {
        // No registered fingerprints yet — retry occasionally instead of every
        // 600ms (constant IPC/DB churn can stall frames on the kiosk).
        scheduleNext(EMPTY_SCAN_RETRY)
        return
      }

      // Flicker fix: keep the current screen mounted while the capture is
      // waiting and just pulse an inline 'Scanning…' indicator. Set in every
      // state (idle, no-match, match-found, expired) so staff always see the
      // reader is listening for the next member.
      setScanActive(true)

      // Wait (up to 30s) for a finger on the reader.
      const capture = await window.electronAPI.captureFingerprint(30000)
      if (!capture.ok) {
        // timeout / cancelled / device error — back off before re-arming so a
        // fast-failing reader can't make the kiosk flicker between screens.
        scheduleNext(RETRY_DELAY)
        return
      }

      // Convert the captured image to a probe template and identify 1:N.
      const fmdRes = await window.electronAPI.createFingerprintFmd(capture.sample.imageBase64)
      if ('error' in fmdRes) {
        scheduleNext(RETRY_DELAY)
        return
      }
      const identifyRes = await window.electronAPI.identifyFingerprint(fmdRes.fmdBase64, templates)
      if ('error' in identifyRes || identifyRes.index < 0 || identifyRes.index >= templates.length) {
        // Not a member — check whether this is a staff/admin fingerprint (P2 6.9)
        if (staffTemplates.length > 0) {
          const staffRes = await window.electronAPI.identifyFingerprint(fmdRes.fmdBase64, staffTemplates)
          if (!('error' in staffRes) && staffRes.index >= 0 && staffRes.index < staffTemplates.length) {
            const staff = staffTemplates[staffRes.index]
            if (staff.role === 'admin') {
              // Executive intercept: an admin scan NEVER processes a member
              // check-in — it opens (or refreshes) the Daily Executive Report
              // modal. Scanning continues while it's open.
              const reportWasOpen = execReportOpenRef.current
              performStaffAction(staff, 'normal')
              // Refreshing an already-open report changes no effect dep, so the
              // auto-scan effect won't re-arm — keep the loop alive manually.
              if (reportWasOpen) scheduleNext(AUTO_SCAN_DELAY)
              return
            }
            // Regular staff: brief verified screen; the kiosk keeps scanning.
            performStaffAction(staff, 'normal')
            scheduleNext(RETRY_DELAY)
            return
          }
        }
        // Finger scanned but not recognized in the system — show the no-match
        // screen (skipped while the exec report modal is up) AND keep scanning
        // (no 'Try Again' click needed).
        if ((currentState === 'idle' || currentState === 'no-match') && !execReportOpenRef.current) {
          setState('no-match')
        }
        scheduleNext(RETRY_DELAY)
        return
      }

      const matched = templates[identifyRes.index]
      const member = await window.electronAPI.getMember(matched.member_id)
      if (!member) {
        setState('idle')
        scheduleNext(RETRY_DELAY)
        return
      }

      setMatchedMember(member)
      // A member scan while the exec report is open ends the report so the
      // member gets the normal full-screen confirmation.
      if (execReportOpenRef.current) setShowExecReport(false)

      if (member.status === 'expired') {
        setState('expired')
        // Keep scanning: a different member can still check in while this
        // expired screen is showing.
        scheduleNext(RETRY_DELAY)
      } else {
        // Log the check-in — may be blocked by session-pack or duplicate-check-in rules
        const result = await window.electronAPI.createCheckin({
          member_id: member.id,
          method: 'fingerprint',
          match_confidence: 1.0,
          status: 'success'
        })
        if (result && result.success === false) {
          setBlockedMessage(result.message || 'Check-in not allowed.')
          setState('blocked')
        } else {
          // If we were already on match-found, bump matchKey to reset countdown
          if (stateRef.current === 'match-found') {
            setMatchKey(prev => prev + 1)
          }
          setState('match-found')
          playSuccessSound()
          log.checkinFingerprint(member.id, member.name)
          notifyCheckin(member)
          onRefresh()
          // Re-arm immediately so the NEXT member can scan while this
          // match-found modal is still on screen.
          scheduleNext(AUTO_SCAN_DELAY)
        }
      }
    } catch (error: any) {
      console.error('Fingerprint scan error:', error.message || error)
      // Always retry — continuous scanning even if a call fails
      scheduleNext(RETRY_DELAY)
    } finally {
      setScanActive(false)
      isScanning.current = false
    }
  }, [onRefresh, performStaffAction])

  // ── P2 6.9: staff/admin fingerprint handling at the kiosk ──
  // Loads today's daily report for the Executive intercept modal.
  const loadExecReport = useCallback(async () => {
    setExecReportLoading(true)
    try {
      const data = await window.electronAPI.getDailyReport(todayLocal())
      setExecReport(data)
    } catch (error: any) {
      setExecReportError(error?.message || 'Failed to load the daily report.')
    } finally {
      setExecReportLoading(false)
    }
  }, [])

  // Live fingerprint rescan inside the blocked modal (P2 6.9): lets the member
  // retry their own check-in, or lets staff/admin re-authenticate and authorize
  // the blocked check-in — all without exiting the modal.
  const handleBlockedRescan = async () => {
    if (blockedRescanning) return
    const member = matchedMemberRef.current
    if (!member) {
      resetToIdle()
      return
    }
    setBlockedRescanning(true)
    try {
      const status = await window.electronAPI.getFingerprintStatus()
      if (!status.available) {
        const detail = status.steps.filter(s => !s.ok).map(s => s.message).join(' ')
        setBlockedMessage(detail || 'Fingerprint scanner is not available. Use manual search instead.')
        return
      }

      const capture = await window.electronAPI.captureFingerprint(30000)
      if (!capture.ok) {
        // If the user left the blocked screen mid-capture, don't touch its state
        if (stateRef.current !== 'blocked') return
        setBlockedMessage(capture.reason === 'timeout'
          ? 'No finger detected. Place a finger on the scanner and try again.'
          : capture.message || 'Scan cancelled.')
        return
      }
      if (stateRef.current !== 'blocked') return

      const fmdRes = await window.electronAPI.createFingerprintFmd(capture.sample.imageBase64)
      if ('error' in fmdRes) {
        setBlockedMessage(fmdRes.error)
        return
      }
      if (stateRef.current !== 'blocked') return

      const [memberTemplates, staffTemplates] = await Promise.all([
        window.electronAPI.getAllFingerprintTemplates(),
        getStaffTemplates(),
      ])
      if (stateRef.current !== 'blocked') return

      // 1) Staff/Admin scan → authorize the blocked member (override) right here
      if (staffTemplates.length > 0) {
        const staffRes = await window.electronAPI.identifyFingerprint(fmdRes.fmdBase64, staffTemplates)
        if (!('error' in staffRes) && staffRes.index >= 0 && staffRes.index < staffTemplates.length) {
          await performStaffAction(staffTemplates[staffRes.index], 'blocked')
          return
        }
      }

      // 2) Member scan → retry their check-in
      if (memberTemplates.length > 0) {
        const memberRes = await window.electronAPI.identifyFingerprint(fmdRes.fmdBase64, memberTemplates)
        if (!('error' in memberRes) && memberRes.index >= 0 && memberRes.index < memberTemplates.length) {
          const tpl = memberTemplates[memberRes.index]
          const member = await window.electronAPI.getMember(tpl.member_id)
          if (member) {
            setMatchedMember(member)
            const result = await window.electronAPI.createCheckin({
              member_id: member.id,
              method: 'fingerprint',
              match_confidence: 1.0,
              status: 'success',
            })
            if (result && result.success === false) {
              setBlockedMessage(result.message || 'Check-in is still blocked.')
            } else {
              setState('match-found')
              playSuccessSound()
              log.checkinFingerprint(member.id, member.name)
              notifyCheckin(member)
              onRefresh()
            }
            return
          }
        }
      }

      setBlockedMessage('Fingerprint not recognized. Try again or use manual search.')
    } catch (error: any) {
      setBlockedMessage(error?.message || 'Scan failed. Try again.')
    } finally {
      setBlockedRescanning(false)
    }
  }

  const handleManualSearch = async () => {
    if (!searchQuery.trim()) return
    
    try {
      const results = await window.electronAPI.searchMembers(searchQuery)
      if (results.length > 0) {
        const member = results[0]
        setMatchedMember(member)
        
        if (member.status === 'expired') {
          setState('expired')
        } else {
          const result = await window.electronAPI.createCheckin({
            member_id: member.id,
            method: 'manual',
            match_confidence: 1.0,
            status: 'success'
          })
          if (result && result.success === false) {
            setBlockedMessage(result.message || 'Check-in not allowed.')
            setState('blocked')
          } else {
            setState('match-found')
            playSuccessSound()
            log.checkinManual(member.id, member.name)
            notifyCheckin(member)
            onRefresh()
          }
        }
      } else {
        setState('no-match')
      }
    } catch (error) {
      setState('no-match')
    }
  }

  const handleMemberIdLogin = async () => {
    if (!memberIdInput.trim()) return

    setMemberIdLoading(true)
    setMemberIdError('')

    try {
      const result = await window.electronAPI.checkMemberIdExists(memberIdInput.trim())
      if (result) {
        // Fetch full member details
        const member = await window.electronAPI.getMember(result.id)
        setMatchedMember(member)

        if (member.status === 'expired') {
          setState('expired')
        } else {
          const result = await window.electronAPI.createCheckin({
            member_id: member.id,
            method: 'manual',
            match_confidence: 1.0,
            status: 'success'
          })
          if (result && result.success === false) {
            setBlockedMessage(result.message || 'Check-in not allowed.')
            setState('blocked')
          } else {
            setState('match-found')
            playSuccessSound()
            log.checkinManual(member.id, member.name)
            notifyCheckin(member)
            onRefresh()
          }
        }
      } else {
        setMemberIdError('Member ID not found. Please try again.')
      }
    } catch (error: any) {
      setMemberIdError(error.message || 'Error looking up member ID')
    } finally {
      setMemberIdLoading(false)
    }
  }

  const handleConfirmCheckin = useCallback(() => {
    setState('idle')
    setMatchedMember(null)
    setSearchQuery('')
    setShowManualSearch(false)
    setShowMemberIdInput(false)
    setMemberIdInput('')
    setMemberIdError('')
    setShowRedeemModal(false)
    setRedeeming(false)
    setRedeemError('')
    setCountdown(AUTO_CLOSE_SECONDS)
  }, [])

  // ── QR Code check-in ──
  const openQrScanner = async () => {
    // Stop any existing stream first so Retry never leaks a camera / triggers "device in use"
    if (qrStreamRef.current) {
      qrStreamRef.current.getTracks().forEach(t => t.stop())
      qrStreamRef.current = null
    }
    cancelAnimationFrame(qrFrameRef.current)
    setQrError('')
    setQrScanning(true)
    setShowQrScanner(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      qrStreamRef.current = stream
      if (qrVideoRef.current) {
        qrVideoRef.current.srcObject = stream
        await qrVideoRef.current.play()
      }
      // Start the decode loop directly — relying on the 'playing' event can miss
      // because it often fires during the awaited play() above.
      startQrDecode()
    } catch (error: any) {
      console.error('QR camera error:', error)
      setQrScanning(false)
      setQrError('Camera unavailable. Make sure the camera permission is granted and no other app is using it.')
    }
  }

  const closeQrScanner = () => {
    if (qrStreamRef.current) {
      qrStreamRef.current.getTracks().forEach(t => t.stop())
      qrStreamRef.current = null
    }
    cancelAnimationFrame(qrFrameRef.current)
    setShowQrScanner(false)
    setQrScanning(false)
  }

  const startQrDecode = () => {
    const video = qrVideoRef.current
    const canvas = qrCanvasRef.current
    if (!video || !canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const tick = () => {
      if (!showQrScanner || !video || !canvas || !ctx) return
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        })
        if (code && code.data) {
          handleQrCode(code.data.trim().toUpperCase())
          return
        }
      }
      qrFrameRef.current = requestAnimationFrame(tick)
    }
    tick()
  }

  const handleQrCode = async (code: string) => {
    if (!code || qrScanning) return
    setQrScanning(true)
    try {
      // QR contains the member's member_id (e.g. M001 or MEM-XXXX)
      const result = await window.electronAPI.checkMemberIdExists(code)
      if (!result) {
        setQrError('QR code not recognized. This member does not exist in the system.')
        setQrScanning(false)
        return
      }
      const member = await window.electronAPI.getMember(result.id)
      closeQrScanner()
      setMatchedMember(member)

      if (member.status === 'expired') {
        setState('expired')
      } else {
        const res = await window.electronAPI.createCheckin({
          member_id: member.id,
          method: 'manual',
          match_confidence: 1.0,
          status: 'success',
        })
        if (res && res.success === false) {
          setBlockedMessage(res.message || 'Check-in not allowed.')
          setState('blocked')
        } else {
          setState('match-found')
          playSuccessSound()
          log.checkinManual(member.id, member.name)
          notifyCheckin(member)
          onRefresh()
        }
      }
    } catch (error: any) {
      setQrError(error.message || 'Failed to process QR code.')
      setQrScanning(false)
    }
  }

  // Desktop notification when a member checks in (wired to enableNotifications setting)
  const notifyCheckin = (member: Member) => {
    if (!kioskSettings.enableNotifications) return
    try {
      if (typeof Notification !== 'undefined') {
        new Notification('REPCHECK', {
          body: `${member.name} checked in (${member.member_id})`,
        })
      }
    } catch {
      // Desktop notifications unavailable — ignore
    }
  }

  // Open the Renew Plan modal
  const handleRenew = async () => {
    if (!matchedMember) return
    try {
      const plans = await window.electronAPI.getPlans()
      setRenewPlans(plans)
      setRenewPlanId(0)
      setRenewPaymentMethod('cash')
      setRenewTxnRef('')
      setRenewAmount(0)
      setRenewError('')
      setShowRenewModal(true)
    } catch (error: any) {
      setRenewError(error.message || 'Failed to load plans')
      setShowRenewModal(true)
    }
  }

  // Confirm the renewal: record the payment and extend the member's plan
  const handleRenewConfirm = async () => {
    if (!matchedMember || !renewPlanId) return
    const plan = renewPlans.find(p => p.id === renewPlanId)
    if (!plan) return
    setRenewing(true)
    setRenewError('')
    try {
      const start = new Date()
      const startStr = todayLocalOf(start)
      // Session packs have no end date — preserve the existing plan_end instead of extending it.
      // Use undefined (→ NULL) rather than '' so auto-expire never misreads the member as expired.
      const endStr = plan.type === 'session_pack'
        ? (matchedMember.plan_end || undefined)
        : (() => {
            const end = new Date(start)
            end.setDate(end.getDate() + (plan.duration_days || 30))
            return todayLocalOf(end)
          })()

      const paymentAmount = renewAmount > 0 ? renewAmount : 0

      // Transaction reference is required for card / GCash / bank transfer (only when a payment is made)
      const requiresRef = paymentAmount > 0 && METHODS_REQUIRING_REF.includes(renewPaymentMethod)
      if (requiresRef && !renewTxnRef.trim()) {
        setRenewing(false)
        setRenewError('Please enter the transaction number for this payment method.')
        return
      }

      const newBalance = Math.max(0, (matchedMember.balance || 0) + plan.price - paymentAmount)

      // Record the renewal payment
      if (paymentAmount > 0) {
        await window.electronAPI.createPayment({
          member_id: matchedMember.id,
          amount: paymentAmount,
          type: 'renewal',
          plan_id: plan.id,
          payment_method: renewPaymentMethod,
          transaction_ref: requiresRef ? renewTxnRef.trim() : undefined,
        })
        log.action({
          action: 'record_payment',
          entity_type: 'payment',
          entity_id: matchedMember.id,
          details: JSON.stringify({ member_name: matchedMember.name, amount: paymentAmount, type: 'renewal', method: renewPaymentMethod }),
        })
      }

      // Extend the member's plan and reactivate them
      await window.electronAPI.updateMember(matchedMember.id, {
        name: matchedMember.name,
        email: matchedMember.email || undefined,
        phone: matchedMember.phone || undefined,
        photo: matchedMember.photo || undefined,
        emergency_contact: matchedMember.emergency_contact || undefined,
        emergency_phone: matchedMember.emergency_phone || undefined,
        plan_id: plan.id,
        plan_start: startStr,
        plan_end: endStr,
        height: matchedMember.height,
        weight: matchedMember.weight,
        birthday: matchedMember.birthday || undefined,
        coach_id: matchedMember.coach_id || undefined,
        coaching_start: matchedMember.coaching_start || undefined,
        coaching_end: matchedMember.coaching_end || undefined,
        balance: newBalance,
        status: 'active',
        sessions_used: 0,
        waiver_agreed_at: matchedMember.waiver_agreed_at || undefined,
      })

      log.action({
        action: 'renew_plan',
        entity_type: 'member',
        entity_id: matchedMember.id,
        details: JSON.stringify({ member_name: matchedMember.name, plan_name: plan.name }),
      })

      setShowRenewModal(false)
      setRenewing(false)
      resetToIdle()
      onRefresh()
    } catch (error: any) {
      setRenewing(false)
      setRenewError(error.message || 'Renewal failed. Please try again.')
    }
  }

  // P2 5.8: redeem 100 reward points for 1 month of free membership.
  // The backend deducts the points and extends plan_end by 30 days; we then
  // re-fetch the member so the on-screen points + plan status update live.
  const handleRedeemFreeMonth = async () => {
    if (!matchedMember) return
    setRedeeming(true)
    setRedeemError('')
    try {
      const res = await window.electronAPI.redeemFreeMonth(matchedMember.id)
      if (!res.success) {
        setRedeemError(res.message || 'Redemption failed. Please try again.')
        return
      }
      // Close the modal + log BEFORE the refresh so a failed re-fetch can never
      // report a false error after the redemption already succeeded.
      setShowRedeemModal(false)
      playSuccessSound()
      log.redeemFreeMonth(matchedMember.id, matchedMember.name, 100, res.planEnd || '')
      onRefresh()
      // Best-effort refresh of the member so the new points + plan end show live
      try {
        const fresh = await window.electronAPI.getMember(matchedMember.id)
        if (fresh) setMatchedMember(fresh)
      } catch {
        // Non-fatal — the screen refreshes from other windows anyway
      }
    } catch (error: any) {
      setRedeemError(error.message || 'Redemption failed. Please try again.')
    } finally {
      setRedeeming(false)
    }
  }

  const handleManualOverride = async () => {
    if (matchedMember) {
      await window.electronAPI.createCheckin({
        member_id: matchedMember.id,
        method: 'manual',
        match_confidence: 1.0,
        status: 'override'
      })
      log.checkinOverride(matchedMember.id, matchedMember.name)
      handleConfirmCheckin()
      onRefresh()
    }
  }

  const handleOpenExternalKiosk = () => {
    window.electronAPI.openKioskWindow()
  }

  const handleCloseExternalKiosk = () => {
    window.electronAPI.closeKioskWindow()
  }

  const resetToIdle = () => {
    setState('idle')
    setMatchedMember(null)
    setSearchQuery('')
    setShowManualSearch(false)
    setShowMemberIdInput(false)
    setMemberIdInput('')
    setMemberIdError('')
    setShowRedeemModal(false)
    setRedeeming(false)
    setRedeemError('')
  }

  const toggleManualSearch = () => {
    setShowManualSearch(prev => !prev)
    if (!showManualSearch) {
      setSearchQuery('')
    }
  }

  const handleIdleAreaClick = () => {
    if (!showMemberIdInput && !showManualSearch) {
      setShowMemberIdInput(true)
      setMemberIdInput('')
      setMemberIdError('')
    }
  }

  const handleMemberIdKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleMemberIdLogin()
    }
    if (e.key === 'Escape') {
      setShowMemberIdInput(false)
      setMemberIdInput('')
      setMemberIdError('')
    }
  }

  // P2 5.1: Guest / trial check-in
  const openGuestModal = () => {
    setGuestForm({ name: '', phone: '', type: 'guest' })
    setGuestSuccess(false)
    setShowGuestModal(true)
  }

  const handleGuestSubmit = async () => {
    if (!guestForm.name.trim()) return
    setGuestSubmitting(true)
    try {
      await window.electronAPI.createGuestCheckin({
        name: guestForm.name.trim(),
        phone: guestForm.phone.trim() || undefined,
        type: guestForm.type,
      })
      // P2 5.1: record guest/trial check-ins in the Activity Log so they have a
      // visible audit trail (previously they were only saved to the DB).
      log.action({
        action: 'guest_checkin',
        entity_type: 'guest_checkin',
        details: JSON.stringify({ name: guestForm.name.trim(), type: guestForm.type, phone: guestForm.phone.trim() || '' }),
      })
      setGuestSuccess(true)
      setGuestCount(c => c + 1)
      setTimeout(() => {
        setShowGuestModal(false)
        setGuestSubmitting(false)
      }, 1800)
    } catch (error: any) {
      console.error('Guest check-in failed:', error)
      setGuestSubmitting(false)
    }
  }

  // P2 5.8: confirm modal for redeeming 100 reward points → 1 free month
  const renderRedeemModal = () => matchedMember && (
    <div className="kiosk-renew-overlay" onClick={() => { if (!redeeming) setShowRedeemModal(false) }}>
      <div className="kiosk-renew-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kiosk-renew-header">
          <h2 className="display-text">🎁 Redeem Free Month</h2>
          <button className="btn-icon" onClick={() => setShowRedeemModal(false)} disabled={redeeming}>✕</button>
        </div>
        <div className="kiosk-renew-body">
          <div className="kiosk-redeem-hero">
            <span className="kiosk-redeem-points">⭐ {matchedMember.points || 0} pts</span>
            <span className="kiosk-redeem-points-label">Reward points available</span>
          </div>
          <p className="text-muted" style={{ margin: 0 }}>
            Redeem <strong>100 points</strong> for <strong>1 month of free membership</strong>.
            This adds 30 days to {matchedMember.name}'s plan.
          </p>
          {redeemError && <div className="kiosk-renew-error">{redeemError}</div>}
        </div>
        <div className="kiosk-renew-footer">
          <button className="btn btn-secondary" onClick={() => setShowRedeemModal(false)} disabled={redeeming}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleRedeemFreeMonth} disabled={redeeming}>
            {redeeming ? 'Redeeming...' : 'Redeem 100 pts'}
          </button>
        </div>
      </div>
    </div>
  )

  const renderGuestModal = () => (
    <div className="kiosk-renew-overlay" onClick={() => { if (!guestSubmitting) setShowGuestModal(false) }}>
      <div className="kiosk-renew-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kiosk-renew-header">
          <h2 className="display-text">🪪 Guest / Trial Check-in</h2>
          <button className="btn-icon" onClick={() => setShowGuestModal(false)} disabled={guestSubmitting}>✕</button>
        </div>
        <div className="kiosk-renew-body">
          {guestSuccess ? (
            <div className="kiosk-guest-success">
              <div className="guest-success-icon">✓</div>
              <span>Welcome, {guestForm.name}! Enjoy your session.</span>
            </div>
          ) : (
            <>
              <p className="text-muted" style={{ margin: 0 }}>
                Record a day-pass or trial visitor without creating a full member record.
              </p>
              <div className="kiosk-renew-field">
                <label>Type</label>
                <div className="kiosk-guest-type-row">
                  <button
                    type="button"
                    className={`btn ${guestForm.type === 'guest' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                    onClick={() => setGuestForm({ ...guestForm, type: 'guest' })}
                  >
                    Day Pass
                  </button>
                  <button
                    type="button"
                    className={`btn ${guestForm.type === 'trial' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                    onClick={() => setGuestForm({ ...guestForm, type: 'trial' })}
                  >
                    Trial
                  </button>
                </div>
              </div>
              <div className="kiosk-renew-field">
                <label>Name *</label>
                <input
                  type="text"
                  className="input"
                  value={guestForm.name}
                  onChange={(e) => setGuestForm({ ...guestForm, name: e.target.value })}
                  placeholder="Guest name"
                  autoFocus
                />
              </div>
              <div className="kiosk-renew-field">
                <label>Phone (optional)</label>
                <input
                  type="tel"
                  className="input"
                  value={guestForm.phone}
                  onChange={(e) => setGuestForm({ ...guestForm, phone: e.target.value })}
                  placeholder="+63 9XX XXX XXXX"
                />
              </div>
            </>
          )}
        </div>
        {!guestSuccess && (
          <div className="kiosk-renew-footer">
            <button className="btn btn-secondary" onClick={() => setShowGuestModal(false)} disabled={guestSubmitting}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleGuestSubmit} disabled={!guestForm.name.trim() || guestSubmitting}>
              {guestSubmitting ? 'Saving...' : 'Check In Guest'}
            </button>
          </div>
        )}
      </div>
    </div>
  )

  const renderIdleState = () => (
    <div className="kiosk-idle" onClick={handleIdleAreaClick}>
      {!kioskSettings.scannerEnabled && (
        <div className="kiosk-scanner-disabled-note">
          ⚠️ Fingerprint scanner is disabled in Settings — use Member ID or manual search.
        </div>
      )}
      {/* Hero logo — 2.5x bigger, centered on the screen; controls float over it */}
      <div className="kiosk-idle-hero">
        {kioskLogo && (
          <div className="kiosk-big-logo">
            <img src={kioskLogo} alt="Gym Logo" />
          </div>
        )}

        {/* Member ID quick login — appears on any click (floating overlay card) */}
        {showMemberIdInput && (
          <div className="kiosk-member-id-section" onClick={(e) => e.stopPropagation()}>
            <input
              ref={memberIdInputRef}
              type="text"
              className="kiosk-member-id-input"
              placeholder="Enter Member ID (e.g. M001)"
              value={memberIdInput}
              onChange={(e) => {
                setMemberIdInput(e.target.value.toUpperCase())
                setMemberIdError('')
              }}
              onKeyDown={handleMemberIdKeyDown}
              disabled={memberIdLoading}
            />
            {memberIdLoading && (
              <div className="kiosk-member-id-hint">
                <span className="spinner-sm" />
                Looking up...
              </div>
            )}
            {!memberIdLoading && memberIdInput.length > 0 && !memberIdError && (
              <div className="kiosk-member-id-hint">
                Press Enter to check in
              </div>
            )}
            {memberIdError && (
              <div className="kiosk-member-id-error">{memberIdError}</div>
            )}
          </div>
        )}
      </div>

      {/* Floating control card — radar, title, subtitle, promo and actions
          docked over the logo so everything fits on one non-scrollable screen */}
      <div className="kiosk-control-card" onClick={(e) => e.stopPropagation()}>
        <div className="radar-container">
          <div className="radar-ring" />
          <div className="radar-ring" />
          <div className="radar-ring" />
          <div className="fingerprint-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.81 4.47c-.08 0-.16-.02-.23-.06C15.66 3.42 14 3 12.01 3c-1.98 0-3.86.47-5.57 1.41-.24.13-.54.04-.68-.2-.13-.24-.04-.55.2-.68C7.82 2.52 9.86 2 12.01 2c2.13 0 3.99.47 6.03 1.52.25.13.34.43.21.67-.09.18-.26.28-.44.28zM3.5 9.72c-.1 0-.2-.03-.29-.09-.23-.16-.28-.47-.12-.7.99-1.4 2.25-2.5 3.75-3.27C9.98 4.04 14 4.03 17.15 5.65c1.5.77 2.76 1.86 3.75 3.25.16.22.11.54-.12.7-.23.16-.54.11-.7-.12-.9-1.26-2.04-2.25-3.39-2.94-2.87-1.47-6.54-1.47-9.4.01-1.36.7-2.5 1.7-3.4 2.96-.08.14-.23.21-.39.21zm6.25 12.07c-.13 0-.26-.05-.35-.15-.87-.87-1.34-1.43-2.01-2.64-.69-1.23-1.05-2.73-1.05-4.34 0-2.97 2.54-5.39 5.66-5.39s5.66 2.42 5.66 5.39c0 .28-.22.5-.5.5s-.5-.22-.5-.5c0-2.42-2.09-4.39-4.66-4.39-2.57 0-4.66 1.97-4.66 4.39 0 1.44.32 2.77.93 3.85.64 1.15 1.08 1.64 1.85 2.42.19.2.19.51 0 .71-.11.1-.24.15-.37.15zm7.17-1.85c-1.19 0-2.24-.3-3.1-.89-1.49-1.01-2.38-2.65-2.38-4.39 0-.28.22-.5.5-.5s.5.22.5.5c0 1.41.72 2.74 1.94 3.56.71.48 1.54.71 2.54.71.24 0 .64-.03 1.04-.1.27-.05.53.13.58.41.05.27-.13.53-.41.58-.57.11-1.07.12-1.21.12zM14.91 22c-.04 0-.09-.01-.13-.02-4.91-1.31-7.78-6.24-7.78-9.44 0-1.66 1.34-3 3-3s3 1.34 3 3c0 1.42-1.16 2.58-2.58 2.58-1.42 0-2.58-1.16-2.58-2.58 0-1.66-1.34-3-3-3s-3 1.34-3 3c0 3.65 3.25 8.96 8.35 10.29.27.07.43.35.35.61-.05.23-.26.37-.46.37z"/>
            </svg>
          </div>
        </div>

        <div className="kiosk-idle-title">
          <h1 className="display-text kiosk-title">
            <span className={`kiosk-scan-dot${scanActive ? ' active' : ''}`} />
            {kioskSettings.scannerEnabled ? (scanActive ? 'Scanning…' : 'Waiting for fingerprint...') : 'Scanner disabled'}
          </h1>
        </div>

        <p className="kiosk-subtitle">Tap anywhere to type Member ID</p>

        {/* Promo / tip carousel (P2 5.1) */}
        <div className="kiosk-promo-carousel" onClick={(e) => e.stopPropagation()}>
          <span className="kiosk-promo-icon">{PROMOS[promoIndex].icon}</span>
          <span className="kiosk-promo-text">{PROMOS[promoIndex].text}</span>
          <span className="kiosk-promo-dots">
            {PROMOS.map((_, i) => (
              <span key={i} className={`kiosk-promo-dot ${i === promoIndex ? 'active' : ''}`} />
            ))}
          </span>
        </div>

        {/* Kiosk action links — one row (P2 5.1) */}
        <div className="kiosk-action-row">
          <button
            className="kiosk-manual-link"
            onClick={(e) => {
              e.stopPropagation()
              toggleManualSearch()
            }}
          >
            {showManualSearch ? 'Hide manual search' : "Can't scan? Search manually"}
          </button>
          <button
            className="kiosk-manual-link"
            onClick={(e) => {
              e.stopPropagation()
              openQrScanner()
            }}
          >
            📷 Scan QR Code
          </button>
          <button
            className="kiosk-manual-link"
            onClick={(e) => {
              e.stopPropagation()
              openGuestModal()
            }}
          >
            🪪 Guest / Trial Check-in
          </button>
        </div>

        {showManualSearch && (
          <div className="manual-search-box animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              className="input"
              placeholder="Search by name or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
              autoFocus
            />
            <button className="btn btn-primary" onClick={handleManualSearch}>
              Search
            </button>
          </div>
        )}

        {/* Today's guest count */}
        {guestCount > 0 && (
          <span className="kiosk-guest-count">👥 {guestCount} guest{guestCount !== 1 ? 's' : ''} today</span>
        )}

        {/* Open/Close external kiosk window buttons */}
        <div className="kiosk-external-controls" onClick={(e) => e.stopPropagation()}>
          {isKioskWindow() ? (
            <button className="btn btn-secondary btn-sm" onClick={handleCloseExternalKiosk}>
              ✕ Close Kiosk Window
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleOpenExternalKiosk}>
              🖥️ Open Kiosk on External Monitor
            </button>
          )}
        </div>
      </div>
      </div>
  )

  const renderMatchFound = () => {
    if (!matchedMember) return null
    // Remaining coach days (only meaningful when the member has coaching)
    const coachDays = matchedMember.coaching_end
      ? Math.ceil((new Date(matchedMember.coaching_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null
    // Coach days percentage (for progress bar)
    const coachTotal = matchedMember.coaching_start && matchedMember.coaching_end
      ? new Date(matchedMember.coaching_end).getTime() - new Date(matchedMember.coaching_start).getTime()
      : 0
    const coachRemaining = matchedMember.coaching_end ? new Date(matchedMember.coaching_end).getTime() - Date.now() : 0
    const coachPct = coachTotal > 0 ? Math.max(2, Math.min(100, (coachRemaining / coachTotal) * 100)) : 65
    // Expiry bar: remaining / total plan duration (fallback 65% when unknown)
    const planTotal = matchedMember.plan_start && matchedMember.plan_end
      ? new Date(matchedMember.plan_end).getTime() - new Date(matchedMember.plan_start).getTime()
      : 0
    const planRemaining = matchedMember.plan_end ? new Date(matchedMember.plan_end).getTime() - Date.now() : 0
    const planPct = planTotal > 0 ? Math.max(2, Math.min(100, (planRemaining / planTotal) * 100)) : 65
    return (
    <div className="kiosk-profile kiosk-profile-split">
      <div className="profile-banner active">
        <div className="banner-left">
          <span className="banner-icon">✓</span>
          <span>Match found — checked in at {new Date().toLocaleTimeString()}</span>
        </div>
        <div className="countdown-badge">
          <svg className="countdown-ring" viewBox="0 0 36 36">
            <path
              className="countdown-track"
              d="M18 2.0845
                a 15.9155 15.9155 0 0 1 0 31.831
                a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path
              className="countdown-fill"
              strokeDasharray={`${(countdown / AUTO_CLOSE_SECONDS) * 100}, 100`}
              d="M18 2.0845
                a 15.9155 15.9155 0 0 1 0 31.831
                a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          </svg>
          <span className="countdown-text">{countdown}</span>
        </div>
      </div>
      <div className="kiosk-scan-next">
        <span className={`kiosk-scan-dot${scanActive ? ' active' : ''}`} />
        <span>{scanActive ? 'Scanning for next member…' : 'Ready for next scan'}</span>
      </div>

      {/* Two-panel check-in confirmation: photo left, details right */}
      <div className="kiosk-split-grid">
        {/* Left panel — photo only, fills the whole panel */}
        <div className="kiosk-photo-panel">
          <div className="kiosk-photo-frame">
            {matchedMember.photo && kioskSettings.showMemberPhotos ? (
              <img src={matchedMember.photo} alt={matchedMember.name} />
            ) : (
              <span className="kiosk-photo-fallback">{matchedMember.name.charAt(0).toUpperCase()}</span>
            )}
          </div>
        </div>

        {/* Right panel — member details */}
        <div className="kiosk-details-panel">            <div className="kiosk-details-header">
              <div className="kiosk-details-title-row">
                <h2 className="display-text profile-name">{matchedMember.name}</h2>
                {matchedMember.frozen ? (
                  <span className="status-badge frozen" title={matchedMember.freeze_end ? `Frozen until ${new Date(matchedMember.freeze_end).toLocaleDateString()}` : 'Frozen'}>
                    ❄️ Frozen
                  </span>
                ) : (
                  <span className={`status-badge ${matchedMember.status}`}>{matchedMember.status}</span>
                )}
              </div>
              <p className="mono-text profile-id">ID: {matchedMember.member_id}</p>
            </div>

          <div className="profile-metadata">
            <div className="metadata-item">
              <span className="metadata-label">Plan</span>
              <span className="metadata-value">{matchedMember.plan_name || 'No plan'}</span>
            </div>
            {/* Multi-session pack members: show sessions remaining (this check-in already consumed one).
                1-session "per session" plans are day passes — time-gated, so no session count is shown. */}
            {matchedMember.plan_type === 'session_pack' && typeof matchedMember.plan_sessions === 'number' && matchedMember.plan_sessions > 1 && (() => {
              const remaining = Math.max(0, matchedMember.plan_sessions! - (matchedMember.sessions_used || 0) - 1)
              return (
                <div className="metadata-item">
                  <span className="metadata-label">Sessions Left</span>
                  <span className={`metadata-value mono-text sessions-left${remaining <= 2 ? ' low' : ''}`}>
                    {remaining} of {matchedMember.plan_sessions} left
                  </span>
                </div>
              )
            })()}
            <div className="metadata-item">
              <span className="metadata-label">Coach</span>
              <span className="metadata-value">{matchedMember.coach_name || '—'}</span>
            </div>
            {/* Remaining coach days when the member availed coaching */}
            {matchedMember.coach_id && coachDays !== null && (
              <div className="metadata-item">
                <span className="metadata-label">Coach Days Left</span>
                <span className={`metadata-value mono-text coach-days${coachDays >= 0 && coachDays <= 2 ? ' low' : ''}`}>
                  {coachDays > 0
                    ? `${coachDays} day${coachDays === 1 ? '' : 's'}`
                    : coachDays === 0
                      ? 'Ends today'
                      : `Ended ${Math.abs(coachDays)}d ago`}
                </span>
                <div className="expiry-bar">
                  <div
                    className="expiry-fill coach"
                    style={{ width: `${coachPct}%` }}
                  />
                </div>
              </div>
            )}
            {/* P2 5.8: referral reward points — visible on every kiosk check-in */}
            <div className="metadata-item">
              <span className="metadata-label">Reward Points</span>
              <span className={`metadata-value mono-text kiosk-points${(matchedMember.points || 0) >= 100 ? ' redeemable' : ''}`}>
                ⭐ {matchedMember.points || 0} pts
              </span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Member Since</span>
              <span className="metadata-value mono-text">
                {matchedMember.created_at ? new Date(matchedMember.created_at).toLocaleDateString() : 'N/A'}
              </span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Balance</span>
              <span className="metadata-value mono-text">
                {formatMoney(matchedMember.balance)}
              </span>
            </div>
          </div>

          <div className="expiry-section">
            <div className="expiry-header">
              <span className="expiry-label">Plan Status</span>
              <span className="mono-text expiry-date">
                {matchedMember.plan_end ? new Date(matchedMember.plan_end).toLocaleDateString() : 'No end date'}
              </span>
            </div>
            <div className="expiry-bar">
              <div
                className="expiry-fill active"
                style={{ width: `${planPct}%` }}
              />
            </div>
            <span className="expiry-status">
              {matchedMember.plan_end
                ? (() => {
                    const days = Math.ceil((new Date(matchedMember.plan_end!).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                    return days > 0
                      ? `${days} day${days === 1 ? '' : 's'} remaining`
                      : 'Expiring today'
                  })()
                : 'No end date'
              }
            </span>
          </div>

          {/* Redeem 100 points for a free month (P2 5.8) */}
          {(matchedMember.points || 0) >= 100 && (
            <button className="btn btn-primary kiosk-redeem-btn" onClick={() => setShowRedeemModal(true)}>
              🎁 Redeem 100 pts — 1 month free
            </button>
          )}
        </div>
      </div>
    </div>
    )
  }

  const renderExpired = () => {
    if (!matchedMember) return null
    // Remaining coach days (only meaningful when the member has coaching)
    const coachDays = matchedMember.coaching_end
      ? Math.ceil((new Date(matchedMember.coaching_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null
    // Coach days percentage (for progress bar)
    const coachTotal = matchedMember.coaching_start && matchedMember.coaching_end
      ? new Date(matchedMember.coaching_end).getTime() - new Date(matchedMember.coaching_start).getTime()
      : 0
    const coachRemaining = matchedMember.coaching_end ? new Date(matchedMember.coaching_end).getTime() - Date.now() : 0
    const coachPct = coachTotal > 0 ? Math.max(2, Math.min(100, (coachRemaining / coachTotal) * 100)) : 65
    const daysExpired = matchedMember.plan_end
      ? Math.floor((Date.now() - new Date(matchedMember.plan_end).getTime()) / (1000 * 60 * 60 * 24))
      : 0
    return (
    <div className="kiosk-profile kiosk-profile-split">
      <div className="profile-banner expired">
        <span className="banner-icon">⚠</span>
        <span>Match found — plan is expired</span>
      </div>

      {/* Two-panel expired profile: photo left, details right */}
      <div className="kiosk-split-grid">
        {/* Left panel — photo only, fills the whole panel */}
        <div className="kiosk-photo-panel expired">
          <div className="kiosk-photo-frame expired">
            {matchedMember.photo && kioskSettings.showMemberPhotos ? (
              <img src={matchedMember.photo} alt={matchedMember.name} />
            ) : (
              <span className="kiosk-photo-fallback">{matchedMember.name.charAt(0).toUpperCase()}</span>
            )}
          </div>
        </div>

        {/* Right panel — member details */}
        <div className="kiosk-details-panel">
          <div className="kiosk-details-header">
            <div className="kiosk-details-title-row">
              <h2 className="display-text profile-name">{matchedMember.name}</h2>
              {matchedMember.frozen ? (
                <span className="status-badge frozen" title={matchedMember.freeze_end ? `Frozen until ${new Date(matchedMember.freeze_end).toLocaleDateString()}` : 'Frozen'}>
                  ❄️ Frozen
                </span>
              ) : (
                <span className="status-badge expired">Expired</span>
              )}
            </div>
            <p className="mono-text profile-id">ID: {matchedMember.member_id}</p>
          </div>

          <div className="profile-metadata">
            <div className="metadata-item">
              <span className="metadata-label">Plan</span>
              <span className="metadata-value">{matchedMember.plan_name || 'No plan'}</span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Expiry Date</span>
              <span className="metadata-value mono-text danger">
                {matchedMember.plan_end ? new Date(matchedMember.plan_end).toLocaleDateString() : 'N/A'}
              </span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Coach</span>
              <span className="metadata-value">{matchedMember.coach_name || '—'}</span>
            </div>
            {matchedMember.coach_id && coachDays !== null && (
              <div className="metadata-item">
                <span className="metadata-label">Coach Days Left</span>
                <span className={`metadata-value mono-text coach-days${coachDays >= 0 && coachDays <= 2 ? ' low' : ''}`}>
                  {coachDays > 0
                    ? `${coachDays} day${coachDays === 1 ? '' : 's'}`
                    : coachDays === 0
                      ? 'Ends today'
                      : `Ended ${Math.abs(coachDays)}d ago`}
                </span>
                <div className="expiry-bar">
                  <div
                    className="expiry-fill coach"
                    style={{ width: `${coachPct}%` }}
                  />
                </div>
              </div>
            )}
            {/* P2 5.8: referral reward points — visible on every kiosk check-in */}
            <div className="metadata-item">
              <span className="metadata-label">Reward Points</span>
              <span className={`metadata-value mono-text kiosk-points${(matchedMember.points || 0) >= 100 ? ' redeemable' : ''}`}>
                ⭐ {matchedMember.points || 0} pts
              </span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Balance Due</span>
              <span className="metadata-value mono-text danger">
                {formatMoney(matchedMember.balance)}
              </span>
            </div>
          </div>

          <div className="expiry-section">
            <div className="expiry-header">
              <span className="expiry-label">Plan Status</span>
              <span className="mono-text expiry-date">Expired</span>
            </div>
            <div className="expiry-bar">
              <div
                className="expiry-fill expired"
                style={{ width: '100%' }}
              />
            </div>
            <span className="expiry-status expired">
              Expired {daysExpired} day{daysExpired === 1 ? '' : 's'} ago
            </span>
          </div>

          {/* Redeem 100 points for a free month — a way to reactivate (P2 5.8) */}
          {(matchedMember.points || 0) >= 100 && (
            <button className="btn btn-primary kiosk-redeem-btn" onClick={() => setShowRedeemModal(true)}>
              🎁 Redeem 100 pts — 1 month free
            </button>
          )}

          <div className="profile-actions">
            <button className="btn btn-primary" onClick={handleRenew}>
              Renew Plan
            </button>
            <button className="btn btn-secondary" onClick={handleManualOverride}>
              Manual Override Entry
            </button>
            <button className="btn btn-secondary" onClick={resetToIdle}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
    )
  }

  const renderNoMatch = () => (
    <div className="kiosk-no-match">
      <div className="no-match-icon">✕</div>
      <h2 className="display-text">No Match Found</h2>
      <p className="text-muted">Fingerprint not recognized in system</p>
      <div className="kiosk-scan-next">
        <span className={`kiosk-scan-dot${scanActive ? ' active' : ''}`} />
        <span>{scanActive ? 'Scanning for next fingerprint…' : 'Scanning again…'}</span>
      </div>
      <div className="no-match-actions">
        <button className="btn btn-primary" onClick={resetToIdle}>
          Try Again
        </button>
        <button className="btn btn-secondary" onClick={() => {
          resetToIdle()
          setShowManualSearch(true)
        }}>
          Search Manually
        </button>
      </div>
    </div>
  )

  const renderBlocked = () => matchedMember && (
    <div className="kiosk-no-match kiosk-blocked">
      <div className="no-match-icon">⛔</div>
      <h2 className="display-text">Check-in Blocked</h2>
      <p className="text-muted">{blockedMessage}</p>

      {/* Blocked member context */}
      <div className="kiosk-blocked-member">
        <div className="profile-avatar kiosk-blocked-avatar">
          {matchedMember.photo && kioskSettings.showMemberPhotos ? (
            <img src={matchedMember.photo} alt={matchedMember.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
          ) : (
            matchedMember.name.charAt(0).toUpperCase()
          )}
        </div>
        <div className="kiosk-blocked-member-info">
          <span className="kiosk-blocked-member-name">{matchedMember.name}</span>
          <span className="mono-text">ID: {matchedMember.member_id}</span>
        </div>
      </div>

{/* Live fingerprint rescan — retry or staff authorize without leaving the modal (P2 6.9).
          Scans automatically on entry (no button needed), so this is just a compact status card. */}
      <div className={`kiosk-blocked-scan${blockedRescanning ? ' active' : ''}`}>
        <div className="kiosk-blocked-fp-wrap">
          <FingerprintIcon progress={1} className="kiosk-blocked-fp" />
          {blockedRescanning && <FingerprintScanRings />}
        </div>
        <span className="kiosk-blocked-scan-title">
          {blockedRescanning ? 'Waiting for fingerprint…' : 'Listening for fingerprint…'}
        </span>
      </div>

      <div className="no-match-actions">
        <button className="btn btn-secondary" onClick={resetToIdle}>
          Done
        </button>
        <button className="btn btn-secondary" onClick={() => {
          resetToIdle()
          setShowManualSearch(true)
        }}>
          Search Manually
        </button>
      </div>
    </div>
  )

  const renderStaffVerified = () => staffVerifiedUser && (
    <div className="kiosk-no-match kiosk-staff-verified">
      <div className="kiosk-staff-verified-icon">✓</div>
      <h2 className="display-text">Staff Verified</h2>
      <p className="kiosk-staff-verified-name">{staffVerifiedUser.name}</p>
      <span className={`status-badge ${staffVerifiedUser.role === 'Admin' ? 'active' : 'inactive'}`}>
        {staffVerifiedUser.role}
      </span>
      <div className="kiosk-scan-next">
        <span className="kiosk-scan-dot" />
        <span>Returning to check-in…</span>
      </div>
    </div>
  )

  const renderRenewModal = () => (
    <div className="kiosk-renew-overlay" onClick={() => { if (!renewing) setShowRenewModal(false) }}>
      <div className="kiosk-renew-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kiosk-renew-header">
          <h2 className="display-text">Renew Plan</h2>
          <button className="btn-icon" onClick={() => setShowRenewModal(false)} disabled={renewing}>✕</button>
        </div>
        <div className="kiosk-renew-body">
          <p className="text-muted" style={{ margin: 0 }}>
            {matchedMember?.name} — current plan: {matchedMember?.plan_name || 'No plan'}
          </p>
          <div className="kiosk-renew-field">
            <label>Plan</label>
            <select
              className="input"
              value={renewPlanId}
              onChange={(e) => {
                const id = Number(e.target.value)
                setRenewPlanId(id)
                const plan = renewPlans.find(p => p.id === id)
                setRenewAmount(plan?.price || 0)
              }}
            >
              <option value={0}>— Select a plan —</option>
              {renewPlans.map((plan) => (
                <option key={plan.id} value={plan.id}>{plan.name} ({formatMoney(plan.price)})</option>
              ))}
            </select>
          </div>
          <div className="kiosk-renew-row">
            <div className="kiosk-renew-field">
              <label>Payment Method</label>
              <select className="input" value={renewPaymentMethod} onChange={(e) => { setRenewPaymentMethod(e.target.value); setRenewTxnRef('') }}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="gcash">GCash</option>
                <option value="bank_transfer">Bank Transfer</option>
              </select>
            </div>
            {METHODS_REQUIRING_REF.includes(renewPaymentMethod) && (
              <div className="kiosk-renew-field">
                <label>Transaction Number *</label>
                <input
                  type="text"
                  className="input"
                  value={renewTxnRef}
                  onChange={(e) => setRenewTxnRef(e.target.value)}
                  placeholder="e.g. 1234567890"
                />
                {!renewTxnRef.trim() && renewAmount > 0 && METHODS_REQUIRING_REF.includes(renewPaymentMethod) && (
                  <div className="kiosk-renew-hint">Transaction number is required for this payment method.</div>
                )}
              </div>
            )}
            <div className="kiosk-renew-field">
              <label>Amount</label>
              <input
                type="number"
                className="input"
                value={renewAmount || ''}
                onChange={(e) => setRenewAmount(Number(e.target.value))}
                placeholder="0.00"
                step="0.01"
                min="1"
              />
            </div>
          </div>
          {renewError && <div className="kiosk-renew-error">{renewError}</div>}
          {matchedMember && (
            <div className="kiosk-renew-summary">
              New plan: {renewPlans.find(p => p.id === renewPlanId)?.name || '—'} · starts{' '}
              {new Date().toLocaleDateString()}
            </div>
          )}
        </div>
        <div className="kiosk-renew-footer">
          <button className="btn btn-secondary" onClick={() => setShowRenewModal(false)} disabled={renewing}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleRenewConfirm} disabled={!renewPlanId || renewing}>
            {renewing ? 'Renewing...' : 'Renew Now'}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="kiosk">
      {/* SMS gateway status dot (PHILSMS_SETUP_GUIDE.md) — live verification
          result for PhilSMS, broadcast from the main process. */}
      {smsStatus && smsStatus.kind !== 'off' && (
        <div className={`kiosk-sms-chip ${smsStatus.verified ? 'ok' : smsStatus.kind === 'simulator' ? 'idle' : 'bad'}`}>
          <span className="kiosk-sms-dot" />
          <span className="kiosk-sms-text">{smsStatus.message}</span>
        </div>
      )}
      {/* Cross-fade state screens — always mounted, faded via .active so the
          kiosk never unmounts/remounts a full screen (that flash was the flicker) */}
      <div className="kiosk-screens">
        <div className={`kiosk-screen${state === 'idle' ? ' active' : ''}`}>{renderIdleState()}</div>
        <div className={`kiosk-screen${state === 'match-found' ? ' active' : ''}`}>{renderMatchFound()}</div>
        <div className={`kiosk-screen${state === 'expired' ? ' active' : ''}`}>{renderExpired()}</div>
        <div className={`kiosk-screen${state === 'no-match' ? ' active' : ''}`}>{renderNoMatch()}</div>
        <div className={`kiosk-screen${state === 'blocked' ? ' active' : ''}`}>{renderBlocked()}</div>
        <div className={`kiosk-screen${state === 'staff-verified' ? ' active' : ''}`}>{renderStaffVerified()}</div>
      </div>
      {showRenewModal && renderRenewModal()}
      {showRedeemModal && renderRedeemModal()}
      {showGuestModal && renderGuestModal()}

      {/* ── P2 6.9: Daily Kiosk Executive Report (admin fingerprint intercept) ── */}
      {showExecReport && (
        <KioskExecReport
          adminName={execAdminName}
          report={execReport}
          loading={execReportLoading}
          error={execReportError}
          onClose={() => {
            setShowExecReport(false)
            resetToIdle()
          }}
        />
      )}

      {/* ── QR Scanner Modal ── */}
      {showQrScanner && (
        <div className="kiosk-renew-overlay" onClick={() => closeQrScanner()}>
          <div className="kiosk-qr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="kiosk-renew-header">
              <h2 className="display-text">📷 Scan QR Code</h2>
              <button className="btn-icon" onClick={closeQrScanner}>✕</button>
            </div>
            <div className="kiosk-qr-body">
              <div className="kiosk-qr-viewport">
                <video ref={qrVideoRef} playsInline muted className="kiosk-qr-video" />
                <canvas ref={qrCanvasRef} style={{ display: 'none' }} />
                {qrScanning && !qrError && (
                  <div className="kiosk-qr-guide">
                    <div className="kiosk-qr-frame" />
                    <span className="kiosk-qr-hint">Point the camera at the member's QR code</span>
                  </div>
                )}
                {qrError && (
                  <div className="kiosk-qr-error">
                    <span>⚠️ {qrError}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setQrError(''); setQrScanning(true); openQrScanner() }}>
                      Retry Camera
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="kiosk-renew-footer">
              <button className="btn btn-secondary" onClick={closeQrScanner}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Kiosk
