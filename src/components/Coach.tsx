import React, { useState, useEffect } from 'react'
import './Coach.css'
import { Coach as CoachType, Member, CoachFeePayment } from '../types/electron'
import { log } from '../lib/logger'
import { todayLocal, todayLocalOf, addDaysLocal } from '../lib/dates'
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
    fee_type: 'monthly' as 'monthly' | 'daily',
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

  // Coach renewal state (Coach Members tab)
  const [renewTarget, setRenewTarget] = useState<Member | null>(null)
  const [renewForm, setRenewForm] = useState({
    start: '',
    end: '',
    record_payment: false,
    payment_amount: '',
    payment_notes: '',
  })

  // Transfer to monthly coaching state (for sessions-only / daily members)
  const [transferTarget, setTransferTarget] = useState<Member | null>(null)
  // Direction of the transfer: 'monthly' = sessions-only → monthly, 'daily' = monthly → sessions-only
  const [transferMode, setTransferMode] = useState<'monthly' | 'daily'>('monthly')
  const [transferForm, setTransferForm] = useState({
    start: '',
    end: '',
    record_payment: false,
    payment_amount: '',
    payment_notes: '',
  })

  // Remove-from-coach confirmation state
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)

  // Transfer-to-another-coach state
  const [coachTransferTarget, setCoachTransferTarget] = useState<Member | null>(null)
  const [coachTransferForm, setCoachTransferForm] = useState({
    coach_id: 0,
    start: '',
    end: '',
    record_payment: false,
    payment_amount: '',
    payment_notes: '',
  })

  const [coachForm, setCoachForm] = useState({
    name: '',
    email: '',
    phone: '',
    specialty: '',
    professional_fee: '',
    professional_fee_daily: '',
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
    setCoachForm({ name: '', email: '', phone: '', specialty: '', professional_fee: '', professional_fee_daily: '' })
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
      professional_fee_daily: coach.professional_fee_daily ? String(coach.professional_fee_daily) : '',
    })
    setShowCoachForm(true)
  }

  const handleCreateCoach = async () => {
    try {
      const payload = {
        ...coachForm,
        professional_fee: coachForm.professional_fee ? Number(coachForm.professional_fee) : 0,
        professional_fee_daily: coachForm.professional_fee_daily ? Number(coachForm.professional_fee_daily) : 0,
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

  const addDays = (dateStr: string, days: number) =>
    addDaysLocal(new Date(dateStr + 'T12:00:00'), days)

  /**
   * The update-member IPC requires the full member payload, so build it from
   * the loaded member and let each action override only the coaching fields.
   */
  const buildMemberUpdate = (member: Member, overrides: Record<string, any>) => ({
    name: member.name,
    email: member.email || undefined,
    phone: member.phone || undefined,
    photo: member.photo || undefined,
    emergency_contact: member.emergency_contact || undefined,
    emergency_phone: member.emergency_phone || undefined,
    plan_id: member.plan_id || undefined,
    plan_start: member.plan_start || undefined,
    plan_end: member.plan_end || undefined,
    height: member.height,
    weight: member.weight,
    birthday: member.birthday || undefined,
    coach_id: member.coach_id || undefined,
    coaching_start: member.coaching_start || undefined,
    coaching_end: member.coaching_end || undefined,
    coach_fee_type: member.coach_fee_type,
    balance: member.balance || 0,
    status: member.status,
    ...overrides,
  })

  const feeTypeOf = (member: Member): 'monthly' | 'daily' =>
    member.coach_fee_type === 'daily' ? 'daily' : 'monthly'

  /** Default coaching end for a given start: +1 month (monthly) or +1 day (daily/sessions). */
  const coachingEndDefault = (start: string, feeType: 'monthly' | 'daily') =>
    feeType === 'daily' ? addDays(start, 1) : addOneMonth(start)

  /** Renewal starts right after the current period; if it already lapsed, today. */
  const renewalStart = (member: Member) => {
    const today = todayLocal()
    if (member.coaching_end && member.coaching_end >= today) return addDays(member.coaching_end, 1)
    return today
  }

  /** The coach's fee matching the member's fee type (monthly vs daily/sessions). */
  const coachFeeForMember = (member: Member) => {
    const coach = coaches.find(c => c.id === member.coach_id)
    if (!coach) return 0
    return feeTypeOf(member) === 'daily'
      ? (coach.professional_fee_daily || 0)
      : (coach.professional_fee || 0)
  }

  const refreshCurrentCoachMembers = () => {
    if (selectedCoachForMembers && selectedCoachForMembers > 0) {
      loadCoachMembers(selectedCoachForMembers)
    }
  }

  const handleEnrollToCoach = async () => {
    if (!enrollMember || !enrollForm.coach_id) return

    try {
      // Update member with coach assignment
      await window.electronAPI.updateMember(enrollMember.id, buildMemberUpdate(enrollMember, {
        coach_id: enrollForm.coach_id,
        coaching_start: enrollForm.coaching_start || undefined,
        coaching_end: enrollForm.coaching_end || undefined,
        coach_fee_type: enrollForm.fee_type,
      }))

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
        fee_type: 'monthly',
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
      fee_type: 'monthly',
      record_payment: false,
      payment_amount: '',
      payment_notes: '',
    })
    setShowEnrollModal(true)
  }

  // ── Coach renewal ──
  const openRenewModal = (member: Member) => {
    const feeType = feeTypeOf(member)
    const start = renewalStart(member)
    setRenewTarget(member)
    setRenewForm({
      start,
      end: coachingEndDefault(start, feeType),
      record_payment: false,
      payment_amount: '',
      payment_notes: '',
    })
  }

  const handleRenewCoaching = async () => {
    if (!renewTarget || !renewForm.start || !renewForm.end) return
    try {
      const feeType = feeTypeOf(renewTarget)
      await window.electronAPI.updateMember(renewTarget.id, buildMemberUpdate(renewTarget, {
        coach_id: renewTarget.coach_id,
        coaching_start: renewForm.start,
        coaching_end: renewForm.end,
        coach_fee_type: feeType,
      }))

      if (renewForm.record_payment && renewForm.payment_amount) {
        await window.electronAPI.createCoachFeePayment({
          coach_id: renewTarget.coach_id!,
          member_id: renewTarget.id,
          amount: Number(renewForm.payment_amount),
          notes: renewForm.payment_notes || undefined,
        })
      }

      log.action({
        action: 'renew_coaching',
        entity_type: 'member',
        entity_id: renewTarget.id,
        details: JSON.stringify({
          member_name: renewTarget.name,
          coach_name: renewTarget.coach_name || `Coach #${renewTarget.coach_id}`,
          fee_type: feeType,
          coaching_start: renewForm.start,
          coaching_end: renewForm.end,
          payment: renewForm.record_payment && renewForm.payment_amount ? Number(renewForm.payment_amount) : 0,
        }),
      })

      setRenewTarget(null)
      refreshCurrentCoachMembers()
      notifyDataChanged()
    } catch (error) {
      console.error('Failed to renew coaching:', error)
    }
  }

  // ── Transfer between coaching fee types: sessions-only (daily) ↔ monthly ──
  const openTransferModal = (member: Member, mode: 'monthly' | 'daily') => {
    const start = todayLocal()
    setTransferTarget(member)
    setTransferMode(mode)
    setTransferForm({
      start,
      end: coachingEndDefault(start, mode),
      record_payment: false,
      payment_amount: '',
      payment_notes: '',
    })
  }

  const handleTransferCoaching = async () => {
    if (!transferTarget || !transferForm.start || !transferForm.end) return
    try {
      await window.electronAPI.updateMember(transferTarget.id, buildMemberUpdate(transferTarget, {
        coach_id: transferTarget.coach_id,
        coach_fee_type: transferMode,
        coaching_start: transferForm.start,
        coaching_end: transferForm.end,
      }))

      if (transferForm.record_payment && transferForm.payment_amount) {
        await window.electronAPI.createCoachFeePayment({
          coach_id: transferTarget.coach_id!,
          member_id: transferTarget.id,
          amount: Number(transferForm.payment_amount),
          notes: transferForm.payment_notes || undefined,
        })
      }

      log.action({
        action: transferMode === 'monthly' ? 'transfer_coaching_monthly' : 'transfer_coaching_daily',
        entity_type: 'member',
        entity_id: transferTarget.id,
        details: JSON.stringify({
          member_name: transferTarget.name,
          coach_name: transferTarget.coach_name || `Coach #${transferTarget.coach_id}`,
          from_fee_type: feeTypeOf(transferTarget),
          to_fee_type: transferMode,
          coaching_start: transferForm.start,
          coaching_end: transferForm.end,
          payment: transferForm.record_payment && transferForm.payment_amount ? Number(transferForm.payment_amount) : 0,
        }),
      })

      setTransferTarget(null)
      refreshCurrentCoachMembers()
      notifyDataChanged()
    } catch (error) {
      console.error('Failed to transfer member coaching fee type:', error)
    }
  }

  // ── Transfer member to another coach (keeps fee type and payment history) ──
  const openCoachTransferModal = (member: Member) => {
    const feeType = feeTypeOf(member)
    const start = member.coaching_start || todayLocal()
    setCoachTransferTarget(member)
    setCoachTransferForm({
      coach_id: 0,
      start,
      end: member.coaching_end || coachingEndDefault(start, feeType),
      record_payment: false,
      payment_amount: '',
      payment_notes: '',
    })
  }

  const handleTransferToCoach = async () => {
    if (!coachTransferTarget || !coachTransferForm.coach_id || !coachTransferForm.start || !coachTransferForm.end) return
    try {
      const newCoach = coaches.find((c) => c.id === coachTransferForm.coach_id)
      await window.electronAPI.updateMember(coachTransferTarget.id, buildMemberUpdate(coachTransferTarget, {
        coach_id: coachTransferForm.coach_id,
        coaching_start: coachTransferForm.start,
        coaching_end: coachTransferForm.end,
      }))

      if (coachTransferForm.record_payment && coachTransferForm.payment_amount) {
        await window.electronAPI.createCoachFeePayment({
          coach_id: coachTransferForm.coach_id,
          member_id: coachTransferTarget.id,
          amount: Number(coachTransferForm.payment_amount),
          notes: coachTransferForm.payment_notes || undefined,
        })
      }

      log.action({
        action: 'transfer_coach',
        entity_type: 'member',
        entity_id: coachTransferTarget.id,
        details: JSON.stringify({
          member_name: coachTransferTarget.name,
          from_coach: coachTransferTarget.coach_name || `Coach #${coachTransferTarget.coach_id}`,
          to_coach: newCoach?.name || `Coach #${coachTransferForm.coach_id}`,
          fee_type: feeTypeOf(coachTransferTarget),
          coaching_start: coachTransferForm.start,
          coaching_end: coachTransferForm.end,
          payment: coachTransferForm.record_payment && coachTransferForm.payment_amount ? Number(coachTransferForm.payment_amount) : 0,
        }),
      })

      setCoachTransferTarget(null)
      refreshCurrentCoachMembers()
      notifyDataChanged()
    } catch (error) {
      console.error('Failed to transfer member to another coach:', error)
    }
  }

  // ── Remove member from coach (keeps fee payment history) ──
  const handleRemoveFromCoach = async () => {
    if (!removeTarget) return
    try {
      await window.electronAPI.updateMember(removeTarget.id, buildMemberUpdate(removeTarget, {
        coach_id: undefined,
        coaching_start: undefined,
        coaching_end: null,
      }))

      log.action({
        action: 'remove_coach',
        entity_type: 'member',
        entity_id: removeTarget.id,
        details: JSON.stringify({
          member_name: removeTarget.name,
          coach_name: removeTarget.coach_name || `Coach #${removeTarget.coach_id}`,
          fee_type: removeTarget.coach_fee_type || 'monthly',
        }),
      })

      setRemoveTarget(null)
      refreshCurrentCoachMembers()
      notifyDataChanged()
    } catch (error) {
      console.error('Failed to remove member from coach:', error)
    }
  }

  // Payment Tracking: split a payment total by the paying member's coaching fee type
  const sumByFeeType = (payments: CoachFeePayment[], type: 'monthly' | 'daily') =>
    payments
      .filter((p) => (p.coach_fee_type === 'daily' ? 'daily' : 'monthly') === type)
      .reduce((sum, p) => sum + (p.amount || 0), 0)

  // Payment section shared by the Renew, Fee-Type Transfer, and Coach Transfer modals (optional coach fee payment)
  const renderCoachingPaymentSection = <T extends { record_payment: boolean; payment_amount: string; payment_notes: string }>(
    form: T,
    setForm: (f: T) => void,
    defaultFee: number,
    mutedNote: string
  ) => (
    <div className="enroll-payment-section" style={{ marginTop: 24 }}>
      <div className="enroll-payment-header">
        <span className="section-label" style={{ margin: 0 }}>💰 Coach Fee Payment (optional)</span>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            setForm({ ...form, record_payment: true, payment_amount: defaultFee ? String(defaultFee) : '' })
          }}
          disabled={form.record_payment}
        >
          + Add Payment
        </button>
      </div>
      {form.record_payment && (
        <div className="enroll-payment-form" style={{ marginTop: 12 }}>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
            <div className="form-group">
              <label>Amount</label>
              <input
                type="number"
                className="input"
                value={form.payment_amount}
                onChange={(e) => setForm({ ...form, payment_amount: e.target.value })}
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
                value={form.payment_notes}
                onChange={(e) => setForm({ ...form, payment_notes: e.target.value })}
                placeholder="Optional note"
              />
            </div>
            <div className="form-group" style={{ justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setForm({ ...form, record_payment: false, payment_amount: '', payment_notes: '' })}
                style={{ marginTop: 22 }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
      {!form.record_payment && (
        <p className="enroll-payment-muted" style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 8 }}>
          {mutedNote}
        </p>
      )}
    </div>
  )

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
                  <th>Monthly Fee</th>
                  <th>Daily Fee</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {coaches.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-row">No coaches registered yet</td>
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
                        <td className="mono-text">
                          {coach.professional_fee_daily ? formatMoney(coach.professional_fee_daily) : '—'}
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
                    <th>Fee Type</th>
                    <th>Status</th>
                    <th>Coaching Start</th>
                    <th>Coaching End</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedCoachForMembers === -1 ? unassignedMembers : coachMembers).length === 0 ? (
                    <tr>
                      <td colSpan={8} className="empty-row">
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
                          {member.coach_id ? (
                            <span className={`fee-type-badge ${feeTypeOf(member)}`}>
                              {feeTypeOf(member) === 'daily' ? 'Daily' : 'Monthly'}
                            </span>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
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
                            {selectedCoachForMembers === -1 ? (
                              <button
                                className="btn-icon enroll-icon"
                                onClick={() => openEnrollModal(member)}
                                title="Enroll to Coach"
                              >
                                👤+
                              </button>
                            ) : (
                              <>
                                <button
                                  className="btn-icon"
                                  onClick={() => openRenewModal(member)}
                                  title="Renew Coaching"
                                >
                                  🔄
                                </button>
                                <button
                                  className="btn-icon"
                                  onClick={() => openCoachTransferModal(member)}
                                  title="Transfer to Another Coach"
                                >
                                  ⇄
                                </button>
                                {feeTypeOf(member) === 'daily' ? (
                                  <button
                                    className="btn-icon"
                                    onClick={() => openTransferModal(member, 'monthly')}
                                    title="Transfer to Monthly Coaching"
                                  >
                                    📅
                                  </button>
                                ) : (
                                  <button
                                    className="btn-icon"
                                    onClick={() => openTransferModal(member, 'daily')}
                                    title="Transfer to Daily (Sessions-Only) Coaching"
                                  >
                                    🕐
                                  </button>
                                )}
                                <button
                                  className="btn-icon danger"
                                  onClick={() => setRemoveTarget(member)}
                                  title="Remove from Coach"
                                >
                                  ✕
                                </button>
                              </>
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
                  <span className="summary-split">
                    <span className="summary-split-row">
                      <span>Monthly members</span>
                      <span className="mono-text">{formatMoney(sumByFeeType(dailyPayments, 'monthly'))}</span>
                    </span>
                    <span className="summary-split-row">
                      <span>Daily members</span>
                      <span className="mono-text">{formatMoney(sumByFeeType(dailyPayments, 'daily'))}</span>
                    </span>
                  </span>
                </div>
                <div className="summary-card">
                  <span className="summary-label">Monthly Total</span>
                  <span className="summary-value">{formatMoney(monthlyTotal)}</span>
                  <span className="summary-count">{monthlyPayments.length} payment(s)</span>
                  <span className="summary-split">
                    <span className="summary-split-row">
                      <span>Monthly members</span>
                      <span className="mono-text">{formatMoney(sumByFeeType(monthlyPayments, 'monthly'))}</span>
                    </span>
                    <span className="summary-split-row">
                      <span>Daily members</span>
                      <span className="mono-text">{formatMoney(sumByFeeType(monthlyPayments, 'daily'))}</span>
                    </span>
                  </span>
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
                  <label>Monthly Fee</label>
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
                <div className="form-group">
                  <label>Daily Fee</label>
                  <input
                    type="number"
                    className="input"
                    value={coachForm.professional_fee_daily}
                    onChange={(e) => setCoachForm({ ...coachForm, professional_fee_daily: e.target.value })}
                    placeholder="e.g. 500"
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
                    return selectedCoach ? (
                      <div className="enroll-coach-fee-display">
                        <span className="enroll-coach-fee-label">Monthly Fee</span>
                        <span className="enroll-coach-fee-amount">{selectedCoach.professional_fee ? formatMoney(selectedCoach.professional_fee) : '—'}</span>
                      </div>
                    ) : null
                  })()}
                  {enrollForm.coach_id > 0 && (() => {
                    const selectedCoach = coaches.find(c => c.id === enrollForm.coach_id)
                    return selectedCoach ? (
                      <div className="enroll-coach-fee-display" style={{ marginTop: 4 }}>
                        <span className="enroll-coach-fee-label">Daily Fee</span>
                        <span className="enroll-coach-fee-amount">{selectedCoach.professional_fee_daily ? formatMoney(selectedCoach.professional_fee_daily) : '—'}</span>
                      </div>
                    ) : null
                  })()}
                  {enrollForm.coach_id > 0 && (
                    <div className="form-group" style={{ marginTop: 8 }}>
                      <label>Fee Type *</label>
                      <select
                        className="input"
                        value={enrollForm.fee_type}
                        onChange={(e) => setEnrollForm({ ...enrollForm, fee_type: e.target.value as 'monthly' | 'daily' })}
                      >
                        <option value="monthly">Monthly</option>
                        <option value="daily">Daily</option>
                      </select>
                    </div>
                  )}
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
                      const fee = enrollForm.fee_type === 'daily' ? coach?.professional_fee_daily : coach?.professional_fee
                      setEnrollForm({
                        ...enrollForm,
                        record_payment: true,
                        payment_amount: fee ? String(fee) : ''
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

      {/* Coach Renewal Modal */}
      {renewTarget && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="display-text">Renew Coaching — {renewTarget.name}</h2>
              <button className="btn-icon" onClick={() => setRenewTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 0 }}>
                {renewTarget.coach_name ? `Coach: ${renewTarget.coach_name}` : ''}
                {renewTarget.coaching_end
                  ? ` · Current period ends ${new Date(renewTarget.coaching_end + 'T12:00:00').toLocaleDateString()}`
                  : ' · No active coaching period'}
                {` · ${feeTypeOf(renewTarget) === 'daily' ? 'Daily (sessions)' : 'Monthly'} fee`}
              </p>
              <div className="form-grid">
                <div className="form-group">
                  <label>New Start *</label>
                  <input
                    type="date"
                    className="input"
                    value={renewForm.start}
                    onChange={(e) => {
                      const start = e.target.value
                      setRenewForm({
                        ...renewForm,
                        start,
                        end: start ? coachingEndDefault(start, feeTypeOf(renewTarget)) : renewForm.end,
                      })
                    }}
                  />
                </div>
                <div className="form-group">
                  <label>New End *</label>
                  <input
                    type="date"
                    className="input"
                    value={renewForm.end}
                    onChange={(e) => setRenewForm({ ...renewForm, end: e.target.value })}
                  />
                </div>
              </div>
              {renderCoachingPaymentSection(
                renewForm,
                setRenewForm,
                coachFeeForMember(renewTarget),
                'Optionally record a coach fee payment when renewing.'
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setRenewTarget(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRenewCoaching}
                disabled={!renewForm.start || !renewForm.end || renewForm.end < renewForm.start}
              >
                Renew Coaching
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Coaching Fee Type Modal — sessions-only (daily) ↔ monthly */}
      {transferTarget && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="display-text">
                Transfer to {transferMode === 'monthly' ? 'Monthly' : 'Daily (Sessions)'} — {transferTarget.name}
              </h2>
              <button className="btn-icon" onClick={() => setTransferTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 0 }}>
                {transferTarget.coach_name ? `Coach: ${transferTarget.coach_name}` : ''}
                {transferMode === 'monthly'
                  ? ' · Moves this sessions-only (daily) member to a monthly coaching plan.'
                  : ' · Moves this member from monthly coaching to sessions-only (daily) coaching.'}
              </p>
              <div className="form-grid">
                <div className="form-group">
                  <label>{transferMode === 'monthly' ? 'Monthly Start' : 'Daily Start'} *</label>
                  <input
                    type="date"
                    className="input"
                    value={transferForm.start}
                    onChange={(e) => {
                      const start = e.target.value
                      setTransferForm({
                        ...transferForm,
                        start,
                        end: start ? coachingEndDefault(start, transferMode) : transferForm.end,
                      })
                    }}
                  />
                </div>
                <div className="form-group">
                  <label>{transferMode === 'monthly' ? 'Monthly End' : 'Daily End'} *</label>
                  <input
                    type="date"
                    className="input"
                    value={transferForm.end}
                    onChange={(e) => setTransferForm({ ...transferForm, end: e.target.value })}
                  />
                </div>
              </div>
              {renderCoachingPaymentSection(
                transferForm,
                setTransferForm,
                transferMode === 'monthly'
                  ? coaches.find((c) => c.id === transferTarget.coach_id)?.professional_fee || 0
                  : coaches.find((c) => c.id === transferTarget.coach_id)?.professional_fee_daily || 0,
                transferMode === 'monthly'
                  ? 'Optionally record the monthly coach fee payment.'
                  : 'Optionally record the daily coach fee payment.'
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setTransferTarget(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleTransferCoaching}
                disabled={!transferForm.start || !transferForm.end || transferForm.end < transferForm.start}
              >
                Transfer to {transferMode === 'monthly' ? 'Monthly' : 'Daily (Sessions)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer to Another Coach Modal */}
      {coachTransferTarget && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="display-text">Transfer Coach — {coachTransferTarget.name}</h2>
              <button className="btn-icon" onClick={() => setCoachTransferTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 0 }}>
                {coachTransferTarget.coach_name ? `Current coach: ${coachTransferTarget.coach_name}` : ''}
                {` · ${feeTypeOf(coachTransferTarget) === 'daily' ? 'Daily (sessions)' : 'Monthly'} coaching continues under the new coach.`}
              </p>
              <div className="form-grid">
                <div className="form-group">
                  <label>New Coach *</label>
                  <select
                    className="input"
                    value={coachTransferForm.coach_id}
                    onChange={(e) => setCoachTransferForm({ ...coachTransferForm, coach_id: Number(e.target.value) })}
                  >
                    <option value={0}>— Select coach —</option>
                    {coaches
                      .filter((coach) => coach.id !== coachTransferTarget.coach_id)
                      .map((coach) => (
                        <option key={coach.id} value={coach.id}>
                          {coach.name}
                        </option>
                      ))}
                  </select>
                  {coachTransferForm.coach_id > 0 && (() => {
                    const newCoach = coaches.find((c) => c.id === coachTransferForm.coach_id)
                    return newCoach ? (
                      <div className="enroll-coach-fee-display">
                        <span className="enroll-coach-fee-label">
                          {feeTypeOf(coachTransferTarget) === 'daily' ? 'Daily Fee' : 'Monthly Fee'}
                        </span>
                        <span className="enroll-coach-fee-amount">
                          {feeTypeOf(coachTransferTarget) === 'daily'
                            ? (newCoach.professional_fee_daily ? formatMoney(newCoach.professional_fee_daily) : '—')
                            : (newCoach.professional_fee ? formatMoney(newCoach.professional_fee) : '—')}
                        </span>
                      </div>
                    ) : null
                  })()}
                </div>
                <div className="form-group">
                  <label>Coaching Start *</label>
                  <input
                    type="date"
                    className="input"
                    value={coachTransferForm.start}
                    onChange={(e) => {
                      const start = e.target.value
                      setCoachTransferForm({
                        ...coachTransferForm,
                        start,
                        end: start ? coachingEndDefault(start, feeTypeOf(coachTransferTarget)) : coachTransferForm.end,
                      })
                    }}
                  />
                </div>
                <div className="form-group">
                  <label>Coaching End *</label>
                  <input
                    type="date"
                    className="input"
                    value={coachTransferForm.end}
                    onChange={(e) => setCoachTransferForm({ ...coachTransferForm, end: e.target.value })}
                  />
                </div>
              </div>
              {renderCoachingPaymentSection(
                coachTransferForm,
                setCoachTransferForm,
                (() => {
                  const newCoach = coaches.find((c) => c.id === coachTransferForm.coach_id)
                  if (!newCoach) return 0
                  return feeTypeOf(coachTransferTarget) === 'daily'
                    ? (newCoach.professional_fee_daily || 0)
                    : (newCoach.professional_fee || 0)
                })(),
                'Optionally record a coach fee payment for the new coach.'
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCoachTransferTarget(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleTransferToCoach}
                disabled={!coachTransferForm.coach_id || !coachTransferForm.start || !coachTransferForm.end || coachTransferForm.end < coachTransferForm.start}
              >
                Transfer to Coach
              </button>
            </div>
          </div>
        </div>
      )}

      {/* P2 5.7: destructive-action confirmation — remove member from coach */}
      <ConfirmModal
        open={!!removeTarget}
        title="Remove from Coach"
        message={`Remove "${removeTarget?.name || ''}" from this coach? They will move back to unassigned members and their coaching period will be cleared. Recorded fee payments are kept in history.`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        confirmVariant="danger"
        icon="👤"
        onConfirm={() => removeTarget && handleRemoveFromCoach()}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  )
}

export default Coach
