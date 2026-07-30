import React, { useState, useEffect, useMemo } from 'react'
import './ActivityLog.css'
import { ActivityLog as ActivityLogType } from '../types/electron'

type ActionFilter = 'all' | 'checkin' | 'member' | 'coach' | 'plan' | 'settings'

const ACTION_CATEGORIES: { key: ActionFilter; label: string }[] = [
  { key: 'all', label: 'All Actions' },
  { key: 'checkin', label: 'Check-ins' },
  { key: 'member', label: 'Members' },
  { key: 'coach', label: 'Coaches' },
  { key: 'plan', label: 'Plans' },
  { key: 'settings', label: 'Settings' },
]

const ACTION_META: Record<string, { label: string; icon: string; category: ActionFilter; verb: string }> = {
  checkin_fingerprint: { label: 'Fingerprint Check-in', icon: '🖐️', category: 'checkin', verb: 'checked in via fingerprint' },
  checkin_manual: { label: 'Manual Check-in', icon: '✍️', category: 'checkin', verb: 'checked in manually' },
  checkin_override: { label: 'Override Entry', icon: '🔓', category: 'checkin', verb: 'overrode check-in' },
  create_member: { label: 'Member Created', icon: '➕', category: 'member', verb: 'created member' },
  update_member: { label: 'Member Updated', icon: '✏️', category: 'member', verb: 'updated member' },
  delete_member: { label: 'Member Deleted', icon: '🗑️', category: 'member', verb: 'deleted member' },
  register_fingerprint: { label: 'Fingerprint Registered', icon: '🖐️', category: 'member', verb: 'registered fingerprint for' },
  assign_plan: { label: 'Plan Assigned', icon: '📋', category: 'member', verb: 'assigned plan to' },
  create_coach: { label: 'Coach Created', icon: '➕', category: 'coach', verb: 'created coach' },
  update_coach: { label: 'Coach Updated', icon: '✏️', category: 'coach', verb: 'updated coach' },
  delete_coach: { label: 'Coach Deleted', icon: '🗑️', category: 'coach', verb: 'deleted coach' },
  record_fee_payment: { label: 'Fee Payment', icon: '💰', category: 'coach', verb: 'recorded fee payment' },
  create_plan: { label: 'Plan Created', icon: '➕', category: 'plan', verb: 'created plan' },
  update_plan: { label: 'Plan Updated', icon: '✏️', category: 'plan', verb: 'updated plan' },
  delete_plan: { label: 'Plan Deleted', icon: '🗑️', category: 'plan', verb: 'deleted plan' },
  update_settings: { label: 'Settings Updated', icon: '⚙️', category: 'settings', verb: 'updated settings' },
  upload_logo: { label: 'Logo Uploaded', icon: '🖼️', category: 'settings', verb: 'uploaded logo' },
  remove_logo: { label: 'Logo Removed', icon: '🗑️', category: 'settings', verb: 'removed logo' },
  create_backup: { label: 'Backup Created', icon: '📦', category: 'settings', verb: 'created backup' },
  restore_backup: { label: 'Backup Restored', icon: '🔄', category: 'settings', verb: 'restored backup' },
}

