import React, { useState, useEffect } from 'react'
import './Checkins.css'
import { Checkin } from '../types/electron'

function Checkins() {
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  )
  const [filterMethod, setFilterMethod] = useState<'all' | 'fingerprint' | 'manual'>('all')

  useEffect(() => {
    loadCheckins()
  }, [selectedDate])

  const loadCheckins = async () => {
    try {
      const data = await window.electronAPI.getCheckins(selectedDate)
      setCheckins(data)
    } catch (error) {
      console.error('Failed to load checkins:', error)
    }
  }

  const filteredCheckins = checkins.filter(
    (c) => filterMethod === 'all' || c.method === filterMethod
  )

  const formatTime = (timestamp: string) => {
    // SQLite timestamps are UTC; ensure correct parsing
    return new Date(timestamp.replace(' ', 'T') + 'Z').toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp.replace(' ', 'T') + 'Z').toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getSuccessCount = () => checkins.filter((c) => c.status === 'success').length
  const getFailedCount = () => checkins.filter((c) => c.status === 'failed').length
  const getOverrideCount = () => checkins.filter((c) => c.status === 'override').length

  return (
    <div className="checkins-page">
      <div className="page-header">
        <h1 className="display-text page-title">Check-in History</h1>
        <div className="header-actions">
          <input
            type="date"
            className="input date-input"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
          <select
            className="input filter-select"
            value={filterMethod}
            onChange={(e) => setFilterMethod(e.target.value as any)}
          >
            <option value="all">All Methods</option>
            <option value="fingerprint">Fingerprint</option>
            <option value="manual">Manual</option>
          </select>
        </div>
      </div>

      <div className="checkins-stats">
        <div className="stat-pill">
          <span className="stat-dot success" />
          <span>{getSuccessCount()} Successful</span>
        </div>
        <div className="stat-pill">
          <span className="stat-dot failed" />
          <span>{getFailedCount()} Failed</span>
        </div>
        <div className="stat-pill">
          <span className="stat-dot override" />
          <span>{getOverrideCount()} Override</span>
        </div>
      </div>

      <div className="checkins-list-container">
        {filteredCheckins.length === 0 ? (
          <div className="empty-state">
            <p>No check-ins found for this date</p>
          </div>
        ) : (
          <div className="checkins-list">
            {filteredCheckins.map((checkin) => (
              <div key={checkin.id} className="checkin-entry">
                <div className="checkin-avatar">
                  {checkin.member_photo ? (
                    <img src={checkin.member_photo} alt={checkin.name || ''} className="checkin-photo" />
                  ) : (
                    checkin.name?.charAt(0).toUpperCase() || '?'
                  )}
                </div>
                <div className="checkin-details">
                  <div className="checkin-main">
                    <span className="checkin-member-name">{checkin.name}</span>
                    <span className="mono-text checkin-member-id">{checkin.member_code}</span>
                  </div>
                  <div className="checkin-meta">
                    <span className="checkin-method">{checkin.method}</span>
                    {checkin.match_confidence && (
                      <span className="checkin-confidence mono-text">
                        {(checkin.match_confidence * 100).toFixed(1)}%
                      </span>
                    )}
                    <span className="checkin-timestamp mono-text">
                      {formatTimestamp(checkin.timestamp)}
                    </span>
                  </div>
                </div>
                <div className={`checkin-status-badge ${checkin.status}`}>
                  {checkin.status}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Checkins
