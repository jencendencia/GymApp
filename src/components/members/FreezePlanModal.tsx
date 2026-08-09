import React, { useState } from 'react'
import { Member } from '../../types/electron'

interface FreezePlanModalProps {
  member: Member
  onClose: () => void
  onFreeze: (memberId: number, data: {
    reason: string
    custom_reason?: string
    days: number
    attachment?: string
  }) => Promise<{ success: boolean; message?: string }>
}

const FREEZE_REASONS = [
  { value: 'medical', label: 'Medical', icon: '🏥', requiresAttachment: true },
  { value: 'travel', label: 'Travel', icon: '✈️', requiresAttachment: true },
  { value: 'other', label: 'Other', icon: '📝', requiresAttachment: false },
]

export default function FreezePlanModal({ member, onClose, onFreeze }: FreezePlanModalProps) {
  const [reason, setReason] = useState('medical')
  const [customReason, setCustomReason] = useState('')
  const [days, setDays] = useState(7)
  const [attachment, setAttachment] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selectedReason = FREEZE_REASONS.find(r => r.value === reason)
  const requiresAttachment = selectedReason?.requiresAttachment || false

  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type (image only)
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (JPG, PNG, etc.)')
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5MB')
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      setAttachment(event.target?.result as string)
      setError('')
    }
    reader.readAsDataURL(file)
  }

  const handleSubmit = async () => {
    if (!reason) {
      setError('Please select a reason')
      return
    }

    if (reason === 'other' && !customReason.trim()) {
      setError('Please enter a custom reason')
      return
    }

    if (requiresAttachment && !attachment) {
      setError('Please upload an attachment')
      return
    }

    if (days < 1 || days > 365) {
      setError('Duration must be between 1 and 365 days')
      return
    }

    setLoading(true)
    setError('')

    try {
      const result = await onFreeze(member.id, {
        reason,
        custom_reason: reason === 'other' ? customReason : undefined,
        days,
        attachment: attachment || undefined,
      })

      if (result.success) {
        onClose()
      } else {
        setError(result.message || 'Failed to freeze plan')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to freeze plan')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal freeze-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="display-text">❄️ Freeze Plan</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
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

          <div className="form-group">
            <label>Reason for Freeze *</label>
            <div className="freeze-reasons">
              {FREEZE_REASONS.map(r => (
                <button
                  key={r.value}
                  type="button"
                  className={`freeze-reason-btn ${reason === r.value ? 'active' : ''}`}
                  onClick={() => {
                    setReason(r.value)
                    setError('')
                  }}
                >
                  <span className="freeze-reason-icon">{r.icon}</span>
                  <span className="freeze-reason-label">{r.label}</span>
                </button>
              ))}
            </div>
          </div>

          {reason === 'other' && (
            <div className="form-group">
              <label>Custom Reason *</label>
              <textarea
                className="input"
                value={customReason}
                onChange={e => {
                  setCustomReason(e.target.value)
                  setError('')
                }}
                placeholder="Please specify the reason..."
                rows={3}
              />
            </div>
          )}

          {requiresAttachment && (
            <div className="form-group">
              <label>Attachment * (Image required)</label>
              <div className="freeze-attachment">
                {attachment ? (
                  <div className="freeze-attachment-preview">
                    <img src={attachment} alt="Attachment preview" />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setAttachment(null)}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label className="freeze-attachment-upload">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAttachmentChange}
                      style={{ display: 'none' }}
                    />
                    <span className="upload-icon">📷</span>
                    <span>Click to upload image</span>
                    <span className="text-muted">JPG, PNG up to 5MB</span>
                  </label>
                )}
              </div>
            </div>
          )}

          <div className="form-group">
            <label>Duration (Days) *</label>
            <div className="freeze-duration">
              <input
                type="number"
                className="input"
                value={days}
                onChange={e => {
                  setDays(parseInt(e.target.value) || 0)
                  setError('')
                }}
                min={1}
                max={365}
              />
              <div className="freeze-duration-presets">
                {[7, 14, 30, 60, 90].map(d => (
                  <button
                    key={d}
                    type="button"
                    className={`btn btn-sm ${days === d ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setDays(d)}
                  >
                    {d} days
                  </button>
                ))}
              </div>
            </div>
          </div>

          {member.plan_end && (
            <div className="freeze-info-box">
              <p>
                <strong>Current Plan End:</strong> {new Date(member.plan_end).toLocaleDateString()}
              </p>
              <p>
                <strong>After Unfreeze:</strong> Plan will be extended by {days} days from unfreeze date
              </p>
            </div>
          )}

          {error && <div className="error-message">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Freezing...' : '❄️ Freeze Plan'}
          </button>
        </div>
      </div>
    </div>
  )
}
