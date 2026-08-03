import React, { useState, useEffect, useRef, useCallback } from 'react'
import './Dashboard.css'
import { ActiveCheckin, TodayStats, Member, AtRiskMember, GuestCheckin } from '../types/electron'
import { useDataVersion } from '../lib/data'
import { useToast } from '../lib/toast'
import { log } from '../lib/logger'

interface DashboardProps {
  stats: TodayStats
  recentCheckins: ActiveCheckin[]
  expiringSoon: Member[]
  onRefresh: () => void
}

function Dashboard({ stats, recentCheckins, expiringSoon, onRefresh }: DashboardProps) {
  const { showToast } = useToast()
  const [activeCheckins, setActiveCheckins] = useState<ActiveCheckin[]>([])
  const [atRiskMembers, setAtRiskMembers] = useState<AtRiskMember[]>([])
  const [showCheckinModal, setShowCheckinModal] = useState(false)
  const [showGuestsModal, setShowGuestsModal] = useState(false)
  const [showExpiringModal, setShowExpiringModal] = useState(false)
  const [showExpiredModal, setShowExpiredModal] = useState(false)
  const [expiredMembers, setExpiredMembers] = useState<Member[]>([])
  const [checkingOutGuestId, setCheckingOutGuestId] = useState<number | null>(null)
  const [checkingOut, setCheckingOut] = useState<number | null>(null)
  const [kioskBusy, setKioskBusy] = useState(false)
  const [kioskOpen, setKioskOpen] = useState(false)
  // P2 5.1: today's guest / trial check-ins (shown as a stat card + panel)
  const [guests, setGuests] = useState<GuestCheckin[]>([])
  // P2 6.5: re-fetch the active list whenever the data layer changes (e.g. a
  // kiosk check-in broadcasts data-changed) so 'Currently Checked In' stays live.
  const dataVersion = useDataVersion()

  // New-check-in pulse: diff the active list to spot newly arrived members and
  // flash a subtle 'Just now' pulse on their rows for a few seconds.
  const [justCheckedIn, setJustCheckedIn] = useState<Set<number>>(new Set())
  const prevActiveIdsRef = useRef<Set<number> | null>(null)

  useEffect(() => {
    const currentIds = new Set(activeCheckins.map(c => c.id))
    // Establish the baseline on the first render that actually has data, so
    // members already checked in don't flash 'Just now' on mount.
    if (prevActiveIdsRef.current === null && currentIds.size === 0) return
    if (prevActiveIdsRef.current === null) {
      prevActiveIdsRef.current = currentIds
      return
    }
    const newlyAdded = [...currentIds].filter(id => !prevActiveIdsRef.current!.has(id))
    prevActiveIdsRef.current = currentIds
    if (newlyAdded.length === 0) return

    setJustCheckedIn(prev => new Set([...prev, ...newlyAdded]))
    // One timer clears ALL entries, so rapid consecutive check-ins can't leave
    // an earlier row's 'Just now' badge stuck forever.
    const timer = setTimeout(() => setJustCheckedIn(new Set()), 4000)
    return () => clearTimeout(timer)
  }, [activeCheckins])

  const loadActiveCheckins = useCallback(async () => {
    try {
      const data = await window.electronAPI.getActiveCheckins()
      setActiveCheckins(data)
    } catch (error) {
      console.error('Failed to load active checkins:', error)
    }
  }, [])

  const loadAtRisk = useCallback(async () => {
    try {
      const data = await window.electronAPI.getAtRiskMembers()
      setAtRiskMembers(data)
    } catch (error) {
      console.error('Failed to load at-risk members:', error)
    }
  }, [])

  const loadGuests = useCallback(async () => {
    try {
      const data = await window.electronAPI.getGuestCheckins()
      setGuests(data)
    } catch (error) {
      console.error('Failed to load guests:', error)
    }
  }, [])

  const loadExpired = useCallback(async () => {
    try {
      const data = await window.electronAPI.getMembers()
      setExpiredMembers(data.filter(m => m.status === 'expired'))
    } catch (error) {
      console.error('Failed to load expired members:', error)
    }
  }, [])

  useEffect(() => {
    loadActiveCheckins()
    loadAtRisk()
    loadGuests()
    loadExpired()
  }, [loadActiveCheckins, loadAtRisk, loadGuests, loadExpired, dataVersion])

  // Check a guest/trial out — marks when they left the gym
  const handleGuestCheckout = async (guest: GuestCheckin) => {
    setCheckingOutGuestId(guest.id)
    try {
      await window.electronAPI.checkoutGuest(guest.id)
      log.action({
        action: 'guest_checkout',
        entity_type: 'guest_checkin',
        entity_id: guest.id,
        details: JSON.stringify({ name: guest.name, type: guest.type }),
      })
      loadGuests()
    } catch (error) {
      console.error('Failed to check out guest:', error)
      showToast('error', 'Could not check out the guest')
    } finally {
      setCheckingOutGuestId(null)
    }
  }

  // Reopen (or focus) the kiosk window on the external monitor
  const handleOpenKiosk = async () => {
    setKioskBusy(true)
    try {
      await window.electronAPI.openKioskWindow()
    } catch (error) {
      console.error('Failed to open kiosk window:', error)
      showToast('error', 'Could not open the kiosk window')
    } finally {
      setKioskBusy(false)
    }
  }

  // Live kiosk status: query once on mount, then stay in sync via broadcasts
  // from the main process (kiosk window opened/closed from anywhere).
  useEffect(() => {
    let mounted = true
    window.electronAPI
      .getKioskStatus()
      .then(({ open }) => {
        if (mounted) setKioskOpen(open)
      })
      .catch((error) => console.error('Failed to get kiosk status:', error))
    const unsubscribe = window.electronAPI.onKioskStatusChanged((open) => {
      if (mounted) setKioskOpen(open)
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const handleCheckout = async (checkin: ActiveCheckin) => {
    setCheckingOut(checkin.id)
    try {
      await window.electronAPI.checkoutMember(checkin.id)

      // Remove from active list immediately
      setActiveCheckins(prev => prev.filter(c => c.id !== checkin.id))

      // Refresh data after a short delay
      setTimeout(() => {
        onRefresh()
        loadActiveCheckins()
      }, 300)
    } catch (error) {
      console.error('Checkout failed:', error)
    } finally {
      setCheckingOut(null)
    }
  }

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp.replace(' ', 'T') + 'Z')
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
  }

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const checkedInCount = activeCheckins.length

  return (
    <div className="dashboard">
      {/* Top greeting */}
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-greeting display-text">{getGreeting()}</h1>
          <p className="dashboard-date">{formatDate(new Date())}</p>
        </div>
        <div className="dashboard-header-right">
          <button
            className={`dash-kiosk-btn${kioskOpen ? ' kiosk-open' : ''}`}
            onClick={handleOpenKiosk}
            disabled={kioskBusy || kioskOpen}
            title={kioskOpen ? 'The kiosk window is already open' : 'Open the kiosk window on the external monitor'}
          >
            <span className={`dash-kiosk-btn-dot${kioskOpen ? ' open' : ''}`} />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="4" width="20" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 21H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M12 17V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            {kioskBusy ? 'Opening…' : kioskOpen ? 'Kiosk Open' : 'Open Kiosk'}
          </button>
          <div className="dashboard-time-badge">
            <span className="dashboard-time-label">Current Time</span>
            <span className="dashboard-time-value clock">{new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="dashboard-stats">
        {/* Active Members */}
        <div className="dash-stat-card">
          <div className="dash-stat-icon active-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12Z" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M18 20C18 17.79 15.31 16 12 16C8.69 16 6 17.79 6 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="dash-stat-body">
            <span className="dash-stat-number display-text">{stats.activeMembers}</span>
            <span className="dash-stat-label">Active Members</span>
          </div>
        </div>

        {/* Today's Check-ins (clickable) */}
        <div
          className="dash-stat-card dash-stat-card--clickable"
          onClick={() => {
            loadActiveCheckins()
            setShowCheckinModal(true)
          }}
        >
          <div className="dash-stat-icon checkin-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M9 11L12 14L22 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M21 12V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V5C3 3.9 3.9 3 5 3H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            {checkedInCount > 0 && (
              <span className="dash-stat-badge">{checkedInCount}</span>
            )}
          </div>
          <div className="dash-stat-body">
            <span className="dash-stat-number display-text">{stats.totalCheckins}</span>
            <span className="dash-stat-label">Today's Check-ins</span>
          </div>
          <div className="dash-stat-arrow">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>

        {/* Guests / Trials Today (clickable — full list) */}
        <div
          className="dash-stat-card dash-stat-card--clickable"
          onClick={() => setShowGuestsModal(true)}
          title="View all guests & trials checked in today"
        >
          <div className="dash-stat-icon guest-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="8" cy="11" r="2" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M5 17C5 14.79 6.34 14 8 14C9.66 14 11 14.79 11 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M13 10H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M13 14H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="dash-stat-body">
            <span className="dash-stat-number display-text">{guests.length}</span>
            <span className="dash-stat-label">Guests Today</span>
          </div>
          <div className="dash-stat-arrow">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>

        {/* Expiring This Week (clickable — full list) */}
        <div
          className="dash-stat-card dash-stat-card--clickable"
          onClick={() => setShowExpiringModal(true)}
          title="View all members expiring this week"
        >
          <div className="dash-stat-icon expiring-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M12 7V12L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="dash-stat-body">
            <span className="dash-stat-number display-text warn">{expiringSoon.length}</span>
            <span className="dash-stat-label">Expiring Soon</span>
          </div>
          <div className="dash-stat-arrow">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>

        {/* Expired Members (clickable — full list) */}
        <div
          className="dash-stat-card dash-stat-card--clickable"
          onClick={() => setShowExpiredModal(true)}
          title="View all members with lapsed plans"
        >
          <div className="dash-stat-icon expired-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M9 9L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M15 9L9 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="dash-stat-body">
            <span className="dash-stat-number display-text danger">{expiredMembers.length}</span>
            <span className="dash-stat-label">Expired</span>
          </div>
          <div className="dash-stat-arrow">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
      </div>

      {/* Quick overview panels */}
      <div className="dashboard-panels">
        {/* Currently Checked In */}
        <div className="dash-panel">
          <div className="dash-panel-header">
            <h3 className="dash-panel-title">Currently Checked In</h3>
            <button
              className="dash-panel-link"
              onClick={() => {
                loadActiveCheckins()
                setShowCheckinModal(true)
              }}
            >
              View all
            </button>
          </div>
          <div className="dash-panel-body">
            {activeCheckins.length === 0 ? (
              <div className="dash-panel-empty">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M9 11L12 14L22 4" stroke="var(--text-faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M21 12V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V5C3 3.9 3.9 3 5 3H16" stroke="var(--text-faint)" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <p>No members currently checked in</p>
              </div>
            ) : (
              <div className="dash-active-list">
                {activeCheckins.slice(0, 5).map((checkin) => (
                  <div key={checkin.id} className={`dash-active-item${justCheckedIn.has(checkin.id) ? ' just-now' : ''}`}>
                    <div className="dash-active-avatar">
                      {checkin.member_photo ? (
                        <img src={checkin.member_photo} alt="" />
                      ) : (
                        checkin.name?.charAt(0).toUpperCase() || '?'
                      )}
                    </div>
                    <div className="dash-active-info">
                      <span className="dash-active-name">{checkin.name}</span>
                      <span className="dash-active-time">
                        {formatTimestamp(checkin.timestamp)}
                        {justCheckedIn.has(checkin.id) && <span className="just-now-badge">Just now</span>}
                      </span>
                    </div>
                    <span className="dash-active-dot" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Today's Guests */}
        <div className="dash-panel">
          <div className="dash-panel-header">
            <h3 className="dash-panel-title">Today's Guests</h3>
            <button className="dash-panel-link" onClick={() => setShowGuestsModal(true)}>
              View all
            </button>
          </div>
          <div className="dash-panel-body">
            {guests.length === 0 ? (
              <div className="dash-panel-empty">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="4" width="20" height="16" rx="3" stroke="var(--text-faint)" strokeWidth="1.5"/>
                  <circle cx="8" cy="11" r="2" stroke="var(--text-faint)" strokeWidth="1.5"/>
                  <path d="M5 17C5 14.79 6.34 14 8 14C9.66 14 11 14.79 11 17" stroke="var(--text-faint)" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <p>No guests or trials checked in today</p>
              </div>
            ) : (
              <div className="dash-guest-list">
                {guests.slice(0, 6).map((guest) => (
                  <div key={guest.id} className="dash-guest-item">
                    <div className="dash-guest-avatar">🪪</div>
                    <div className="dash-guest-info">
                      <span className="dash-guest-name">{guest.name}</span>
                      <span className="dash-guest-time">
                        {guest.type === 'trial' ? 'Trial' : 'Day Pass'}
                        {guest.phone ? ` · ${guest.phone}` : ''} · {formatTimestamp(guest.created_at)}
                      </span>
                    </div>
                    <span className={`dash-guest-badge${guest.type === 'trial' ? ' trial' : ''}`}>
                      {guest.type === 'trial' ? 'Trial' : 'Guest'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* At-Risk Members */}
        <div className="dash-panel">
          <div className="dash-panel-header">
            <h3 className="dash-panel-title">At-Risk Members</h3>
            <button className="dash-panel-link" onClick={loadAtRisk} title="Refresh at-risk list">
              ↻ Refresh
            </button>
          </div>
          <div className="dash-panel-body">
            {atRiskMembers.length === 0 ? (
              <div className="dash-panel-empty">
                <p>No at-risk members — everyone is showing up!</p>
              </div>
            ) : (
              <div className="dash-atrisk-list">
                {atRiskMembers.slice(0, 6).map((m) => {
                  const reason = m.days_since_last_checkin != null && m.days_since_last_checkin >= 14
                    ? `No check-in in ${m.days_since_last_checkin}d`
                    : `${m.checkins_prev} → ${m.checkins_recent} check-ins (${m.drop_pct}% drop)`
                  return (
                    <div key={m.id} className="dash-atrisk-item">
                      <div className="dash-atrisk-avatar">{m.name.charAt(0).toUpperCase()}</div>
                      <div className="dash-atrisk-info">
                        <span className="dash-atrisk-name">{m.name}</span>
                        <span className="dash-atrisk-plan">{m.plan_name || 'No plan'}</span>
                      </div>
                      <span className="dash-atrisk-reason" title={reason}>
                        {reason}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Expiring Soon */}
        <div className="dash-panel">
          <div className="dash-panel-header">
            <h3 className="dash-panel-title">Expiring This Week</h3>
            <button className="dash-panel-link" onClick={() => setShowExpiringModal(true)}>
              View all
            </button>
          </div>
          <div className="dash-panel-body">
            {expiringSoon.length === 0 ? (
              <div className="dash-panel-empty">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="var(--text-faint)" strokeWidth="1.5"/>
                  <path d="M12 7V12L15 15" stroke="var(--text-faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <p>No members expiring this week</p>
              </div>
            ) : (
              <div className="dash-expiring-list">
                {expiringSoon.slice(0, 6).map((member) => {
                  const daysLeft = member.plan_end
                    ? Math.max(0, Math.floor((new Date(member.plan_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                    : 0
                  return (
                    <div key={member.id} className="dash-expiring-item">
                      <div className="dash-expiring-info">
                        <span className="dash-expiring-name">{member.name}</span>
                        <span className="dash-expiring-plan">{member.plan_name || 'No plan'}</span>
                      </div>
                      <span className={`dash-expiring-days ${daysLeft <= 2 ? 'urgent' : ''}`}>
                        {daysLeft}d
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Check-in Detail Modal ── */}
      {showCheckinModal && (
        <div className="dash-modal-overlay" onClick={() => setShowCheckinModal(false)}>
          <div className="dash-modal" onClick={e => e.stopPropagation()}>
            <div className="dash-modal-header">
              <div>
                <h2 className="dash-modal-title">Currently Checked In</h2>
                <p className="dash-modal-subtitle">{activeCheckins.length} member{activeCheckins.length !== 1 ? 's' : ''} checked in</p>
              </div>
              <button className="dash-modal-close" onClick={() => setShowCheckinModal(false)}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M5 5L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            <div className="dash-modal-body">
              {activeCheckins.length === 0 ? (
                <div className="dash-modal-empty">
                  <p>No members are currently checked in</p>
                </div>
              ) : (
                <table className="dash-modal-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>ID</th>
                      <th>Check-in Time</th>
                      <th>Method</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeCheckins.map((checkin) => (
                      <tr key={checkin.id} className="dash-modal-row">
                        <td>
                          <div className="dash-modal-member">
                            <div className="dash-modal-avatar">
                              {checkin.name?.charAt(0).toUpperCase() || '?'}
                            </div>
                            <span>{checkin.name}</span>
                          </div>
                        </td>
                        <td>
                          <span className="mono-text">{checkin.member_code}</span>
                        </td>
                        <td>
                          <span className="mono-text">{formatTimestamp(checkin.timestamp)}</span>
                        </td>
                        <td>
                          <span className={`dash-modal-method method-${checkin.method}`}>
                            {checkin.method === 'fingerprint' ? 'Fingerprint' : 'Manual'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn btn-sm btn-checkout"
                            onClick={() => handleCheckout(checkin)}
                            disabled={checkingOut === checkin.id}
                          >
                            {checkingOut === checkin.id ? (
                              <span className="btn-spinner-sm" />
                            ) : (
                              'Check Out'
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="dash-modal-footer">
              <span className="dash-modal-footer-text">
                {activeCheckins.length} checked in • Click "Check Out" when a member leaves
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Guests Today Modal (full list) ── */}
      {showGuestsModal && (
        <div className="dash-modal-overlay" onClick={() => setShowGuestsModal(false)}>
          <div className="dash-modal" onClick={e => e.stopPropagation()}>
            <div className="dash-modal-header">
              <div>
                <h2 className="dash-modal-title">Today's Guests</h2>
                <p className="dash-modal-subtitle">{guests.length} guest/trial check-in{guests.length !== 1 ? 's' : ''} today</p>
              </div>
              <button className="dash-modal-close" onClick={() => setShowGuestsModal(false)}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M5 5L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="dash-modal-body">
              {guests.length === 0 ? (
                <div className="dash-modal-empty">
                  <p>No guests or trials checked in today</p>
                </div>
              ) : (
                <div className="dash-guest-list">
                  {guests.map((guest) => (
                    <div key={guest.id} className="dash-guest-item">
                      <div className="dash-guest-avatar">🪪</div>
                      <div className="dash-guest-info">
                        <span className="dash-guest-name">{guest.name}</span>
                        <span className="dash-guest-time">
                          {guest.type === 'trial' ? 'Trial' : 'Day Pass'}
                          {guest.phone ? ` · ${guest.phone}` : ''} · {formatTimestamp(guest.created_at)}
                        </span>
                      </div>
                      <div className="dash-guest-actions">
                        <span className={`dash-guest-badge${guest.type === 'trial' ? ' trial' : ''}`}>
                          {guest.type === 'trial' ? 'Trial' : 'Guest'}
                        </span>
                        {guest.checked_out_at ? (
                          <span className="dash-guest-checkedout">✓ Out {formatTimestamp(guest.checked_out_at)}</span>
                        ) : (
                          <button
                            className="dash-guest-checkout-btn"
                            onClick={() => handleGuestCheckout(guest)}
                            disabled={checkingOutGuestId === guest.id}
                          >
                            {checkingOutGuestId === guest.id ? 'Checking out…' : 'Check Out'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="dash-modal-footer">
              <span className="dash-modal-footer-text">{guests.length} guest{guests.length !== 1 ? 's' : ''} today • {guests.filter(g => !g.checked_out_at).length} still checked in</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Expiring This Week Modal (full list) ── */}
      {showExpiringModal && (
        <div className="dash-modal-overlay" onClick={() => setShowExpiringModal(false)}>
          <div className="dash-modal" onClick={e => e.stopPropagation()}>
            <div className="dash-modal-header">
              <div>
                <h2 className="dash-modal-title">Expiring This Week</h2>
                <p className="dash-modal-subtitle">{expiringSoon.length} member{expiringSoon.length !== 1 ? 's' : ''} expiring in the next 7 days</p>
              </div>
              <button className="dash-modal-close" onClick={() => setShowExpiringModal(false)}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M5 5L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="dash-modal-body">
              {expiringSoon.length === 0 ? (
                <div className="dash-modal-empty">
                  <p>No members expiring this week</p>
                </div>
              ) : (
                <div className="dash-expiring-list">
                  {expiringSoon.map((member) => {
                    const daysLeft = member.plan_end
                      ? Math.max(0, Math.floor((new Date(member.plan_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                      : 0
                    return (
                      <div key={member.id} className="dash-expiring-item">
                        <div className="dash-expiring-info">
                          <span className="dash-expiring-name">{member.name}</span>
                          <span className="dash-expiring-plan">{member.plan_name || 'No plan'}</span>
                        </div>
                        <span className={`dash-expiring-days ${daysLeft <= 2 ? 'urgent' : ''}`}>
                          {daysLeft}d
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="dash-modal-footer">
              <span className="dash-modal-footer-text">Renew expiring members before their plans lapse</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Expired Members Modal (full list) ── */}
      {showExpiredModal && (
        <div className="dash-modal-overlay" onClick={() => setShowExpiredModal(false)}>
          <div className="dash-modal" onClick={e => e.stopPropagation()}>
            <div className="dash-modal-header">
              <div>
                <h2 className="dash-modal-title">Expired Members</h2>
                <p className="dash-modal-subtitle">{expiredMembers.length} member{expiredMembers.length !== 1 ? 's' : ''} with lapsed plan{expiredMembers.length !== 1 ? 's' : ''}</p>
              </div>
              <button className="dash-modal-close" onClick={() => setShowExpiredModal(false)}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M5 5L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="dash-modal-body">
              {expiredMembers.length === 0 ? (
                <div className="dash-modal-empty">
                  <p>No expired members — everyone is on an active plan</p>
                </div>
              ) : (
                <div className="dash-expiring-list">
                  {expiredMembers.map((member) => {
                    const daysExpired = member.plan_end
                      ? Math.max(0, Math.floor((Date.now() - new Date(member.plan_end).getTime()) / (1000 * 60 * 60 * 24)))
                      : 0
                    return (
                      <div key={member.id} className="dash-expiring-item">
                        <div className="dash-expiring-info">
                          <span className="dash-expiring-name">{member.name}</span>
                          <span className="dash-expiring-plan">{member.plan_name || 'No plan'}</span>
                        </div>
                        <span className="dash-expiring-days urgent">
                          {daysExpired === 0 ? 'Expired today' : `Expired ${daysExpired}d ago`}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="dash-modal-footer">
              <span className="dash-modal-footer-text">Reach out to lapsed members to bring them back</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard
