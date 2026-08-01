import React, { useState, useEffect } from 'react'
import './Coach.css'
import { Coach as CoachType, Member, CoachFeePayment } from '../types/electron'
import { log } from '../lib/logger'
import { todayLocal, todayLocalOf } from '../lib/dates'
import { notifyDataChanged, useDataVersion } from '../lib/data'
import { formatMoney } from '../lib/format'
import ConfirmModal from './ConfirmModal'

function Coach() {
  const dataVersion = useDataVersion()
  const [activeTab, setActiveTab] = useState<'registration' | 'members' | 'payments'>('registration')
  const [coaches, setCoaches] = useState<CoachType[]>([])
  const [selectedCoach, setSelectedCoach] = useState<CoachType | null>(null)
  const [showCoachForm, setShowCoachForm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CoachType | null>(null)
  const [coachMembers, setCoachMembers] = useState<Member[]>([])
  const [selectedCoachForMembers, setSelectedCoachForMembers] = useState<number | null>(null)

  // Unassigned members state
  const [unassignedMembers, setUnassignedMembers] = useState<Member[]>([])

  // Enroll to Coach modal state
  const [showEnrollModal, setShowEnrollModal] = useState(false)
  const [enrollMember, setEnrollMember] = useState<Member | null>(null)
  const [enrollForm, setEnrollForm] = useState({
    coach_id: 0,
    coaching_start: todayLocal(),
    coaching_end: '',
    record_payment: false,
    payment_amount: '',
    payment_notes: '',
  })

  // Fee payments state
  const [showFeeModal, setShowFeeModal] = useState(false)
  const [feeCoachId, setFeeCoachId] = useState<number | null>(null)
  const [feePayments, setFeePayments] = useState<CoachFeePayment[]>([])
  const [feeCollected, setFeeCollected] = useState(0)
  const [feeCoachName, setFeeCoachName] = useState('')
  const [feeCoachFee, setFeeCoachFee] = useState(0)
  const [feeCoachMembers, setFeeCoachMembers] = useState<Member[]>([])

  const [feeForm, setFeeForm] = useState({
    member_id: 0,
    amount: '',
    notes: '',
  })

  const [coachForm, setCoachForm] = useState({
    name: '',
    email: '',
    phone: '',
    specialty: '',
    professional_fee: '',
  })

  useEffect(() => {
    loadCoaches()
    loadUnassignedMembers()
  }, [dataVersion])

  const loadCoaches = async () => {
    try {
      const data = await window.electronAPI.getCoaches()
      setCoaches(data)
    } catch (error) {
      console.error('Failed to load coaches:', error)
    }
  }

  const loadCoachMembers = async (coachId: number) => {
    try {
      const data = await window.electronAPI.getCoachMembers(coachId)
      setCoachMembers(data)
    } catch (error) {
      console.error('Failed to load coach members:', error)
    }
  }

  const loadUnassignedMembers = async () => {
    try {
      const allMembers = await window.electronAPI.getMembers()
      setUnassignedMembers(allMembers.filter((m: Member) => !m.coach_id))
    } catch (error) {
      console.error('Failed to load unassigned members:', error)
    }
  }

  const handleCoachSelectForMembers = (value: string) => {
    const coachId = Number(value)
    if (coachId === -1) {
      setSelectedCoachForMembers(-1)
      loadUnassignedMembers()
    } else if (coachId > 0) {
      setSelectedCoachForMembers(coachId)
      loadCoachMembers(coachId)
    } else {
      setSelectedCoachForMembers(null)
      setCoachMembers([])
      setUnassignedMembers([])
    }
  }

  const resetCoachForm = () => {
    setCoachForm({ name: '', email: '', phone: '', specialty: '', professional_fee: '' })
    setSelectedCoach(null)
  }

  const openEditCoach = (coach: CoachType) => {
    setSelectedCoach(coach)
    setCoachForm({
      name: coach.name,
      email: coach.email || '',
      phone: coach.phone || '',
      specialty: coach.specialty || '',
      professional_fee: coach.professional_fee ? String(coach.professional_fee) : '',
    })
    setShowCoachForm(true)
  }

  const handleCreateCoach = async () => {
    try {
      const payload = {
        ...coachForm,
        professional_fee: coachForm.professional_fee ? Number(coachForm.professional_fee) : 0,
      }
      if (selectedCoach) {
        await window.electronAPI.updateCoach(selectedCoach.id, payload)
        log.updateCoach(selectedCoach.id, coachForm.name, payload)
      } else {
        const result = await window.electronAPI.createCoach(payload)
        log.createCoach(result.lastInsertRowid as number, coachForm.name)
      }
      setShowCoachForm(false)
      resetCoachForm()
      notifyDataChanged()
    } catch (error) {
      console.error('Failed to save coach:', error)
    }
  }

  const handleDeleteCoach = async (id: number) => {
    try {
      const coach = coaches.find(c => c.id === id)
      await window.electronAPI.deleteCoach(id)
      setDeleteTarget(null)
      if (selectedCoachForMembers === id) {
        setSelectedCoachForMembers(null)
        setCoachMembers([])
      }
      notifyDataChanged()
      if (coach) {
        log.deleteCoach(id, coach.name)
      }
    } catch (error) {
      console.error('Failed to delete coach:', error)
    }
  }

  // Payment Tracking state
  const [trackingCoachId, setTrackingCoachId] = useState<number>(0)
  const [trackingDate, setTrackingDate] = useState(() => todayLocal())
  const [dailyPayments, setDailyPayments] = useState<CoachFeePayment[]>([])
  const [dailyTotal, setDailyTotal] = useState(0)
  const [monthlyPayments, setMonthlyPayments] = useState<CoachFeePayment[]>([])
  const [monthlyTotal, setMonthlyTotal] = useState(0)

  const loadPaymentTracking = async (coachId: number, date: string) => {
    try {
      const [dailyData, monthlyTotalVal, monthlyPaymentsData] = await Promise.all([
        window.electronAPI.getCoachPaymentsByDate(coachId, date),
        window.electronAPI.getCoachMonthlyTotal(coachId, date),
        window.electronAPI.getCoachMonthlyPayments(coachId, date),
      ])
      setDailyPayments(dailyData.payments)
      setDailyTotal(dailyData.dailyTotal)
      setMonthlyTotal(monthlyTotalVal)
      setMonthlyPayments(monthlyPaymentsData)
    } catch (error) {
      console.error('Failed to load payment tracking:', error)
    }
  }

  const handleTrackingCoachChange = (coachId: number) => {
    setTrackingCoachId(coachId)
    if (coachId) {
      loadPaymentTracking(coachId, trackingDate)
    }
  }

  const handleTrackingDateChange = (date: string) => {
    setTrackingDate(date)
    if (trackingCoachId) {
      loadPaymentTracking(trackingCoachId, date)
    }
  }

  // Fee Payments handlers
  const openFeePayments = async (coach: CoachType) => {
    setFeeCoachId(coach.id)
    setFeeCoachName(coach.name)
    setFeeCoachFee(coach.professional_fee || 0)
    setFeeForm({ member_id: 0, amount: '', notes: '' })
    setShowFeeModal(true)

    try {
      const [payments, collected, members] = await Promise.all([
        window.electronAPI.getCoachFeePayments(coach.id),
        window.electronAPI.getCoachFeeCollected(coach.id),
        window.electronAPI.getCoachMembers(coach.id),
      ])
      setFeePayments(payments)
      setFeeCollected(collected)
      setFeeCoachMembers(members)
    } catch (error) {
      console.error('Failed to load fee data:', error)
    }
  }

const handleRecordFeePayment = async () => {
    if (!feeCoachId || !feeForm.member_id || !feeForm.amount) return
    try {
      await window.electronAPI.createCoachFeePayment({
        coach_id: feeCoachId,
        member_id: feeForm.member_id,
        amount: Number(feeForm.amount),
        notes: feeForm.notes || undefined,
      })
      // Reload data
      const [payments, collected] = await Promise.all([
        window.electronAPI.getCoachFeePayments(feeCoachId),
        window.electronAPI.getCoachFeeCollected(feeCoachId),
      ])
      setFeePayments(payments)
      setFeeCollected(collected)
      setFeeForm({ member_id: 0, amount: '', notes: '' })
      
      // Log the fee payment
      const member = feeCoachMembers.find(m => m.id === feeForm.member_id)
      log.recordFeePayment(feeCoachId, feeCoachName, member?.name || `Member #${feeForm.member_id}`, Number(feeForm.amount))
    } catch (error) {
      console.error('Failed to record payment:', error)
    }
  }

    const addOneMonth = (dateStr: string): string => {
    const date = new Date(dateStr + 'T12:00:00')
    date.setMonth(date.getMonth() + 1)
    return todayLocalOf(date)
  }

  const handleEnrollToCoach = async () => {
    if (!enrollMember || !enrollForm.coach_id) return

    try {
      // Update member with coach assignment
      await window.electronAPI.updateMember(enrollMember.id, {
        name: enrollMember.name,
        email: enrollMember.email || undefined,
        phone: enrollMember.phone || undefined,
        photo: enrollMember.photo || undefined,
        emergency_contact: enrollMember.emergency_contact || undefined,
        emergency_phone: enrollMember.emergency_phone || undefined,
        plan_id: enrollMember.plan_id || undefined,
        plan_start: enrollMember.plan_start || undefined,
        plan_end: enrollMember.plan_end || undefined,
        height: enrollMember.height,
        weight: enrollMember.weight,
        birthday: enrollMember.birthday || undefined,
        coach_id: enrollForm.coach_id,
        coaching_start: enrollForm.coaching_start || undefined,
        coaching_end: enrollForm.coaching_end || undefined,
        balance: enrollMember.balance || 0,
        status: enrollMember.status,
      })

      // Record coach fee payment if enabled
      if (enrollForm.record_payment && enrollForm.payment_amount) {
        await window.electronAPI.createCoachFeePayment({
          coach_id: enrollForm.coach_id,
          member_id: enrollMember.id,
          amount: Number(enrollForm.payment_amount),
          notes: enrollForm.payment_notes || undefined,
        })
      }

// Log the enrollment
      const coach = coaches.find(c => c.id === enrollForm.coach_id)
      log.action({
        action: 'assign_coach',
        entity_type: 'member',
        entity_id: enrollMember.id,
        details: JSON.stringify({
          member_name: enrollMember.name,
          coach_name: coach?.name || `Coach #${enrollForm.coach_id}`,
          coach_id: enrollForm.coach_id,
        }),
      })

      // Close modal and refresh
      setShowEnrollModal(false)
      setEnrollMember(null)
      setEnrollForm({
        coach_id: 0,
        coaching_start: todayLocal(),
        coaching_end: '',
        record_payment: false,
        payment_amount: '',
        payment_notes: '',
      })

      // Refresh current view
      if (selectedCoachForMembers === -1) {
        loadUnassignedMembers()
      } else if (selectedCoachForMembers) {
        loadCoachMembers(selectedCoachForMembers)
      }
      notifyDataChanged()
    } catch (error) {
      console.error('Failed to enroll member:', error)
    }
  }

  const openEnrollModal = (member: Member) => {
    const today = todayLocal()
    setEnrollMember(member)
    setEnrollForm({
      coach_id: 0,
      coaching_start: today,
      coaching_end: addOneMonth(today),
      record_payment: false,
      payment_amount: '',
      payment_notes: '',
    })
    setShowEnrollModal(true)
  }

  return (
    <div className="coach-page">
      <div className="page-header">
        <h1 className="display-text page-title">Coaches</h1>
      </div>

      {/* Sub-tabs */}
      <div className="coach-tabs">
        <button
          className={`coach-tab ${activeTab === 'registration' ? 'active' : ''}`}
          onClick={() => setActiveTab('registration')}
        >
          Coach Registration
        </button>
        <button
          className={`coach-tab ${activeTab === 'members' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('members')
            loadUnassignedMembers()
          }}
        >
          Coach Members
        </button>
        <button
          className={`coach-tab ${activeTab === 'payments' ? 'active' : ''}`}
          onClick={() => setActiveTab('payments')}
        >
          Payment Tracking
        </button>
      </div>

      {activeTab === 'registration' && (
        <div className="coach-registration-section">
          <div className="header-actions" style={{ marginBottom: 16 }}>
            <button
              className="btn btn-primary"
              onClick={() => {
                resetCoachForm()
                setShowCoachForm(true)
              }}
            >
              + Register Coach
            </button>
          </div>

          <div className="coach-table-container">
            <table className="coach-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Specialty</th>
                  <th>Professional Fee</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {coaches.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-row">No coaches registered yet</td>
                  </tr>
                ) : (
                  coaches.map((coach) => {
                    return (
                      <tr key={coach.id}>
                        <td className="coach-name">{coach.name}</td>
                        <td>{coach.specialty || '—'}</td>
                        <td className="mono-text">
                          {coach.professional_fee ? formatMoney(coach.professional_fee) : '—'}
                        </td>
                        <td>
                          <div className="coach-actions">
                            <button
                              className="btn-icon"
                              onClick={() => openFeePayments(coach)}
                              title="View Payments"
                            >
                              💰
                            </button>
                            <button
                              className="btn-icon"
                              onClick={() => openEditCoach(coach)}
                              title="Edit"
                            >
                              ✏️
                            </button>
                            <button
                              className="btn-icon danger"
                              onClick={() => setDeleteTarget(coach)}
                              title="Delete"
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'members' && (
        <div className="coach-members-section">
          <div className="coach-selector">
            <label>Select Coach</label>
            <select
              className="input"
              value={selectedCoachForMembers !== null ? String(selectedCoachForMembers) : ''}
              onChange={(e) => handleCoachSelectForMembers(e.target.value)}
            >
              <option value="">— Choose a coach —</option>
              <option value="-1">👤 Unassigned Members ({unassignedMembers.length})</option>
              {coaches.map((coach) => (
                <option key={coach.id} value={coach.id}>
                  {coach.name}
                </option>
              ))}
            </select>
          </div>

          {selectedCoachForMembers !== null ? (
            <div className="coach-table-container" style={{ marginTop: 20 }}>
              <table className="coach-table">
                <thead>
                  <tr>
                    <th>Member ID</th>
                    <th>Name</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Coaching Start</th>
                    <th>Coaching End</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedCoachForMembers === -1 ? unassignedMembers : coachMembers).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty-row">
                        {selectedCoachForMembers === -1
                          ? 'All members are assigned to a coach'
                          : 'No members assigned to this coach'}
                      </td>
                    </tr>
                  ) : (
                    (selectedCoachForMembers === -1 ? unassignedMembers : coachMembers).map((member) => (
                      <tr key={member.id}>
                        <td className="mono-text">{member.member_id}</td>
                        <td>{member.name}</td>
                        <td>{member.plan_name || 'No plan'}</td>
                        <td>
                          <span className={`status-badge ${member.status}`}>
                            {member.status}
                          </span>
                        </td>
                        <td>
                          {member.coaching_start
                            ? new Date(member.coaching_start).toLocaleDateString()
                            : '—'}
                        </td>
                        <td>
                          {member.coaching_end
                            ? new Date(member.coaching_end).toLocaleDateString()
                            : '—'}
                        </td>
                        <td>
                          <div className="coach-actions">
                            {selectedCoachForMembers === -1 && (
                              <button
                                className="btn-icon enroll-icon"
                                onClick={() => openEnrollModal(member)}
                                title="Enroll to Coach"
                              >
                                👤+
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="coach-empty-state">
              <span className="coach-empty-icon">👤</span>
              <p>Select a coach above to view their assigned members</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'payments' && (
        <div className="payment-tracking-section">
          {/* Filters */}
          <div className="payment-tracking-filters">
            <div className="filter-group">
              <label>Coach</label>
              <select
                className="input"
                value={trackingCoachId}
                onChange={(e) => handleTrackingCoachChange(Number(e.target.value))}
              >
                <option value={0}>— Select a coach —</option>
                {coaches.map((coach) => (
                  <option key={coach.id} value={coach.id}>
                    {coach.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Date</label>
              <input
                type="date"
                className="input"
                value={trackingDate}
                onChange={(e) => handleTrackingDateChange(e.target.value)}
              />
            </div>
          </div>

          {trackingCoachId ? (
            <>
              {/* Summary cards */}
              <div className="payment-summary-cards">
                <div className="summary-card">
                  <span className="summary-label">Daily Total</span>
                  <span className="summary-value accent">{formatMoney(dailyTotal)}</span>
                  <span className="summary-count">{dailyPayments.length} payment(s)</span>
                </div>
                <div className="summary-card">
                  <span className="summary-label">Monthly Total</span>
                  <span className="summary-value">{formatMoney(monthlyTotal)}</span>
                  <span className="summary-count">{monthlyPayments.length} payment(s)</span>
                </div>
              </div>

              {/* Daily payments */}
              <div className="payment-tracking-list" style={{ marginTop: 20 }}>
                <h3 className="section-label">Payments on {new Date(trackingDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</h3>
                <div className="coach-table-container" style={{ maxHeight: 250 }}>
                  <table className="coach-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Member</th>
                        <th>Amount</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyPayments.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="empty-row">No payments on this date</td>
                        </tr>
                      ) : (
                        dailyPayments.map((p) => (
                          <tr key={p.id}>
                            <td className="mono-text">{new Date(p.created_at.replace(' ', 'T') + 'Z').toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
                            <td>{p.member_name}<span className="text-faint"> ({p.member_code})</span></td>
                            <td className="mono-text fee-amount">{formatMoney(p.amount)}</td>
                            <td className="text-faint">{p.notes || '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Monthly payments */}
              <div className="payment-tracking-list" style={{ marginTop: 16, marginBottom: 24 }}>
                <h3 className="section-label">All Payments This Month</h3>
                <div className="coach-table-container" style={{ maxHeight: 250 }}>
                  <table className="coach-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Member</th>
                        <th>Amount</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyPayments.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="empty-row">No payments this month</td>
                        </tr>
                      ) : (
                        monthlyPayments.map((p) => (
                          <tr key={p.id}>
                            <td className="mono-text">{new Date(p.created_at.replace(' ', 'T') + 'Z').toLocaleDateString()}</td>
                            <td>{p.member_name}<span className="text-faint"> ({p.member_code})</span></td>
                            <td className="mono-text fee-amount">{formatMoney(p.amount)}</td>
                            <td className="text-faint">{p.notes || '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="coach-empty-state">
              <span className="coach-empty-icon">📊</span>
              <p>Select a coach and date to view payment tracking</p>
            </div>
          )}
        </div>
      )}

      {/* P2 5.7: destructive-action confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Coach"
        message={`Are you sure you want to delete the coach "${deleteTarget?.name || ''}"? Members assigned to this coach will be unassigned.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmVariant="danger"
        icon="🗑️"
        onConfirm={() => deleteTarget && handleDeleteCoach(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Coach Registration/Edit Modal */}
      {showCoachForm && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="display-text">
                {selectedCoach ? 'Edit Coach' : 'Register Coach'}
              </h2>
              <button className="btn-icon" onClick={() => setShowCoachForm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Name *</label>
                  <input
                    type="text"
                    className="input"
                    value={coachForm.name}
                    onChange={(e) => setCoachForm({ ...coachForm, name: e.target.value })}
                    placeholder="Coach full name"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    className="input"
                    value={coachForm.email}
                    onChange={(e) => setCoachForm({ ...coachForm, email: e.target.value })}
                    placeholder="coach@example.com"
                  />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    type="tel"
                    className="input"
                    value={coachForm.phone}
                    onChange={(e) => setCoachForm({ ...coachForm, phone: e.target.value })}
                    placeholder="+63 9XX XXX XXXX"
                  />
                </div>
                <div className="form-group">
                  <label>Specialty</label>
                  <input
                    type="text"
                    className="input"
                    value={coachForm.specialty}
                    onChange={(e) => setCoachForm({ ...coachForm, specialty: e.target.value })}
                    placeholder="e.g., Strength Training, Yoga, etc."
                  />
                </div>
                <div className="form-group">
                  <label>Professional Fee</label>
                  <input
                    type="number"
                    className="input"
                    value={coachForm.professional_fee}
                    onChange={(e) => setCoachForm({ ...coachForm, professional_fee: e.target.value })}
                    placeholder="e.g. 1500"
                    step="0.01"
                    min="0"
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCoachForm(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateCoach}
                disabled={!coachForm.name}
              >
                {selectedCoach ? 'Save Changes' : 'Register Coach'}
              </button>
            </div>
          </div>
        </div>
      )}

{/* Fee Payments Modal */}
      {showFeeModal && feeCoachId && (
        <div className="modal-overlay">
          <div className="modal modal-fee" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-left">
                <h2 className="display-text">Fee Payments - {feeCoachName}</h2>
                <span className="fee-summary">
                  {formatMoney(feeCollected)} collected
                  {feeCoachFee > 0 && ` of ${formatMoney(feeCoachFee)} fee`}
                </span>
              </div>
              <button className="btn-icon" onClick={() => setShowFeeModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Record payment form */}
              <div className="fee-payment-form">
                <h3 className="section-label">Record Payment</h3>
                <div className="form-grid fee-form-grid">
                  <div className="form-group">
                    <label>Member</label>
                    <select
                      className="input"
                      value={feeForm.member_id}
                      onChange={(e) => setFeeForm({ ...feeForm, member_id: Number(e.target.value) })}
                    >
                      <option value={0}>— Select member —</option>
                      {feeCoachMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.member_id})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Amount</label>
                    <input
                      type="number"
                      className="input"
                      value={feeForm.amount}
                      onChange={(e) => setFeeForm({ ...feeForm, amount: e.target.value })}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                    />
                  </div>
                  <div className="form-group">
                    <label>Notes</label>
                    <input
                      type="text"
                      className="input"
                      value={feeForm.notes}
                      onChange={(e) => setFeeForm({ ...feeForm, notes: e.target.value })}
                      placeholder="Optional note"
                    />
                  </div>
                  <div className="form-group" style={{ justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-primary"
                      onClick={handleRecordFeePayment}
                      disabled={!feeForm.member_id || !feeForm.amount}
                      style={{ marginTop: 22 }}
                    >
                      Record Payment
                    </button>
                  </div>
                </div>
              </div>

              {/* Payment history */}
              <div className="fee-payment-history" style={{ marginTop: 24 }}>
                <h3 className="section-label">Payment History</h3>
                <div className="coach-table-container" style={{ maxHeight: 300 }}>
                  <table className="coach-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Member</th>
                        <th>Amount</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {feePayments.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="empty-row">No payments recorded yet</td>
                        </tr>
                      ) : (
                        feePayments.map((payment) => (
                          <tr key={payment.id}>
                            <td className="mono-text">
                              {new Date(payment.created_at.replace(' ', 'T') + 'Z').toLocaleDateString()}
                            </td>
                            <td>
                              {payment.member_name}
                              <span className="text-faint"> ({payment.member_code})</span>
                            </td>
                            <td className="mono-text fee-amount">
                              {formatMoney(payment.amount)}
                            </td>
                            <td className="text-faint">{payment.notes || '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Enroll to Coach Modal */}
      {showEnrollModal && enrollMember && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="display-text">Enroll to Coach — {enrollMember.name}</h2>
              <button className="btn-icon" onClick={() => setShowEnrollModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Coach *</label>
                  <select
                    className="input"
                    value={enrollForm.coach_id}
                    onChange={(e) => setEnrollForm({ ...enrollForm, coach_id: Number(e.target.value) })}
                  >
                    <option value={0}>— Select coach —</option>
                    {coaches.map((coach) => (
                      <option key={coach.id} value={coach.id}>
                        {coach.name}
                      </option>
                    ))}
                  </select>
                  {enrollForm.coach_id > 0 && (() => {
                    const selectedCoach = coaches.find(c => c.id === enrollForm.coach_id)
                    return selectedCoach?.professional_fee ? (
                      <div className="enroll-coach-fee-display">
                        <span className="enroll-coach-fee-label">Professional Fee</span>
                        <span className="enroll-coach-fee-amount">{formatMoney(selectedCoach.professional_fee)}</span>
                      </div>
                    ) : selectedCoach ? (
                      <div className="enroll-coach-fee-display">
                        <span className="enroll-coach-fee-label">Professional Fee</span>
                        <span className="enroll-coach-fee-none">No fee set</span>
                      </div>
                    ) : null
                  })()}
                </div>
                <div className="form-group">
                  <label>Coaching Start</label>
                  <input
                    type="date"
                    className="input"
                    value={enrollForm.coaching_start}
                    onChange={(e) => {
                      const newStart = e.target.value
                      setEnrollForm({
                        ...enrollForm,
                        coaching_start: newStart,
                        coaching_end: addOneMonth(newStart),
                      })
                    }}
                  />
                </div>
                <div className="form-group">
                  <label>Coaching End</label>
                  <input
                    type="date"
                    className="input"
                    value={enrollForm.coaching_end}
                    onChange={(e) => setEnrollForm({ ...enrollForm, coaching_end: e.target.value })}
                  />
                </div>
              </div>

              {/* Coach Fee Payment Section */}
              <div className="enroll-payment-section" style={{ marginTop: 24 }}>
                <div className="enroll-payment-header">
                  <span className="section-label" style={{ margin: 0 }}>💰 Coach Fee Payment</span>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      const coach = coaches.find(c => c.id === enrollForm.coach_id)
                      setEnrollForm({
                        ...enrollForm,
                        record_payment: true,
                        payment_amount: coach?.professional_fee ? String(coach.professional_fee) : ''
                      })
                    }}
                    disabled={enrollForm.record_payment}
                  >
                    + Add Payment
                  </button>
                </div>
                {enrollForm.record_payment && (
                  <div className="enroll-payment-form" style={{ marginTop: 12 }}>
                    <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
                      <div className="form-group">
                        <label>Amount</label>
                        <input
                          type="number"
                          className="input"
                          value={enrollForm.payment_amount}
                          onChange={(e) => setEnrollForm({ ...enrollForm, payment_amount: e.target.value })}
                          placeholder="0.00"
                          step="0.01"
                          min="0"
                          autoFocus
                        />
                      </div>
                      <div className="form-group">
                        <label>Notes</label>
                        <input
                          type="text"
                          className="input"
                          value={enrollForm.payment_notes}
                          onChange={(e) => setEnrollForm({ ...enrollForm, payment_notes: e.target.value })}
                          placeholder="Optional note"
                        />
                      </div>
                      <div className="form-group" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setEnrollForm({ ...enrollForm, record_payment: false, payment_amount: '', payment_notes: '' })}
                          style={{ marginTop: 22 }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {!enrollForm.record_payment && (
                  <p className="enroll-payment-muted" style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 8 }}>
                    Optionally record a coach fee payment when enrolling.
                  </p>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowEnrollModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleEnrollToCoach}
                disabled={!enrollForm.coach_id}
              >
                Enroll to Coach
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Coach
