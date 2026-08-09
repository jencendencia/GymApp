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
  })

  useEffect(() => {
    loadPlans()
  }, [dataVersion])

  const loadPlans = async () => {
    try {
      const data = await window.electronAPI.getPlans()
      setPlans(data)
    } catch (error) {
      console.error('Failed to load plans:', error)
    }
  }

  const handleCreate = async () => {
    try {
      const result = await window.electronAPI.createPlan({
        ...formData,
        duration_days: Number(formData.duration_days) || 0,
        sessions: Number(formData.sessions) || 0,
        price: Number(formData.price) || 0,
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
              <h3 className="plan-name display-text">{plan.name}</h3>
              <div className="plan-price mono-text">{formatMoney(plan.price)}</div>
              <div className="plan-details">
                {plan.duration_days && (
                  <span>{plan.duration_days} days</span>
                )}
                {plan.sessions && (
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
