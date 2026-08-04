import React from 'react'
import { DailyReport } from '../types/electron'
import { formatMoney } from '../lib/format'

interface KioskExecReportProps {
  adminName: string
  report: DailyReport | null
  loading: boolean
  error: string | null
  onClose: () => void
}

/**
 * Daily Kiosk Executive Report (P2 6.9).
 *
 * Shown directly on the kiosk terminal when an ADMIN fingerprint is scanned
 * instead of a member check-in. Mirrors the Reports page daily report — revenue
 * stats, payment-method + plan-type breakdowns, outstanding balances and the
 * transaction list — with a one-tap dismiss back to standard check-in mode.
 */
function KioskExecReport({ adminName, report, loading, error, onClose }: KioskExecReportProps) {
  const fmtCurrency = formatMoney

  const fmtDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }

  const fmtTime = (ts: string) => {
    return new Date(ts.replace(' ', 'T') + 'Z').toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const typeLabel = (t: string) => (t === 'new_plan' ? 'New' : t === 'renewal' ? 'Renewal' : 'Pack')

  const BreakdownPanel = ({ title, items, total }: { title: string; items: { key: string; total: number }[]; total: number }) => (
    <div className="kiosk-exec-panel">
      <h3 className="kiosk-exec-panel-title">{title}</h3>
      {items.length === 0 ? (
        <p className="kiosk-exec-empty">No payments today</p>
      ) : (
        items.map(item => {
          const pct = total > 0 ? (item.total / total) * 100 : 0
          return (
            <div key={item.key} className="kiosk-exec-bar-row">
              <span className="kiosk-exec-bar-label">
                {item.key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </span>
              <div className="kiosk-exec-bar-track">
                <div className="kiosk-exec-bar-fill" style={{ width: `${Math.max(pct, 2)}%` }} />
              </div>
              <span className="kiosk-exec-bar-amt mono-text">{fmtCurrency(item.total)}</span>
            </div>
          )
        })
      )}
    </div>
  )

  return (
    <div className="kiosk-exec-overlay">
      <div className="kiosk-exec-modal">
        <div className="kiosk-exec-header">
          <div className="kiosk-exec-header-text">
            <span className="kiosk-exec-kicker">Daily Kiosk Executive Report</span>
            <h2 className="display-text kiosk-exec-title">📊 Today's Business</h2>
            <span className="kiosk-exec-meta">
              {report ? fmtDate(report.date) : ''}
              {adminName ? ` · Opened by ${adminName}` : ''}
            </span>
          </div>
          <button className="btn-icon kiosk-exec-close" onClick={onClose} title="Close report">✕</button>
        </div>

        <div className="kiosk-exec-body">
          {loading && (
            <div className="kiosk-exec-loading">
              <div className="spinner" />
              <p>Loading today's report…</p>
            </div>
          )}
          {!loading && error && <div className="kiosk-exec-error">⚠️ {error}</div>}

          {report && !loading && (
            <>
              {/* Stat cards */}
              <div className="kiosk-exec-stats">
                <div className="kiosk-exec-stat accent">
                  <span className="kiosk-exec-stat-num display-text">{fmtCurrency(report.totalRevenue)}</span>
                  <span className="kiosk-exec-stat-label">Total Revenue</span>
                </div>
                <div className="kiosk-exec-stat info">
                  <span className="kiosk-exec-stat-num display-text">{report.newMembers}</span>
                  <span className="kiosk-exec-stat-label">New Enrollments</span>
                </div>
                <div className="kiosk-exec-stat warn">
                  <span className="kiosk-exec-stat-num display-text">{report.renewals}</span>
                  <span className="kiosk-exec-stat-label">Renewals</span>
                </div>
                <div className="kiosk-exec-stat danger">
                  <span className="kiosk-exec-stat-num display-text">{report.outstandingCount}</span>
                  <span className="kiosk-exec-stat-label">Outstanding</span>
                </div>
              </div>

              {/* Breakdowns */}
              <div className="kiosk-exec-grid">
                <BreakdownPanel title="By Payment Method" items={report.byMethod.map(m => ({ key: m.payment_method || 'cash', total: m.total }))} total={report.totalRevenue} />
                <BreakdownPanel title="By Plan Type" items={report.byType.map(t => ({ key: t.type, total: t.total }))} total={report.totalRevenue} />
              </div>

              {/* Outstanding balances */}
              {report.outstanding.length > 0 && (
                <div className="kiosk-exec-panel kiosk-exec-outstanding">
                  <h3 className="kiosk-exec-panel-title kiosk-exec-danger-title">⚠️ Outstanding Balances</h3>
                  <div className="kiosk-exec-out-list">
                    {report.outstanding.slice(0, 8).map(o => (
                      <div key={o.id} className="kiosk-exec-out-item">
                        <span className="kiosk-exec-out-name">{o.name}</span>
                        <span className="mono-text kiosk-exec-out-code">{o.member_id}</span>
                        <span className="kiosk-exec-out-amt mono-text">{fmtCurrency(o.balance)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Transaction list */}
              {report.transactions.length > 0 && (
                <div className="kiosk-exec-panel">
                  <h3 className="kiosk-exec-panel-title">Transactions</h3>
                  <div className="kiosk-exec-table-wrap">
                    <table className="kiosk-exec-table">
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Plan</th>
                          <th>Type</th>
                          <th>Method</th>
                          <th>Amount</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.transactions.slice(0, 14).map(t => (
                          <tr key={t.id}>
                            <td className="kiosk-exec-td-member">{t.member_name || 'Unknown'}</td>
                            <td>{t.plan_name || '—'}</td>
                            <td><span className={`kiosk-exec-type type-${t.type}`}>{typeLabel(t.type)}</span></td>
                            <td>{(t.payment_method || 'cash').replace(/_/g, ' ')}</td>
                            <td className="mono-text">{fmtCurrency(t.amount)}</td>
                            <td className="mono-text">{fmtTime(t.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="kiosk-exec-footer">
          <span className="kiosk-exec-live-hint">
            <span className="kiosk-scan-dot active" />
            Scanner is live — members can still check in · scan again to refresh
          </span>
          <button className="btn btn-primary kiosk-exec-dismiss" onClick={onClose}>
            ✔ Return to Check-in
          </button>
        </div>
      </div>
    </div>
  )
}

export default KioskExecReport
