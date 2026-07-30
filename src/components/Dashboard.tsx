import React, { useState, useEffect, useCallback } from 'react'
import './Dashboard.css'
import { ActiveCheckin, TodayStats, Member } from '../types/electron'

interface DashboardProps {
  stats: TodayStats
  recentCheckins: ActiveCheckin[]
  expiringSoon: Member[]
  onRefresh: () => void
}

function Dashboard({ stats, recentCheckins, expiringSoon, onRefresh }: DashboardProps) {
  const [activeCheckins, setActiveCheckins] = useState<ActiveCheckin[]>([])
  const [showCheckinModal, setShowCheckinModal] = useState(false)
  const [checkingOut, setCheckingOut] = useState<number | null>(null)

  const loadActiveCheckins = useCallback(async () => {
    try {
      const data = await window.electronAPI.getActiveCheckins()
      setActiveCheckins(data)
    } catch (error) {
      console.error('Failed to load active checkins:', error)
    }
  }, [])

  useEffect(() => {
    loadActiveCheckins()
  }, [loadActiveCheckins])

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

        {/* Expiring This Week */}
        <div className="dash-stat-card">
          <div className="dash-stat-icon expiring-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M12 7V12L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="dash-stat-body">
            <span className="dash-stat-number display-text warn">{stats.expiringThisWeek}</span>
            <span className="dash-stat-label">Expiring Soon</span>
          </div>
        </div>

        {/* Expired Members */}
        <div className="dash-stat-card">
          <div className="dash-stat-icon expired-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M9 9L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M15 9L9 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="dash-stat-body">
            <span className="dash-stat-number display-text danger">{stats.expiredMembers}</span>
            <span className="dash-stat-label">Expired</span>
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
                  <div key={checkin.id} className="dash-active-item">
                    <div className="dash-active-avatar">
                      {checkin.member_photo ? (
                        <img src={checkin.member_photo} alt="" />
                      ) : (
                        checkin.name?.charAt(0).toUpperCase() || '?'
                      )}
                    </div>
                    <div className="dash-active-info">
                      <span className="dash-active-name">{checkin.name}</span>
                      <span className="dash-active-time">{formatTimestamp(checkin.timestamp)}</span>
                    </div>
                    <span className="dash-active-dot" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Expiring Soon */}
        <div className="dash-panel">
          <div className="dash-panel-header">
            <h3 className="dash-panel-title">Expiring This Week</h3>
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
    </div>
  )
}

export default Dashboard
