import React, { useState, useEffect, useRef, useCallback } from 'react'
import './Kiosk.css'
import { Member, TodayStats } from '../types/electron'
import { log } from '../lib/logger'

interface KioskProps {
  onRefresh: () => void
}

type KioskState = 'idle' | 'scanning' | 'match-found' | 'no-match' | 'expired'

// WebAuthn Relying Party ID - must match registration
const RP_ID = 'localhost'
const AUTO_SCAN_DELAY = 600 // ms delay before auto-scanning
const AUTO_CLOSE_SECONDS = 10

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
  const memberIdInputRef = useRef<HTMLInputElement>(null)
  const autoScanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const isScanning = useRef(false)
  const stateRef = useRef(state)

  // Load kiosk logo from settings
  useEffect(() => {
    const loadLogo = async () => {
      try {
        const logo = await window.electronAPI.getSetting('kioskLogo')
        if (logo) setKioskLogo(logo)
      } catch {}
    }
    loadLogo()
  }, [])

  // Keep stateRef in sync
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Auto-focus member ID input when shown
  useEffect(() => {
    if (showMemberIdInput && memberIdInputRef.current) {
      memberIdInputRef.current.focus()
    }
  }, [showMemberIdInput])

  // Auto-scan in any state (except when manual search is open)
  useEffect(() => {
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
  }, [state, showManualSearch, matchKey])

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
            // If we were already on match-found, bump matchKey to reset countdown
            if (stateRef.current === 'match-found') {
              setMatchKey(prev => prev + 1)
            }
            setState('match-found')
            
            // Log the check-in
            await window.electronAPI.createCheckin({
              member_id: member.id,
              method: 'fingerprint',
              match_confidence: 1.0,
              status: 'success'
            })
            log.checkinFingerprint(member.id, member.name)
            onRefresh()
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
          setState('match-found')
          await window.electronAPI.createCheckin({
            member_id: member.id,
            method: 'manual',
            match_confidence: 1.0,
            status: 'success'
          })
          log.checkinManual(member.id, member.name)
          onRefresh()
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
          setState('match-found')
          await window.electronAPI.createCheckin({
            member_id: member.id,
            method: 'manual',
            match_confidence: 1.0,
            status: 'success'
          })
          log.checkinManual(member.id, member.name)
          onRefresh()
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

  const handleRenew = () => {
    console.log('Renew plan for:', matchedMember?.id)
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

  const renderIdleState = () => (
    <div className="kiosk-idle animate-fade-in" onClick={handleIdleAreaClick}>
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
      
      <h1 className="display-text kiosk-title">Waiting for fingerprint...</h1>
      <p className="kiosk-subtitle">Tap anywhere to type Member ID</p>
      
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
            {matchedMember.photo ? (
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
            {matchedMember.photo ? (
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

  return (
    <div className="kiosk">
      {state === 'idle' && renderIdleState()}
      {state === 'scanning' && renderScanningState()}
      {state === 'match-found' && renderMatchFound()}
      {state === 'expired' && renderExpired()}
      {state === 'no-match' && renderNoMatch()}
    </div>
  )
}

export default Kiosk
