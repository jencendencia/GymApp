import React, { useEffect, useRef, useState } from 'react'
import { Member, Plan } from '../../types/electron'
import { formatMoney } from '../../lib/format'
import WaiverModal from './WaiverModal'

// Payment methods that require a transaction reference number
const METHODS_REQUIRING_REF = ['gcash', 'maya', 'bank_transfer', 'card']

export interface NewPlanData {
  plan_id: number
  plan_start: string
  plan_end: string
}

export interface NewPlanPayment {
  amount: number
  payment_method: string
  transaction_ref: string
}

interface NewPlanModalProps {
  member: Member
  plans: Plan[]
  data: NewPlanData
  payment: NewPlanPayment
  autoRenew: boolean
  waiverAgreed: boolean
  waiverAgreedAt: string | null
  validationAttempted: boolean
  shakeKey: number
  missing: string[]
  onDataChange: (data: NewPlanData) => void
  onPaymentChange: (payment: NewPlanPayment) => void
  onAutoRenewChange: (autoRenew: boolean) => void
  /** Parent records waiver agreement (timestamp + activity log) and this closes the modal. */
  onWaiverAgree: () => void
  onSubmit: () => void
  onCancel: () => void
}

/** New Plan / renewal modal — plan select, waiver, and payment (P2 6.6). */
function NewPlanModal(props: NewPlanModalProps) {
  const { member, plans, data, payment, autoRenew, waiverAgreed, waiverAgreedAt, validationAttempted, shakeKey, missing } = props
  const planRef = useRef<HTMLSelectElement>(null)
  const paymentRef = useRef<HTMLInputElement>(null)
  const txnRef = useRef<HTMLInputElement>(null)
  const waiverRef = useRef<HTMLDivElement>(null)
  const [showWaiver, setShowWaiver] = useState(false)

  // P2 6.6: restore the original scroll-to-first-missing behavior when validation fails
  useEffect(() => {
    if (!validationAttempted || missing.length === 0) return
    const targets: { el: HTMLElement | null }[] = [
      { el: data.plan_id === 0 ? planRef.current : null },
      { el: !member.waiver_agreed_at && !waiverAgreed ? waiverRef.current : null },
      { el: payment.amount <= 0 ? paymentRef.current : null },
      { el: METHODS_REQUIRING_REF.includes(payment.payment_method) && !payment.transaction_ref.trim() ? txnRef.current : null },
    ]
    const first = targets.find(t => t.el)?.el
    first?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validationAttempted])

  // P2 5.2: partial-payment summary — plan price vs paying now vs remaining
  const selectedPlan = plans.find(p => p.id === data.plan_id)
  const planPrice = selectedPlan?.price || 0
  const payingNow = payment.amount > 0 ? payment.amount : 0
  const remainingAfter = Math.max(0, (member.balance || 0) + planPrice - payingNow)

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="display-text">New Plan — {member.name}</h2>
          <button className="btn-icon" onClick={props.onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-group">
              <label>Plan *</label>
              <select
                ref={planRef}
                className={`input ${validationAttempted && data.plan_id === 0 ? 'input-required-missing' : ''}`}
                value={data.plan_id}
                onChange={(e) => props.onDataChange({ ...data, plan_id: Number(e.target.value) })}
              >
                <option value={0}>— Select a plan —</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} ({formatMoney(plan.price)})
                  </option>
                ))}
              </select>
              {validationAttempted && data.plan_id === 0 && (
                <span className="field-required-hint">⚠️ Select a plan</span>
              )}
            </div>
            <div className="form-group">
              <label>Plan Start</label>
              <input
                type="date"
                className="input"
                value={data.plan_start}
                onChange={(e) => props.onDataChange({ ...data, plan_start: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Plan End</label>
              <input
                type="date"
                className="input"
                value={data.plan_end}
                onChange={(e) => props.onDataChange({ ...data, plan_end: e.target.value })}
              />
            </div>            </div>

            {/* P2 5.2: auto-renew toggle */}
            <div className="newplan-auto-renew">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={autoRenew}
                  onChange={(e) => props.onAutoRenewChange(e.target.checked)}
                />
                <span>Auto-renew when this plan expires</span>
              </label>
              <p className="field-hint">When enabled, REPCHECK automatically starts a new term at expiry and records a renewal payment.</p>
            </div>

          {/* ── Waiver Section (Renewal) ── */}
          <div className="newplan-waiver-section">
            <span className="section-label" style={{ margin: 0 }}>📄 Waiver Agreement</span>
            <div ref={waiverRef} className={`renew-waiver-box ${validationAttempted && !member.waiver_agreed_at && !waiverAgreed ? 'enrollment-card-required' : ''}`}>
              {waiverAgreed || member?.waiver_agreed_at ? (
                <div className="renew-waiver-signed">
                  <div className="waiver-success-icon" style={{ width: 36, height: 36, fontSize: 18 }}>✓</div>
                  <span className="renew-waiver-status success">Waiver on File</span>
                  <span className="renew-waiver-hint">
                    {waiverAgreedAt
                      ? `Signed ${new Date(waiverAgreedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                      : 'Waiver already on record'}
                  </span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowWaiver(true)}>
                    View Waiver
                  </button>
                </div>
              ) : (
                <div className="renew-waiver-pending">
                  <div className="waiver-icon-large" style={{ fontSize: 24 }}>📄</div>
                  <span className="renew-waiver-status">No waiver on file</span>
                  <span className="renew-waiver-hint">Member must sign waiver before renewal</span>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowWaiver(true)}>
                    View & Sign Waiver
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Payment section for new plan — required */}
          <div className="newplan-payment-section">
            <div className="newplan-payment-header">
              <span className="section-label" style={{ margin: 0 }}>💰 Payment <span className="req-badge">Required</span></span>
              <span className="newplan-balance mono-text">
                Current Balance: <strong className={member.balance > 0 ? 'danger' : ''}>{formatMoney(member.balance || 0)}</strong>
              </span>
            </div>
            <div className="payment-form newplan-payment-form">
              <div className="payment-form-grid">
                <div className="form-group">
                  <label>Amount *</label>
                  <input
                    ref={paymentRef}
                    type="number"
                    className={`input ${validationAttempted && payment.amount <= 0 ? 'input-required-missing' : ''}`}
                    value={payment.amount || ''}
                    onChange={(e) => props.onPaymentChange({ ...payment, amount: Number(e.target.value) })}
                    placeholder="0.00"
                    step="0.01"
                    min="1"
                  />
                  {validationAttempted && payment.amount <= 0 && (
                    <span className="field-required-hint">⚠️ Enter a payment amount</span>
                  )}
                </div>
                <div className="form-group">
                  <label>Payment Method</label>
                  <select
                    className="input"
                    value={payment.payment_method}
                    onChange={(e) => props.onPaymentChange({ ...payment, payment_method: e.target.value, transaction_ref: '' })}
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="gcash">GCash</option>
                    <option value="maya">Maya</option>
                    <option value="bank_transfer">Bank Transfer</option>
                  </select>
                </div>
                {METHODS_REQUIRING_REF.includes(payment.payment_method) && (
                  <div className="form-group">
                    <label>Transaction Number *</label>
                    <input
                      ref={txnRef}
                      type="text"
                      className={`input ${validationAttempted && !payment.transaction_ref.trim() ? 'input-required-missing' : ''}`}
                      value={payment.transaction_ref}
                      onChange={(e) => props.onPaymentChange({ ...payment, transaction_ref: e.target.value })}
                      placeholder="e.g. 1234567890"
                    />
                    {validationAttempted && !payment.transaction_ref.trim() && (
                      <span className="field-required-hint">⚠️ Transaction number required for this method</span>
                    )}
                  </div>
                )}
              </div>

              {/* P2 5.2: partial-payment summary — plan price vs paying now vs remaining */}
              <div className="newplan-payment-summary">
                <div className="summary-row"><span>Plan price</span><span className="mono-text">{formatMoney(planPrice)}</span></div>
                <div className="summary-row"><span>Paying now</span><span className="mono-text">{formatMoney(payingNow)}</span></div>
                <div className="summary-row summary-total">
                  <span>Remaining balance</span>
                  <span className={`mono-text ${remainingAfter > 0 ? 'danger' : ''}`}>{formatMoney(remainingAfter)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          {missing.length > 0 ? (
            <span key={shakeKey} className={`footer-required-note ${validationAttempted ? 'flash' : ''}`}>
              ⚠️ Missing: {missing.join(', ')}
            </span>
          ) : (
            <span className="footer-required-note ok">✓ All required fields complete</span>
          )}
          <button className="btn btn-secondary" onClick={props.onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={props.onSubmit}>Assign Plan</button>
        </div>
      </div>

      <WaiverModal
        open={showWaiver}
        showAgree
        onClose={() => setShowWaiver(false)}
        onAgree={() => {
          setShowWaiver(false)
          props.onWaiverAgree()
        }}
      />
    </div>
  )
}

export default NewPlanModal
