import React, { RefObject } from 'react'
import { Member, Plan, Coach, Payment, WaiverTemplate } from '../../types/electron'
import { formatMoney } from '../../lib/format'
import { todayLocal, planEndDate } from '../../lib/dates'
import WaiverModal from './WaiverModal'
import FingerprintEnrollment, { ENROLL_STEPS, FingerprintSlotData } from '../FingerprintEnrollment'

// Payment methods that require a transaction reference number
const METHODS_REQUIRING_REF = ['gcash', 'maya', 'bank_transfer', 'card']

export interface MemberFormData {
  member_id: string
  name: string
  email: string
  phone: string
  emergency_contact: string
  emergency_phone: string
  plan_id: number
  plan_start: string
  plan_end: string
  height: string
  weight: string
  birthday: string
  coach_id: number
  coaching_start: string
  coaching_end: string
  balance: number
  status: 'active' | 'inactive' | 'expired'
  photo: string
  /** Member who referred this new member (0 = none) — they earn 20 points (P2 5.8). */
  referrer_id: number
}

export interface PaymentFormData {
  amount: number
  type: 'new_plan' | 'renewal' | 'top_up'
  payment_method: string
  transaction_ref: string
}

/** One enrolled finger: its ANSI-378 template + capture quality. */
export interface FingerprintSlot {
  /** Base64 ANSI-378 FMD template captured from the U.are.U reader */
  fmdBase64: string | null
  quality: number
}

/** Up to FINGER_SLOTS enrolled fingerprints per member (3-finger enrollment). */
export interface FingerprintState {
  /** True while a capture is in flight */
  scanning: boolean
  /** Which slot (0..FINGER_SLOTS-1) is being scanned */
  scanningSlot: number
  fingers: FingerprintSlot[]
  error: string | null
}

/** Number of fingerprints a member can enroll (index + middle + ring). */
export const FINGER_SLOTS = ENROLL_STEPS

/** Fresh, all-empty fingerprint state (create mode / reset). */
export const emptyFingerprints = (): FingerprintState => ({
  scanning: false,
  scanningSlot: -1,
  fingers: Array.from({ length: FINGER_SLOTS }, () => ({ fmdBase64: null, quality: 0 })),
  error: null,
})

interface MemberFormModalProps {
  selectedMember: Member | null
  plans: Plan[]
  coaches: Coach[]
  /** All active members — options for the "Referred By" dropdown (P2 5.8). */
  members: Member[]
  formData: MemberFormData
  onFormDataChange: (d: MemberFormData) => void
  paymentForm: PaymentFormData
  onPaymentFormChange: (p: PaymentFormData | ((prev: PaymentFormData) => PaymentFormData)) => void
  photoPreview: string | null
  /** Currently enrolled fingerprint slots (pre-fill for edit mode). */
  initialFingers: FingerprintSlotData[]
  /** Capture one finger from the U.are.U reader; null = cancelled/timeout. */
  captureFinger: () => Promise<FingerprintSlotData | null>
  /** Fired on every successful capture / clear with the full slot set. */
  onFingerprintsChange: (fingers: FingerprintSlotData[]) => void
  waiverAgreed: boolean
  waiverAgreedAt: string | null
  waiverTemplates: WaiverTemplate[]
  waiverTemplateId: number | null
  onWaiverTemplateChange: (templateId: number | null) => void
  validationAttempted: boolean
  shakeKey: number
  missingRequired: string[]
  memberIdWarning: string | null
  checkingMemberId: boolean
  lastMemberId: { last: number; next: number }
  lastMemberIdLoaded: boolean
  memberPayments: Payment[]
  paymentsLoading: boolean
  isAdmin: boolean
  /** P2 5.2: auto-renew toggle (create mode) */
  autoRenew: boolean
  onAutoRenewChange: (autoRenew: boolean) => void
  refs: {
    fileInputRef: RefObject<HTMLInputElement>
    nameRef: RefObject<HTMLInputElement>
    planRef: RefObject<HTMLSelectElement>
    waiverRef: RefObject<HTMLDivElement>
    paymentRef: RefObject<HTMLInputElement>
    transactionRefRef: RefObject<HTMLInputElement>
  }
  onMemberIdChange: (value: string) => void
  onPhotoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  onCameraCapture: () => void
  onPaymentStatus: (payment: Payment, status: 'voided' | 'refunded') => void
  /** Parent records waiver agreement (timestamp + activity log). */
  onWaiverAgree: () => void
  onSubmit: () => void
  onClose: () => void
}

