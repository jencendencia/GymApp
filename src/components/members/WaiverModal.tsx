import React from 'react'

interface WaiverModalProps {
  open: boolean
  /** Show the "I Agree" confirm button (hidden when viewing an existing member's waiver). */
  showAgree: boolean
  title?: string
  content?: string
  onClose: () => void
  onAgree: () => void
}

/** Membership waiver & release — shared by the new-member and renewal flows (P2 6.6). */
function WaiverModal({ open, showAgree, title, content, onClose, onAgree }: WaiverModalProps) {
  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal waiver-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="display-text">📄 {title || 'Membership Waiver & Release'}</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body waiver-modal-body">
          <div className="waiver-content">
            {(content || '').split('\n\n').map((paragraph, index) => {
              const trimmed = paragraph.trim()
              if (!trimmed) return null
              return <p key={index}>{trimmed}</p>
            })}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {showAgree && (
            <button className="btn btn-primary" onClick={onAgree}>
              I Agree
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default WaiverModal
