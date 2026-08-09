import React, { useState, useEffect, useCallback } from 'react'
import './Reports.css'
import { DailyReport, MonthlyReport, Member, StaffUser, ReportCoachSummary } from '../types/electron'
import { todayLocal, todayLocalOf } from '../lib/dates'
import { getCurrencySymbol } from '../lib/format'

interface EmailResult {
  success: boolean
  filePath?: string
  message?: string
}

type ReportView = 'daily' | 'monthly'

interface ReportsProps {
  appName?: string
  currentUser?: StaffUser | null
}

function Reports({ appName = 'REPCHECK', currentUser }: ReportsProps) {
  // Sanitized filename prefix derived from the app name
  const filePrefix = appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'repcheck'
  const [view, setView] = useState<ReportView>('daily')

  // Who generated the report (shown in the footer of every export)
  const generatedBy = currentUser
    ? `${currentUser.role === 'admin' ? 'Admin' : 'Staff'} · ${currentUser.display_name || currentUser.username}`
    : 'System'

  const switchView = (v: ReportView) => {
    setShowDatePicker(false)
    setView(v)
  }

  // Daily state
  const [dailyDate, setDailyDate] = useState(() => todayLocal())
  const [dailyReport, setDailyReport] = useState<DailyReport | null>(null)

  // Monthly state
  const [monthYear, setMonthYear] = useState(() => new Date().toISOString().slice(0, 7))
  const [monthlyReport, setMonthlyReport] = useState<MonthlyReport | null>(null)

  const [loading, setLoading] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailRecipient, setEmailRecipient] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailResult, setEmailResult] = useState<EmailResult | null>(null)
