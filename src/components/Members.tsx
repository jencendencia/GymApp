import React, { useState, useEffect, useRef } from 'react'
import './Members.css'
import { Member, Plan, Coach, StaffUser } from '../types/electron'
import { log } from '../lib/logger'

interface FingerprintState {
  scanning: boolean
  captured: boolean
  credentialId: string | null
  error: string | null
}

function Members({ currentUser }: { currentUser?: StaffUser | null }) {
  const isAdmin = currentUser?.role === 'admin'
  const [members, setMembers] = useState<Member[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [coaches, setCoaches] = useState<Coach[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [memberTab, setMemberTab] = useState<'all' | 'expiring'>('all')
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [fingerprint, setFingerprint] = useState<FingerprintState>({
    scanning: false,
    captured: false,
    credentialId: null,
    error: null
  })
  const [waiverAgreed, setWaiverAgreed] = useState(false)
  const [waiverAgreedAt, setWaiverAgreedAt] = useState<string | null>(null)
  const [showWaiverModal, setShowWaiverModal] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [memberIdWarning, setMemberIdWarning] = useState<string | null>(null)
  const [checkingMemberId, setCheckingMemberId] = useState(false)
  const memberIdCheckTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  const [newPlanMember, setNewPlanMember] = useState<Member | null>(null)
  const [showNewPlanModal, setShowNewPlanModal] = useState(false)
  const [newPlanData, setNewPlanData] = useState({
    plan_id: 0,
    plan_start: '',
    plan_end: '',
  })

  // Payment recording state (create mode only)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    type: 'new_plan' as 'new_plan' | 'renewal' | 'top_up',
    payment_method: 'cash',
  })

  // New Plan modal payment state
  const [newPlanShowPayment, setNewPlanShowPayment] = useState(false)
  const [newPlanPayment, setNewPlanPayment] = useState({
    amount: 0,
    payment_method: 'cash',
  })

  // Renewal waiver state
  const [renewWaiverAgreed, setRenewWaiverAgreed] = useState(false)
  const [renewWaiverAgreedAt, setRenewWaiverAgreedAt] = useState<string | null>(null)
  const [renewShowWaiverModal, setRenewShowWaiverModal] = useState(false)

  const [formData, setFormData] = useState({
    member_id: '',
    name: '',
    email: '',
    phone: '',
    emergency_contact: '',
    emergency_phone: '',
    plan_id: 0,
    plan_start: '',
    plan_end: '',
    height: '',
    weight: '',
    birthday: '',
    coach_id: 0,
    coaching_start: '',
    coaching_end: '',
    balance: 0,
    status: 'active' as 'active' | 'inactive' | 'expired',
    photo: ''
  })

  useEffect(() => {
    loadPlans()
    loadCoaches()
  }, [])

  const loadMembers = async () => {
    try {
      const data = searchQuery
        ? await window.electronAPI.searchMembers(searchQuery)
        : await window.electronAPI.getMembers()
      setMembers(data)
    } catch (error) {
      console.error('Failed to load members:', error)
    }
  }

  const loadPlans = async () => {
    try {
      const data = await window.electronAPI.getPlans()
      setPlans(data)
    } catch (error) {
      console.error('Failed to load plans:', error)
    }
  }

  const loadCoaches = async () => {
    try {
      const data = await window.electronAPI.getCoaches()
      setCoaches(data)
    } catch (error) {
      console.error('Failed to load coaches:', error)
    }
  }

  useEffect(() => {
    loadMembers()
  }, [searchQuery])

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        const base64 = reader.result as string
        setPhotoPreview(base64)
        setFormData({ ...formData, photo: base64 })
      }
      reader.readAsDataURL(file)
    }
  }

  const handleCameraCapture = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement
      if (target.files?.[0]) {
        const reader = new FileReader()
        reader.onloadend = () => {
          const base64 = reader.result as string
          setPhotoPreview(base64)
          setFormData({ ...formData, photo: base64 })
        }
        reader.readAsDataURL(target.files[0])
      }
    }
    input.click()
  }

  // Check if member ID already exists (with debounce)
  const handleMemberIdChange = (value: string) => {
    setFormData({ ...formData, member_id: value })
    setMemberIdWarning(null)

    // Clear any pending check
    if (memberIdCheckTimeout.current) {
      clearTimeout(memberIdCheckTimeout.current)
    }

    if (!value.trim()) {
      setMemberIdWarning(null)
      return
    }

    setCheckingMemberId(true)
    memberIdCheckTimeout.current = setTimeout(async () => {
      try {
        const existing = await window.electronAPI.checkMemberIdExists(value.trim())
        if (existing) {
          setMemberIdWarning(`⚠️ Member ID "${value}" is already assigned to ${existing.name}`)
        } else {
          setMemberIdWarning(null)
        }
      } catch {
        // Silently fail - don't block user
      } finally {
        setCheckingMemberId(false)
      }
    }, 500)
  }

  // Real WebAuthn fingerprint registration using Windows Hello
  const handleFingerprintScan = async () => {
    if (fingerprint.captured) return
    
    setFingerprint({ scanning: true, captured: false, credentialId: null, error: null })
    
    try {
      // Generate a unique challenge for this registration
      const challenge = new Uint8Array(32)
      crypto.getRandomValues(challenge)
      
      // Generate a unique user ID
      const userId = new TextEncoder().encode(formData.member_id || generateMemberId())
      
      // Create WebAuthn credential - this triggers the real fingerprint scanner
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: 'REPCHECK Gym Check-In',
            id: window.location.hostname || 'localhost'
          },
          user: {
            id: userId,
            name: formData.email || formData.member_id || 'member',
            displayName: formData.name || 'Member'
          },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' },   // ES256
            { alg: -257, type: 'public-key' }  // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',  // Use built-in scanner
            userVerification: 'required',
            residentKey: 'required'
          },
          timeout: 60000,
          attestation: 'none'
        }
      }) as PublicKeyCredential | null

      if (credential) {
        // Convert the credential ID to a hex string for storage
        const credentialIdArray = new Uint8Array(credential.rawId)
        const credentialIdHex = Array.from(credentialIdArray)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
        
        setFingerprint({
          scanning: false,
          captured: true,
          credentialId: credentialIdHex,
          error: null
        })
      } else {
        setFingerprint({
          scanning: false,
          captured: false,
          credentialId: null,
          error: 'Registration cancelled'
        })
      }
    } catch (error: any) {
      console.error('Fingerprint registration error:', error)
      setFingerprint({
        scanning: false,
        captured: false,
        credentialId: null,
        error: error.message || 'Registration failed'
      })
    }
  }

  const handleRetakeFingerprint = () => {
    setFingerprint({ scanning: false, captured: false, credentialId: null, error: null })
  }

  const handleCreate = async () => {
    try {
      const memberId = formData.member_id || generateMemberId()
      const result = await window.electronAPI.createMember({
        member_id: memberId,
        name: formData.name,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        photo: formData.photo || undefined,
        emergency_contact: formData.emergency_contact || undefined,
        emergency_phone: formData.emergency_phone || undefined,
        plan_id: formData.plan_id || undefined,
        plan_start: formData.plan_start || undefined,
        plan_end: formData.plan_end || undefined,
        height: formData.height ? Number(formData.height) : undefined,
        weight: formData.weight ? Number(formData.weight) : undefined,
        birthday: formData.birthday || undefined,
        coach_id: formData.coach_id || undefined,
        coaching_start: formData.coaching_start || undefined,
        coaching_end: formData.coaching_end || undefined,
        balance: formData.balance || 0,
        waiver_agreed_at: waiverAgreed ? (waiverAgreedAt || new Date().toISOString()) : undefined,
      })
      
      // Get the numeric ID of the newly created member
      const newNumericId = result?.lastInsertRowid ? Number(result.lastInsertRowid) : 0
      
      // Save the fingerprint credential if captured
      if (fingerprint.captured && fingerprint.credentialId) {
        // Store the WebAuthn credential ID associated with this member
        await window.electronAPI.saveFingerprintCredential(memberId, fingerprint.credentialId)
        if (newNumericId) log.registerFingerprint(newNumericId, formData.name)
      }

      // Process pending payment from the payment form (if any)
      if (newNumericId && showPaymentForm && paymentForm.amount > 0) {
        const payAmount = paymentForm.amount
        await window.electronAPI.createPayment({
          member_id: newNumericId,
          amount: payAmount,
          type: paymentForm.type,
          plan_id: formData.plan_id || undefined,
          payment_method: paymentForm.payment_method,
        })
        // Reduce balance by payment amount
        const updatedBalance = Math.max(0, (formData.balance || 0) - payAmount)
        await window.electronAPI.updateMember(newNumericId, {
          name: formData.name,
          email: formData.email || undefined,
          phone: formData.phone || undefined,
          photo: formData.photo || undefined,
          emergency_contact: formData.emergency_contact || undefined,
          emergency_phone: formData.emergency_phone || undefined,
          plan_id: formData.plan_id || undefined,
          plan_start: formData.plan_start || undefined,
          plan_end: formData.plan_end || undefined,
          height: formData.height ? Number(formData.height) : undefined,
          weight: formData.weight ? Number(formData.weight) : undefined,
          birthday: formData.birthday || undefined,
          coach_id: formData.coach_id || undefined,
          coaching_start: formData.coaching_start || undefined,
          coaching_end: formData.coaching_end || undefined,
          balance: updatedBalance,
          status: 'active',
        })
        log.action({
          action: 'record_payment',
          entity_type: 'payment',
          entity_id: newNumericId,
          details: JSON.stringify({
            member_name: formData.name,
            amount: payAmount,
            type: paymentForm.type,
            method: paymentForm.payment_method,
          }),
        })
      }
      
      setShowForm(false)
      resetForm()
      loadMembers()
      
      if (newNumericId) {
        log.createMember(newNumericId, formData.name)
      }
    } catch (error) {
      console.error('Failed to create member:', error)
    }
  }

  const handleUpdate = async () => {
    if (!selectedMember) return
    try {
      await window.electronAPI.updateMember(selectedMember.id, {
        name: formData.name,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        photo: formData.photo || undefined,
        emergency_contact: formData.emergency_contact || undefined,
        emergency_phone: formData.emergency_phone || undefined,
        plan_id: formData.plan_id || undefined,
        plan_start: formData.plan_start || undefined,
        plan_end: formData.plan_end || undefined,
        height: formData.height ? Number(formData.height) : undefined,
        weight: formData.weight ? Number(formData.weight) : undefined,
        birthday: formData.birthday || undefined,
        coach_id: formData.coach_id || undefined,
        coaching_start: formData.coaching_start || undefined,
        coaching_end: formData.coaching_end || undefined,
        balance: formData.balance || 0,
        status: formData.status,
      })
      
      // Update fingerprint credential if newly captured
      if (fingerprint.captured && fingerprint.credentialId) {
        await window.electronAPI.saveFingerprintCredential(selectedMember.member_id, fingerprint.credentialId)
        log.registerFingerprint(selectedMember.id, formData.name)
      }
      
      setShowForm(false)
      setSelectedMember(null)
      resetForm()
      loadMembers()
      
      // Build changes object for logging — track all editable fields
      const changedFields: Record<string, any> = {}
      if (selectedMember.name !== formData.name) changedFields.name = formData.name
      if (selectedMember.email !== formData.email) changedFields.email = formData.email
      if (selectedMember.phone !== formData.phone) changedFields.phone = formData.phone
      if (selectedMember.emergency_contact !== formData.emergency_contact) changedFields.emergency_contact = formData.emergency_contact
      if (selectedMember.emergency_phone !== formData.emergency_phone) changedFields.emergency_phone = formData.emergency_phone
      if (selectedMember.plan_id !== formData.plan_id) changedFields.plan_id = formData.plan_id
      if (selectedMember.plan_start !== formData.plan_start) changedFields.plan_start = formData.plan_start
      if (selectedMember.plan_end !== formData.plan_end) changedFields.plan_end = formData.plan_end
      if (Number(selectedMember.height ?? 0) !== Number(formData.height || 0)) changedFields.height = formData.height
      if (Number(selectedMember.weight ?? 0) !== Number(formData.weight || 0)) changedFields.weight = formData.weight
      if (selectedMember.birthday !== formData.birthday) changedFields.birthday = formData.birthday
      if (selectedMember.coach_id !== formData.coach_id) changedFields.coach_id = formData.coach_id
      if (selectedMember.coaching_start !== formData.coaching_start) changedFields.coaching_start = formData.coaching_start
      if (selectedMember.coaching_end !== formData.coaching_end) changedFields.coaching_end = formData.coaching_end
      if (selectedMember.balance !== formData.balance) changedFields.balance = formData.balance
      if (selectedMember.status !== formData.status) changedFields.status = formData.status
      if (Object.keys(changedFields).length > 0) {
        log.updateMember(selectedMember.id, formData.name, changedFields)
      }
    } catch (error) {
      console.error('Failed to update member:', error)
    }
  }

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this member?')) {
      try {
        const member = members.find(m => m.id === id)
        await window.electronAPI.deleteMember(id)
        setSelectedMember(null)
        loadMembers()
        if (member) {
          log.deleteMember(id, member.name)
        }
      } catch (error) {
        console.error('Failed to delete member:', error)
      }
    }
  }

  const getDefaultStartDate = () => {
    return new Date().toISOString().split('T')[0]
  }

  const getDefaultEndDate = () => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().split('T')[0]
  }

  const resetForm = () => {
    const today = getDefaultStartDate()
    const twoMonths = getDefaultEndDate()
    setFormData({
      member_id: '',
      name: '',
      email: '',
      phone: '',
      emergency_contact: '',
      emergency_phone: '',
      plan_id: 0,
      plan_start: today,
      plan_end: twoMonths,
      height: '',
      weight: '',
      birthday: '',
      coach_id: 0,
      coaching_start: today,
      coaching_end: twoMonths,
      balance: 0,
      status: 'active',
      photo: ''
    })
    setPhotoPreview(null)
    setFingerprint({ scanning: false, captured: false, credentialId: null, error: null })
    setWaiverAgreed(false)
    setWaiverAgreedAt(null)
  }

  const generateMemberId = () => {
    return 'MEM-' + Date.now().toString(36).toUpperCase()
  }

  const openNewPlanModal = (member: Member) => {
    setNewPlanMember(member)
    const today = getDefaultStartDate()
    const baseEnd = getDefaultEndDate()
    // Calculate carryover in the frontend: add remaining days from current plan to new end date
    const remaining = calcDaysRemaining(member.plan_end)
    let finalEnd = baseEnd
    if (remaining && remaining > 0) {
      const d = new Date(baseEnd)
      d.setDate(d.getDate() + remaining)
      finalEnd = d.toISOString().split('T')[0]
    }
    setNewPlanData({
      plan_id: 0,
      plan_start: today,
      plan_end: finalEnd,
    })
    setNewPlanShowPayment(false)
    setNewPlanPayment({ amount: 0, payment_method: 'cash' })
    // Initialize waiver state based on existing member waiver
    setRenewWaiverAgreed(!!member.waiver_agreed_at)
    setRenewWaiverAgreedAt(member.waiver_agreed_at || null)
    setRenewShowWaiverModal(false)
    setShowNewPlanModal(true)
  }

  const handleNewPlanSave = async () => {
    if (!newPlanMember || !newPlanData.plan_id) {
      alert('Please select a plan before assigning.')
      return
    }
    try {
      // Get the plan price for auto-updating balance
      const selectedPlan = plans.find(p => p.id === newPlanData.plan_id)
      const planPrice = selectedPlan?.price || 0
      // New balance: outstanding balance + plan price - any payment made now
      const paymentAmount = newPlanShowPayment && newPlanPayment.amount > 0 ? newPlanPayment.amount : 0
      const newBalance = Math.max(0, (newPlanMember.balance || 0) + planPrice - paymentAmount)

      await window.electronAPI.updateMember(newPlanMember.id, {
        name: newPlanMember.name,
        email: newPlanMember.email || undefined,
        phone: newPlanMember.phone || undefined,
        photo: newPlanMember.photo || undefined,
        emergency_contact: newPlanMember.emergency_contact || undefined,
        emergency_phone: newPlanMember.emergency_phone || undefined,
        plan_id: newPlanData.plan_id,
        plan_start: newPlanData.plan_start,
        plan_end: newPlanData.plan_end,
        height: newPlanMember.height,
        weight: newPlanMember.weight,
        birthday: newPlanMember.birthday || undefined,
        coach_id: newPlanMember.coach_id || undefined,
        coaching_start: newPlanMember.coaching_start || undefined,
        coaching_end: newPlanMember.coaching_end || undefined,
        balance: newBalance,
        status: newPlanMember.status,
        waiver_agreed_at: (!newPlanMember.waiver_agreed_at && renewWaiverAgreed && renewWaiverAgreedAt)
          ? renewWaiverAgreedAt
          : undefined,
      })

      // Process payment if entered
      if (paymentAmount > 0) {
        await window.electronAPI.createPayment({
          member_id: newPlanMember.id,
          amount: paymentAmount,
          type: 'renewal',
          plan_id: newPlanData.plan_id,
          payment_method: newPlanPayment.payment_method,
        })
        log.action({
          action: 'record_payment',
          entity_type: 'payment',
          entity_id: newPlanMember.id,
          details: JSON.stringify({
            member_name: newPlanMember.name,
            amount: paymentAmount,
            type: 'renewal',
            method: newPlanPayment.payment_method,
          }),
        })
      }

      setShowNewPlanModal(false)
      setNewPlanMember(null)
      loadMembers()
      
      // Log the plan assignment
      const plan = plans.find(p => p.id === newPlanData.plan_id)
      log.assignPlan(newPlanMember.id, newPlanMember.name, plan?.name || `Plan #${newPlanData.plan_id}`)
    } catch (error) {
      console.error('Failed to update plan:', error)
    }
  }

  const openEditForm = (member: Member) => {
    setSelectedMember(member)
    setFormData({
      member_id: member.member_id,
      name: member.name,
      email: member.email || '',
      phone: member.phone || '',
      emergency_contact: member.emergency_contact || '',
      emergency_phone: member.emergency_phone || '',
      plan_id: member.plan_id || 0,
      plan_start: member.plan_start || '',
      plan_end: member.plan_end || '',
      height: member.height ? String(member.height) : '',
      weight: member.weight ? String(member.weight) : '',
      birthday: member.birthday || '',
      coach_id: member.coach_id || 0,
      coaching_start: member.coaching_start || '',
      coaching_end: member.coaching_end || '',
      balance: member.balance || 0,
      status: member.status,
      photo: member.photo || ''
    })
    setPhotoPreview(member.photo || null)
    setWaiverAgreed(!!member.waiver_agreed_at)
    setWaiverAgreedAt(member.waiver_agreed_at || null)
    setShowForm(true)
  }

  const resetPaymentForm = () => {
    setShowPaymentForm(false)
    setPaymentForm({ amount: 0, type: 'new_plan', payment_method: 'cash' })
  }

  const getPlanName = (planId?: number) => {
    if (!planId) return 'No plan'
    const plan = plans.find(p => p.id === planId)
    return plan?.name || 'Unknown'
  }

  const calcDaysRemaining = (dateStr?: string): number | null => {
    if (!dateStr) return null
    const now = new Date()
    const end = new Date(dateStr)
    const diff = end.getTime() - now.getTime()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }

  const isExpiring = (member: Member): boolean => {
    const daysPlan = calcDaysRemaining(member.plan_end)
    const daysCoaching = calcDaysRemaining(member.coaching_end)
    const days = Math.min(
      daysPlan ?? Infinity,
      daysCoaching ?? Infinity
    )
    return days <= 2 && days >= 0
  }

  const expiringMembers = members.filter(isExpiring)

  return (
    <div className="members-page">
      <div className="page-header">
        <h1 className="display-text page-title">Members</h1>
        <div className="header-actions">
          <input
            type="text"
            className="input search-input"
            placeholder="Search by name, ID, or email..."
            value={searchQuery}
            onChange={handleSearch}
          />
          <button className="btn btn-primary" onClick={() => {
            resetForm()
            setSelectedMember(null)
            setShowForm(true)
            setShowPaymentForm(false)
            setPaymentForm({ amount: 0, type: 'new_plan', payment_method: 'cash' })
          }}>
            + Add Member
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="member-tabs">
        <button
          className={`member-tab ${memberTab === 'all' ? 'active' : ''}`}
          onClick={() => setMemberTab('all')}
        >
          All Members
        </button>
        <button
          className={`member-tab ${memberTab === 'expiring' ? 'active' : ''}`}
          onClick={() => setMemberTab('expiring')}
        >
          Expiring Members {expiringMembers.length > 0 && <span className="expiring-badge">{expiringMembers.length}</span>}
        </button>
      </div>

      {memberTab === 'all' && (
      <div className="members-table-container">
        <table className="members-table">
          <thead>
            <tr>
              <th>Photo</th>
              <th>Member ID</th>
              <th>Member Since</th>
              <th>Name</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Balance</th>
              <th>Expiry</th>
              <th>Days Left</th>
              <th>Waiver</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={11} className="empty-row">No members found</td>
              </tr>
            ) : (
              members.map((member) => (
                <tr key={member.id} onClick={() => openEditForm(member)}>
                  <td>
                    {member.photo ? (
                      <img src={member.photo} alt={member.name} className="member-table-photo" />
                    ) : (
                      <div className="member-table-avatar">{member.name.charAt(0)}</div>
                    )}
                  </td>
                  <td className="mono-text">{member.member_id}</td>
                  <td className="mono-text">{member.created_at ? new Date(member.created_at).toLocaleDateString() : '—'}</td>
                  <td>{member.name}</td>
                  <td>{getPlanName(member.plan_id)}</td>
                  <td>
                    <span className={`status-badge ${member.status}`}>
                      {member.status}
                    </span>
                  </td>
                  <td className="mono-text">₱{member.balance.toFixed(2)}</td>
                  <td className="mono-text">
                    {member.plan_end
                      ? new Date(member.plan_end).toLocaleDateString()
                      : 'N/A'}
                  </td>
                  <td className="mono-text">
                    {(() => {
                      const d = calcDaysRemaining(member.plan_end) ?? calcDaysRemaining(member.coaching_end)
                      if (d === null || d === undefined) return '—'
                      if (d <= 0) return <span className="status-badge expired">Expired</span>
                      if (d <= 2) return <span className="days-left days-danger">{d} day{d !== 1 ? 's' : ''}</span>
                      return <span className="days-left">{d} days</span>
                    })()}
                  </td>
                  <td>
                    {member.waiver_agreed_at ? (
                      <span className="waiver-badge signed" title={`Signed ${new Date(member.waiver_agreed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}>✓ Signed</span>
                    ) : (
                      <span className="waiver-badge unsigned">—</span>
                    )}
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="btn-icon"
                        onClick={(e) => {
                          e.stopPropagation()
                          openNewPlanModal(member)
                        }}
                        title="New Plan"
                      >
                        📋
                      </button>
                      {isAdmin && (
                        <button
                          className="btn-icon danger"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(member.id)
                          }}
                          title="Delete"
                        >
                          ✕
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
      )}

      {memberTab === 'expiring' && (
        <div className="members-table-container">
          <table className="members-table">
            <thead>
              <tr>
                <th>Photo</th>
                <th>Member ID</th>
                <th>Member Since</th>
                <th>Name</th>
                <th>Plan</th>
                <th>Expiry Date</th>
                <th>Days Left</th>
                <th>Status</th>
                <th>Waiver</th>
                <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {expiringMembers.length === 0 ? (
              <tr>
                <td colSpan={10} className="empty-row">No expiring members</td>
              </tr>
            ) : (
              expiringMembers.map((member) => {
                  // Show whichever end date is expiring sooner
                  const planDays = calcDaysRemaining(member.plan_end)
                  const coachDays = calcDaysRemaining(member.coaching_end)
                  const usePlan = (planDays ?? Infinity) <= (coachDays ?? Infinity)
                  const daysLeft = usePlan ? (planDays ?? 0) : (coachDays ?? 0)
                  const expiryDate = usePlan ? (member.plan_end || '') : (member.coaching_end || '')
                  return (
                    <tr key={member.id} onClick={() => openEditForm(member)}>
                      <td>
                        {member.photo ? (
                          <img src={member.photo} alt={member.name} className="member-table-photo" />
                        ) : (
                          <div className="member-table-avatar">{member.name.charAt(0)}</div>
                        )}
                      </td>
                      <td className="mono-text">{member.member_id}</td>
                      <td className="mono-text">{member.created_at ? new Date(member.created_at).toLocaleDateString() : '—'}</td>
                      <td>{member.name}</td>
                      <td>{getPlanName(member.plan_id)}</td>
                      <td className="mono-text">
                        {expiryDate ? new Date(expiryDate).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="mono-text">
                        {daysLeft <= 0 ? (
                          <span className="status-badge expired">Expired</span>
                        ) : daysLeft === 1 ? (
                          <span className="days-left days-danger">{daysLeft} day</span>
                        ) : (
                          <span className="days-left days-warning">{daysLeft} days</span>
                        )}
                      </td>
                      <td>
                        <span className={`status-badge ${member.status}`}>
                          {member.status}
                        </span>
                      </td>
                      <td>
                        {member.waiver_agreed_at ? (
                          <span className="waiver-badge signed" title={`Signed ${new Date(member.waiver_agreed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}>✓ Signed</span>
                        ) : (
                          <span className="waiver-badge unsigned">—</span>
                        )}
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="btn-icon"
                            onClick={(e) => {
                              e.stopPropagation()
                              openNewPlanModal(member)
                            }}
                            title="New Plan"
                          >
                            📋
                          </button>
                          {isAdmin && (
                            <button
                              className="btn-icon danger"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDelete(member.id)
                              }}
                              title="Delete"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* New Plan Modal */}
      {showNewPlanModal && newPlanMember && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="display-text">New Plan — {newPlanMember.name}</h2>
              <button className="btn-icon" onClick={() => setShowNewPlanModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Plan</label>
                  <select
                    className="input"
                    value={newPlanData.plan_id}
                    onChange={(e) => setNewPlanData({ ...newPlanData, plan_id: Number(e.target.value) })}
                  >
                    <option value={0}>No plan</option>
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} (₱{plan.price})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Plan Start</label>
                  <input
                    type="date"
                    className="input"
                    value={newPlanData.plan_start}
                    onChange={(e) => setNewPlanData({ ...newPlanData, plan_start: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Plan End</label>
                  <input
                    type="date"
                    className="input"
                    value={newPlanData.plan_end}
                    onChange={(e) => setNewPlanData({ ...newPlanData, plan_end: e.target.value })}
                  />
                </div>
              </div>

              {/* ── Waiver Section (Renewal) ── */}
              <div className="newplan-waiver-section">
                <span className="section-label" style={{ margin: 0 }}>📄 Waiver Agreement</span>
                <div className="renew-waiver-box">
                  {renewWaiverAgreed || newPlanMember?.waiver_agreed_at ? (
                    <div className="renew-waiver-signed">
                      <div className="waiver-success-icon" style={{ width: 36, height: 36, fontSize: 18 }}>✓</div>
                      <span className="renew-waiver-status success">Waiver on File</span>
                      <span className="renew-waiver-hint">
                        {renewWaiverAgreedAt
                          ? `Signed ${new Date(renewWaiverAgreedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                          : 'Waiver already on record'}
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setRenewShowWaiverModal(true)}
                      >
                        View Waiver
                      </button>
                    </div>
                  ) : (
                    <div className="renew-waiver-pending">
                      <div className="waiver-icon-large" style={{ fontSize: 24 }}>📄</div>
                      <span className="renew-waiver-status">No waiver on file</span>
                      <span className="renew-waiver-hint">
                        Member must sign waiver before renewal
                      </span>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => setRenewShowWaiverModal(true)}
                      >
                        View & Sign Waiver
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Payment section for new plan */}
              <div className="newplan-payment-section">
                <div className="newplan-payment-header">
                  <span className="section-label" style={{ margin: 0 }}>💰 Payment</span>
                  <span className="newplan-balance mono-text">
                    Current Balance: <strong className={newPlanMember.balance > 0 ? 'danger' : ''}>₱{(newPlanMember.balance || 0).toFixed(2)}</strong>
                  </span>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => setNewPlanShowPayment(true)}
                    disabled={newPlanShowPayment}
                  >
                    + Add Payment
                  </button>
                </div>
                {newPlanShowPayment && (
                  <div className="payment-form newplan-payment-form">
                    <div className="payment-form-grid">
                      <div className="form-group">
                        <label>Amount</label>
                        <input
                          type="number"
                          className="input"
                          value={newPlanPayment.amount || ''}
                          onChange={(e) => setNewPlanPayment({ ...newPlanPayment, amount: Number(e.target.value) })}
                          placeholder="0.00"
                          step="0.01"
                          min="1"
                          autoFocus
                        />
                      </div>
                      <div className="form-group">
                        <label>Payment Method</label>
                        <select
                          className="input"
                          value={newPlanPayment.payment_method}
                          onChange={(e) => setNewPlanPayment({ ...newPlanPayment, payment_method: e.target.value })}
                        >
                          <option value="cash">Cash</option>
                          <option value="card">Card</option>
                          <option value="gcash">GCash</option>
                          <option value="bank_transfer">Bank Transfer</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label>&nbsp;</label>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setNewPlanShowPayment(false); setNewPlanPayment({ amount: 0, payment_method: 'cash' }) }}>
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {!newPlanShowPayment && (
                  <p className="newplan-payment-muted">Optionally record a payment when assigning this plan.</p>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowNewPlanModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleNewPlanSave}
                disabled={!newPlanData.plan_id || (!newPlanMember.waiver_agreed_at && !renewWaiverAgreed)}
              >
                Assign Plan
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="modal-overlay">
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="display-text">
                {selectedMember ? 'Edit Member' : 'New Member'}
              </h2>
              <button className="btn-icon" onClick={() => setShowForm(false)}>✕</button>
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
                        <button type="button" className="btn btn-secondary btn-sm" onClick={handleCameraCapture}>
                          📸 Take Photo
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>
                          📁 Upload
                        </button>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoUpload}
                        style={{ display: 'none' }}
                      />
                    </div>
                  </div>

                  {/* Waiver Agreement */}
                {/* Waiver Agreement */}
                  <div className="enrollment-card">
                    <label className="section-label">📄 Waiver Agreement</label>
                    <div className="waiver-container">
                      {waiverAgreed || (selectedMember?.waiver_agreed_at) ? (
                        <div className="waiver-signed">
                          <div className="waiver-success-icon">✓</div>
                          <span className="waiver-status success">Waiver Signed</span>
                          <span className="waiver-hint">
                            {selectedMember?.waiver_agreed_at || waiverAgreedAt
                              ? `Agreed on ${new Date((selectedMember?.waiver_agreed_at || waiverAgreedAt)!).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                              : 'Member agreed to the terms'}
                          </span>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setShowWaiverModal(true)}
                          >
                            {selectedMember ? 'View Waiver' : 'View Waiver'}
                          </button>
                        </div>
                      ) : (
                        <div className="waiver-pending">
                          <div className="waiver-icon-large">📄</div>
                          <span className="waiver-status">
                            {selectedMember ? 'No waiver on file' : 'Member must agree to waiver'}
                          </span>
                          <span className="waiver-hint">
                            {selectedMember ? 'Waiver was not signed during enrollment' : 'Review liability waiver with the member'}
                          </span>
                          {!selectedMember && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => setShowWaiverModal(true)}
                            >
                              View & Sign Waiver
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                {/* Fingerprint Registration - Real WebAuthn */}
                  <div className="enrollment-card">
                    <label className="section-label">Fingerprint Registration</label>
                    <div className="fingerprint-container">
                      {fingerprint.captured ? (
                        <div className="fingerprint-captured">
                          <div className="fingerprint-success-icon">✓</div>
                          <span className="fingerprint-status success">Fingerprint Registered</span>
                          <span className="fingerprint-hint">
                            Using Windows Hello biometric authentication
                          </span>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={handleRetakeFingerprint}>
                            Retake
                          </button>
                        </div>
                      ) : fingerprint.scanning ? (
                        <div className="fingerprint-scanning">
                          <div className="fingerprint-animation">
                            <div className="scan-ring ring-1" />
                            <div className="scan-ring ring-2" />
                            <div className="scan-ring ring-3" />
                            <div className="fingerprint-icon-pulse">👆</div>
                          </div>
                          <span className="fingerprint-status">Place your finger on the scanner...</span>
                          <span className="fingerprint-hint">
                            Windows Hello will prompt you to verify
                          </span>
                        </div>
                      ) : (
                        <div className="fingerprint-idle">
                          <div className="fingerprint-icon-large">👆</div>
                          <span className="fingerprint-status">
                            Register member's fingerprint
                          </span>
                          <span className="fingerprint-hint">
                            Uses Windows Hello for secure biometric verification
                          </span>
                          {fingerprint.error && (
                            <span className="fingerprint-error">{fingerprint.error}</span>
                          )}
                          <button type="button" className="btn btn-primary btn-sm" onClick={handleFingerprintScan}>
                            🔍 Start Registration
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Basic Info Form */}
                <div className="enrollment-form">
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Member ID</label>
                      <input
                        type="text"
                        className={`input ${memberIdWarning ? 'input-warning' : ''}`}
                        value={formData.member_id}
                        onChange={(e) => handleMemberIdChange(e.target.value)}
                        placeholder="Auto-generated if empty"
                        disabled={!!selectedMember}
                      />
                      {checkingMemberId && <span className="member-id-checking">Checking...</span>}
                      {memberIdWarning && (
                        <span className="member-id-warning">{memberIdWarning}</span>
                      )}
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
                        className="input"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Full name"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Email</label>
                      <input
                        type="email"
                        className="input"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="email@example.com"
                      />
                    </div>
                    <div className="form-group">
                      <label>Phone</label>
                      <input
                        type="tel"
                        className="input"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        placeholder="+63 9XX XXX XXXX"
                      />
                    </div>
                    <div className="form-group">
                      <label>Emergency Contact</label>
                      <input
                        type="text"
                        className="input"
                        value={formData.emergency_contact}
                        onChange={(e) => setFormData({ ...formData, emergency_contact: e.target.value })}
                        placeholder="Contact name"
                      />
                    </div>
                    <div className="form-group">
                      <label>Emergency Phone</label>
                      <input
                        type="tel"
                        className="input"
                        value={formData.emergency_phone}
                        onChange={(e) => setFormData({ ...formData, emergency_phone: e.target.value })}
                        placeholder="+63 9XX XXX XXXX"
                      />
                    </div>
                    <div className="form-group">
                      <label>Plan</label>
                      <select
                        className="input"
                        value={formData.plan_id}
                      onChange={(e) => {
                        const planId = Number(e.target.value)
                        const plan = plans.find(p => p.id === planId)
                        // Auto-set balance to plan price when creating a new member
                        if (!selectedMember) {
                          setFormData({ ...formData, plan_id: planId, balance: plan ? plan.price : 0 })
                        } else {
                          setFormData({ ...formData, plan_id: planId })
                        }
                      }}
                    >
                      <option value={0}>No plan</option>
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name} (₱{plan.price})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Balance</label>
                      <input
                        type="number"
                        className="input"
                        value={formData.balance}
                        onChange={(e) => setFormData({ ...formData, balance: Number(e.target.value) })}
                        step="0.01"
                      />
                    </div>
                    <div className="form-group">
                      <label>Height (cm)</label>
                      <input
                        type="number"
                        className="input"
                        value={formData.height}
                        onChange={(e) => setFormData({ ...formData, height: e.target.value })}
                        placeholder="e.g. 175"
                        step="0.1"
                      />
                    </div>
                    <div className="form-group">
                      <label>Weight (kg)</label>
                      <input
                        type="number"
                        className="input"
                        value={formData.weight}
                        onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                        placeholder="e.g. 75"
                        step="0.1"
                      />
                    </div>
                    <div className="form-group">
                      <label>Birthday</label>
                      <input
                        type="date"
                        className="input"
                        value={formData.birthday}
                        onChange={(e) => setFormData({ ...formData, birthday: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label>Coach</label>
                      <select
                        className="input"
                        value={formData.coach_id}
                        onChange={(e) => setFormData({ ...formData, coach_id: Number(e.target.value) })}
                      >
                        <option value={0}>No coach</option>
                        {coaches.map((coach) => (
                          <option key={coach.id} value={coach.id}>
                            {coach.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Coaching Start</label>
                      <input
                        type="date"
                        className="input"
                        value={formData.coaching_start}
                        onChange={(e) => setFormData({ ...formData, coaching_start: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label>Coaching End</label>
                      <input
                        type="date"
                        className="input"
                        value={formData.coaching_end}
                        onChange={(e) => setFormData({ ...formData, coaching_end: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label>Plan Start</label>
                      <input
                        type="date"
                        className="input"
                        value={formData.plan_start}
                        onChange={(e) => setFormData({ ...formData, plan_start: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label>Plan End</label>
                      <input
                        type="date"
                        className="input"
                        value={formData.plan_end}
                        onChange={(e) => setFormData({ ...formData, plan_end: e.target.value })}
                      />
                    </div>
                    {selectedMember && (
                      <div className="form-group">
                        <label>Status</label>
                        <select
                          className="input"
                          value={formData.status}
                          onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                          <option value="expired">Expired</option>
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Payments Section (create mode only) ── */}
            {!selectedMember && (
              <div className="payment-section">
                <div className="payment-section-header">
                  <h3 className="section-label" style={{ margin: 0 }}>💰 Payments</h3>
                  <div className="payment-section-actions">
                    <span className="payment-hint">Payment will be recorded when you create the member</span>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => setShowPaymentForm(true)}
                      disabled={showPaymentForm}
                    >
                      + Record Payment
                    </button>
                  </div>
                </div>

                {/* Record Payment Form */}
                {showPaymentForm && (
                  <div className="payment-form">
                    <div className="payment-form-grid">
                      <div className="form-group">
                        <label>Amount *</label>
                        <input
                          type="number"
                          className="input"
                          value={paymentForm.amount || ''}
                          onChange={(e) => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })}
                          placeholder="0.00"
                          step="0.01"
                          min="1"
                          autoFocus
                        />
                      </div>
                      <div className="form-group">
                        <label>Payment Type</label>
                        <select
                          className="input"
                          value={paymentForm.type}
                          onChange={(e) => setPaymentForm({ ...paymentForm, type: e.target.value as any })}
                        >
                          <option value="new_plan">New Plan</option>
                          <option value="renewal">Renewal</option>
                          <option value="top_up">Top Up</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Payment Method</label>
                        <select
                          className="input"
                          value={paymentForm.payment_method}
                          onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}
                        >
                          <option value="cash">Cash</option>
                          <option value="card">Card</option>
                          <option value="gcash">GCash</option>
                          <option value="bank_transfer">Bank Transfer</option>
                        </select>
                      </div>
                      <div className="form-group payment-form-actions">
                        <label>&nbsp;</label>
                        <div className="payment-btn-row">
                          <button className="btn btn-secondary btn-sm" onClick={resetPaymentForm}>
                            Cancel
                          </button>
                          <span className="payment-create-note">
                            Payment will be applied when you click "Create Member"
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={selectedMember ? handleUpdate : handleCreate}
                disabled={!formData.name || (!selectedMember && !waiverAgreed)}
              >
                {selectedMember ? 'Save Changes' : 'Create Member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Renewal Waiver Modal */}
      {renewShowWaiverModal && (
        <div className="modal-overlay" onClick={() => setRenewShowWaiverModal(false)}>
          <div className="modal waiver-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="display-text">📄 Membership Waiver & Release</h2>
              <button className="btn-icon" onClick={() => setRenewShowWaiverModal(false)}>✕</button>
            </div>
            <div className="modal-body waiver-modal-body">
              <div className="waiver-content">
                <h3>ASSUMPTION OF RISK AND RELEASE OF LIABILITY</h3>
                
                <p>I, the undersigned, acknowledge that I am voluntarily participating in the programs and activities offered by this fitness facility. I understand that there are inherent risks involved in physical exercise and the use of fitness equipment and facilities.</p>

                <h4>1. ASSUMPTION OF RISK</h4>
                <p>I acknowledge that I have been informed of the potential risks associated with my participation, including but not limited to: muscle strains, sprains, fractures, cardiovascular complications, and other physical injuries. I voluntarily assume all risks associated with my participation.</p>

                <h4>2. MEDICAL CLEARANCE</h4>
                <p>I represent that I am in good physical health and have no medical condition that would prevent safe participation in exercise programs. I understand that it is my responsibility to consult with a physician prior to beginning any exercise program.</p>

                <h4>3. RELEASE OF LIABILITY</h4>
                <p>I hereby release, waive, and discharge this facility, its owners, employees, and agents from any and all liability, claims, demands, actions, or causes of action arising out of or related to any loss, damage, or injury, including death, that may be sustained by me while participating in any activities at this facility.</p>

                <h4>4. USE OF FACILITIES</h4>
                <p>I agree to use all equipment and facilities in a safe and responsible manner. I understand that I must follow all posted rules and staff instructions. I will report any damaged or unsafe equipment to staff immediately.</p>

                <h4>5. PHOTOGRAPHY AND MARKETING</h4>
                <p>I grant permission to the facility to use photographs, video, or other media of me for promotional and marketing purposes, unless I notify the facility in writing of my objection.</p>

                <hr />

                <p className="waiver-agreement-text">
                  By clicking "I Agree", I confirm that I have read, understood, and voluntarily agree to the terms and conditions of this waiver and release of liability.
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setRenewShowWaiverModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setRenewWaiverAgreed(true)
                  setRenewShowWaiverModal(false)
                  const now = new Date().toISOString()
                  setRenewWaiverAgreedAt(now)
                  log.action({
                    action: 'waiver_signed',
                    entity_type: 'member',
                    details: JSON.stringify({ member_name: newPlanMember?.name || 'Member', agreed_at: now, context: 'renewal' }),
                  })
                }}
              >
                I Agree
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Member Waiver Modal */}
      {showWaiverModal && (
        <div className="modal-overlay" onClick={() => setShowWaiverModal(false)}>
          <div className="modal waiver-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="display-text">📄 Membership Waiver & Release</h2>
              <button className="btn-icon" onClick={() => setShowWaiverModal(false)}>✕</button>
            </div>
            <div className="modal-body waiver-modal-body">
              <div className="waiver-content">
                <h3>ASSUMPTION OF RISK AND RELEASE OF LIABILITY</h3>
                
                <p>I, the undersigned, acknowledge that I am voluntarily participating in the programs and activities offered by this fitness facility. I understand that there are inherent risks involved in physical exercise and the use of fitness equipment and facilities.</p>

                <h4>1. ASSUMPTION OF RISK</h4>
                <p>I acknowledge that I have been informed of the potential risks associated with my participation, including but not limited to: muscle strains, sprains, fractures, cardiovascular complications, and other physical injuries. I voluntarily assume all risks associated with my participation.</p>

                <h4>2. MEDICAL CLEARANCE</h4>
                <p>I represent that I am in good physical health and have no medical condition that would prevent safe participation in exercise programs. I understand that it is my responsibility to consult with a physician prior to beginning any exercise program.</p>

                <h4>3. RELEASE OF LIABILITY</h4>
                <p>I hereby release, waive, and discharge this facility, its owners, employees, and agents from any and all liability, claims, demands, actions, or causes of action arising out of or related to any loss, damage, or injury, including death, that may be sustained by me while participating in any activities at this facility.</p>

                <h4>4. USE OF FACILITIES</h4>
                <p>I agree to use all equipment and facilities in a safe and responsible manner. I understand that I must follow all posted rules and staff instructions. I will report any damaged or unsafe equipment to staff immediately.</p>

                <h4>5. PHOTOGRAPHY AND MARKETING</h4>
                <p>I grant permission to the facility to use photographs, video, or other media of me for promotional and marketing purposes, unless I notify the facility in writing of my objection.</p>

                <hr />

                <p className="waiver-agreement-text">
                  By clicking "I Agree", I confirm that I have read, understood, and voluntarily agree to the terms and conditions of this waiver and release of liability.
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowWaiverModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setWaiverAgreed(true)
                  setShowWaiverModal(false)
                  const now = new Date().toISOString()
                  setWaiverAgreedAt(now)
                  log.action({
                    action: 'waiver_signed',
                    entity_type: 'member',
                    details: JSON.stringify({ member_name: formData.name || 'New Member', agreed_at: now }),
                  })
                }}
              >
                I Agree
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Members
