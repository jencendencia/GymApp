import React from 'react'
import { Member } from '../../types/electron'
import { formatMoney } from '../../lib/format'
import MemberAvatar from '../MemberAvatar'

interface MembersTableProps {
  memberTab: 'all' | 'expiring'
  members: Member[]
  expiringMembers: Member[]
  totalMembers: number
  memberPage: number
  pageSize: number
  loading: boolean
  isAdmin: boolean
  getPlanName: (planId?: number) => string
  onTabChange: (tab: 'all' | 'expiring') => void
  onPageChange: (page: number) => void
  onOpenEdit: (member: Member) => void
  onOpenIdCard: (member: Member) => void
  onOpenNewPlan: (member: Member) => void
  onDelete: (member: Member) => void
  onShowQr: (member: Member) => void
}

function calcDaysRemaining(dateStr?: string): number | null {
  if (!dateStr) return null
  const now = new Date()
  const end = new Date(dateStr)
  const diff = end.getTime() - now.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

const DayCell = ({ member }: { member: Member }) => {
  const d = calcDaysRemaining(member.plan_end) ?? calcDaysRemaining(member.coaching_end)
  if (d === null || d === undefined) return <span>—</span>
  if (d <= 0) return <span className="status-badge expired">Expired</span>
  if (d <= 2) return <span className="days-left days-danger">{d} day{d !== 1 ? 's' : ''}</span>
  return <span className="days-left">{d} days</span>
}

/** Presentational members tables (all + expiring) with tabs and pagination (P2 6.6). */
function MembersTable(props: MembersTableProps) {
  const {
    memberTab, members, expiringMembers, totalMembers, memberPage, pageSize, loading,
    isAdmin, getPlanName, onTabChange, onPageChange,
    onOpenEdit, onOpenIdCard, onOpenNewPlan, onDelete, onShowQr,
  } = props

  // Match the original split: all-tab shows ID card (no QR), expiring-tab shows QR (no ID card)
  const renderActions = (member: Member, showQr: boolean, showIdCard: boolean) => (
    <div className="table-actions">
      {showQr && (
        <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onShowQr(member) }} title="Show QR Code">⬒</button>
      )}
      {showIdCard && (
        <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onOpenIdCard(member) }} title="Member ID Card">🪪</button>
      )}
      <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onOpenNewPlan(member) }} title="New Plan">📋</button>
      {isAdmin && (
        <button className="btn-icon danger" onClick={(e) => { e.stopPropagation(); onDelete(member) }} title="Delete">✕</button>
      )}
    </div>
  )

  // Honors the global "Show Member Photos" setting (P2 6.9) — falls back to initials when off
  const renderPhoto = (member: Member) => (
    <MemberAvatar
      name={member.name}
      photo={member.photo}
      imgClassName="member-table-photo"
      fallbackClassName="member-table-avatar"
    />
  )

  const renderWaiver = (member: Member) =>
    member.waiver_agreed_at ? (
      <span className="waiver-badge signed" title={`Signed ${new Date(member.waiver_agreed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}>✓ Signed</span>
    ) : (
      <span className="waiver-badge unsigned">—</span>
    )

  const skeletonRows = loading && members.length === 0
    ? Array.from({ length: 5 }).map((_, i) => (
        <tr key={`sk-${i}`}>
          {Array.from({ length: 11 }).map((__, j) => (
            <td key={j}><div className="skeleton" style={{ height: 20 }} /></td>
          ))}
        </tr>
      ))
    : null

  return (
    <>
      {/* Sub-tabs */}
      <div className="member-tabs">
        <button className={`member-tab ${memberTab === 'all' ? 'active' : ''}`} onClick={() => onTabChange('all')}>
          All Members {totalMembers > 0 && <span className="expiring-badge">{totalMembers}</span>}
        </button>
        <button className={`member-tab ${memberTab === 'expiring' ? 'active' : ''}`} onClick={() => onTabChange('expiring')}>
          Expiring Members {expiringMembers.length > 0 && <span className="expiring-badge">{expiringMembers.length}</span>}
        </button>
      </div>

      {memberTab === 'all' && (
        <div className="members-table-container">
          <table className="members-table">
            <thead>
              <tr>
                <th>Photo</th>
                <th>Member ID</th>
                <th>Member Since</th>
                <th>Name</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Balance</th>
                <th>Expiry</th>
                <th>Days Left</th>
                <th>Waiver</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {skeletonRows}
              {!skeletonRows && members.length === 0 ? (
                <tr>
                  <td colSpan={11} className="empty-row">No members found</td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr key={member.id} onClick={() => onOpenEdit(member)}>
                    <td>{renderPhoto(member)}</td>
                    <td className="mono-text">{member.member_id}</td>
                    <td className="mono-text">{member.created_at ? new Date(member.created_at).toLocaleDateString() : '—'}</td>
                    <td>{member.name}</td>
                    <td>{getPlanName(member.plan_id)}</td>
                    <td><span className={`status-badge ${member.status}`}>{member.status}</span></td>
                    <td className="mono-text">{formatMoney(member.balance)}</td>
                    <td className="mono-text">{member.plan_end ? new Date(member.plan_end).toLocaleDateString() : 'N/A'}</td>
                    <td className="mono-text"><DayCell member={member} /></td>
                    <td>{renderWaiver(member)}</td>
                    <td>{renderActions(member, false, true)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {memberTab === 'all' && totalMembers > pageSize && (
        <div className="members-pagination">
          <span className="pagination-info mono-text">
            Showing {loading ? '…' : (memberPage * pageSize) + 1}–{Math.min((memberPage + 1) * pageSize, totalMembers)} of {totalMembers}
          </span>
          <div className="pagination-actions">
            <button className="btn btn-secondary btn-sm" disabled={memberPage === 0 || loading} onClick={() => onPageChange(Math.max(0, memberPage - 1))}>← Prev</button>
            <button className="btn btn-secondary btn-sm" disabled={(memberPage + 1) * pageSize >= totalMembers || loading} onClick={() => onPageChange(memberPage + 1)}>Next →</button>
          </div>
        </div>
      )}

      {memberTab === 'expiring' && (
        <div className="members-table-container">
          <table className="members-table">
            <thead>
              <tr>
                <th>Photo</th>
                <th>Member ID</th>
                <th>Member Since</th>
                <th>Name</th>
                <th>Plan</th>
                <th>Expiry Date</th>
                <th>Days Left</th>
                <th>Status</th>
                <th>Waiver</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {skeletonRows}
              {!skeletonRows && expiringMembers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty-row">No expiring members</td>
                </tr>
              ) : (
                expiringMembers.map((member) => {
                  const planDays = calcDaysRemaining(member.plan_end)
                  const coachDays = calcDaysRemaining(member.coaching_end)
                  const usePlan = (planDays ?? Infinity) <= (coachDays ?? Infinity)
                  const daysLeft = usePlan ? (planDays ?? 0) : (coachDays ?? 0)
                  const expiryDate = usePlan ? (member.plan_end || '') : (member.coaching_end || '')
                  return (
                    <tr key={member.id} onClick={() => onOpenEdit(member)}>
                      <td>{renderPhoto(member)}</td>
                      <td className="mono-text">{member.member_id}</td>
                      <td className="mono-text">{member.created_at ? new Date(member.created_at).toLocaleDateString() : '—'}</td>
                      <td>{member.name}</td>
                      <td>{getPlanName(member.plan_id)}</td>
                      <td className="mono-text">{expiryDate ? new Date(expiryDate).toLocaleDateString() : 'N/A'}</td>
                      <td className="mono-text">
                        {daysLeft <= 0 ? (
                          <span className="status-badge expired">Expired</span>
                        ) : daysLeft === 1 ? (
                          <span className="days-left days-danger">{daysLeft} day</span>
                        ) : (
                          <span className="days-left days-warning">{daysLeft} days</span>
                        )}
                      </td>
                      <td><span className={`status-badge ${member.status}`}>{member.status}</span></td>
                      <td>{renderWaiver(member)}</td>
                      <td>{renderActions(member, true, false)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

export default MembersTable
