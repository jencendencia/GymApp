import React, { useState, useEffect } from 'react'
import './Plans.css'
import { Plan, StaffUser } from '../types/electron'
import { log } from '../lib/logger'
import ConfirmModal from './ConfirmModal'

function Plans({ currentUser }: { currentUser?: StaffUser | null }) {
  const isAdmin = currentUser?.role === 'admin'
  const [plans, setPlans] = useState<Plan[]>([])
  const [showForm, setShowForm] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    type: 'monthly' as 'monthly' | 'quarterly' | 'annual' | 'session_pack' | 'family',
    duration_days: 30,
    sessions: 0,
    price: 0,
  })

  useEffect(() => {
    loadPlans()
  }, [])

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
      const result = await window.electronAPI.createPlan(formData)
      setShowForm(false)
      resetForm()
      loadPlans()
      log.createPlan(result.lastInsertRowid as number, formData.name, formData.price)
    } catch (error) {
      console.error('Failed to create plan:', error)
    }
  }

  const handleUpdate = async () => {
    if (!selectedPlan) return
    try {
      await window.electronAPI.updatePlan(selectedPlan.id, formData)
      setShowForm(false)
      setSelectedPlan(null)
      resetForm()
      loadPlans()
      
      // Build changes object
      const changedFields: Record<string, any> = {}
      if (selectedPlan.name !== formData.name) changedFields.name = formData.name
      if (selectedPlan.price !== formData.price) changedFields.price = formData.price
      if (selectedPlan.type !== formData.type) changedFields.type = formData.type
      if (Object.keys(changedFields).length > 0) {
        log.updatePlan(selectedPlan.id, formData.name, changedFields)
      }
    } catch (error) {
      console.error('Failed to update plan:', error)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      const plan = plans.find(p => p.id === id)
      await window.electronAPI.deletePlan(id)
      setDeleteTarget(null)
      loadPlans()
      if (plan) {
        log.deletePlan(id, plan.name)
      }
    } catch (error) {
      console.error('Failed to delete plan:', error)
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'monthly',
      duration_days: 30,
      sessions: 0,
      price: 0,
    })
  }

  const openEditForm = (plan: Plan) => {
    setSelectedPlan(plan)
    setFormData({
      name: plan.name,
      type: plan.type,
      duration_days: plan.duration_days || 30,
      sessions: plan.sessions || 0,
      price: plan.price,
    })
    setShowForm(true)
  }

  const formatType = (type: string) => {
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
              <div className="plan-price mono-text">₱{plan.price.toFixed(2)}</div>
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
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                    <option value="session_pack">Session Pack</option>
                    <option value="family">Family</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Price *</label>
                  <input
                    type="number"
                    className="input"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                    step="0.01"
                    min="0"
                  />
                </div>
                <div className="form-group">
                  <label>Duration (days)</label>
                  <input
                    type="number"
                    className="input"
                    value={formData.duration_days}
                    onChange={(e) => setFormData({ ...formData, duration_days: Number(e.target.value) })}
                    min="0"
                  />
                </div>
                <div className="form-group">
                  <label>Sessions (for session packs)</label>
                  <input
                    type="number"
                    className="input"
                    value={formData.sessions}
                    onChange={(e) => setFormData({ ...formData, sessions: Number(e.target.value) })}
                    min="0"
                  />
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
                disabled={!formData.name || formData.price <= 0}
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
