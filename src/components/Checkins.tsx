import React, { useState, useEffect } from 'react'
import './Checkins.css'
import { Checkin } from '../types/electron'
import { todayLocal } from '../lib/dates'

function Checkins() {
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [exporting, setExporting] = useState(false)
  const [selectedDate, setSelectedDate] = useState(todayLocal())
  const [filterMethod, setFilterMethod] = useState<'all' | 'fingerprint' | 'manual'>('all')
  // P1 4.2: pagination state
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const PAGE_SIZE = 100

  useEffect(() => {
    loadCheckins()
  }, [selectedDate])

  const loadCheckins = async () => {
    try {
      setPage(0)
      const [data, count] = await Promise.all([
        window.electronAPI.getCheckins(selectedDate, { offset: 0, limit: PAGE_SIZE }),
        window.electronAPI.getCheckinsCount(selectedDate),
      ])
      setCheckins(data)
      setTotalCount(count)
    } catch (error) {
      console.error('Failed to load checkins:', error)
    }
  }

  const loadMore = async () => {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const next = page + 1
      const data = await window.electronAPI.getCheckins(selectedDate, { offset: next * PAGE_SIZE, limit: PAGE_SIZE })
      setCheckins(prev => [...prev, ...data])
      setPage(next)
    } catch (error) {
      console.error('Failed to load more checkins:', error)
    } finally {
      setLoadingMore(false)
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

  // Styled Excel export (.xls with HTML formatting) — same approach as the Reports page
  const handleExportExcel = () => {
    setExporting(true)
    try {
      const esc = (s: string | undefined | null): string => {
        if (!s) return ''
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      }
      const fmtTs = (ts: string) => new Date(ts.replace(' ', 'T') + 'Z').toLocaleString()
      const statusClass = (s: string) => s === 'success' ? 'tag-success' : s === 'failed' ? 'tag-failed' : 'tag-override'
      const methodClass = (m: string) => m === 'fingerprint' ? 'tag-fp' : 'tag-manual'
      const style = `<style>
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #222; padding: 20px; }
        h1 { font-size: 16pt; font-weight: 700; text-align: center; margin: 0 0 4px; color: #1a1a2e; }
        .subtitle { text-align: center; font-size: 10pt; color: #666; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
        th { padding: 6px 8px; text-align: left; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #fff; background: #1a1a2e; border: 1px solid #1a1a2e; }
        td { padding: 5px 8px; border: 1px solid #dde1e6; vertical-align: middle; font-size: 9pt; }
        tr:nth-child(even) { background: #f8f9fb; }
        .mono { font-family: 'Consolas', 'Courier New', monospace; font-size: 8.5pt; }
        .tag { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 7pt; font-weight: 700; }
        .tag-success { background: #e8f5e9; color: #2e7d32; }
        .tag-failed { background: #fdecea; color: #c62828; }
        .tag-override { background: #fff3e0; color: #e65100; }
        .tag-fp { background: #e3f2fd; color: #1565c0; }
        .tag-manual { background: #f3e5f5; color: #6a1b9a; }
        .footer { text-align: center; font-size: 8pt; color: #999; margin-top: 16px; border-top: 1px solid #dde1e6; padding-top: 8px; }
      </style>`
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>checkins-${selectedDate}</title>${style}</head><body>
<h1>Check-in History</h1>
<div class="subtitle">${new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
<table>
  <thead><tr><th>Member ID</th><th>Name</th><th>Method</th><th>Status</th><th>Confidence</th><th>Checked In</th><th>Checked Out</th></tr></thead>
  <tbody>
    ${filteredCheckins.map(c => `<tr>
      <td class="mono">${esc(c.member_code || '')}</td>
      <td>${esc(c.name || '')}</td>
      <td><span class="tag ${methodClass(c.method)}">${esc(c.method)}</span></td>
      <td><span class="tag ${statusClass(c.status)}">${esc(c.status)}</span></td>
      <td class="mono">${c.match_confidence != null ? ((c.match_confidence * 100).toFixed(1) + '%') : ''}</td>
      <td class="mono">${c.timestamp ? esc(fmtTs(c.timestamp)) : ''}</td>
      <td class="mono">${c.checked_out_at ? esc(fmtTs(c.checked_out_at)) : ''}</td>
    </tr>`).join('')}
  </tbody>
</table>
<div class="footer">Generated ${new Date().toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
</body></html>`
      const encoder = new TextEncoder()
      const bom = new Uint8Array([0xEF, 0xBB, 0xBF])
      const blob = new Blob([bom, encoder.encode(html)], { type: 'application/vnd.ms-excel;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `checkins-${selectedDate}.xls`
      // Delay the download briefly so the "Exporting..." indicator is visible on screen
      setTimeout(() => {
        a.click()
        URL.revokeObjectURL(url)
        setExporting(false)
      }, 400)
    } catch (error) {
      console.error('Export failed:', error)
      setExporting(false)
    }
  }

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
          <button
            className="btn btn-secondary"
            onClick={handleExportExcel}
            disabled={exporting || filteredCheckins.length === 0}
            title={filteredCheckins.length === 0 ? 'No check-ins to export for this date' : 'Export check-ins as a styled Excel file'}
          >
            {exporting ? '⏳ Exporting...' : '⬇ Export Excel'}
          </button>
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
          <div className="empty-state checkins-empty-state">
            <span className="empty-state-icon">📋</span>
            <p className="empty-state-title">No check-in history</p>
            <p className="empty-state-hint">There are no check-ins recorded for {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}. Pick another date or check in a member to see their entry here.</p>
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

      {/* P1 4.2: load-more pagination */}
      {filteredCheckins.length > 0 && filteredCheckins.length < totalCount && (
        <div className="checkins-load-more">
          <button className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading...' : `Load more (${filteredCheckins.length} of ${totalCount})`}
          </button>
        </div>
      )}
    </div>
  )
}

export default Checkins
