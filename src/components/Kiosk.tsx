import React, { useState, useEffect, useRef, useCallback } from 'react'
import './Kiosk.css'
import jsQR from 'jsqr'
import { Member, TodayStats, Plan } from '../types/electron'
import { log } from '../lib/logger'
import { todayLocalOf } from '../lib/dates'

interface KioskProps {
  onRefresh: () => void
}

type KioskState = 'idle' | 'scanning' | 'match-found' | 'no-match' | 'expired' | 'blocked'

// WebAuthn Relying Party ID - must match registration
const RP_ID = 'localhost'
const AUTO_SCAN_DELAY = 600 // ms delay before auto-scanning
const AUTO_CLOSE_SECONDS = 10

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
  const [blockedMessage, setBlockedMessage] = useState('')
  // Renewal modal state
  const [showRenewModal, setShowRenewModal] = useState(false)
  const [renewPlans, setRenewPlans] = useState<Plan[]>([])
  const [renewPlanId, setRenewPlanId] = useState(0)
  const [renewPaymentMethod, setRenewPaymentMethod] = useState('cash')
  const [renewTxnRef, setRenewTxnRef] = useState('')
  const [renewAmount, setRenewAmount] = useState(0)
  const [renewing, setRenewing] = useState(false)
  const [renewError, setRenewError] = useState('')
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
  const stateRef = useRef(state)

  // Load kiosk logo + settings from the Settings page
  useEffect(() => {
    const loadKioskConfig = async () => {
      try {
        const logo = await window.electronAPI.getSetting('kioskLogo')
        if (logo) setKioskLogo(logo)
      } catch {}
      try {
        const data = await window.electronAPI.getSettings()
        setKioskSettings({
          scannerEnabled: data.scannerEnabled !== 'false',
          showMemberPhotos: data.showMemberPhotos !== 'false',
          enableNotifications: data.enableNotifications === 'true',
          autoLockTimeout: Number(data.autoLockTimeout) || 0,
        })
      } catch {}
    }
    loadKioskConfig()
  }, [])

  // Keep stateRef in sync
  useEffect(() => {
    stateRef.current = state
  }, [state])

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

  // Auto-scan in any state (except when manual search is open, scanner is disabled, or check-in was blocked)
  useEffect(() => {
    if (!kioskSettings.scannerEnabled || state === 'blocked') return
    if (!showManualSearch) {
      autoScanTimer.current = setTimeout(() => {
        handleRealScan()
      }, AUTO_SCAN_DELAY)
    }
    return () => {
      if (autoScanTimer.current) {
        clearTimeout(autoScanTimer.current)
        autoScanTimer.current = null
      }
    }
  }, [state, showManualSearch, matchKey, kioskSettings.scannerEnabled])

  // Countdown timer for match-found auto-close
  useEffect(() => {
    if (state === 'match-found') {
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
  }, [state === 'match-found', matchKey])

  // Real fingerprint check-in using WebAuthn
  const handleRealScan = useCallback(async () => {
    if (isScanning.current) return
    isScanning.current = true

    const currentState = stateRef.current

    try {
      // Get all members to find their credential IDs
      // Stay on current state during prep work — no UI flicker
      const members = await window.electronAPI.getMembers()
      
      if (members.length === 0) {
        // No members yet — schedule retry silently (no state change)
        autoScanTimer.current = setTimeout(() => handleRealScan(), AUTO_SCAN_DELAY)
        return
      }
      
      // Collect all credential IDs from all members
      const allowCredentials: PublicKeyCredentialDescriptor[] = []
      const memberCredentialMap: Record<string, Member> = {}
      
      for (const member of members) {
        const credentials = await window.electronAPI.getFingerprint(member.id)
        if (credentials && credentials.length > 0) {
          for (const cred of credentials) {
            const credIdHex = Buffer.from(cred.template).toString('hex')
            allowCredentials.push({
              type: 'public-key',
              id: Uint8Array.from(Buffer.from(credIdHex, 'hex'))
            })
            memberCredentialMap[credIdHex] = member
          }
        }
      }
      
      if (allowCredentials.length === 0) {
        // No registered fingerprints yet — schedule retry silently
        autoScanTimer.current = setTimeout(() => handleRealScan(), AUTO_SCAN_DELAY)
        return
      }
      
      // Generate a challenge
      const challenge = new Uint8Array(32)
      crypto.getRandomValues(challenge)
      
      // Only show scanning UI if we're not already showing a match
      // If a modal is already visible, scan silently in the background
      if (currentState === 'idle' || currentState === 'no-match') {
        setState('scanning')
      }
      
      // Prompt the browser's WebAuthn to scan a fingerprint
      // This waits patiently until the user touches the scanner or cancels
      const abortController = new AbortController()
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: RP_ID,
          userVerification: 'required',
          allowCredentials,
          timeout: 60000
        },
        signal: abortController.signal
      }) as PublicKeyCredential | null
      
      if (assertion) {
        // Find which member this credential belongs to
        const credentialIdHex = Array.from(new Uint8Array(assertion.rawId))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
        
        const member = memberCredentialMap[credentialIdHex]
        
        if (member) {
          setMatchedMember(member)
          
          if (member.status === 'expired') {
            setState('expired')
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
            }
          }
        } else {
          // Credential matched but member not found — go to idle
          setState('idle')
        }
      } else {
        // User cancelled — if we were idle, go back to idle; if showing a match, stay on it
        if (currentState === 'idle' || currentState === 'no-match') {
          setState('idle')
        }
        // else: stay on match-found/expired — don't dismiss the modal
      }
    } catch (error: any) {
      console.error('Fingerprint scan error:', error.name || error.message)
      // Only go to idle if we weren't showing a match
      if (stateRef.current === 'idle' || stateRef.current === 'no-match' || stateRef.current === 'scanning') {
        setState('idle')
      }
      // else: stay on match-found/expired — don't dismiss the modal
    } finally {
      isScanning.current = false
    }
  }, [onRefresh])

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
    <div className="kiosk-idle animate-fade-in" onClick={handleIdleAreaClick}>
      {!kioskSettings.scannerEnabled && (
        <div className="kiosk-scanner-disabled-note">
          ⚠️ Fingerprint scanner is disabled in Settings — use Member ID or manual search.
        </div>
      )}
      {kioskLogo && (
        <div className="kiosk-big-logo">
          <img src={kioskLogo} alt="Gym Logo" />
        </div>
      )}

      {/* Member ID quick login — appears on any click */}
      {showMemberIdInput && (
        <div className="kiosk-member-id-section animate-fade-in" onClick={(e) => e.stopPropagation()}>
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

      <div className="radar-container">
        <div className="radar-ring ring-1" />
        <div className="radar-ring ring-2" />
        <div className="radar-ring ring-3" />
        <div className="fingerprint-icon">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.81 4.47c-.08 0-.16-.02-.23-.06C15.66 3.42 14 3 12.01 3c-1.98 0-3.86.47-5.57 1.41-.24.13-.54.04-.68-.2-.13-.24-.04-.55.2-.68C7.82 2.52 9.86 2 12.01 2c2.13 0 3.99.47 6.03 1.52.25.13.34.43.21.67-.09.18-.26.28-.44.28zM3.5 9.72c-.1 0-.2-.03-.29-.09-.23-.16-.28-.47-.12-.7.99-1.4 2.25-2.5 3.75-3.27C9.98 4.04 14 4.03 17.15 5.65c1.5.77 2.76 1.86 3.75 3.25.16.22.11.54-.12.7-.23.16-.54.11-.7-.12-.9-1.26-2.04-2.25-3.39-2.94-2.87-1.47-6.54-1.47-9.4.01-1.36.7-2.5 1.7-3.4 2.96-.08.14-.23.21-.39.21zm6.25 12.07c-.13 0-.26-.05-.35-.15-.87-.87-1.34-1.43-2.01-2.64-.69-1.23-1.05-2.73-1.05-4.34 0-2.97 2.54-5.39 5.66-5.39s5.66 2.42 5.66 5.39c0 .28-.22.5-.5.5s-.5-.22-.5-.5c0-2.42-2.09-4.39-4.66-4.39-2.57 0-4.66 1.97-4.66 4.39 0 1.44.32 2.77.93 3.85.64 1.15 1.08 1.64 1.85 2.42.19.2.19.51 0 .71-.11.1-.24.15-.37.15zm7.17-1.85c-1.19 0-2.24-.3-3.1-.89-1.49-1.01-2.38-2.65-2.38-4.39 0-.28.22-.5.5-.5s.5.22.5.5c0 1.41.72 2.74 1.94 3.56.71.48 1.54.71 2.54.71.24 0 .64-.03 1.04-.1.27-.05.53.13.58.41.05.27-.13.53-.41.58-.57.11-1.07.12-1.21.12zM14.91 22c-.04 0-.09-.01-.13-.02-4.91-1.31-7.78-6.24-7.78-9.44 0-1.66 1.34-3 3-3s3 1.34 3 3c0 1.42-1.16 2.58-2.58 2.58-1.42 0-2.58-1.16-2.58-2.58 0-1.66-1.34-3-3-3s-3 1.34-3 3c0 3.65 3.25 8.96 8.35 10.29.27.07.43.35.35.61-.05.23-.26.37-.46.37z"/>
          </svg>
        </div>
      </div>
      
      <h1 className="display-text kiosk-title">
        {kioskSettings.scannerEnabled ? 'Waiting for fingerprint...' : 'Scanner disabled'}
      </h1>
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
      
      <button 
        className="kiosk-manual-link"
        onClick={(e) => {
          e.stopPropagation()
          toggleManualSearch()
        }}
      >
        {showManualSearch ? 'Hide manual search' : "Can't scan? Search manually"}
      </button>
      
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

      {/* QR code check-in button */}
      <button
        className="kiosk-manual-link"
        onClick={(e) => {
          e.stopPropagation()
          openQrScanner()
        }}
      >
        📷 Scan QR Code
      </button>

      {/* Guest / trial check-in button (P2 5.1) */}
      <button
        className="kiosk-manual-link"
        onClick={(e) => {
          e.stopPropagation()
          openGuestModal()
        }}
      >
        🪪 Guest / Trial Check-in
      </button>

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
  )

  const renderScanningState = () => (
    <div className="kiosk-scanning animate-fade-in">
      <div className="scanning-animation">
        <div className="scanning-ring" />
        <div className="scanning-ring ring-2" />
        <div className="scanning-ring ring-3" />
      </div>
      <h2 className="display-text">Scanning...</h2>
      <p className="text-muted">Place your finger on the scanner</p>
    </div>
  )

  const renderMatchFound = () => matchedMember && (
    <div className="kiosk-profile animate-fade-in">
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
      
      <div className="profile-card">
        <div className="profile-header">
          <div className="profile-avatar">
            {matchedMember.photo && kioskSettings.showMemberPhotos ? (
              <img src={matchedMember.photo} alt={matchedMember.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '16px' }} />
            ) : (
              matchedMember.name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="profile-info">
            <h2 className="display-text profile-name">{matchedMember.name}</h2>
            <p className="mono-text profile-id">ID: {matchedMember.member_id}</p>
            <span className={`status-badge ${matchedMember.status}`}>
              {matchedMember.status}
            </span>
          </div>
        </div>
        
        <div className="profile-metadata">
          <div className="metadata-item">
            <span className="metadata-label">Plan</span>
            <span className="metadata-value">{matchedMember.plan_name || 'No plan'}</span>
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
              ₱{matchedMember.balance.toFixed(2)}
            </span>
          </div>
        </div>
        
        <div className="expiry-section">
          <div className="expiry-header">
            <span className="expiry-label">Plan Status</span>
            <span className="mono-text expiry-date">
              {matchedMember.plan_end ? new Date(matchedMember.plan_end).toLocaleDateString() : 'N/A'}
            </span>
          </div>
          <div className="expiry-bar">
            <div 
              className="expiry-fill active"
              style={{ width: '65%' }}
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
      </div>
    </div>
  )

  const renderExpired = () => matchedMember && (
    <div className="kiosk-profile animate-fade-in">
      <div className="profile-banner expired">
        <span className="banner-icon">⚠</span>
        <span>Match found — plan is expired</span>
      </div>
      
      <div className="profile-card">
        <div className="profile-header">
          <div className="profile-avatar">
            {matchedMember.photo && kioskSettings.showMemberPhotos ? (
              <img src={matchedMember.photo} alt={matchedMember.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '16px' }} />
            ) : (
              matchedMember.name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="profile-info">
            <h2 className="display-text profile-name">{matchedMember.name}</h2>
            <p className="mono-text profile-id">ID: {matchedMember.member_id}</p>
            <span className="status-badge expired">Expired</span>
          </div>
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
            <span className="metadata-label">Balance Due</span>
            <span className="metadata-value mono-text danger">
              ₱{matchedMember.balance.toFixed(2)}
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
            Expired {matchedMember.plan_end ? Math.floor((Date.now() - new Date(matchedMember.plan_end).getTime()) / (1000 * 60 * 60 * 24)) : 0} days ago
          </span>
        </div>
        
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
  )

  const renderNoMatch = () => (
    <div className="kiosk-no-match animate-fade-in">
      <div className="no-match-icon">✕</div>
      <h2 className="display-text">No Match Found</h2>
      <p className="text-muted">Fingerprint not recognized in system</p>
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

  const renderBlocked = () => (
    <div className="kiosk-no-match animate-fade-in">
      <div className="no-match-icon">⛔</div>
      <h2 className="display-text">Check-in Blocked</h2>
      <p className="text-muted">{blockedMessage}</p>
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
                <option key={plan.id} value={plan.id}>{plan.name} (₱{plan.price})</option>
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
              <label>Amount (₱)</label>
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
      {state === 'idle' && renderIdleState()}
      {state === 'scanning' && renderScanningState()}
      {state === 'match-found' && renderMatchFound()}
      {state === 'expired' && renderExpired()}
      {state === 'no-match' && renderNoMatch()}
      {state === 'blocked' && renderBlocked()}
      {showRenewModal && renderRenewModal()}
      {showGuestModal && renderGuestModal()}

      {/* ── QR Scanner Modal ── */}
      {showQrScanner && (
        <div className="kiosk-renew-overlay" onClick={() => { if (!qrScanning) closeQrScanner() }}>
          <div className="kiosk-qr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="kiosk-renew-header">
              <h2 className="display-text">📷 Scan QR Code</h2>
              <button className="btn-icon" onClick={closeQrScanner} disabled={qrScanning}>✕</button>
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
              <button className="btn btn-secondary" onClick={closeQrScanner} disabled={qrScanning}>
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
