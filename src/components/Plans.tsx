import React, { useState, useEffect } from 'react'
import './Plans.css'
import { Plan, StaffUser } from '../types/electron'
import { log } from '../lib/logger'
import { notifyDataChanged, useDataVersion } from '../lib/data'
import { formatMoney } from '../lib/format'
import { useToast } from '../lib/toast'
import ConfirmModal from './ConfirmModal'

function Plans({ currentUser }: { currentUser?: StaffUser | null }) {
  const isAdmin = currentUser?.role === 'admin'
  const dataVersion = useDataVersion()
  const { showToast } = useToast()
  const [plans, setPlans] = useState<Plan[]>([])
  const [showForm, setShowForm] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null)
  // P4: global one-time membership registration cost (a setting, not per-plan)
  const [membershipCost, setMembershipCost] = useState(0)
  const [editingCost, setEditingCost] = useState(false)
  const [costInput, setCostInput] = useState('')
  // Numeric fields are kept as raw strings while editing — a controlled
  // number input that coerces with Number() snaps back on every keystroke
  // (e.g. '1500.' → 1500), and Chromium can even refuse to type into a field
  // prefilled with 0 until the spinner is used. Values are converted on submit.
  const [formData, setFormData] = useState({
    name: '',
    type: 'monthly' as 'monthly' | 'quarterly' | 'annual' | 'session_pack' | 'family' | 'daily',
    duration_days: '30',
    sessions: '0',
    price: '',
    // P4: members-only plan — only registered members can avail it
    members_only: false,
    // P4: members-only promo price (empty = no promo)
    promo_price: '',
  })

  useEffect(() => {
    loadPlans()
  }, [dataVersion])

  const loadPlans = async () => {
    try {
      const data = await window.electronAPI.getPlans()
      setPlans(data)
      const cost = await window.electronAPI.getSetting('membership_cost')
      setMembershipCost(Number(cost) || 0)
    } catch (error) {
      console.error('Failed to load plans:', error)
    }
  }

  // P4: persist the global membership cost (admin-only — the edit affordance is
  // rendered only for admins)
  const saveMembershipCost = async () => {
    const n = Number(costInput)
    if (costInput.trim() === '' || !Number.isFinite(n) || n < 0) {
      showToast('error', 'Membership cost must be a non-negative number.')
      return
    }
    try {
      await window.electronAPI.saveSetting('membership_cost', String(n))
      setMembershipCost(n)
      setEditingCost(false)
      log.updateSettings({ membership_cost: n })
      showToast('success', `Membership cost set to ${formatMoney(n)}.`)
    } catch (error: any) {
      console.error('Failed to save membership cost:', error)
      showToast('error', error?.message || 'Failed to save membership cost.')
    }
  }

  const handleCreate = async () => {
    try {
      const result = await window.electronAPI.createPlan({
        ...formData,
        duration_days: Number(formData.duration_days) || 0,
        sessions: Number(formData.sessions) || 0,
        price: Number(formData.price) || 0,
        members_only: formData.members_only ? 1 : 0,
        // Empty promo field = no promo (null)
        promo_price: formData.promo_price.trim() !== '' ? (Number(formData.promo_price) || 0) : null,
      })
      setShowForm(false)
      resetForm()
      notifyDataChanged()
      log.createPlan(result.lastInsertRowid as number, formData.name, Number(formData.price))
      showToast('success', `Plan "${formData.name}" created.`)
    } catch (error: any) {
      console.error('Failed to create plan:', error)
      showToast('error', error?.message || 'Failed to create plan.')
    }
  }

  const handleUpdate = async () => {
    if (!selectedPlan) return
    try {
      await window.electronAPI.updatePlan(selectedPlan.id, {
        ...formData,
        duration_days: Number(formData.duration_days) || 0,
        sessions: Number(formData.sessions) || 0,
        price: Number(formData.price) || 0,
        members_only: formData.members_only ? 1 : 0,
        // Empty promo field = no promo (null)
        promo_price: formData.promo_price.trim() !== '' ? (Number(formData.promo_price) || 0) : null,
      })
      setShowForm(false)
      setSelectedPlan(null)
      resetForm()
      notifyDataChanged()
      showToast('success', `Plan "${formData.name}" updated.`)
      
      // Build changes object
      const changedFields: Record<string, any> = {}
      if (selectedPlan.name !== formData.name) changedFields.name = formData.name
      if (selectedPlan.price !== Number(formData.price)) changedFields.price = Number(formData.price)
      if (selectedPlan.type !== formData.type) changedFields.type = formData.type
      if (!!selectedPlan.members_only !== formData.members_only) changedFields.members_only = formData.members_only
      const newPromo = formData.promo_price.trim() !== '' ? (Number(formData.promo_price) || 0) : null
      if (Number(selectedPlan.promo_price ?? null) !== Number(newPromo ?? null)) changedFields.promo_price = newPromo
      if (Object.keys(changedFields).length > 0) {
        log.updatePlan(selectedPlan.id, formData.name, changedFields)
      }
    } catch (error: any) {
      console.error('Failed to update plan:', error)
      showToast('error', error?.message || 'Failed to update plan.')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      const plan = plans.find(p => p.id === id)
      await window.electronAPI.deletePlan(id)
      setDeleteTarget(null)
      notifyDataChanged()
      if (plan) {
        log.deletePlan(id, plan.name)
      }
      showToast('success', `Plan "${plan?.name || ''}" deleted.`)
    } catch (error: any) {
      console.error('Failed to delete plan:', error)
      showToast('error', error?.message || 'Failed to delete plan.')
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'monthly',
      duration_days: '30',
      sessions: '0',
      price: '',
      members_only: false,
      promo_price: '',
    })
  }

  const openEditForm = (plan: Plan) => {
    setSelectedPlan(plan)
    setFormData({
      name: plan.name,
      type: plan.type,
      duration_days: String(plan.duration_days || 30),
      sessions: String(plan.sessions || 0),
      price: String(plan.price ?? 0),
      members_only: !!plan.members_only,
      promo_price: plan.promo_price === null || plan.promo_price === undefined ? '' : String(plan.promo_price),
    })
    setShowForm(true)
  }

  const formatType = (type: string) => {
    if (type === 'session_pack') return 'Per Session'
    return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  }

  return (
    <div className="plans-page">
      <div className="page-header">
        <h1 className="display-text page-title">Plans</h1>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => {
            resetForm()
            setSelectedPlan(null)
            setShowForm(true)
          }}>
            + Add Plan
          </button>
        )}
      </div>

      {/* P4: global one-time membership registration cost — always present, admin-only edit.
          Charged when a client toggles "Is a Member" at enrollment, on top of the plan price. */}
      <div className="membership-cost-card">
        <div className="membership-cost-icon">🪪</div>
        <div className="membership-cost-body">
          <div className="membership-cost-title">Membership Cost</div>
          <div className="membership-cost-desc">One-time fee when a client registers as a member — added on top of the plan price.</div>
        </div>
        <div className="membership-cost-value mono-text">{formatMoney(membershipCost)}</div>
        {isAdmin && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setCostInput(membershipCost > 0 ? String(membershipCost) : '')
              setEditingCost(true)
            }}
            title="Edit membership cost"
          >
            ✎ Edit
          </button>
        )}
      </div>
      {editingCost && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="display-text">Edit Membership Cost</h2>
              <button className="btn-icon" onClick={() => setEditingCost(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Membership Cost (one-time)</label>
                <input
                  type="number"
                  className="input"
                  value={costInput}
                  onChange={(e) => setCostInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveMembershipCost() }}
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  autoFocus
                />
                <span className="field-hint">Charged once when a client toggles "Is a Member" at enrollment. Set 0 for free membership registration.</span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditingCost(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveMembershipCost}>Save</button>
            </div>
          </div>
        </div>
      )}

      <div className="plans-grid">
        {plans.length === 0 ? (
          <p className="empty-message">No plans created yet</p>
        ) : (
          plans.map((plan) => (
            <div key={plan.id} className={`plan-card ${!isAdmin ? 'plan-card-readonly' : ''}`} onClick={() => isAdmin && openEditForm(plan)}>
              <div className="plan-header">
                <span className={`plan-type-badge ${plan.type}`}>
                  {formatType(plan.type)}
                </span>
                <div className="plan-header-actions">
                  {/* P4: members-only plan indicator */}
                  {!!plan.members_only && (
                    <span className="plan-members-badge" title="For members only — clients must register as members to avail this plan">
                      🪪 Members Only
                    </span>
                  )}
                  {/* P4: members-only promo indicator */}
                  {plan.promo_price !== null && plan.promo_price !== undefined && (
                    <span className="plan-promo-badge" title={`Members-only promo price: ${formatMoney(plan.promo_price)}`}>
                      🏷️ PROMO
                    </span>
                  )}
                  {isAdmin && (
                    <button
                      className="btn-icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        openEditForm(plan)
                      }}
                      title="Edit plan"
                    >
                      ✎
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      className="btn-icon danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteTarget(plan)
                      }}
                      title="Delete"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              <h3 className="plan-name display-text">{plan.name}</h3>
              <div className="plan-price-row">
                <div className="plan-price mono-text">{formatMoney(plan.price)}</div>
                {/* P4: members-only promo price — shown struck-through vs the regular price */}
                {plan.promo_price !== null && plan.promo_price !== undefined && (
                  <div className="plan-promo-row">
                    <span className="plan-promo-price mono-text">{formatMoney(plan.promo_price)}</span>
                    <span className="plan-promo-note">Members promo</span>
                  </div>
                )}
              </div>
              <div className="plan-details">
                {(plan.duration_days || 0) > 0 && (
                  <span>{plan.duration_days} days</span>
                )}
                {(plan.sessions || 0) > 0 && (
                  <span>{plan.sessions} sessions</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Plan"
        message={`Are you sure you want to delete the plan "${deleteTarget?.name || ''}"? Members assigned to it will have no plan.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmVariant="danger"
        icon="🗑️"
        onConfirm={() => deleteTarget && handleDelete(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      {showForm && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="display-text">
                {selectedPlan ? 'Edit Plan' : 'New Plan'}
              </h2>
              <button className="btn-icon" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group full-width">
                  <label>Plan Name *</label>
                  <input
                    type="text"
                    className="input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Premium Monthly"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Type *</label>
                  <select
                    className="input"
                    value={formData.type}
                    onChange={(e) => {
                      const type = e.target.value as any
                      setFormData({
                        ...formData,
                        type,
                        // Daily plans last one day by default
                        duration_days: type === 'daily' ? '1' : formData.duration_days,
                        // Sessions only apply to per-session plans
                        sessions: type === 'session_pack' ? formData.sessions : '0',
                      })
                    }}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>                  <option value="session_pack">Per Session</option>
                  <option value="family">Family</option>
                  <option value="daily">Daily</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Price *</label>
                  <input
                    type="number"
                    className="input"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                  />
                </div>
                <div className="form-group">
                  <label>Duration (days)</label>
                  <input
                    type="number"
                    className="input"
                    value={formData.duration_days}
                    onChange={(e) => setFormData({ ...formData, duration_days: e.target.value })}
                    min="0"
                  />
                </div>
                {formData.type === 'session_pack' && (
                  <div className="form-group">
                    <label>Sessions (for per-session plans)</label>
                    <input
                      type="number"
                      className="input"
                      value={formData.sessions}
                      onChange={(e) => setFormData({ ...formData, sessions: e.target.value })}
                      min="0"
                    />
                  </div>
                )}
                {/* P4: members-only plan — only registered members can avail it */}
                <div className="form-group form-toggle-section">
                  <label className="toggle-row">
                    <span className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={formData.members_only}
                        onChange={(e) => setFormData({ ...formData, members_only: e.target.checked })}
                      />
                      <span className="toggle-track" aria-hidden="true" />
                    </span>
                    <span>Members Only</span>
                  </label>
                  <p className="field-hint">Only clients registered as members can avail this plan.</p>
                </div>
                {/* P4: members-only promo price — leave empty for no promo */}
                <div className="form-group full-width">
                  <label>Members-Only Promo Price</label>
                  <input
                    type="number"
                    className="input"
                    value={formData.promo_price}
                    onChange={(e) => setFormData({ ...formData, promo_price: e.target.value })}
                    step="0.01"
                    min="0"
                    placeholder="No promo"
                  />
                  <span className="field-hint">Leave empty for no promo. Only clients registered as members can avail this price.</span>
                  {formData.promo_price.trim() !== '' && Number(formData.promo_price) > Number(formData.price || 0) && (
                    <span className="field-required-hint">⚠️ Promo price is higher than the regular price — double-check</span>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={selectedPlan ? handleUpdate : handleCreate}
                disabled={!formData.name || !formData.price || Number(formData.price) <= 0}
              >
                {selectedPlan ? 'Save Changes' : 'Create Plan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Plans
