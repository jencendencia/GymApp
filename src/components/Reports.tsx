import React, { useState, useEffect, useCallback } from 'react'
import './Reports.css'
import { DailyReport, MonthlyReport } from '../types/electron'

type ReportView = 'daily' | 'monthly'

function Reports() {
  const [view, setView] = useState<ReportView>('daily')

  const switchView = (v: ReportView) => {
    setShowDatePicker(false)
    setView(v)
  }

  // Daily state
  const [dailyDate, setDailyDate] = useState(() => new Date().toISOString().split('T')[0])
  const [dailyReport, setDailyReport] = useState<DailyReport | null>(null)

  // Monthly state
  const [monthYear, setMonthYear] = useState(() => new Date().toISOString().slice(0, 7))
  const [monthlyReport, setMonthlyReport] = useState<MonthlyReport | null>(null)

  const [loading, setLoading] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)

  // ── Load data ──
  const loadDaily = useCallback(async (date: string) => {
    setLoading(true)
    try {
      const data = await window.electronAPI.getDailyReport(date)
      setDailyReport(data)
    } catch (err) {
      console.error('Failed to load daily report:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMonthly = useCallback(async (ym: string) => {
    setLoading(true)
    try {
      const data = await window.electronAPI.getMonthlyReport(ym)
      setMonthlyReport(data)
    } catch (err) {
      console.error('Failed to load monthly report:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (view === 'daily') loadDaily(dailyDate)
  }, [view, dailyDate, loadDaily])

  useEffect(() => {
    if (view === 'monthly') loadMonthly(monthYear)
  }, [view, monthYear, loadMonthly])

  // ── Date navigation (compute strings locally to avoid UTC timezone shifts) ──
  const goPrevDay = () => {
    const [y, mo, d] = dailyDate.split('-').map(Number)
    const date = new Date(y, mo - 1, d - 1)
    setDailyDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`)
  }

  const goNextDay = () => {
    const [y, mo, d] = dailyDate.split('-').map(Number)
    const date = new Date(y, mo - 1, d + 1)
    const nextStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    if (nextStr <= todayStr) setDailyDate(nextStr)
  }

  const goPrevMonth = () => {
    const [y, m] = monthYear.split('-').map(Number)
    const prevM = m - 1
    const prevY = prevM < 1 ? y - 1 : y
    const adjM = prevM < 1 ? 12 : prevM
    setMonthYear(`${prevY}-${String(adjM).padStart(2, '0')}`)
  }

  const goNextMonth = () => {
    const [y, m] = monthYear.split('-').map(Number)
    const nextM = m + 1
    const nextY = nextM > 12 ? y + 1 : y
    const adjM = nextM > 12 ? 1 : nextM
    // Don't go past the current month
    const now = new Date()
    const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const candidate = `${nextY}-${String(adjM).padStart(2, '0')}`
    if (candidate <= currentYm) setMonthYear(candidate)
  }

  // ── Format helpers ──
  const fmtCurrency = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

  const fmtDateLabel = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  }

  const fmtMonthLabel = (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    const d = new Date(y, m - 1, 1)
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  const fmtTime = (ts: string) => {
    // SQLite timestamps are UTC; ensure correct parsing by converting to ISO format
    return new Date(ts.replace(' ', 'T') + 'Z').toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  // ── Breakdown bar component ──
  const BreakdownBar = ({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) => {
    const pct = total > 0 ? (amount / total) * 100 : 0
    return (
      <div className="breakdown-bar-row">
        <div className="breakdown-bar-label">
          <span>{label}</span>
          <span className="mono-text breakdown-bar-amount">{fmtCurrency(amount)}</span>
        </div>
        <div className="breakdown-bar-track">
          <div
            className="breakdown-bar-fill"
            style={{ width: `${Math.max(pct, 1)}%`, background: color }}
          />
        </div>
        <span className="breakdown-bar-pct mono-text">{pct.toFixed(1)}%</span>
      </div>
    )
  }

  // ── CSV Export ──
  const exportCSV = () => {
    if (view === 'daily' && dailyReport) {
      const rows = [
        ['Member', 'Member ID', 'Plan', 'Type', 'Method', 'Amount', 'Time'],
        ...dailyReport.transactions.map(t => [
          t.member_name || '',
          t.member_code || '',
          t.plan_name || '',
          t.type,
          t.payment_method || '',
          t.amount.toFixed(2),
          fmtTime(t.created_at),
        ]),
      ]
      const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `repcheck-daily-${dailyReport.date}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } else if (view === 'monthly' && monthlyReport) {
      // Monthly CSV: summary + plan type breakdown
      const rows = [
        ['Metric', 'Value'],
        ['Year-Month', monthlyReport.yearMonth],
        ['Total Revenue', monthlyReport.totalRevenue.toFixed(2)],
        ['Previous Month Revenue', monthlyReport.previousMonthRevenue.toFixed(2)],
        ['Change (%)', monthlyReport.percentChange.toFixed(1)],
        ['New Members', String(monthlyReport.newMembers)],
        ['Renewals', String(monthlyReport.renewals)],
        ['Churned', String(monthlyReport.churned)],
        ['Avg Revenue / Active Member', monthlyReport.avgRevenuePerMember.toFixed(2)],
        [],
        ['Plan Type', 'Count', 'Total'],
        ...monthlyReport.byPlanType.map(p => [p.plan_type, String(p.count), p.total.toFixed(2)]),
        [],
        ['Payment Method', 'Count', 'Total'],
        ...monthlyReport.byMethod.map(m => [m.payment_method, String(m.count), m.total.toFixed(2)]),
      ]
      const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `repcheck-monthly-${monthlyReport.yearMonth}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  const exportPDF = () => {
    window.print()
  }

  // ── Payment method colors ──
  const methodColors: Record<string, string> = {
    cash: '#4da8ff',
    card: '#5e5ce6',
    gcash: '#00c853',
    bank_transfer: '#ff9f0a',
    other: '#8e8e93',
  }

  const defaultMethodColor = '#4da8ff'

  // Check if date is today (for next-day disabling)
  const isToday = dailyDate === new Date().toISOString().split('T')[0]

  // ── Date picker handlers ──
  const handleDatePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      setDailyDate(e.target.value)
      setShowDatePicker(false)
    }
  }

  const handleMonthPickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      setMonthYear(e.target.value)
      setShowDatePicker(false)
    }
  }

  const handlePickerBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // Only close if the blur isn't to another child of the date-nav
    const nav = e.currentTarget.closest('.date-nav')
    if (nav && !nav.contains(e.relatedTarget as Node)) {
      setShowDatePicker(false)
    }
  }

  return (
    <div className="reports-page">
      {/* ── Topbar ── */}
      <div className="reports-topbar">
        <h1 className="display-text page-title">Reports</h1>
        <div className="topbar-actions">
          <button className="btn btn-secondary btn-sm" onClick={exportCSV} title="Export as CSV">
            📄 CSV
          </button>
          <button className="btn btn-primary btn-sm" onClick={exportPDF} title="Print / Export as PDF">
            🖨️ PDF
          </button>
        </div>
      </div>

      {/* ── View tabs + Date nav ── */}
      <div className="reports-controls">
        <div className="view-tabs">
          <button
            className={`view-tab ${view === 'daily' ? 'active' : ''}`}
            onClick={() => switchView('daily')}
          >
            Daily
          </button>
          <button
            className={`view-tab ${view === 'monthly' ? 'active' : ''}`}
            onClick={() => switchView('monthly')}
          >
            Monthly
          </button>
        </div>

        <div className="date-nav">
          {view === 'daily' ? (
            <>
              <button className="date-arrow btn-icon" onClick={goPrevDay}>◀</button>
              {showDatePicker ? (
                <input
                  type="date"
                  className="input date-picker-input"
                  value={dailyDate}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={handleDatePickerChange}
                  onBlur={handlePickerBlur}
                  onKeyDown={(e) => e.key === 'Escape' && setShowDatePicker(false)}
                  autoFocus
                />
              ) : (
                <span
                  className="date-label date-label-clickable"
                  onClick={() => setShowDatePicker(true)}
                  title="Click to pick a date"
                >
                  {fmtDateLabel(dailyDate)}
                </span>
              )}
              <button className="date-arrow btn-icon" onClick={goNextDay} disabled={isToday}>▶</button>
            </>
          ) : (
            <>
              <button className="date-arrow btn-icon" onClick={goPrevMonth}>◀</button>
              {showDatePicker ? (
                <input
                  type="month"
                  className="input date-picker-input"
                  value={monthYear}
                  max={new Date().toISOString().slice(0, 7)}
                  onChange={handleMonthPickerChange}
                  onBlur={handlePickerBlur}
                  onKeyDown={(e) => e.key === 'Escape' && setShowDatePicker(false)}
                  autoFocus
                />
              ) : (
                <span
                  className="date-label date-label-clickable"
                  onClick={() => setShowDatePicker(true)}
                  title="Click to pick a month"
                >
                  {fmtMonthLabel(monthYear)}
                </span>
              )}
              <button className="date-arrow btn-icon" onClick={goNextMonth}>▶</button>
            </>
          )}
        </div>
      </div>

      <div className="reports-scroll">
        {loading && !dailyReport && !monthlyReport ? (
          <div className="reports-loading">
            <div className="loading-spinner" />
            <p>Loading report...</p>
          </div>
        ) : (
          <>
            {/* ── Stat cards ── */}
            {view === 'daily' && dailyReport && (
              <div className="stat-cards">
                <div className="stat-card accent">
                  <span className="stat-number display-text">{fmtCurrency(dailyReport.totalRevenue)}</span>
                  <span className="stat-label">Total Revenue</span>
                  <span className="stat-sub">Today's collections</span>
                </div>
                <div className="stat-card info">
                  <span className="stat-number display-text">{dailyReport.newMembers}</span>
                  <span className="stat-label">New Enrollments</span>
                  <span className="stat-sub">Members joined today</span>
                </div>
                <div className="stat-card warn">
                  <span className="stat-number display-text">{dailyReport.renewals}</span>
                  <span className="stat-label">Renewals</span>
                  <span className="stat-sub">Plans renewed today</span>
                </div>
                <div className="stat-card danger">
                  <span className="stat-number display-text">{dailyReport.outstandingCount}</span>
                  <span className="stat-label">Outstanding</span>
                  <span className="stat-sub">Members with flagged balances</span>
                </div>
              </div>
            )}

            {view === 'monthly' && monthlyReport && (
              <div className="stat-cards">
                <div className="stat-card accent">
                  <span className="stat-number display-text">{fmtCurrency(monthlyReport.totalRevenue)}</span>
                  <span className="stat-label">Total Revenue</span>
                  <span className={`stat-sub ${monthlyReport.percentChange >= 0 ? 'positive' : 'negative'}`}>
                    {monthlyReport.percentChange >= 0 ? '▲' : '▼'} {fmtPct(monthlyReport.percentChange)} vs last month
                  </span>
                </div>
                <div className="stat-card info">
                  <span className="stat-number display-text">{monthlyReport.newMembers}</span>
                  <span className="stat-label">New Members</span>
                  <span className="stat-sub">Joined this month</span>
                </div>
                <div className="stat-card warn">
                  <span className="stat-number display-text">{monthlyReport.renewals}</span>
                  <span className="stat-label">Renewals</span>
                  <span className="stat-sub">Plans renewed this month</span>
                </div>
                <div className="stat-card danger">
                  <span className="stat-number display-text">{monthlyReport.churned}</span>
                  <span className="stat-label">Churned</span>
                  <span className="stat-sub">Members not renewed</span>
                </div>
              </div>
            )}

            {/* ── Breakdown panels ── */}
            {view === 'daily' && dailyReport && (
              <div className="breakdown-grid">
                <div className="breakdown-panel">
                  <h3 className="panel-title">By Plan Type</h3>
                  <div className="breakdown-bars">
                    {dailyReport.byType.length === 0 ? (
                      <p className="empty-breakdown">No payments today</p>
                    ) : (
                      dailyReport.byType.map(item => (
                        <BreakdownBar
                          key={item.type}
                          label={item.type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                          amount={item.total}
                          total={dailyReport.totalRevenue}
                          color="var(--accent)"
                        />
                      ))
                    )}
                  </div>
                </div>
                <div className="breakdown-panel">
                  <h3 className="panel-title">By Payment Method</h3>
                  <div className="breakdown-bars">
                    {dailyReport.byMethod.length === 0 ? (
                      <p className="empty-breakdown">No payments today</p>
                    ) : (
                      dailyReport.byMethod.map(item => (
                        <BreakdownBar
                          key={item.payment_method}
                          label={item.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                          amount={item.total}
                          total={dailyReport.totalRevenue}
                          color={methodColors[item.payment_method] || defaultMethodColor}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {view === 'monthly' && monthlyReport && (
              <div className="breakdown-grid">
                <div className="breakdown-panel">
                  <h3 className="panel-title">Weekly Revenue Trend</h3>
                  <div className="trend-chart">
                    {monthlyReport.weekly.length === 0 ? (
                      <p className="empty-breakdown">No data this month</p>
                    ) : (
                      monthlyReport.weekly.map(item => {
                        const maxVal = Math.max(...monthlyReport.weekly.map(w => w.total), 1)
                        const barH = (item.total / maxVal) * 100
                        return (
                          <div key={item.week} className="trend-bar-col">
                            <span className="trend-bar-val mono-text">{fmtCurrency(item.total)}</span>
                            <div className="trend-bar-track">
                              <div className="trend-bar-fill" style={{ height: `${barH}%` }} />
                            </div>
                            <span className="trend-bar-label">{item.week}</span>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
                <div className="breakdown-panel">
                  <h3 className="panel-title">Revenue by Plan Type</h3>
                  <div className="breakdown-bars">
                    {monthlyReport.byPlanType.length === 0 ? (
                      <p className="empty-breakdown">No data this month</p>
                    ) : (
                      monthlyReport.byPlanType.map(item => (
                        <BreakdownBar
                          key={item.plan_type}
                          label={item.plan_type === 'no_plan' ? 'No Plan' : item.plan_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                          amount={item.total}
                          total={monthlyReport.totalRevenue}
                          color="var(--accent)"
                        />
                      ))
                    )}
                  </div>
                  <div className="panel-divider" />
                  <div className="panel-meta">
                    <div className="meta-row">
                      <span>Payment Methods</span>
                      <div className="meta-methods">
                        {monthlyReport.byMethod.map(m => (
                          <span key={m.payment_method} className="method-chip">
                            {m.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} {fmtCurrency(m.total)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="meta-row">
                      <span>Outstanding Balances</span>
                      <span className="mono-text danger">{fmtCurrency(monthlyReport.outstanding.reduce((s, o) => s + o.balance, 0))}</span>
                    </div>
                    <div className="meta-row">
                      <span>Avg Revenue / Active Member</span>
                      <span className="mono-text">{fmtCurrency(monthlyReport.avgRevenuePerMember)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Outstanding Balances Panel (daily) ── */}
            {view === 'daily' && dailyReport && dailyReport.outstanding.length > 0 && (
              <div className="outstanding-section">
                <div className="outstanding-header">
                  <span className="outstanding-icon">⚠️</span>
                  <h3 className="panel-title">Outstanding Balances — Checked in Today</h3>
                  <span className="outstanding-count mono-text">{dailyReport.outstandingCount} member{dailyReport.outstandingCount !== 1 ? 's' : ''}</span>
                </div>
                <div className="outstanding-list">
                  {dailyReport.outstanding.map(m => (
                    <div key={m.id} className="outstanding-item">
                      <div className="outstanding-info">
                        <span className="outstanding-name">{m.name}</span>
                        <span className="mono-text outstanding-code">{m.member_id}</span>
                      </div>
                      <span className="mono-text outstanding-balance danger">{fmtCurrency(m.balance)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Itemized table (daily only) ── */}
            {view === 'daily' && dailyReport && dailyReport.transactions.length > 0 && (
              <div className="report-table-section">
                <h3 className="panel-title">Transaction Details</h3>
                <div className="report-table-container">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>ID</th>
                        <th>Plan</th>
                        <th>Type</th>
                        <th>Method</th>
                        <th>Amount</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyReport.transactions.map(t => {
                        // Flag rows from members with outstanding balances
                        const isFlagged = dailyReport.outstanding.some(o => o.id === t.member_id)
                        return (
                          <tr key={t.id} className={isFlagged ? 'row-flagged' : ''}>
                            <td className="td-member">
                              <span className="member-name">{t.member_name || 'Unknown'}</span>
                            </td>
                            <td className="mono-text td-id">{t.member_code || ''}</td>
                            <td className="td-plan">{t.plan_name || '—'}</td>
                            <td>
                              <span className={`type-tag type-${t.type}`}>
                                {t.type === 'new_plan' ? 'New' : t.type === 'renewal' ? 'Renewal' : 'Pack'}
                              </span>
                            </td>
                            <td className="td-method">{t.payment_method || 'cash'}</td>
                            <td className="mono-text td-amount">{fmtCurrency(t.amount)}</td>
                            <td className="mono-text td-time">{fmtTime(t.created_at)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default Reports