const [reminderState, setReminderState] = useState<{ sending: boolean; result: string | null; error: string | null }>({ sending: false, result: null, error: null })

  // New members modal (clickable "New Enrollments"/"New Members" stat cards)
  const [newMembersOpen, setNewMembersOpen] = useState(false)
  const [newMembersList, setNewMembersList] = useState<Member[]>([])
  const [newMembersLoading, setNewMembersLoading] = useState(false)
  const [newMembersRange, setNewMembersRange] = useState<{ from: string; to: string; label: string } | null>(null)

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
    const nextStr = todayLocalOf(date)
    if (nextStr <= todayLocal()) setDailyDate(nextStr)
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
  const fmtCurrency = (n: number) => `${getCurrencySymbol()}${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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

  // ── SVG line chart (weekly revenue trend) — no external chart library needed ──
  const RevenueLineChart = ({ data }: { data: { week: string; count: number; total: number }[] }) => {
    if (!data || data.length === 0) return <p className="empty-breakdown">No data this month</p>

    const W = 520
    const H = 210
    const PAD_L = 62
    const PAD_R = 14
    const PAD_T = 16
    const PAD_B = 34
    const maxVal = Math.max(...data.map(d => d.total), 1)
    const innerW = W - PAD_L - PAD_R
    const innerH = H - PAD_T - PAD_B
    const stepX = data.length > 1 ? innerW / (data.length - 1) : 0
    const pts = data.map((d, i) => ({
      x: PAD_L + i * stepX,
      y: PAD_T + innerH - (d.total / maxVal) * innerH,
      ...d,
    }))
    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    const lastX = pts.length > 0 ? pts[pts.length - 1].x : PAD_L
    const areaPath = `${linePath} L${lastX.toFixed(1)},${(PAD_T + innerH).toFixed(1)} L${PAD_L},${(PAD_T + innerH).toFixed(1)} Z`
    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(t => ({
      y: PAD_T + innerH - t * innerH,
      label: fmtCurrency(maxVal * t),
    }))

    return (
      <div className="trend-line-chart">
        <svg viewBox={`0 0 ${W} ${H}`} className="trend-line-svg" preserveAspectRatio="none">
          <defs>
            <linearGradient id="lineAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent, #c6ff3d)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--accent, #c6ff3d)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {gridLines.map((g, i) => (
            <g key={i}>
              <line x1={PAD_L} y1={g.y.toFixed(1)} x2={W - PAD_R} y2={g.y.toFixed(1)} className="line-grid" />
              <text x={PAD_L - 8} y={(g.y + 4).toFixed(1)} textAnchor="end" className="line-grid-label">{g.label}</text>
            </g>
          ))}
          <path d={areaPath} fill="url(#lineAreaGrad)" className="line-area" />
          <path d={linePath} fill="none" className="line-stroke" />
          {pts.map((p, i) => (
            <g key={i}>
              <circle cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r="4.5" className="line-dot" />
              <title>{`${p.week}: ${fmtCurrency(p.total)}`}</title>
              <text x={p.x.toFixed(1)} y={H - 14} textAnchor="middle" className="line-x-label">{p.week}</text>
            </g>
          ))}
        </svg>
      </div>
    )
  }

  // ── Coach Report section (embedded in daily/monthly reports) ──
  // Shows a per-coach summary table: members, active members, period revenue
  // and all-time fee collections. Replaces the former separate Coach tab.
  const CoachReportSection = ({ coaches, periodLabel }: { coaches: ReportCoachSummary[]; periodLabel: string }) => {
    if (!coaches || coaches.length === 0) return null
    const totalMembers = coaches.reduce((s, c) => s + (c.totalMembers || 0), 0)
    const totalActive = coaches.reduce((s, c) => s + (c.activeMembers || 0), 0)
    const totalPeriod = coaches.reduce((s, c) => s + (c.periodCollected || 0), 0)
    const totalAll = coaches.reduce((s, c) => s + (c.totalCollected || 0), 0)
    return (
      <div className="report-table-section">
        <h3 className="panel-title">Coach Report</h3>
        <div className="report-table-container">
          <table className="report-table">
            <thead>
              <tr>
                <th>Coach</th>
                <th>Specialty</th>
                <th>Members</th>
                <th>Active</th>
                <th>{periodLabel}</th>
                <th>Total Collected</th>
              </tr>
            </thead>
            <tbody>
              {coaches.map(c => (
                <tr key={c.coach_id}>
                  <td>{c.coach_name}</td>
                  <td className="td-plan">{c.specialty || '—'}</td>
                  <td className="mono-text">{c.totalMembers}</td>
                  <td className="mono-text">{c.activeMembers}</td>
                  <td className="mono-text td-amount">{fmtCurrency(c.periodCollected)}</td>
                  <td className="mono-text td-amount">{fmtCurrency(c.totalCollected)}</td>
                </tr>
              ))}
              <tr className="row-total">
                <td><strong>Total</strong></td>
                <td></td>
                <td className="mono-text">{totalMembers}</td>
                <td className="mono-text">{totalActive}</td>
                <td className="mono-text td-amount">{fmtCurrency(totalPeriod)}</td>
                <td className="mono-text td-amount">{fmtCurrency(totalAll)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── Styled Excel Export (.xls with HTML formatting) ──
  // Uses HTML table with inline CSS saved as .xls
  // Excel opens HTML .xls files with full styling (colors, fonts, borders)
  const exportExcel = () => {
    const now = new Date().toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    // Build a styled HTML table from data
    // Cells starting with '<' are treated as raw HTML (not escaped)
    const style = `<style>
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #222; padding: 20px; }
      h1 { font-size: 16pt; font-weight: 700; text-align: center; margin: 0 0 4px; color: #1a1a2e; }
      .subtitle { text-align: center; font-size: 10pt; color: #666; margin-bottom: 16px; }
      .section-title { font-size: 11pt; font-weight: 700; color: #1a1a2e; margin: 16px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #1a1a2e; }

      /* Stat cards — table layout for Excel compatibility */
      .stat-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; table-layout: fixed; }
      .stat-table td { width: 25%; padding: 10px 12px; border: 1px solid #dde1e6; text-align: center; background: #f5f7fa; vertical-align: top; }
      .stat-num { font-size: 18pt; font-weight: 700; line-height: 1.1; }
      .stat-green { color: #2e7d32; } .stat-blue { color: #1565c0; } .stat-orange { color: #e65100; } .stat-red { color: #c62828; }
      .stat-lbl { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-top: 2px; }
      .stat-sub { font-size: 7.5pt; color: #888; }
      .stat-up { color: #2e7d32; } .stat-down { color: #c62828; }

      /* Tables */
      table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
      th { padding: 6px 8px; text-align: left; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #fff; background: #1a1a2e; border: 1px solid #1a1a2e; }
      td { padding: 5px 8px; border: 1px solid #dde1e6; vertical-align: middle; font-size: 9pt; }
      tr:nth-child(even) { background: #f8f9fb; }
      tr.total-row td { font-weight: 700; border-top: 2px solid #1a1a2e; background: #eef0f4; }
      tr.flagged td { background: #fff5f5; }
      .mono { font-family: 'Consolas', 'Courier New', monospace; font-size: 8.5pt; }
      .amt { text-align: right; font-weight: 600; }
      .danger { color: #c62828; font-weight: 700; }

      .tag { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 7pt; font-weight: 700; }
      .tag-new { background: #e8f5e9; color: #2e7d32; }
      .tag-renewal { background: #e3f2fd; color: #1565c0; }
      .tag-pack { background: #fff3e0; color: #e65100; }

      .footer { text-align: center; font-size: 8pt; color: #999; margin-top: 16px; border-top: 1px solid #dde1e6; padding-top: 8px; }
      .summary-table td { border: none; padding: 4px 8px; font-size: 9pt; }
      .summary-table td:last-child { text-align: right; font-weight: 600; }
    </style>`

    const esc = (s: string | undefined | null): string => {
      if (!s) return ''
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }

    // ── Helper: stat cards HTML (table layout for reliable Excel rendering) ──
    const buildStatCards = (items: { num: string; label: string; sub: string; cls: string }[]) =>
      `<table class="stat-table"><tr>${items.map(i =>
        `<td><div class="stat-num ${i.cls}">${esc(i.num)}</div><div class="stat-lbl">${i.label}</div><div class="stat-sub">${i.sub}</div></td>`
      ).join('')}</tr></table>`

    // ── Helper: data table HTML ──
    // Cells starting with '<' are raw HTML (e.g. type tags, styled names); others are auto-escaped
    const buildTable = (headers: string[], rows: string[][], totalRow?: string[]) => {
      let html = '<table><thead><tr>'
      for (const h of headers) html += `<th>${esc(h)}</th>`
      html += '</tr></thead><tbody>'
      for (const row of rows) {
        html += '<tr>'
        for (const cell of row) {
          if (cell.length > 0 && cell[0] === '<') {
            html += `<td>${cell}</td>`
          } else {
            html += `<td>${esc(cell)}</td>`
          }
        }
        html += '</tr>'
      }
      if (totalRow) {
        html += '<tr class="total-row">'
        for (const cell of totalRow) {
          if (cell.length > 0 && cell[0] === '<') {
            html += `<td>${cell}</td>`
          } else {
            html += `<td>${esc(cell)}</td>`
          }
        }
        html += '</tr>'
      }
      html += '</tbody></table>'
      return html
    }

    const typeTag = (type: string): string => {
      const tagClass = type === 'new_plan' ? 'tag-new' : type === 'renewal' ? 'tag-renewal' : 'tag-pack'
      const label = type === 'new_plan' ? 'New' : type === 'renewal' ? 'Renewal' : 'Pack'
      return `<span class="tag ${tagClass}">${label}</span>`
    }

    // ── Helper: Coach Report section HTML (shared by daily + monthly) ──
    const coachTableHtml = (coaches: ReportCoachSummary[], periodLabel: string) => {
      if (!coaches || coaches.length === 0) return ''
      const totalMembers = coaches.reduce((s, c) => s + (c.totalMembers || 0), 0)
      const totalActive = coaches.reduce((s, c) => s + (c.activeMembers || 0), 0)
      const totalPeriod = coaches.reduce((s, c) => s + (c.periodCollected || 0), 0)
      const totalAll = coaches.reduce((s, c) => s + (c.totalCollected || 0), 0)
      return `<div class="section-title">Coach Report</div>\n${buildTable(
        ['Coach', 'Specialty', 'Members', 'Active', periodLabel, 'Total Collected'],
        coaches.map(c => [c.coach_name, c.specialty || '—', String(c.totalMembers), String(c.activeMembers), fmtCurrency(c.periodCollected), fmtCurrency(c.totalCollected)]),
        ['Total', '', String(totalMembers), String(totalActive), fmtCurrency(totalPeriod), fmtCurrency(totalAll)]
      )}`
    }

    let html: string
    const daily = dailyReport
    const monthly = monthlyReport

    if (view === 'daily' && daily) {
      html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${filePrefix}-daily-${daily.date}</title>${style}</head><body>

<h1>${esc(appName)} — Daily Sales Report</h1>
<div class="subtitle">${fmtDateLabel(daily.date)}</div>

${buildStatCards([
  { num: fmtCurrency(daily.totalRevenue), label: 'TOTAL REVENUE', sub: "Today's collections", cls: 'stat-green' },
  { num: String(daily.newMembers), label: 'NEW ENROLLMENTS', sub: 'Members joined today', cls: 'stat-blue' },
  { num: String(daily.renewals), label: 'RENEWALS', sub: 'Plans renewed today', cls: 'stat-orange' },
  { num: String(daily.outstandingCount), label: 'OUTSTANDING', sub: 'Members with flagged balances', cls: 'stat-red' },
])}

<div class="section-title">Revenue by Plan Type</div>
${buildTable(
  ['Type', 'Transactions', 'Total'],
  daily.byType.map(i => [i.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), String(i.count), fmtCurrency(i.total)]),
  ['Total', String(daily.byType.reduce((s, i) => s + i.count, 0)), fmtCurrency(daily.totalRevenue)]
)}

<div class="section-title">Revenue by Payment Method</div>
${buildTable(
  ['Method', 'Transactions', 'Total'],
  daily.byMethod.map(i => [i.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), String(i.count), fmtCurrency(i.total)]),
  ['Total', String(daily.byMethod.reduce((s, i) => s + i.count, 0)), fmtCurrency(daily.totalRevenue)]
)}

${daily.outstanding.length > 0 ? `
<div class="section-title" style="color:#c62828;border-color:#c62828;">Outstanding Balances</div>
${buildTable(
  ['Member', 'Member ID', 'Balance'],
  daily.outstanding.map(o => [o.name, o.member_id, fmtCurrency(o.balance)]),
  ['Total Outstanding', '', fmtCurrency(daily.outstanding.reduce((s, o) => s + o.balance, 0))]
)}` : ''}

<div class="section-title">Transaction Details</div>
${buildTable(
  ['Member', 'Member ID', 'Plan', 'Type', 'Method', 'Status', 'Amount', 'Time'],
  daily.transactions.map(t => {
    const flagged = daily.outstanding.some(o => o.id === t.member_id)
    return [
      `<span${flagged ? ' style="color:#c62828;font-weight:600;"' : ''}>${esc(t.member_name || 'Unknown')}</span>`,
      t.member_code || '',
      t.plan_name || '—',
      typeTag(t.type),
      (t.payment_method || 'cash').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      `<span class="tag tag-status">${esc(t.status || 'completed')}</span>`,
      fmtCurrency(t.amount),
      fmtTime(t.created_at),
    ]
  }),
  ['TOTAL', '', '', '', '', '', fmtCurrency(daily.totalRevenue), '']
)}

${coachTableHtml(daily.coaches, 'Collected Today')}

<div class="footer">Report generated ${now} — ${esc(appName)} — Generated by ${esc(generatedBy)}</div>
</body></html>`
    } else if (view === 'monthly' && monthly) {
      html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${filePrefix}-monthly-${monthly.yearMonth}</title>${style}</head><body>

<h1>${esc(appName)} — Monthly Sales Report</h1>
<div class="subtitle">${fmtMonthLabel(monthly.yearMonth)}</div>

${buildStatCards([
  { num: fmtCurrency(monthly.totalRevenue), label: 'TOTAL REVENUE', sub: `${monthly.percentChange >= 0 ? '▲' : '▼'} ${fmtPct(monthly.percentChange)} vs last month`, cls: 'stat-green' },
  { num: String(monthly.newMembers), label: 'NEW MEMBERS', sub: 'Joined this month', cls: 'stat-blue' },
  { num: String(monthly.renewals), label: 'RENEWALS', sub: 'Plans renewed this month', cls: 'stat-orange' },
  { num: String(monthly.churned), label: 'CHURNED', sub: 'Members not renewed', cls: 'stat-red' },
])}

${monthly.weekly.length > 0 ? `
<div class="section-title">Weekly Revenue Trend</div>
${buildTable(
  ['Week', 'Transactions', 'Total'],
  monthly.weekly.map(w => [w.week, String(w.count), fmtCurrency(w.total)]),
  ['Total', String(monthly.weekly.reduce((s, w) => s + w.count, 0)), fmtCurrency(monthly.totalRevenue)]
)}` : ''}

<div class="section-title">Revenue by Plan Type</div>
${buildTable(
  ['Plan Type', 'Count', 'Total'],
  monthly.byPlanType.map(i => [i.plan_type === 'no_plan' ? 'No Plan' : i.plan_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), String(i.count), fmtCurrency(i.total)]),
  ['Total', String(monthly.byPlanType.reduce((s, i) => s + i.count, 0)), fmtCurrency(monthly.totalRevenue)]
)}

<div class="section-title">Revenue by Payment Method</div>
${buildTable(
  ['Method', 'Count', 'Total'],
  monthly.byMethod.map(i => [i.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), String(i.count), fmtCurrency(i.total)]),
  ['Total', String(monthly.byMethod.reduce((s, i) => s + i.count, 0)), fmtCurrency(monthly.byMethod.reduce((s, i) => s + i.total, 0))]
)}

${monthly.outstanding.length > 0 ? `
<div class="section-title" style="color:#c62828;border-color:#c62828;">Outstanding Balances (as of Month-End)</div>
${buildTable(
  ['Member', 'Member ID', 'Balance'],
  monthly.outstanding.map(o => [o.name, o.member_id, fmtCurrency(o.balance)]),
  ['Total Outstanding', '', fmtCurrency(monthly.outstanding.reduce((s, o) => s + o.balance, 0))]
)}` : ''}

<div class="section-title">Summary</div>
<table class="summary-table">
<tr><td><strong>Payment Methods</strong></td><td>${monthly.byMethod.map(m => `${m.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}: ${fmtCurrency(m.total)}`).join('; ')}</td></tr>
<tr><td><strong>Total Outstanding</strong></td><td class="danger">${fmtCurrency(monthly.outstanding.reduce((s, o) => s + o.balance, 0))}</td></tr>
<tr><td><strong>Avg Revenue / Active Member</strong></td><td>${fmtCurrency(monthly.avgRevenuePerMember)}</td></tr>
<tr><td><strong>Active Member Count</strong></td><td>${monthly.activeMemberCount}</td></tr>
</table>

${coachTableHtml(monthly.coaches, 'Collected This Month')}

<div class="footer">Report generated ${now} — ${esc(appName)} — Generated by ${esc(generatedBy)}</div>
</body></html>`
    } else {
      return
    }

    // Encode HTML as UTF-8 bytes + BOM for proper encoding
    const encoder = new TextEncoder()
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF])
    const utf8Bytes = encoder.encode(html)
    const blob = new Blob([bom, utf8Bytes], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const filename = view === 'daily' && dailyReport
      ? `${filePrefix}-daily-${dailyReport.date}.xls`
      : `${filePrefix}-monthly-${monthlyReport!.yearMonth}.xls`
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  // Simple HTML escaping for safe interpolation into standalone print document
  const esc = (s: string | undefined | null): string => {
    if (!s) return ''
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  const exportPDF = () => {
    const r = view === 'daily' ? dailyReport : monthlyReport
    if (!r) return

    const isDaily = view === 'daily'
    const dr = dailyReport as DailyReport
    const mr = monthlyReport as MonthlyReport
    const title = isDaily
      ? `Daily Sales Report — ${fmtDateLabel(dr.date)}`
      : `Monthly Sales Report — ${fmtMonthLabel(mr.yearMonth)}`

    // ── Build stat cards HTML ──
    const statCards = isDaily
      ? `
        <div class="stat-row">
          <div class="stat-card">
            <div class="stat-num accent">${esc(fmtCurrency(dr.totalRevenue))}</div>
            <div class="stat-lbl">Total Revenue</div>
            <div class="stat-sub">Today's collections</div>
          </div>
          <div class="stat-card">
            <div class="stat-num info">${dr.newMembers}</div>
            <div class="stat-lbl">New Enrollments</div>
            <div class="stat-sub">Members joined today</div>
          </div>
          <div class="stat-card">
            <div class="stat-num warn">${dr.renewals}</div>
            <div class="stat-lbl">Renewals</div>
            <div class="stat-sub">Plans renewed today</div>
          </div>
          <div class="stat-card">
            <div class="stat-num danger">${dr.outstandingCount}</div>
            <div class="stat-lbl">Outstanding</div>
            <div class="stat-sub">Members with flagged balances</div>
          </div>
        </div>`
      : `
        <div class="stat-row">
          <div class="stat-card">
            <div class="stat-num accent">${esc(fmtCurrency(mr.totalRevenue))}</div>
            <div class="stat-lbl">Total Revenue</div>
            <div class="stat-sub ${mr.percentChange >= 0 ? 'positive' : 'negative'}">${mr.percentChange >= 0 ? '▲' : '▼'} ${esc(fmtPct(mr.percentChange))} vs last month</div>
          </div>
          <div class="stat-card">
            <div class="stat-num info">${mr.newMembers}</div>
            <div class="stat-lbl">New Members</div>
            <div class="stat-sub">Joined this month</div>
          </div>
          <div class="stat-card">
            <div class="stat-num warn">${mr.renewals}</div>
            <div class="stat-lbl">Renewals</div>
            <div class="stat-sub">Plans renewed this month</div>
          </div>
          <div class="stat-card">
            <div class="stat-num danger">${mr.churned}</div>
            <div class="stat-lbl">Churned</div>
            <div class="stat-sub">Members not renewed</div>
          </div>
        </div>`

    // ── Build breakdown bars HTML ──
    const buildBreakdown = (items: { label: string; amount: number; total: number }[]) =>
      items.map(item => {
        const pct = item.total > 0 ? (item.amount / item.total) * 100 : 0
        return `
          <div class="bb-row">
            <div class="bb-label">
              <span class="bb-name">${esc(item.label)}</span>
              <span class="bb-amount">${esc(fmtCurrency(item.amount))}</span>
            </div>
            <div class="bb-track"><div class="bb-fill" style="width:${Math.max(pct, 1)}%"></div></div>
            <span class="bb-pct">${pct.toFixed(1)}%</span>
          </div>`
      }).join('')

    // Daily breakdowns
    const planBreakdown = isDaily
      ? buildBreakdown(dr.byType.map(i => ({ label: i.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), amount: i.total, total: dr.totalRevenue })))
      : buildBreakdown(mr.byPlanType.map(i => ({
        label: i.plan_type === 'no_plan' ? 'No Plan' : i.plan_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        amount: i.total,
        total: mr.totalRevenue,
      })))

    const methodBreakdown = isDaily
      ? buildBreakdown(dr.byMethod.map(i => ({ label: i.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), amount: i.total, total: dr.totalRevenue })))
      : buildBreakdown(mr.byMethod.map(i => ({ label: i.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), amount: i.total, total: mr.totalRevenue })))

    // ── Weekly trend (monthly only) ──
    const weeklyTrend = !isDaily && mr.weekly.length > 0
      ? `<div class="section">
          <h2 class="section-title">Weekly Revenue Trend</h2>
          <table class="data-table">
            <thead><tr><th>Week</th><th>Transactions</th><th>Total</th></tr></thead>
            <tbody>
              ${mr.weekly.map(w => `<tr><td>${w.week}</td><td>${w.count}</td><td class="mono">${fmtCurrency(w.total)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>`
      : ''

    // ── Outstanding (daily) ──
    const outstandingSection = isDaily && dr.outstanding.length > 0
      ? `<div class="section outstanding">
          <h2 class="section-title">Outstanding Balances — Checked in Today (${dr.outstandingCount} member${dr.outstandingCount !== 1 ? 's' : ''})</h2>
          <table class="data-table">
            <thead><tr><th>Member</th><th>ID</th><th>Balance</th></tr></thead>
            <tbody>
              ${dr.outstanding.map(o => `<tr><td>${o.name}</td><td class="mono">${o.member_id}</td><td class="mono danger">${fmtCurrency(o.balance)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>`
      : ''

    // ── Outstanding (monthly) ──
    const monthlyOutstanding = !isDaily && mr.outstanding.length > 0
      ? `<div class="section outstanding">
          <h2 class="section-title">Outstanding Balances as of Month-End</h2>
          <table class="data-table">
            <thead><tr><th>Member</th><th>ID</th><th>Balance</th></tr></thead>
            <tbody>
              ${mr.outstanding.map(o => `<tr><td>${o.name}</td><td class="mono">${o.member_id}</td><td class="mono danger">${fmtCurrency(o.balance)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>`
      : ''

    // ── Transaction details table (daily only) ──
    const transactionTable = isDaily && dr.transactions.length > 0
      ? `<div class="section">
          <h2 class="section-title">Transaction Details</h2>
          <table class="data-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>ID</th>
                <th>Plan</th>
                <th>Type</th>
                <th>Method</th>
                <th class="amt">Amount</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              ${dr.transactions.map(t => {
                const flagged = dr.outstanding.some(o => o.id === t.member_id)
                const typeLabel = t.type === 'new_plan' ? 'New' : t.type === 'renewal' ? 'Renewal' : 'Pack'
                return `<tr class="${flagged ? 'flagged' : ''}">
                  <td>${t.member_name || 'Unknown'}</td>
                  <td class="mono">${t.member_code || ''}</td>
                  <td>${t.plan_name || '—'}</td>
                  <td><span class="tag tag-${t.type}">${typeLabel}</span></td>
                  <td>${(t.payment_method || 'cash').replace(/_/g, ' ')}</td>
                  <td class="mono amt">${fmtCurrency(t.amount)}</td>
                  <td class="mono">${fmtTime(t.created_at)}</td>
                </tr>`
              }).join('')}
            </tbody>
          </table>
        </div>`
      : ''

    // ── Coach Report section (embedded, daily + monthly) ──
    const coachSectionPdf = (() => {
      const coaches = isDaily ? dr.coaches : mr.coaches
      if (!coaches || coaches.length === 0) return ''
      const totalMembers = coaches.reduce((s, c) => s + (c.totalMembers || 0), 0)
      const totalActive = coaches.reduce((s, c) => s + (c.activeMembers || 0), 0)
      const totalPeriod = coaches.reduce((s, c) => s + (c.periodCollected || 0), 0)
      const totalAll = coaches.reduce((s, c) => s + (c.totalCollected || 0), 0)
      const rows = coaches.map(c =>
        `<tr><td>${c.coach_name}</td><td>${esc(c.specialty || '—')}</td><td class="mono">${c.totalMembers}</td><td class="mono">${c.activeMembers}</td><td class="mono amt">${fmtCurrency(c.periodCollected)}</td><td class="mono amt">${fmtCurrency(c.totalCollected)}</td></tr>`
      ).join('')
      return `<div class="section">
          <h2 class="section-title">Coach Report</h2>
          <table class="data-table">
            <thead><tr><th>Coach</th><th>Specialty</th><th>Members</th><th>Active</th><th class="amt">${isDaily ? 'Collected Today' : 'Collected This Month'}</th><th class="amt">Total Collected</th></tr></thead>
            <tbody>
              ${rows}
              <tr><td><strong>Total</strong></td><td></td><td class="mono"><strong>${totalMembers}</strong></td><td class="mono"><strong>${totalActive}</strong></td><td class="mono amt"><strong>${fmtCurrency(totalPeriod)}</strong></td><td class="mono amt"><strong>${fmtCurrency(totalAll)}</strong></td></tr>
            </tbody>
          </table>
        </div>`
    })()

    // ── Monthly summary meta ──
    const monthlyMeta = !isDaily
      ? `<div class="section">
          <h2 class="section-title">Summary</h2>
          <table class="data-table">
            <tbody>
              <tr><td><strong>Payment Methods</strong></td><td>${mr.byMethod.map(m => `${m.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}: ${fmtCurrency(m.total)}`).join(', ')}</td></tr>
              <tr><td><strong>Total Outstanding</strong></td><td class="mono danger">${fmtCurrency(mr.outstanding.reduce((s, o) => s + o.balance, 0))}</td></tr>
              <tr><td><strong>Avg Revenue / Active Member</strong></td><td class="mono">${fmtCurrency(mr.avgRevenuePerMember)}</td></tr>
              <tr><td><strong>Active Member Count</strong></td><td class="mono">${mr.activeMemberCount}</td></tr>
            </tbody>
          </table>
        </div>`
      : ''

    // ── Build the PDF filename for Save-as-PDF — matches CSV naming ──
    const pdfFilename = isDaily
      ? `${filePrefix}-daily-${dr.date}`
      : `${filePrefix}-monthly-${mr.yearMonth}`

    // ── Assemble full HTML ──
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${pdfFilename}</title>
<style>
  @page { size: A4 portrait; margin: 15mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', -apple-system, Helvetica, Arial, sans-serif;
    font-size: 11pt;
    color: #222;
    line-height: 1.5;
    padding: 0;
  }
  .report-header {
    text-align: center;
    padding-bottom: 10px;
    margin-bottom: 16px;
    border-bottom: 2px solid #333;
  }
  .report-header h1 { font-size: 18pt; font-weight: 700; letter-spacing: -0.3px; }
  .report-header .date { font-size: 10pt; color: #666; margin-top: 4px; }

  .section {
    margin-bottom: 16px;
    page-break-inside: avoid;
  }
  .section-title {
    font-size: 12pt;
    font-weight: 700;
    color: #333;
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid #ccc;
  }

  /* Stat cards */
  .stat-row {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    page-break-inside: avoid;
  }
  .stat-card {
    flex: 1;
    background: #f5f5f5;
    border: 1px solid #ddd;
    border-radius: 6px;
    padding: 10px 12px;
  }
  .stat-num { font-size: 20pt; font-weight: 700; line-height: 1.1; }
  .stat-num.accent { color: #2e7d32; }
  .stat-num.info { color: #1565c0; }
  .stat-num.warn { color: #e65100; }
  .stat-num.danger { color: #c62828; }
  .stat-lbl { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-top: 2px; }
  .stat-sub { font-size: 7.5pt; color: #888; }
  .stat-sub.positive { color: #2e7d32; }
  .stat-sub.negative { color: #c62828; }

  /* Breakdown bars */
  .bb-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .bb-label { min-width: 100px; flex-shrink: 0; }
  .bb-name { display: block; font-size: 10pt; font-weight: 500; }
  .bb-amount { display: block; font-size: 8pt; color: #666; }
  .bb-track {
    flex: 1;
    height: 12px;
    background: #e0e0e0;
    border-radius: 6px;
    overflow: hidden;
  }
  .bb-fill { height: 100%; background: #555; border-radius: 6px; min-width: 2px; }
  .bb-pct { font-size: 8pt; color: #666; min-width: 40px; text-align: right; font-family: 'Consolas', monospace; }

  /* Tables */
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9pt;
    page-break-inside: auto;
  }
  .data-table thead { display: table-header-group; }
  .data-table tbody { page-break-inside: auto; }
  .data-table tr { page-break-inside: avoid; }
  .data-table th {
    padding: 6px 8px;
    text-align: left;
    font-size: 7pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #555;
    border-bottom: 2px solid #ccc;
    background: #f0f0f0;
  }
  .data-table td {
    padding: 5px 8px;
    border-bottom: 1px solid #e0e0e0;
    vertical-align: middle;
  }
  .data-table .mono { font-family: 'Consolas', 'Courier New', monospace; font-size: 8.5pt; }
  .data-table .amt { text-align: right; }
  .data-table .danger { color: #c62828; font-weight: 700; }
  .data-table tr.flagged { background: #fff5f5; }

  .tag {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 7pt;
    font-weight: 700;
    text-transform: uppercase;
    border: 1px solid #ccc;
    background: #f0f0f0;
    color: #333;
  }

  .outstanding .section-title { color: #c62828; }

  .footer {
    text-align: center;
    font-size: 8pt;
    color: #999;
    margin-top: 24px;
    padding-top: 8px;
    border-top: 1px solid #ddd;
  }
</style>
</head>
<body>
  <div class="report-header">
    <h1>${title}</h1>
    <div class="date">Generated ${new Date().toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
  </div>

  ${statCards}

  <div class="section">
    <h2 class="section-title">Revenue by Plan Type</h2>
    <div class="bb-list">${planBreakdown}</div>
  </div>

  <div class="section">
    <h2 class="section-title">Revenue by Payment Method</h2>
    <div class="bb-list">${methodBreakdown}</div>
  </div>

  ${weeklyTrend}
  ${monthlyMeta}
  ${outstandingSection}
  ${monthlyOutstanding}
  ${transactionTable}
  ${coachSectionPdf}

  <div class="footer">${esc(appName)} — ${title} — Generated by ${esc(generatedBy)}</div>
</body>
</html>`

    const printWin = window.open('', '_blank', 'width=800,height=600')
    if (!printWin) {
      alert('Please allow pop-ups to print the report.')
      return
    }
    printWin.document.write(html)
    printWin.document.close()
    printWin.focus()
    printWin.print()
  }

  // ── Payment method colors ──
  const methodColors: Record<string, string> = {
    cash: '#4da8ff',
    card: '#5e5ce6',
    gcash: '#00c853',
    maya: '#00b2e3',
    bank_transfer: '#ff9f0a',
    other: '#8e8e93',
  }

  const defaultMethodColor = '#4da8ff'

  // Check if date is today (for next-day disabling)
  const isToday = dailyDate === todayLocal()

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

  // ── Renewal reminder emails ──
  const handleSendRenewalReminders = async () => {
    setReminderState({ sending: true, result: null, error: null })
    try {
      const res = await window.electronAPI.sendRenewalReminders()
      if (res.success) {
        setReminderState({
          sending: false,
          result: `Renewal reminders sent to ${res.sent} member${res.sent === 1 ? '' : 's'}${res.skipped > 0 ? ` (${res.skipped} skipped — already sent or no email)` : ''}.`,
          error: null,
        })
      } else {
        setReminderState({ sending: false, result: null, error: res.message || 'Failed to send reminders. Check SMTP settings.' })
      }
    } catch (error: any) {
      setReminderState({ sending: false, result: null, error: error.message })
    }
  }



// ── Open the "New Members" modal (clickable stat card) ──
  const openNewMembersModal = async (range: { from: string; to: string; label: string }) => {
    setNewMembersRange(range)
    setNewMembersOpen(true)
    setNewMembersList([])
    setNewMembersLoading(true)
    try {
      const members = await window.electronAPI.getNewMembers({ from: range.from, to: range.to })
      setNewMembersList(members)
    } catch (error: any) {
      console.error('Failed to load new members:', error)
    } finally {
      setNewMembersLoading(false)
    }
  }

  const closeNewMembersModal = () => {
    setNewMembersOpen(false)
    setNewMembersList([])
    setNewMembersRange(null)
  }

  // ── Printable receipt (opens a print window) ──
  const handlePrintReceipt = (t: { id: number; member_name?: string; member_code?: string; plan_name?: string; type: string; payment_method?: string; amount: number; created_at: string }) => {
    const escReceipt = (s: string | undefined | null) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt ${t.id}</title>
<style>
  body { font-family: 'Courier New', monospace; width: 300px; margin: 0 auto; color: #000; font-size: 12px; }
  .center { text-align: center; }
  .line { border-top: 1px dashed #000; margin: 8px 0; }
  table { width: 100%; }
  td { padding: 2px 0; }
  .amt { text-align: right; font-weight: bold; }
  h1 { font-size: 16px; margin: 8px 0 0; }
</style></head><body>
  <div class="center">
    <h1>${escReceipt(appName)}</h1>
    <div>Payment Receipt</div>
    <div>Receipt #${t.id}</div>
    <div>${new Date(t.created_at.replace(' ', 'T') + 'Z').toLocaleString()}</div>
  </div>
  <div class="line"></div>
  <table>
    <tr><td>Member</td><td>${escReceipt(t.member_name || 'Unknown')}</td></tr>
    <tr><td>Member ID</td><td>${escReceipt(t.member_code || '')}</td></tr>
    <tr><td>Plan</td><td>${escReceipt(t.plan_name || '—')}</td></tr>
    <tr><td>Type</td><td>${escReceipt(t.type.replace(/_/g, ' '))}</td></tr>
    <tr><td>Method</td><td>${escReceipt((t.payment_method || 'cash').replace(/_/g, ' '))}</td></tr>
    <tr><td class="amt">TOTAL</td><td class="amt">${getCurrencySymbol()}${t.amount.toFixed(2)}</td></tr>
  </table>
  <div class="line"></div>
  <div class="center">Thank you!</div>
  <script>window.onload = () => window.print()</script>
</body></html>`
    const win = window.open('', '_blank', 'width=360,height=500')
    if (!win) {
      alert('Please allow pop-ups to print the receipt.')
      return
    }
    win.document.write(html)
    win.document.close()
    win.focus()
  }

  // Open the email modal, pre-filling the default owner email from Settings if set
  const openEmailModal = async () => {
    setEmailRecipient('')
    setEmailResult(null)
    setShowEmailModal(true)
    try {
      const owner = await window.electronAPI.getSetting('reportOwnerEmail')
      if (owner) setEmailRecipient(owner)
    } catch { /* ignore */ }
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
          <button className="btn btn-secondary btn-sm" onClick={exportExcel} title="Export as styled Excel spreadsheet">
            📊 XLS
          </button>
          <button className="btn btn-primary btn-sm" onClick={exportPDF} title="Print / Export as PDF">
            🖨️ PDF
          </button>
          <button className="btn btn-sm" onClick={handleSendRenewalReminders} disabled={reminderState.sending} title="Email renewal reminders to members expiring within 7 days" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            {reminderState.sending ? 'Sending...' : '📧 Reminders'}
          </button>
          <button className="btn btn-sm" onClick={() => { openEmailModal() }} title="Send report via email" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            📧 Email
          </button>
        </div>
      </div>

      {reminderState.result && (
        <div className="reports-reminder-banner success">✅ {reminderState.result}</div>
      )}
      {reminderState.error && (
        <div className="reports-reminder-banner error">❌ {reminderState.error}</div>
      )}

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
                  max={todayLocal()}
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
<div
                  className="stat-card info stat-card-clickable"
                  title="View members enrolled today"
                  onClick={() => openNewMembersModal({ from: dailyDate, to: dailyDate, label: fmtDateLabel(dailyDate) })}
                >
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
<div
                  className="stat-card info stat-card-clickable"
                  title="View members enrolled this month"
                  onClick={() => {
                    const [y, m] = monthYear.split('-').map(Number)
                    const lastDay = new Date(y, m, 0).getDate()
                    const from = `${monthYear}-01`
                    const to = `${monthYear}-${String(lastDay).padStart(2, '0')}`
                    openNewMembersModal({ from, to, label: fmtMonthLabel(monthYear) })
                  }}
                >
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
                  <RevenueLineChart data={monthlyReport.weekly} />
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

            {/* ── Coach Report section (monthly) ── */}
            {view === 'monthly' && monthlyReport && (
              <CoachReportSection coaches={monthlyReport.coaches} periodLabel="Collected This Month" />
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

            {/* ── Coach Report section (daily) ── */}
            {view === 'daily' && dailyReport && (
              <CoachReportSection coaches={dailyReport.coaches} periodLabel="Collected Today" />
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
                        <th>Status</th>
                        <th>Amount</th>
                        <th>Time</th>
                        <th></th>
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
                            <td>
                              <span className={`pay-status ${t.status || 'completed'}`}>
                                {t.status || 'completed'}
                              </span>
                            </td>
                            <td className="mono-text td-amount">{fmtCurrency(t.amount)}</td>
                            <td className="mono-text td-time">{fmtTime(t.created_at)}</td>
                            <td className="td-receipt" style={{ textAlign: 'center' }}>
                              <button className="btn btn-secondary btn-sm" onClick={() => handlePrintReceipt(t)} title="Print receipt">🧾</button>
                            </td>
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

      {/* ── Email Report Modal ── */}
      {showEmailModal && (
        <div className="modal-overlay" onClick={() => setShowEmailModal(false)}>
          <div className="modal reports-email-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="display-text">📧 Email Report</h2>
              <button className="btn-icon" onClick={() => setShowEmailModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Recipient Email</label>
                <input
                  type="email"
                  className="input"
                  value={emailRecipient}
                  onChange={(e) => { setEmailRecipient(e.target.value); setEmailResult(null) }}
                  placeholder="email@example.com"
                  autoFocus
                  disabled={emailSending}
                />
              </div>
              <div className="form-group" style={{ marginTop: 12 }}>
                <label>Report</label>
                <div className="reports-email-report-info">
                  <span className="reports-email-report-name">
                    {view === 'daily'
                      ? `Daily Sales Report — ${fmtDateLabel(dailyDate)}`
                      : `Monthly Sales Report — ${fmtMonthLabel(monthYear)}`
                    }
                  </span>
                </div>
              </div>

              {emailResult && (
                <div className={`reports-email-result ${emailResult.success ? 'success' : 'error'}`}>
                  {emailResult.success ? (
                    <>
                      <span>✅ {emailResult.message || 'Email sent successfully!'}</span>
                    </>
                  ) : (
                    <span>
                      ❌ {emailResult.message || 'Failed to send report.'}
                      <p className="reports-email-hint">
                        Make sure SMTP is configured in Settings.
                      </p>
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowEmailModal(false)} disabled={emailSending}>
                {emailResult?.success ? 'Close' : 'Cancel'}
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (!emailRecipient.trim()) return
                  setEmailSending(true)
                  setEmailResult(null)

                  try {
                    // Generate the same HTML as the Excel export
                    const r = view === 'daily' ? dailyReport : monthlyReport
                    if (!r) return

                    // Build the report HTML using the shared style
                    const now = new Date().toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    const style = `<style>
                      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #222; padding: 20px; }
                      h1 { font-size: 16pt; font-weight: 700; text-align: center; margin: 0 0 4px; color: #1a1a2e; }
                      .subtitle { text-align: center; font-size: 10pt; color: #666; margin-bottom: 16px; }
                      .section-title { font-size: 11pt; font-weight: 700; color: #1a1a2e; margin: 16px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #1a1a2e; }
                      .stat-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; table-layout: fixed; }
                      .stat-table td { width: 25%; padding: 10px 12px; border: 1px solid #dde1e6; text-align: center; background: #f5f7fa; vertical-align: top; }
                      .stat-num { font-size: 18pt; font-weight: 700; line-height: 1.1; }
                      .stat-green { color: #2e7d32; } .stat-blue { color: #1565c0; } .stat-orange { color: #e65100; } .stat-red { color: #c62828; }
                      .stat-lbl { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-top: 2px; }
                      .stat-sub { font-size: 7.5pt; color: #888; }
                      table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
                      th { padding: 6px 8px; text-align: left; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #fff; background: #1a1a2e; border: 1px solid #1a1a2e; }
                      td { padding: 5px 8px; border: 1px solid #dde1e6; vertical-align: middle; font-size: 9pt; }
                      tr:nth-child(even) { background: #f8f9fb; }
                      tr.total-row td { font-weight: 700; border-top: 2px solid #1a1a2e; background: #eef0f4; }
                      .mono { font-family: 'Consolas', 'Courier New', monospace; font-size: 8.5pt; }
                      .amt { text-align: right; font-weight: 600; }
                      .danger { color: #c62828; font-weight: 700; }
                      .tag { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 7pt; font-weight: 700; }
                      .tag-new { background: #e8f5e9; color: #2e7d32; }
                      .tag-renewal { background: #e3f2fd; color: #1565c0; }
                      .tag-pack { background: #fff3e0; color: #e65100; }
                      .footer { text-align: center; font-size: 8pt; color: #999; margin-top: 16px; border-top: 1px solid #dde1e6; padding-top: 8px; }
                    </style>`

                    const buildStatCards = (items: { num: string; label: string; sub: string; cls: string }[]) =>
                      `<table class="stat-table"><tr>${items.map(i =>
                        `<td><div class="stat-num ${i.cls}">${esc(i.num)}</div><div class="stat-lbl">${i.label}</div><div class="stat-sub">${i.sub}</div></td>`
                      ).join('')}</tr></table>`

                    const buildTable = (headers: string[], rows: string[][], totalRow?: string[]) => {
                      let html = '<table><thead><tr>'
                      for (const h of headers) html += `<th>${esc(h)}</th>`
                      html += '</tr></thead><tbody>'
                      for (const row of rows) {
                        html += '<tr>'
                        for (const cell of row) {
                          html += `<td>${cell.length > 0 && cell[0] === '<' ? cell : esc(cell)}</td>`
                        }
                        html += '</tr>'
                      }
                      if (totalRow) {
                        html += '<tr class="total-row">'
                        for (const cell of totalRow) {
                          html += `<td>${cell.length > 0 && cell[0] === '<' ? cell : esc(cell)}</td>`
                        }
                        html += '</tr>'
                      }
                      html += '</tbody></table>'
                      return html
                    }

                    const typeTag = (type: string): string => {
                      const tagClass = type === 'new_plan' ? 'tag-new' : type === 'renewal' ? 'tag-renewal' : 'tag-pack'
                      const label = type === 'new_plan' ? 'New' : type === 'renewal' ? 'Renewal' : 'Pack'
                      return `<span class="tag ${tagClass}">${label}</span>`
                    }

                    // ── Helper: Coach Report section HTML (shared by daily + monthly) ──
                    const coachTableHtml = (coaches: ReportCoachSummary[], periodLabel: string) => {
                      if (!coaches || coaches.length === 0) return ''
                      const totalMembers = coaches.reduce((s, c) => s + (c.totalMembers || 0), 0)
                      const totalActive = coaches.reduce((s, c) => s + (c.activeMembers || 0), 0)
                      const totalPeriod = coaches.reduce((s, c) => s + (c.periodCollected || 0), 0)
                      const totalAll = coaches.reduce((s, c) => s + (c.totalCollected || 0), 0)
                      return `<div class="section-title">Coach Report</div>\n${buildTable(
                        ['Coach', 'Specialty', 'Members', 'Active', periodLabel, 'Total Collected'],
                        coaches.map(c => [c.coach_name, c.specialty || '—', String(c.totalMembers), String(c.activeMembers), fmtCurrency(c.periodCollected), fmtCurrency(c.totalCollected)]),
                        ['Total', '', String(totalMembers), String(totalActive), fmtCurrency(totalPeriod), fmtCurrency(totalAll)]
                      )}`
                    }

                    let html: string
                    const emailFilename = view === 'daily' && dailyReport
                      ? `${filePrefix}-daily-${dailyReport.date}.xls`
                      : `${filePrefix}-monthly-${monthlyReport!.yearMonth}.xls`

                    if (view === 'daily' && dailyReport) {
                      const daily = dailyReport
                      html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${filePrefix}-daily-${daily.date}</title>${style}</head><body>
<h1>${esc(appName)} — Daily Sales Report</h1>
<div class="subtitle">${fmtDateLabel(daily.date)}</div>
${buildStatCards([
  { num: fmtCurrency(daily.totalRevenue), label: 'TOTAL REVENUE', sub: "Today's collections", cls: 'stat-green' },
  { num: String(daily.newMembers), label: 'NEW ENROLLMENTS', sub: 'Members joined today', cls: 'stat-blue' },
  { num: String(daily.renewals), label: 'RENEWALS', sub: 'Plans renewed today', cls: 'stat-orange' },
  { num: String(daily.outstandingCount), label: 'OUTSTANDING', sub: 'Members with flagged balances', cls: 'stat-red' },
])}
<div class="section-title">Revenue by Plan Type</div>
${buildTable(['Type', 'Transactions', 'Total'], daily.byType.map(i => [i.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), String(i.count), fmtCurrency(i.total)]), ['Total', String(daily.byType.reduce((s, i) => s + i.count, 0)), fmtCurrency(daily.totalRevenue)])}
<div class="section-title">Revenue by Payment Method</div>
${buildTable(['Method', 'Transactions', 'Total'], daily.byMethod.map(i => [i.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), String(i.count), fmtCurrency(i.total)]), ['Total', String(daily.byMethod.reduce((s, i) => s + i.count, 0)), fmtCurrency(daily.totalRevenue)])}
${daily.outstanding.length > 0 ? `\n<div class="section-title" style="color:#c62828;border-color:#c62828;">Outstanding Balances</div>\n${buildTable(['Member', 'Member ID', 'Balance'], daily.outstanding.map(o => [o.name, o.member_id, fmtCurrency(o.balance)]), ['Total Outstanding', '', fmtCurrency(daily.outstanding.reduce((s, o) => s + o.balance, 0))])}` : ''}
<div class="section-title">Transaction Details</div>
${buildTable(['Member', 'Member ID', 'Plan', 'Type', 'Method', 'Status', 'Amount', 'Time'], daily.transactions.map(t => {
  const flagged = daily.outstanding.some(o => o.id === t.member_id)
  return [
    `<span${flagged ? ' style="color:#c62828;font-weight:600;"' : ''}>${esc(t.member_name || 'Unknown')}</span>`,
    t.member_code || '', t.plan_name || '—', typeTag(t.type),
    (t.payment_method || 'cash').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    `<span class="tag tag-status">${esc(t.status || 'completed')}</span>`,
    fmtCurrency(t.amount), fmtTime(t.created_at),
  ]
}), ['TOTAL', '', '', '', '', '', fmtCurrency(daily.totalRevenue), ''])}
${coachTableHtml(daily.coaches, 'Collected Today')}
<div class="footer">Report generated ${now} — ${esc(appName)} — Generated by ${esc(generatedBy)}</div>
</body></html>`
                    } else if (view === 'monthly' && monthlyReport) {
                      const monthly = monthlyReport
                      html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${filePrefix}-monthly-${monthly.yearMonth}</title>${style}</head><body>
<h1>${esc(appName)} — Monthly Sales Report</h1>
<div class="subtitle">${fmtMonthLabel(monthly.yearMonth)}</div>
${buildStatCards([
  { num: fmtCurrency(monthly.totalRevenue), label: 'TOTAL REVENUE', sub: `${monthly.percentChange >= 0 ? '▲' : '▼'} ${fmtPct(monthly.percentChange)} vs last month`, cls: 'stat-green' },
  { num: String(monthly.newMembers), label: 'NEW MEMBERS', sub: 'Joined this month', cls: 'stat-blue' },
  { num: String(monthly.renewals), label: 'RENEWALS', sub: 'Plans renewed this month', cls: 'stat-orange' },
  { num: String(monthly.churned), label: 'CHURNED', sub: 'Members not renewed', cls: 'stat-red' },
])}
${monthly.weekly.length > 0 ? `\n<div class="section-title">Weekly Revenue Trend</div>\n${buildTable(['Week', 'Transactions', 'Total'], monthly.weekly.map(w => [w.week, String(w.count), fmtCurrency(w.total)]), ['Total', String(monthly.weekly.reduce((s, w) => s + w.count, 0)), fmtCurrency(monthly.totalRevenue)])}` : ''}
<div class="section-title">Revenue by Plan Type</div>
${buildTable(['Plan Type', 'Count', 'Total'], monthly.byPlanType.map(i => [i.plan_type === 'no_plan' ? 'No Plan' : i.plan_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), String(i.count), fmtCurrency(i.total)]), ['Total', String(monthly.byPlanType.reduce((s, i) => s + i.count, 0)), fmtCurrency(monthly.totalRevenue)])}
<div class="section-title">Revenue by Payment Method</div>
${buildTable(['Method', 'Count', 'Total'], monthly.byMethod.map(i => [i.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), String(i.count), fmtCurrency(i.total)]), ['Total', String(monthly.byMethod.reduce((s, i) => s + i.count, 0)), fmtCurrency(monthly.byMethod.reduce((s, i) => s + i.total, 0))])}
${monthly.outstanding.length > 0 ? `\n<div class="section-title" style="color:#c62828;border-color:#c62828;">Outstanding Balances (as of Month-End)</div>\n${buildTable(['Member', 'Member ID', 'Balance'], monthly.outstanding.map(o => [o.name, o.member_id, fmtCurrency(o.balance)]), ['Total Outstanding', '', fmtCurrency(monthly.outstanding.reduce((s, o) => s + o.balance, 0))])}` : ''}
<div class="section-title">Summary</div>
<table class="summary-table">
<tr><td><strong>Payment Methods</strong></td><td>${monthly.byMethod.map(m => `${m.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}: ${fmtCurrency(m.total)}`).join('; ')}</td></tr>
<tr><td><strong>Total Outstanding</strong></td><td class="danger">${fmtCurrency(monthly.outstanding.reduce((s, o) => s + o.balance, 0))}</td></tr>
</table>
${coachTableHtml(monthly.coaches, 'Collected This Month')}
<div class="footer">Report generated ${now} — ${esc(appName)} — Generated by ${esc(generatedBy)}</div>
</body></html>`
                    } else {
                      setEmailSending(false)
                      return
                    }

                    const result = await window.electronAPI.sendReportEmail({
                      html,
                      recipient: emailRecipient.trim(),
                      appName,
                      filename: emailFilename,
                    })
                    setEmailResult(result)
                  } catch (error: any) {
                    setEmailResult({ success: false, message: error.message })
                  } finally {
                    setEmailSending(false)
                  }
                }}
                disabled={!emailRecipient.trim() || emailSending}
              >
{emailSending ? 'Sending...' : 'Send Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Members Modal (clickable "New Enrollments"/"New Members" stat cards) ── */}
      {newMembersOpen && (
        <div className="modal-overlay" onClick={closeNewMembersModal}>
          <div className="modal reports-newmembers-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="display-text">👥 New Members</h2>
              <button className="btn-icon" onClick={closeNewMembersModal}>✕</button>
            </div>
            <div className="modal-body">
              <p className="reports-newmembers-range">
                {newMembersRange?.label}
              </p>
              {newMembersLoading ? (
                <div className="reports-loading">
                  <div className="loading-spinner" />
                  <p>Loading members...</p>
                </div>
              ) : newMembersList.length === 0 ? (
                <p className="empty-breakdown">No new members enrolled in this period.</p>
              ) : (
                <div className="reports-newmembers-list">
                  {newMembersList.map(m => (
                    <div key={m.id} className="reports-newmember-item">
                      <div className="reports-newmember-avatar">
                        {m.photo ? (
                          <img src={m.photo} alt={m.name} />
                        ) : (
                          m.name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="reports-newmember-info">
                        <span className="reports-newmember-name">{m.name}</span>
                        <span className="mono-text reports-newmember-code">{m.member_id}</span>
                      </div>
                      <div className="reports-newmember-plan">
                        <span className="reports-newmember-plan-label">Plan</span>
                        <span className="reports-newmember-plan-value">{m.plan_name || 'No plan'}</span>
                      </div>
                      <div className="reports-newmember-date">
                        <span className="reports-newmember-plan-label">Joined</span>
                        <span className="mono-text reports-newmember-date-value">
                          {m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeNewMembersModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Reports
