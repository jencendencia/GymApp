import React from 'react'
import { Member } from '../../types/electron'
import { formatMoney } from '../../lib/format'

/** Member QR code modal with print support (P2 6.6). */
export function QrCodeModal({
  member,
  qrCodeUrl,
  qrError,
  onClose,
}: {
  member: Member
  qrCodeUrl: string | null
  qrError: string
  onClose: () => void
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal qr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="display-text">⬒ Member QR Code</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body qr-modal-body">
          <div className="qr-member-info">
            <span className="qr-member-name">{member.name}</span>
            <span className="mono-text qr-member-id">ID: {member.member_id}</span>
            <span className={`status-badge ${member.status}`}>{member.status}</span>
          </div>
          <div className="qr-code-container">
            {qrCodeUrl ? (
              <img src={qrCodeUrl} alt={`QR for ${member.member_id}`} className="qr-code-img" />
            ) : (
              <div className="qr-loading">{qrError || 'Generating...'}</div>
            )}
          </div>
          <p className="qr-hint">
            Show this code at the kiosk and tap <strong>📷 Scan QR Code</strong> to check in.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!qrCodeUrl) return
              const win = window.open('', '_blank', 'width=400,height=520')
              if (!win) {
                alert('Please allow pop-ups to print the QR code.')
                return
              }
              const escHtml = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
              win.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>QR — ${escHtml(member.member_id)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; text-align: center; padding: 24px; }
  .qr { margin: 20px auto; }
  .name { font-size: 16px; font-weight: 700; }
  .id { font-size: 13px; color: #555; margin-top: 4px; }
</style></head><body>
  <div class="name">${escHtml(member.name)}</div>
  <div class="id">ID: ${escHtml(member.member_id)}</div>
  <img class="qr" src="${qrCodeUrl}" width="280" height="280" alt="QR" />
  <div class="id">Scan at the front-desk kiosk to check in</div>
  <script>window.onload = () => window.print()</script>
</body></html>`)
              win.document.close()
              win.focus()
            }}
            disabled={!qrCodeUrl}
          >
            🖨️ Print
          </button>
        </div>
      </div>
    </div>
  )
}

/** Printable member ID card modal (P2 6.6). */
export function IdCardModal({
  member,
  idCardQr,
  printing,
  onPrint,
  onClose,
}: {
  member: Member
  idCardQr: string
  printing: boolean
  onPrint: () => void
  onClose: () => void
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal id-card-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="display-text">🪪 Member ID Card</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="id-card-preview">
            <div className="id-card-front">
              <div className="id-card-top">
                <span className="id-card-brand display-text">REPCHECK</span>
                <span className="id-card-code mono-text">{member.member_id}</span>
              </div>
              <div className="id-card-photo-row">
                {member.photo ? (
                  <img src={member.photo} alt={member.name} className="id-card-photo" />
                ) : (
                  <div className="id-card-photo-placeholder">{member.name.charAt(0).toUpperCase()}</div>
                )}
                <div className="id-card-details">
                  <span className="id-card-name">{member.name}</span>
                  <span className="id-card-plan">{member.plan_name || 'No Plan'}</span>
                  <span className={`status-badge ${member.status}`}>{member.status}</span>
                </div>
              </div>
              <div className="id-card-meta">
                <div>
                  <span className="id-card-label">Valid Until</span>
                  <span className="id-card-value">{member.plan_end ? new Date(member.plan_end).toLocaleDateString() : 'N/A'}</span>
                </div>
                <div>
                  <span className="id-card-label">Balance</span>
                  <span className="id-card-value">{formatMoney(member.balance || 0)}</span>
                </div>
                <div>
                  <span className="id-card-label">Coach</span>
                  <span className="id-card-value">{member.coach_name || '—'}</span>
                </div>
              </div>
            </div>
            {idCardQr ? (
              <img src={idCardQr} alt="QR" className="id-card-qr" />
            ) : (
              <div className="id-card-qr-loading">Generating QR…</div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onPrint} disabled={printing || !idCardQr}>
            {printing ? 'Printing…' : '🖨️ Print ID Card'}
          </button>
        </div>
      </div>
    </div>
  )
}
