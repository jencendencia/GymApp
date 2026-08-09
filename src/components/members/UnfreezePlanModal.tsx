import React, { useState } from 'react'
import { Member } from '../../types/electron'

interface UnfreezePlanModalProps {
  member: Member
  onClose: () => void
  onUnfreeze: (memberId: number) => Promise<{ success: boolean; message?: string }>
}

/** Confirm modal for unfreezing a member's plan — shows the freeze details
 *  (reason, duration, dates, attachment) before the admin confirms. */
function UnfreezePlanModal({ member, onClose, onUnfreeze }: UnfreezePlanModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const freezeDays = member.freeze_days || 0
  const freezeStart = member.freeze_start ? new Date(member.freeze_start).toLocaleDateString() : ''
  const freezeEnd = member.freeze_end ? new Date(member.freeze_end).toLocaleDateString() : ''

  const handleConfirm = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await onUnfreeze(member.id)
      if (result.success) {
        onClose()
      } else {
        setError(result.message || 'Failed to unfreeze plan.')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to unfreeze plan.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => { if (!loading) onClose() }}>
      <div className="modal freeze-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="display-text">🔓 Unfreeze Plan</h2>
          <button className="btn-icon" onClick={onClose} disabled={loading}>✕</button>
        </div>

        <div className="modal-body">
          <div className="freeze-member-info">
            <div className="freeze-member-avatar">
              {member.photo ? (
                <img src={member.photo} alt={member.name} />
              ) : (
                <span>{member.name.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div className="freeze-member-details">
              <h3>{member.name}</h3>
              <p className="mono-text">{member.member_id}</p>
              {member.plan_name && <p className="text-muted">{member.plan_name}</p>}
            </div>
          </div>

          <div className="freeze-details">
            <div className="freeze-detail-row">
              <span>Reason</span>
              <strong>{member.freeze_reason || '—'}</strong>
            </div>
            <div className="freeze-detail-row">
              <span>Duration</span>
              <strong>{freezeDays} {freezeDays === 1 ? 'day' : 'days'}</strong>
            </div>
            {freezeStart && (
              <div className="freeze-detail-row">
                <span>Frozen Since</span>
                <strong>{freezeStart}</strong>
              </div>
            )}
            {freezeEnd && (
              <div className="freeze-detail-row">
                <span>Frozen Until</span>
                <strong>{freezeEnd}</strong>
              </div>
            )}
            {member.freeze_attachment && (
              <div className="freeze-detail-row">
                <span>Attachment</span>
                <img
                  className="freeze-detail-attachment"
                  src={member.freeze_attachment}
                  alt="Freeze attachment"
                />
              </div>
            )}
          </div>

          <div className="freeze-info-box">
            <p>
              <strong>What happens next:</strong> The remaining freeze days will be added to{' '}
              {member.name}'s plan end date{member.plan_end ? ` (currently ${new Date(member.plan_end).toLocaleDateString()})` : ''}.
              If the freeze period has already ended, the plan is simply unfrozen.
            </p>
          </div>

          {error && <div className="error-message">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={loading}>
            {loading ? 'Unfreezing...' : '🔓 Unfreeze Plan'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default UnfreezePlanModal
