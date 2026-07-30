import React from 'react'
import './RightPanel.css'
import { TodayStats, Checkin, Member } from '../types/electron'

interface RightPanelProps {
  stats: TodayStats
  recentCheckins: Checkin[]
  expiringSoon: Member[]
  currentTime: Date
}

function RightPanel({ stats, recentCheckins, expiringSoon, currentTime }: RightPanelProps) {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatTimestamp = (timestamp: string) => {
    // SQLite timestamps are UTC; ensure correct parsing
    const date = new Date(timestamp.replace(' ', 'T') + 'Z')
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <aside className="right-panel">
      {/* Clock */}
      <div className="panel-clock">
        <span className="clock-time mono-text">{formatTime(currentTime)}</span>
        <span className="clock-date">{formatDate(currentTime)}</span>
      </div>

      {/* Today's Stats */}
      <section className="panel-section">
        <h3 className="section-title">Today's Stats</h3>
        <div className="stats-grid">
          <div className="stat-box">
            <span className="stat-number display-text">{stats.totalCheckins}</span>
            <span className="stat-label">Check-ins</span>
          </div>
          <div className="stat-box">
            <span className="stat-number display-text accent">{stats.activeMembers}</span>
            <span className="stat-label">Active</span>
          </div>
          <div className="stat-box">
            <span className="stat-number display-text danger">{stats.expiredMembers}</span>
            <span className="stat-label">Expired</span>
          </div>
          <div className="stat-box">
            <span className="stat-number display-text warn">{stats.expiringThisWeek}</span>
            <span className="stat-label">Expiring</span>
          </div>
        </div>
      </section>

      {/* Recent Check-ins */}
      <section className="panel-section">
        <h3 className="section-title">Recent Check-ins</h3>
        <div className="checkin-list">
          {recentCheckins.length === 0 ? (
            <p className="empty-message">No check-ins today</p>
          ) : (
            recentCheckins.slice(0, 8).map((checkin) => (
              <div key={checkin.id} className="checkin-item">
                <div className="checkin-avatar">
                  {checkin.name?.charAt(0).toUpperCase() || '?'}
                </div>
                <div className="checkin-info">
                  <span className="checkin-name">{checkin.name}</span>
                  <span className="checkin-time mono-text">
                    {formatTimestamp(checkin.timestamp)}
                  </span>
                </div>
                <div className={`checkin-dot ${checkin.status}`} />
              </div>
            ))
          )}
        </div>
      </section>

      {/* Expiring Soon */}
      <section className="panel-section">
        <h3 className="section-title">Expiring Soon</h3>
        <div className="expiring-list">
          {expiringSoon.length === 0 ? (
            <p className="empty-message">No members expiring soon</p>
          ) : (
            expiringSoon.slice(0, 5).map((member) => {
              const daysLeft = member.plan_end
                ? Math.max(0, Math.floor((new Date(member.plan_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                : 0
              
              return (
                <div key={member.id} className="expiring-item">
                  <div className="expiring-avatar">
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="expiring-info">
                    <span className="expiring-name">{member.name}</span>
                    <span className="expiring-plan">{member.plan_name || 'No plan'}</span>
                  </div>
                  <span className={`expiring-days ${daysLeft <= 2 ? 'urgent' : ''}`}>
                    {daysLeft}d left
                  </span>
                </div>
              )
            })
          )}
        </div>
      </section>
    </aside>
  )
}

export default RightPanel
