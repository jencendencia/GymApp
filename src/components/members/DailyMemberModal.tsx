import React, { useState } from 'react'
import { Plan, WaiverTemplate } from '../../types/electron'
import { formatMoney } from '../../lib/format'
import { todayLocal, planEndDate } from '../../lib/dates'
import { log } from '../../lib/logger'
import { useToast } from '../../lib/toast'
import { notifyDataChanged } from '../../lib/data'
import WaiverModal from './WaiverModal'
import FingerprintEnrollment, { ENROLL_STEPS, FingerprintSlotData, emptyFingerSlots } from '../FingerprintEnrollment'

// Payment methods that require a transaction reference number
const METHODS_REQUIRING_REF = ['gcash', 'maya', 'bank_transfer', 'card']

interface DailyMemberModalProps {
  /** All plans — the modal filters to the 'daily' type. */
  plans: Plan[]
  waiverTemplates: WaiverTemplate[]
  /** Capture one finger from the U.are.U reader; null = cancelled/timeout. */
  captureFinger: () => Promise<FingerprintSlotData | null>
  /** Fired after a successful daily enrollment. */
  onCreated: () => void
  onClose: () => void
}

/** Quick daily-member enrollment — name, waiver, fingerprint, daily plan, payment (P3). */
function DailyMemberModal({ plans, waiverTemplates, captureFinger, onCreated, onClose }: DailyMemberModalProps) {
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [waiverAgreed, setWaiverAgreed] = useState(false)
  const [waiverAgreedAt, setWaiverAgreedAt] = useState<string | null>(null)
  const [showWaiverModal, setShowWaiverModal] = useState(false)
  const [fingers, setFingers] = useState<FingerprintSlotData[]>(emptyFingerSlots)
  const [planId, setPlanId] = useState(0)
  const [amount, setAmount] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [transactionRef, setTransactionRef] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Only daily-type plans are valid for this quick enrollment
  const dailyPlans = plans.filter(p => p.type === 'daily')
  const selectedPlan = dailyPlans.find(p => p.id === planId)

  const waiverTemplate = waiverTemplates.find(t => t.is_default) || waiverTemplates[0]

  const requiresRef = METHODS_REQUIRING_REF.includes(paymentMethod)

  const handlePlanChange = (id: number) => {
    setPlanId(id)
    const plan = dailyPlans.find(p => p.id === id)
    if (plan) setAmount(plan.price)
    setError('')
  }

  const handleSubmit = async () => {
    // Validation
    if (!name.trim()) {
      setError('Please enter the member name.')
      return
    }
    if (!waiverAgreed) {
      setError('The member must agree to the waiver before enrolling.')
      return
    }
    if (!selectedPlan) {
      setError('Please select a daily membership plan.')
      return
    }
    if (amount <= 0) {
      setError('Please enter a payment amount.')
      return
    }
    if (requiresRef && !transactionRef.trim()) {
      setError('Please enter the transaction reference number.')
      return
    }

    setLoading(true)
    setError('')

    try {
      // Auto-generate a member ID (same scheme as the main member form)
      const memberId = 'MEM-' + Date.now().toString(36).toUpperCase()
      const start = todayLocal()
      const end = planEndDate(selectedPlan, start) || undefined

      const result = await window.electronAPI.createMember({
        member_id: memberId,
        name: name.trim(),
        plan_id: selectedPlan.id,
        plan_start: start,
        plan_end: end,
        balance: selectedPlan.price || 0,
        waiver_agreed_at: waiverAgreedAt || new Date().toISOString(),
        waiver_template_id: waiverTemplate?.id,
        auto_renew: 0,
      })
      const newNumericId = result?.lastInsertRowid ? Number(result.lastInsertRowid) : 0
      if (!newNumericId) throw new Error('Failed to create the daily member.')

      // Save enrolled fingerprint templates (up to 3) so the member can check in
      const enrolled = fingers.filter(f => f.fmdBase64)
      if (enrolled.length > 0) {
        await window.electronAPI.replaceFingerprints(
          newNumericId,
          enrolled.map(f => ({ fmdBase64: f.fmdBase64!, quality: f.quality || 0 }))
        )
        log.registerFingerprint(newNumericId, name.trim())
      }

      // Record the payment and settle the balance
      await window.electronAPI.createPayment({
        member_id: newNumericId,
        amount,
        type: 'new_plan',
        plan_id: selectedPlan.id,
        payment_method: paymentMethod,
        transaction_ref: transactionRef.trim() || undefined,
      })
      const updatedBalance = Math.max(0, (selectedPlan.price || 0) - amount)
      await window.electronAPI.updateMember(newNumericId, {
        name: name.trim(),
        plan_id: selectedPlan.id,
        plan_start: start,
        plan_end: end,
        balance: updatedBalance,
        status: 'active',
      })
      log.action({
        action: 'record_payment',
        entity_type: 'payment',
        entity_id: newNumericId,
        details: JSON.stringify({ member_name: name.trim(), amount, type: 'new_plan', method: paymentMethod }),
      })
      log.createMember(newNumericId, name.trim())

      notifyDataChanged()
      onCreated()
      showToast('success', `Daily member "${name.trim()}" enrolled.`)
      onClose()
    } catch (err: any) {
      console.error('Failed to create daily member:', err)
      setError(err?.message || 'Failed to create the daily member.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => { if (!loading) onClose() }}>
      <div className="modal modal-lg daily-member-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="display-text">☀️ Daily Member</h2>
          <button className="btn-icon" onClick={onClose} disabled={loading}>✕</button>
        </div>
        <div className="modal-body">
          <div className="member-form-card">
            <h3 className="section-label">👤 Member</h3>
            <div className="form-group">
              <label>Name *</label>
              <input
                type="text"
                className={`input ${!name.trim() ? 'input-required-missing' : ''}`}
                value={name}
                onChange={(e) => { setName(e.target.value); setError('') }}
                placeholder="Full name"
                required
                autoFocus
              />
              {!name.trim() && <span className="field-required-hint">⚠️ Name is required</span>}
            </div>
          </div>

          {/* Waiver Agreement */}
          <div className={`enrollment-card ${!waiverAgreed ? 'enrollment-card-required' : ''}`}>
            <label className="section-label">
              📄 Waiver Agreement <span className="req-badge">Required</span>
            </label>
            <div className="waiver-container">
              {waiverAgreed ? (
                <div className="waiver-signed">
                  <div className="waiver-success-icon">✓</div>
                  <span className="waiver-status success">Waiver Agreed & Signed</span>
                  <span className="waiver-hint">
                    {waiverAgreedAt
                      ? `Agreed and signed on ${new Date(waiverAgreedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                      : 'Member agreed to the terms'}
                  </span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowWaiverModal(true)}>
                    View Waiver
                  </button>
                </div>
              ) : (
                <div className="waiver-pending">
                  <div className="waiver-icon-large">📄</div>
                  <span className="waiver-status">Member must agree to waiver</span>
                  <span className="waiver-hint">Required — the member must sign the waiver before they can be enrolled</span>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowWaiverModal(true)}>
                    View & Sign Waiver
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Fingerprint Registration */}
          <div className="enrollment-card">
            <label className="section-label">
              Fingerprint Registration
              <span className="fingerprint-count">{fingers.filter(f => f.fmdBase64).length}/{ENROLL_STEPS}</span>
            </label>
            <FingerprintEnrollment
              initialFingers={fingers}
              captureFinger={captureFinger}
              onEnrolled={setFingers}
              hint="Register the member's fingerprint so they can check in at the kiosk."
            />
          </div>

          {/* Membership Plan */}
          <div className="member-form-card">
            <h3 className="section-label">📋 Daily Membership Plan</h3>
            {dailyPlans.length === 0 ? (
              <p className="payment-muted">
                No daily plan created yet. Add a <strong>Daily</strong> plan in the Plans page first.
              </p>
            ) : (
              <div className="form-grid">
                <div className="form-group">
                  <label>Plan *</label>
                  <select
                    className={`input ${planId === 0 ? 'input-required-missing' : ''}`}
                    value={planId}
                    onChange={(e) => handlePlanChange(Number(e.target.value))}
                  >
                    <option value={0}>— Select a plan —</option>
                    {dailyPlans.map((plan) => (
                      <option key={plan.id} value={plan.id}>{plan.name} ({formatMoney(plan.price)})</option>
                    ))}
                  </select>
                  {planId === 0 && <span className="field-required-hint">⚠️ Select a plan</span>}
                </div>
              </div>
            )}
          </div>

          {/* Payment */}
          {selectedPlan && (
            <div className="payment-section">
              <div className="payment-section-header">
                <h3 className="section-label" style={{ margin: 0 }}>💰 Payment <span className="req-badge">Required</span></h3>
              </div>
              {selectedPlan && (
                <div className="newplan-payment-summary" style={{ marginBottom: 12 }}>
                  <div className="summary-row">
                    <span>Plan — {selectedPlan.name}</span>
                    <span className="mono-text">{formatMoney(selectedPlan.price)}</span>
                  </div>
                  <div className="summary-row summary-total">
                    <span>Total to be paid</span>
                    <span className="mono-text">{formatMoney(selectedPlan.price)}</span>
                  </div>
                </div>
              )}
              <div className="payment-form">
                <div className="payment-form-grid">
                  <div className="form-group">
                    <label>Amount *</label>
                    <input
                      type="number"
                      className={`input ${amount <= 0 ? 'input-required-missing' : ''}`}
                      value={amount || ''}
                      onChange={(e) => { setAmount(Number(e.target.value)); setError('') }}
                      placeholder="0.00"
                      step="0.01"
                      min="1"
                    />
                    {amount <= 0 && <span className="field-required-hint">⚠️ Enter a payment amount</span>}
                  </div>
                  <div className="form-group">
                    <label>Payment Method</label>
                    <select
                      className="input"
                      value={paymentMethod}
                      onChange={(e) => { setPaymentMethod(e.target.value); setTransactionRef(''); setError('') }}
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="gcash">GCash</option>
                      <option value="maya">Maya</option>
                      <option value="bank_transfer">Bank Transfer</option>
                    </select>
                  </div>
                  {requiresRef && (
                    <div className="form-group">
                      <label>Transaction Number *</label>
                      <input
                        type="text"
                        className={`input ${!transactionRef.trim() ? 'input-required-missing' : ''}`}
                        value={transactionRef}
                        onChange={(e) => { setTransactionRef(e.target.value); setError('') }}
                        placeholder="e.g. 1234567890"
                      />
                      {!transactionRef.trim() && <span className="field-required-hint">⚠️ Transaction number required for this method</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && <div className="error-message">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Enrolling...' : '☀️ Enroll Daily Member'}
          </button>
        </div>
      </div>

      <WaiverModal
        open={showWaiverModal}
        showAgree={!waiverAgreed}
        title={waiverTemplate?.title}
        content={waiverTemplate?.content}
        onClose={() => setShowWaiverModal(false)}
        onAgree={() => {
          setShowWaiverModal(false)
          setWaiverAgreed(true)
          setWaiverAgreedAt(new Date().toISOString())
          setError('')
          log.action({
            action: 'waiver_signed',
            entity_type: 'member',
            details: JSON.stringify({ member_name: name.trim() || 'New Member', agreed_at: new Date().toISOString() }),
          })
        }}
      />
    </div>
  )
}

export default DailyMemberModal