/** Create / edit member form modal (photo, fingerprint, waiver, personal info, plan, coaching, payments) (P2 6.6). */
function MemberFormModal(props: MemberFormModalProps) {
  const {
    selectedMember, plans, coaches, members, formData, onFormDataChange, paymentForm, onPaymentFormChange,
    photoPreview, initialFingers, captureFinger, onFingerprintsChange, waiverAgreed, waiverAgreedAt,
    waiverTemplates, waiverTemplateId, onWaiverTemplateChange, validationAttempted, shakeKey, missingRequired,
    memberIdWarning, checkingMemberId, lastMemberId, lastMemberIdLoaded,
    memberPayments, paymentsLoading, isAdmin, autoRenew, onAutoRenewChange, refs, onMemberIdChange,
    onPhotoUpload, onCameraCapture, onPaymentStatus, onWaiverAgree, onSubmit, onClose,
  } = props

  const [showWaiverModal, setShowWaiverModal] = React.useState(false)

  const setFormData = (d: Partial<MemberFormData>) => onFormDataChange({ ...formData, ...d })

  // Create-mode only: multi-session packs (sessions > 1) intentionally have no
  // end date — the Plan End field is disabled so no one types a date that the
  // submit path would silently discard.
  const isCreateMultiSessionPack = !selectedMember && (() => {
    const plan = plans.find(p => p.id === formData.plan_id)
    return !!plan && plan.type === 'session_pack' && (plan.sessions || 0) > 1
  })()

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="display-text">{selectedMember ? 'Edit Member' : 'New Member'}</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="enrollment-layout">
            {/* Photo and Fingerprint Section */}
            <div className="enrollment-sidebar">
              {/* Photo Upload */}
              <div className="enrollment-card">
                <label className="section-label">Profile Photo</label>
                <div className="photo-container">
                  {photoPreview ? (
                    <img src={photoPreview} alt="Profile" className="photo-preview" />
                  ) : (
                    <div className="photo-placeholder">
                      <span className="photo-icon">📷</span>
                      <span>No photo</span>
                    </div>
                  )}
                  <div className="photo-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={onCameraCapture}>📸 Take Photo</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => refs.fileInputRef.current?.click()}>📁 Upload</button>
                  </div>
                  <input ref={refs.fileInputRef} type="file" accept="image/*" onChange={onPhotoUpload} style={{ display: 'none' }} />
                </div>
              </div>

              {/* Waiver Agreement */}
              <div ref={refs.waiverRef} className={`enrollment-card ${!selectedMember && !waiverAgreed ? 'enrollment-card-required' : ''}`}>
                <label className="section-label">
                  📄 Waiver Agreement {!selectedMember && <span className="req-badge">Required</span>}
                </label>
                <div className="waiver-container">
                  {waiverAgreed || (selectedMember?.waiver_agreed_at) ? (
                    <div className="waiver-signed">
                      <div className="waiver-success-icon">✓</div>
                      <span className="waiver-status success">Waiver Agreed & Signed</span>
                      <span className="waiver-hint">
                        {selectedMember?.waiver_agreed_at || waiverAgreedAt
                          ? `Agreed and signed on ${new Date((selectedMember?.waiver_agreed_at || waiverAgreedAt)!).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                          : 'Member agreed to the terms'}
                      </span>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowWaiverModal(true)}>
                        View Waiver
                      </button>
                    </div>
                  ) : (
                    <div className="waiver-pending">
                      <div className="waiver-icon-large">📄</div>
                      <span className="waiver-status">{selectedMember ? 'No waiver on file' : 'Member must agree to waiver'}</span>
                      <span className="waiver-hint">
                        {selectedMember ? 'Waiver was not signed during enrollment' : 'Required — member must sign the waiver before they can be created'}
                      </span>
                      {!selectedMember && (
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowWaiverModal(true)}>
                          View & Sign Waiver
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Fingerprint Registration — Windows Hello-style 3-tap enrollment (P2 6.9) */}
              <div className="enrollment-card">
                <label className="section-label">
                  Fingerprint Registration
                  <span className="fingerprint-count">{initialFingers.filter(f => f.fmdBase64).length}/{ENROLL_STEPS}</span>
                </label>
                <FingerprintEnrollment
                  initialFingers={initialFingers}
                  captureFinger={captureFinger}
                  onEnrolled={onFingerprintsChange}
                  hint="Tap the finger 3 times to finish enrollment. Registered fingerprints are used for kiosk login and check-in."
                />
              </div>
            </div>

            {/* Basic Info Form */}
            <div className="enrollment-form">
              <div className="member-form-card">
                <h3 className="section-label">👤 Personal Information</h3>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Member ID</label>
                    <div className="member-id-input-row">
                      <input
                        type="text"
                        className={`input ${memberIdWarning ? 'input-warning' : ''}`}
                        value={formData.member_id}
                        onChange={(e) => onMemberIdChange(e.target.value)}
                        placeholder="Auto-generated if empty"
                        disabled={!!selectedMember}
                      />
                      {!selectedMember && lastMemberIdLoaded && lastMemberId.last > 0 && !formData.member_id.trim() && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm member-id-suggest"
                          onClick={() => onMemberIdChange(String(lastMemberId.next))}
                          title={`Last ID entered was ${lastMemberId.last}. Use the next number.`}
                        >
                          Use ID {lastMemberId.next}
                        </button>
                      )}
                    </div>
                    {!selectedMember && lastMemberIdLoaded && (
                      <span className="member-id-hint">
                        Last ID used: <strong>{lastMemberId.last || '—'}</strong>
                        {lastMemberId.last > 0 && <> · Next suggested: <strong>{lastMemberId.next}</strong></>}
                      </span>
                    )}
                    {checkingMemberId && <span className="member-id-checking">Checking...</span>}
                    {memberIdWarning && <span className="member-id-warning">{memberIdWarning}</span>}
                  </div>
                  {selectedMember && (
                    <div className="form-group">
                      <label>Member Since</label>
                      <input
                        type="text"
                        className="input"
                        value={selectedMember.created_at ? new Date(selectedMember.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'}
                        disabled
                        readOnly
                      />
                    </div>
                  )}
                  <div className="form-group">
                    <label>Name *</label>
                    <input
                      type="text"
                      className={`input ${!formData.name.trim() ? 'input-required-missing' : ''}`}
                      value={formData.name}
                      onChange={(e) => setFormData({ name: e.target.value })}
                      placeholder="Full name"
                      required
                      ref={refs.nameRef}
                    />
                    {!formData.name.trim() && <span className="field-required-hint">⚠️ Name is required</span>}
                  </div>
                  <div className="form-group">
                    <label>Email</label>
                    <input type="email" className="input" value={formData.email} onChange={(e) => setFormData({ email: e.target.value })} placeholder="email@example.com" />
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input type="tel" className="input" value={formData.phone} onChange={(e) => setFormData({ phone: e.target.value })} placeholder="+63 9XX XXX XXXX" />
                  </div>
                  <div className="form-group">
                    <label>Emergency Contact</label>
                    <input type="text" className="input" value={formData.emergency_contact} onChange={(e) => setFormData({ emergency_contact: e.target.value })} placeholder="Contact name" />
                  </div>
                  <div className="form-group">
                    <label>Emergency Phone</label>
                    <input type="tel" className="input" value={formData.emergency_phone} onChange={(e) => setFormData({ emergency_phone: e.target.value })} placeholder="+63 9XX XXX XXXX" />
                  </div>
                  <div className="form-group">
                    <label>Birthday</label>
                    <input type="date" className="input" value={formData.birthday} onChange={(e) => setFormData({ birthday: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Height (cm)</label>
                    <input type="number" className="input" value={formData.height} onChange={(e) => setFormData({ height: e.target.value })} placeholder="e.g. 175" step="0.1" />
                  </div>
                  <div className="form-group">
                    <label>Weight (kg)</label>
                    <input type="number" className="input" value={formData.weight} onChange={(e) => setFormData({ weight: e.target.value })} placeholder="e.g. 75" step="0.1" />
                  </div>
                  {selectedMember && (
                    <div className="form-group">
                      <label>Status</label>
                      <select className="input" value={formData.status} onChange={(e) => setFormData({ status: e.target.value as any })}>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="expired">Expired</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {selectedMember && (
                <div className="member-form-card">
                  <h3 className="section-label">💳 Payment History</h3>
                  {paymentsLoading ? (
                    <p className="payment-muted">Loading payments…</p>
                  ) : memberPayments.length === 0 ? (
                    <p className="payment-muted">No payments recorded for this member.</p>
                  ) : (
                    <div className="payment-history-table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
                      <table className="payment-history-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Type</th>
                            <th>Method</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {memberPayments.map(pay => (
                            <tr key={pay.id}>
                              <td className="mono-text">{new Date(pay.created_at).toLocaleDateString()}</td>
                              <td><span className={`type-tag type-${pay.type}`}>{pay.type}</span></td>
                              <td className="td-method">{pay.payment_method || '—'}</td>
                              <td className="td-amount mono-text">{formatMoney(pay.amount)}</td>
                              <td><span className={`pay-status ${pay.status || 'completed'}`}>{pay.status || 'completed'}</span></td>
                              <td>
                                {(pay.status === 'completed' || !pay.status) && isAdmin && (
                                  <div className="table-actions">
                                    <button className="btn-icon" title="Refund payment" onClick={() => onPaymentStatus(pay, 'refunded')}>↩️</button>
                                    <button className="btn-icon danger" title="Void payment" onClick={() => onPaymentStatus(pay, 'voided')}>✕</button>
                                  </div>
                                )}
                                {pay.note && <span title={pay.note} style={{ cursor: 'help', color: 'var(--text-faint)' }}>ℹ️</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {!selectedMember && (
                <div className="member-form-card">
                  <h3 className="section-label">📋 Membership Plan</h3>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Plan *</label>
                      <select
                        ref={refs.planRef}
                        className={`input ${formData.plan_id === 0 ? 'input-required-missing' : ''}`}
                        value={formData.plan_id}
                        onChange={(e) => {
                          const planId = Number(e.target.value)
                          const plan = plans.find(p => p.id === planId)
                          const prevPlan = plans.find(p => p.id === formData.plan_id)
                          // Keep the selected coach's professional fee in the auto-filled total
                          const coachFee = formData.coach_id > 0 ? (coaches.find(c => c.id === formData.coach_id)?.professional_fee || 0) : 0
                          // Plan dates follow the plan: end = start + duration_days
                          // (per-session passes = +1 day; multi-session packs = no end
                          // date). Start defaults to today when not yet set.
                          const start = formData.plan_start || todayLocal()
                          onFormDataChange({
                            ...formData,
                            plan_id: planId,
                            plan_start: start,
                            plan_end: plan ? planEndDate(plan, start) : '',
                            balance: plan ? plan.price : 0,
                          })
                          onPaymentFormChange((prev) => {
                            const wasAutoFilled = prev.amount <= 0 || prev.amount === (prevPlan?.price || 0) + coachFee
                            if (planId === 0) {
                              if (prevPlan && wasAutoFilled) return { ...prev, amount: coachFee }
                              return prev
                            }
                            if (wasAutoFilled) return { ...prev, amount: (plan ? plan.price : 0) + coachFee }
                            return prev
                          })
                        }}
                      >
                        <option value={0}>— Select a plan —</option>
                        {plans.map((plan) => (
                          <option key={plan.id} value={plan.id}>{plan.name} ({formatMoney(plan.price)})</option>
                        ))}
                      </select>
                      {formData.plan_id === 0 && <span className="field-required-hint">⚠️ Select a plan</span>}
                    </div>
                    <div className="form-group">
                      <label>Balance</label>
                      <input type="number" className="input" value={formData.balance} onChange={(e) => setFormData({ balance: Number(e.target.value) })} step="0.01" />
                    </div>
                    <div className="form-group">
                      <label>Plan Start</label>
                      <input
                        type="date"
                        className="input"
                        value={formData.plan_start}
                        onChange={(e) => {
                          const val = e.target.value
                          setFormData({
                            ...formData,
                            plan_start: val,
                            // Keep coaching start in sync with the plan when it wasn't customized
                            coaching_start: formData.coach_id > 0 && (!formData.coaching_start.trim() || formData.coaching_start === formData.plan_start)
                              ? val
                              : formData.coaching_start,
                          })
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label>Plan End</label>
                      <input
                        type="date"
                        className="input"
                        value={formData.plan_end}
                        onChange={(e) => {
                          const val = e.target.value
                          setFormData({
                            ...formData,
                            plan_end: val,
                            // Keep coaching end in sync with the plan when it wasn't customized
                            coaching_end: formData.coach_id > 0 && (!formData.coaching_end.trim() || formData.coaching_end === formData.plan_end)
                              ? val
                              : formData.coaching_end,
                          })
                        }}
                        disabled={isCreateMultiSessionPack}
                        title={isCreateMultiSessionPack ? 'Multi-session packs have no time-based end' : ''}
                      />
                      {isCreateMultiSessionPack ? (
                        <span className="field-hint">Multi-session packs don't expire by time — no end date.</span>
                      ) : (
                        formData.plan_end && <span className="field-hint">Auto-filled from the plan — adjust if needed</span>
                      )}
                    </div>
                  </div>
                  {/* P2 5.2: auto-renew toggle for new members */}
                  <div className="form-group auto-renew-toggle">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={autoRenew}
                        onChange={(e) => onAutoRenewChange(e.target.checked)}
                      />
                      <span>Auto-renew at plan expiry</span>
                    </label>
                    <p className="field-hint">The membership renews automatically when the plan expires.</p>
                  </div>
                </div>
              )}

              {!selectedMember && (
                <div className="member-form-card">
                  <h3 className="section-label">🏋️ Coaching</h3>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Coach</label>
                      <select
                        className="input"
                        value={formData.coach_id}
                        onChange={(e) => {
                          const cid = Number(e.target.value)
                          const newCoach = cid > 0 ? coaches.find(c => c.id === cid) : undefined
                          const oldCoach = formData.coach_id > 0 ? coaches.find(c => c.id === formData.coach_id) : undefined
                          const newFee = newCoach?.professional_fee || 0
                          const oldFee = oldCoach?.professional_fee || 0
                          setFormData({
                            coach_id: cid,
                            // Auto-fill coaching dates from the plan dates when a coach is picked
                            coaching_start: cid > 0 ? (formData.coaching_start || formData.plan_start) : '',
                            coaching_end: cid > 0 ? (formData.coaching_end || formData.plan_end) : '',
                          })
                          // Add the coach's professional fee to the amount to be paid
                          onPaymentFormChange((prev) => {
                            const plan = plans.find(p => p.id === formData.plan_id)
                            const planPrice = plan?.price || 0
                            const wasAutoFilled = prev.amount === planPrice + oldFee
                            if (prev.amount <= 0 || wasAutoFilled) {
                              return { ...prev, amount: Math.max(0, planPrice + newFee) }
                            }
                            return prev
                          })
                        }}
                      >
                        <option value={0}>No coach</option>
                        {coaches.map((coach) => (
                          <option key={coach.id} value={coach.id}>{coach.name}</option>
                        ))}
                      </select>
                      {formData.coach_id > 0 && (() => {
                        const selectedCoach = coaches.find(c => c.id === formData.coach_id)
                        if (!selectedCoach) return null
                        return (
                          <div className="member-coach-fee-display">
                            <span className="member-coach-fee-label">Professional Fee</span>
                            {selectedCoach.professional_fee ? (
                              <span className="member-coach-fee-amount">{formatMoney(selectedCoach.professional_fee)}</span>
                            ) : (
                              <span className="member-coach-fee-none">No fee set</span>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                    {formData.coach_id > 0 && (
                      <div className="form-group">
                        <label>Coaching Start</label>
                        <input type="date" className="input" value={formData.coaching_start} onChange={(e) => setFormData({ coaching_start: e.target.value })} />
                      </div>
                    )}
                    {formData.coach_id > 0 && (
                      <div className="form-group">
                        <label>Coaching End</label>
                        <input type="date" className="input" value={formData.coaching_end} onChange={(e) => setFormData({ coaching_end: e.target.value })} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Referral (P2 5.8): who referred this new member — the referrer
                  earns 20 reward points, redeemable for a free month at 100 pts. */}
              {!selectedMember && (
                <div className="member-form-card">
                  <h3 className="section-label">🎁 Referral</h3>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Referred By</label>
                      <select
                        className="input"
                        value={formData.referrer_id}
                        onChange={(e) => setFormData({ referrer_id: Number(e.target.value) })}
                      >
                        <option value={0}>— No referral —</option>
                        {[...members]
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((m) => (
                            <option key={m.id} value={m.id}>{m.name} ({m.member_id})</option>
                          ))}
                      </select>
                      {formData.referrer_id > 0 && (() => {
                        const referrer = members.find(m => m.id === formData.referrer_id)
                        return (
                          <span className="field-hint">
                            ⭐ {referrer?.name || 'This member'} will earn <strong>20 points</strong> for this referral.
                          </span>
                        )
                      })()}
                      <span className="field-hint">
                        Members earn 20 points per referral — 100 points = 1 month of free membership.
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Payments Section (create mode only) — required ── */}
          {!selectedMember && (
            <div className="payment-section">
              <div className="payment-section-header">
                <h3 className="section-label" style={{ margin: 0 }}>💰 Payments <span className="req-badge">Required</span></h3>
                <div className="payment-section-actions">
                  <span className="payment-hint">A payment is required to create this member</span>
                </div>
              </div>
              {/* Amount breakdown: plan + coach fee = total to be paid */}
              {(formData.plan_id > 0 || formData.coach_id > 0) && (() => {
                const selectedPlan = plans.find(p => p.id === formData.plan_id)
                const selectedCoach = formData.coach_id > 0 ? coaches.find(c => c.id === formData.coach_id) : undefined
                const coachFee = selectedCoach?.professional_fee || 0
                const total = (selectedPlan?.price || 0) + coachFee
                return (
                  <div className="newplan-payment-summary" style={{ marginBottom: 12 }}>
                    {selectedPlan && (
                      <div className="summary-row">
                        <span>Plan — {selectedPlan.name}</span>
                        <span className="mono-text">{formatMoney(selectedPlan.price)}</span>
                      </div>
                    )}
                    {selectedCoach && (
                      <div className="summary-row">
                        <span>Coach fee — {selectedCoach.name}</span>
                        <span className="mono-text">{coachFee ? formatMoney(coachFee) : '—'}</span>
                      </div>
                    )}
                    <div className="summary-row summary-total">
                      <span>Total to be paid</span>
                      <span className="mono-text">{formatMoney(total)}</span>
                    </div>
                  </div>
                )
              })()}
              <div className="payment-form">
                <div className="payment-form-grid">
                  <div className="form-group">
                    <label>Amount *</label>
                    <input
                      ref={refs.paymentRef}
                      type="number"
                      className={`input ${paymentForm.amount <= 0 ? 'input-required-missing' : ''}`}
                      value={paymentForm.amount || ''}
                      onChange={(e) => onPaymentFormChange({ ...paymentForm, amount: Number(e.target.value) })}
                      placeholder="0.00"
                      step="0.01"
                      min="1"
                    />
                    {paymentForm.amount <= 0 && <span className="field-required-hint">⚠️ Enter a payment amount</span>}
                  </div>
                  <div className="form-group">
                    <label>Payment Type</label>
                    <select className="input" value={paymentForm.type} onChange={(e) => onPaymentFormChange({ ...paymentForm, type: e.target.value as any })}>
                      <option value="new_plan">New Plan</option>
                      <option value="renewal">Renewal</option>
                      <option value="top_up">Top Up</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Payment Method</label>
                    <select className="input" value={paymentForm.payment_method} onChange={(e) => onPaymentFormChange({ ...paymentForm, payment_method: e.target.value, transaction_ref: '' })}>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="gcash">GCash</option>
                      <option value="maya">Maya</option>
                      <option value="bank_transfer">Bank Transfer</option>
                    </select>
                  </div>
                  {METHODS_REQUIRING_REF.includes(paymentForm.payment_method) && (
                    <div className="form-group">
                      <label>Transaction Number *</label>
                      <input
                        ref={refs.transactionRefRef}
                        type="text"
                        className={`input ${!paymentForm.transaction_ref.trim() ? 'input-required-missing' : ''}`}
                        value={paymentForm.transaction_ref}
                        onChange={(e) => onPaymentFormChange({ ...paymentForm, transaction_ref: e.target.value })}
                        placeholder="e.g. 1234567890"
                      />
                      {!paymentForm.transaction_ref.trim() && <span className="field-required-hint">⚠️ Transaction number required for this method</span>}
                    </div>
                  )}
                  <div className="form-group payment-form-actions">
                    <label>&nbsp;</label>
                    <div className="payment-btn-row">
                      <span className="payment-create-note">Payment will be applied when you click "Create Member"</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {missingRequired.length > 0 ? (
            <span key={shakeKey} className={`footer-required-note ${validationAttempted ? 'flash' : ''}`}>
              ⚠️ Missing: {missingRequired.join(', ')}
            </span>
          ) : (
            <span className="footer-required-note ok">✓ All required fields complete</span>
          )}
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSubmit}>
            {selectedMember ? 'Save Changes' : 'Create Member'}
          </button>
        </div>
      </div>

      <WaiverModal
        open={showWaiverModal}
        showAgree={!selectedMember}
        title={waiverTemplates.find(t => t.id === waiverTemplateId)?.title || waiverTemplates[0]?.title}
        content={waiverTemplates.find(t => t.id === waiverTemplateId)?.content || waiverTemplates[0]?.content}
        onClose={() => setShowWaiverModal(false)}
        onAgree={() => {
          setShowWaiverModal(false)
          onWaiverAgree()
        }}
      />
    </div>
  )
}

export default MemberFormModal