function ActivityLog() {
  const [logs, setLogs] = useState<ActivityLogType[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<ActionFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDate, setSelectedDate] = useState('')

  useEffect(() => {
    loadLogs()
  }, [])

  const loadLogs = async () => {
    setLoading(true)
    try {
      const data = await window.electronAPI.getActivityLogs(200)
      setLogs(data)
    } catch (error) {
      console.error('Failed to load activity logs:', error)
    } finally {
      setLoading(false)
    }
  }

  // Group logs by date for timeline display
  const groupedLogs = useMemo(() => {
    let filtered = logs

    // Filter by category
    if (filter !== 'all') {
      const categoryActions = Object.entries(ACTION_META)
        .filter(([, meta]) => meta.category === filter)
        .map(([action]) => action)
      filtered = filtered.filter(log => categoryActions.includes(log.action))
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(log => {
        const meta = ACTION_META[log.action]
        const details = parseDetails(log.details) || {}
        const name = details.member_name || details.name || details.coach_name || ''
        return name.toLowerCase().includes(q) || meta?.label.toLowerCase().includes(q) || log.action.includes(q)
      })
    }

    // Filter by date
    if (selectedDate) {
      filtered = filtered.filter(log => {
        const logDate = new Date(log.created_at.replace(' ', 'T') + 'Z').toISOString().split('T')[0]
        return logDate === selectedDate
      })
    }

    // Group by date
    const groups: Record<string, ActivityLogType[]> = {}
    for (const log of filtered) {
      const date = new Date(log.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
      if (!groups[date]) groups[date] = []
      groups[date].push(log)
    }
    return groups
  }, [logs, filter, searchQuery, selectedDate])

  const formatTime = (timestamp: string) => {
    return new Date(timestamp.replace(' ', 'T') + 'Z').toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const getActionMeta = (action: string) => {
    return ACTION_META[action] || { label: action, icon: '📝', category: 'all' as ActionFilter, verb: action }
  }

  const getCategoryClass = (category: string) => {
    switch (category) {
      case 'checkin': return 'cat-checkin'
      case 'member': return 'cat-member'
      case 'coach': return 'cat-coach'
      case 'plan': return 'cat-plan'
      case 'settings': return 'cat-settings'
      default: return 'cat-default'
    }
  }

  const parseDetails = (details?: string) => {
    if (!details) return null
    try {
      return JSON.parse(details)
    } catch {
      return null
    }
  }

  const getEntitySummary = (log: ActivityLogType): string => {
    const details = parseDetails(log.details)
    if (!details) return ''

    switch (log.action) {
      case 'checkin_fingerprint':
      case 'checkin_manual':
      case 'checkin_override':
        return details.member_name || ''
      case 'create_member':
      case 'update_member':
      case 'delete_member':
        return details.name || ''
      case 'register_fingerprint':
        return details.member_name || ''
      case 'assign_plan':
        return `${details.member_name || ''} → ${details.plan_name || ''}`
      case 'create_coach':
      case 'update_coach':
      case 'delete_coach':
        return details.name || ''
      case 'record_fee_payment':
        return `${details.member_name || ''} — ₱${details.amount || 0}`
      case 'create_plan':
      case 'update_plan':
      case 'delete_plan':
        return details.name || ''
      case 'create_backup':
        return details.path || ''
      default:
        return JSON.stringify(details)
    }
  }

  // (getDateGroups removed — use Object.entries(groupedLogs) directly)

  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="activitylog-page">
      <div className="page-header">
        <h1 className="display-text page-title">Activity Log</h1>
        <div className="header-actions">
          <input
            type="text"
            className="input search-input"
            placeholder="Search by name or action..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <input
            type="date"
            className="input date-input"
            value={selectedDate}
            max={today}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
          <button className="btn btn-secondary" onClick={loadLogs} title="Refresh logs">
            ⟳
          </button>
        </div>
      </div>

      {/* Category filter pills */}
      <div className="filter-pills">
        {ACTION_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            className={`filter-pill ${getCategoryClass(cat.key)} ${filter === cat.key ? 'active' : ''}`}
            onClick={() => setFilter(cat.key)}
          >
            {cat.label}
            {cat.key !== 'all' && (
              <span className="pill-count">
                {logs.filter(l => ACTION_META[l.action]?.category === cat.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="timeline-container">
        {loading ? (
          <div className="timeline-loading">
            <div className="loading-spinner" />
            <p>Loading activity logs...</p>
          </div>
        ) : Object.entries(groupedLogs).length === 0 ? (
          <div className="timeline-empty">
            <div className="empty-icon">📜</div>
            <h3>No activity found</h3>
            <p>Try adjusting your filters or check back after performing some actions.</p>
          </div>
        ) : (
          <div className="timeline">
            {Object.entries(groupedLogs).map(([date, dateLogs]) => (
              <div key={date} className="timeline-day-group">
                <div className="timeline-date-header">
                  <div className="date-dot" />
                  <span className="date-label">{date}</span>
                  <span className="date-count mono-text">{dateLogs.length} event{dateLogs.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="timeline-entries">
                  {dateLogs.map((log, i) => {
                    const meta = getActionMeta(log.action)
                    const details = parseDetails(log.details)
                    const summary = getEntitySummary(log)
                    const categoryClass = getCategoryClass(meta.category)

                    return (
                      <div
                        key={log.id}
                        className={`timeline-entry ${categoryClass}`}
                        style={{ animationDelay: `${i * 30}ms` }}
                      >
                        <div className="entry-timeline-line">
                          <div className="entry-dot" />
                        </div>
                        <div className="entry-card">
                          <div className="entry-header">
                            <div className="entry-action-badge">
                              <span className="action-icon">{meta.icon}</span>
                              <span className="action-label">{meta.label}</span>
                            </div>
                            <div className="entry-meta">
                              <span className="entry-time mono-text">{formatTime(log.created_at)}</span>
                              {details && details.method && (
                                <span className="entry-method">{details.method}</span>
                              )}
                            </div>
                          </div>
                          <div className="entry-body">
                            {summary && (
                              <span className="entry-summary">{summary}</span>
                            )}
                            {details && details.changes && (
                              <div className="entry-changes">
                                {Object.entries(details.changes).map(([key, val]) => (
                                  <span key={key} className="change-chip">
                                    {key}: <strong>{String(val)}</strong>
                                  </span>
                                ))}
                              </div>
                            )}
                            {log.action === 'record_fee_payment' && details && (
                              <div className="entry-amount">
                                <span className="amount-badge">₱{Number(details.amount).toFixed(2)}</span>
                              </div>
                            )}
                          </div>
                          <div className="entry-footer">
                            <span className="entry-user">{log.user}</span>
                            {log.entity_id && (
                              <span className="entry-entity-id mono-text">
                                ID: {log.entity_id}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ActivityLog
