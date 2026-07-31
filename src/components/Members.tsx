import React, { useState, useEffect, useRef } from 'react'
import './Members.css'
import QRCode from 'qrcode'
import { Member, Plan, Coach, StaffUser, Payment } from '../types/electron'
import { log } from '../lib/logger'
import { useToast } from '../lib/toast'
import { todayLocal, todayLocalOf } from '../lib/dates'
import ConfirmModal from './ConfirmModal'

// Payment methods that require a transaction reference number
const METHODS_REQUIRING_REF = ['gcash', 'maya', 'bank_transfer', 'card']

interface FingerprintState {
  scanning: boolean
  captured: boolean
  credentialId: string | null
  error: string | null
}

function Members({ currentUser, initialSearch, onSearchConsumed }: { currentUser?: StaffUser | null; initialSearch?: string; onSearchConsumed?: () => void }) {
  const isAdmin = currentUser?.role === 'admin'
  const { showToast } = useToast()
  const [members, setMembers] = useState<Member[]>([])
  // Full list used only for expiry computation (the table itself is paginated)
  const [allMembers, setAllMembers] = useState<Member[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [coaches, setCoaches] = useState<Coach[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [memberTab, setMemberTab] = useState<'all' | 'expiring'>('all')
  const [memberPage, setMemberPage] = useState(0)
  const [totalMembers, setTotalMembers] = useState(0)
  const [membersLoading, setMembersLoading] = useState(false)
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null)
  const [idCardMember, setIdCardMember] = useState<Member | null>(null)
  const [idCardQr, setIdCardQr] = useState('')
  const [idCardPrinting, setIdCardPrinting] = useState(false)
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
  const [validationAttempted, setValidationAttempted] = useState(false)
  const [shakeKey, setShakeKey] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const planRef = useRef<HTMLSelectElement>(null)
  const waiverRef = useRef<HTMLDivElement>(null)
  const paymentRef = useRef<HTMLInputElement>(null)
  const [memberIdWarning, setMemberIdWarning] = useState<string | null>(null)
  const [checkingMemberId, setCheckingMemberId] = useState(false)
  const memberIdCheckTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transactionRefRef = useRef<HTMLInputElement>(null)
  const newPlanPlanRef = useRef<HTMLSelectElement>(null)
  const newPlanPaymentRef = useRef<HTMLInputElement>(null)
  const newPlanTxnRef = useRef<HTMLInputElement>(null)
  const newPlanWaiverRef = useRef<HTMLDivElement>(null)
  
  const [newPlanMember, setNewPlanMember] = useState<Member | null>(null)
  const [showNewPlanModal, setShowNewPlanModal] = useState(false)
  const [newPlanData, setNewPlanData] = useState({
    plan_id: 0,
    plan_start: '',
    plan_end: '',
  })

  // Payment recording state (create mode only)
  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    type: 'new_plan' as 'new_plan' | 'renewal' | 'top_up',
    payment_method: 'cash',
    transaction_ref: '',
  })

  // New Plan modal payment state (always visible & required)
  const [newPlanPayment, setNewPlanPayment] = useState({
    amount: 0,
    payment_method: 'cash',
    transaction_ref: '',
  })

  // Last staff-entered numeric member ID (to suggest the next ID in the new-member form)
  const [lastMemberId, setLastMemberId] = useState<{ last: number; next: number }>({ last: 0, next: 1 })
  const [lastMemberIdLoaded, setLastMemberIdLoaded] = useState(false)

  // Renewal waiver state
  const [renewWaiverAgreed, setRenewWaiverAgreed] = useState(false)
  const [renewWaiverAgreedAt, setRenewWaiverAgreedAt] = useState<string | null>(null)
  const [renewShowWaiverModal, setRenewShowWaiverModal] = useState(false)

  // New Plan modal validation state
  const [newPlanValidationAttempted, setNewPlanValidationAttempted] = useState(false)
  const [newPlanShakeKey, setNewPlanShakeKey] = useState(0)

  // QR code modal state
  const [qrMember, setQrMember] = useState<Member | null>(null)
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null)
  const [qrError, setQrError] = useState('')
  const [exporting, setExporting] = useState(false)

  // Payment history for the member being edited (P2 5.2)
  const [memberPayments, setMemberPayments] = useState<Payment[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)

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

  // Load the last staff-entered member ID once so the new-member form can suggest the next ID
  useEffect(() => {
    (async () => {
      try {
        const info = await window.electronAPI.getLastMemberId()
        setLastMemberId(info)
        setLastMemberIdLoaded(true)
      } catch {
        setLastMemberIdLoaded(true)
      }
    })()
  }, [])

  // Support the global search jump (App sets initialSearch, then we consume it)
  useEffect(() => {
    if (initialSearch) {
      setSearchQuery(initialSearch)
      onSearchConsumed?.()
    }
  }, [initialSearch])

  // P1 4.2: server-side pagination (expiry computation still needs the full list)
  const PAGE_SIZE = 50

  const loadMembers = async () => {
    setMembersLoading(true)
    try {
      if (memberTab === 'all') {
        const data = await window.electronAPI.getMembersPage({
          offset: memberPage * PAGE_SIZE,
          limit: PAGE_SIZE,
          search: searchQuery.trim() || undefined,
        })
        setMembers(data.rows)
        setTotalMembers(data.total)
        // If the last item on this page was deleted, step back a page instead of showing an empty table
        if (data.rows.length === 0 && data.total > 0 && memberPage > 0) {
          setMemberPage(p => Math.max(0, p - 1))
        }
      } else {
        // Expiring tab already needs the full list — reuse it for the badge too
        const data = await window.electronAPI.getMembers()
        setMembers(data)
        setAllMembers(data)
        setTotalMembers(data.length)
      }
    } catch (error) {
      console.error('Failed to load members:', error)
    } finally {
      setMembersLoading(false)
    }
  }

  // Keep a full member list in the background for the expiring badge/filter
  const loadAllMembers = async () => {
    try {
      const data = await window.electronAPI.getMembers()
      setAllMembers(data)
    } catch (error) {
      console.error('Failed to load all members:', error)
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
    // Full list is only needed for the expiring badge on the 'all' tab (the expiring tab fetches it directly)
    if (memberTab === 'all') {
      loadAllMembers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, memberTab, memberPage])

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
    setMemberPage(0)
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

  // Required-field validation for the member form
  const missingRequired: string[] = (() => {
    const missing: string[] = []
    if (!formData.name.trim()) missing.push('Name')
    if (!selectedMember) {
      if (!formData.plan_id) missing.push('Plan')
      if (!waiverAgreed) missing.push('Waiver')
      if (paymentForm.amount <= 0) missing.push('Payment')
      if (METHODS_REQUIRING_REF.includes(paymentForm.payment_method) && !paymentForm.transaction_ref.trim()) {
        missing.push('Transaction Ref')
      }
    }
    return missing
  })()

  const scrollToFirstMissing = () => {
    const targets: { el: HTMLElement | null }[] = [
      { el: !formData.name.trim() ? nameRef.current : null },
      { el: !selectedMember && formData.plan_id === 0 ? planRef.current : null },
      { el: !selectedMember && !waiverAgreed ? waiverRef.current : null },
      { el: !selectedMember && paymentForm.amount <= 0 ? paymentRef.current : null },
      { el: !selectedMember && METHODS_REQUIRING_REF.includes(paymentForm.payment_method) && !paymentForm.transaction_ref.trim() ? transactionRefRef.current : null },
    ]
    const first = targets.find(t => t.el)?.el
    first?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const handleSubmitClick = () => {
    if (missingRequired.length > 0) {
      setValidationAttempted(true)
      setShakeKey(k => k + 1)
      scrollToFirstMissing()
      return
    }
    setValidationAttempted(false)
    if (selectedMember) {
      handleUpdate()
    } else {
      handleCreate()
    }
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

      // Process the required payment
      if (newNumericId && paymentForm.amount > 0) {
        const payAmount = paymentForm.amount
        await window.electronAPI.createPayment({
          member_id: newNumericId,
          amount: payAmount,
          type: paymentForm.type,
          plan_id: formData.plan_id || undefined,
          payment_method: paymentForm.payment_method,
          transaction_ref: paymentForm.transaction_ref.trim() || undefined,
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
      loadAllMembers()
      
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
        waiver_agreed_at: waiverAgreedAt || undefined,
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
      loadAllMembers()
      
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
    try {
      const member = members.find(m => m.id === id)
      await window.electronAPI.deleteMember(id)
      setDeleteTarget(null)
      setSelectedMember(null)
      loadMembers()
      loadAllMembers()
      if (member) {
        log.deleteMember(id, member.name)
      }
    } catch (error) {
      console.error('Failed to delete member:', error)
    }
  }

  const getDefaultStartDate = () => {
    return todayLocal()
  }

  const getDefaultEndDate = () => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return todayLocalOf(d)
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
    coaching_start: '',
    coaching_end: '',
      balance: 0,
      status: 'active',
      photo: ''
    })
    setPhotoPreview(null)
    setFingerprint({ scanning: false, captured: false, credentialId: null, error: null })
    setWaiverAgreed(false)
    setWaiverAgreedAt(null)
    setValidationAttempted(false)
    setShakeKey(0)
    setPaymentForm({ amount: 0, type: 'new_plan', payment_method: 'cash', transaction_ref: '' })
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
      finalEnd = todayLocalOf(d)
    }
    setNewPlanData({
      plan_id: 0,
      plan_start: today,
      plan_end: finalEnd,
    })
    setNewPlanPayment({ amount: 0, payment_method: 'cash', transaction_ref: '' })
    // Initialize waiver state based on existing member waiver
    setRenewWaiverAgreed(!!member.waiver_agreed_at)
    setRenewWaiverAgreedAt(member.waiver_agreed_at || null)
    setRenewShowWaiverModal(false)
    setShowNewPlanModal(true)
  }

  // Required-field validation for the New Plan modal: plan + payment are required
  const newPlanMissing: string[] = (() => {
    const missing: string[] = []
    if (!newPlanMember) return missing
    if (!newPlanData.plan_id) missing.push('Plan')
    if (!newPlanMember.waiver_agreed_at && !renewWaiverAgreed) missing.push('Waiver')
    if (newPlanPayment.amount <= 0) missing.push('Payment')
    if (METHODS_REQUIRING_REF.includes(newPlanPayment.payment_method) && !newPlanPayment.transaction_ref.trim()) {
      missing.push('Transaction Ref')
    }
    return missing
  })()

  const handleNewPlanSubmit = () => {
    if (newPlanMissing.length > 0) {
      setNewPlanValidationAttempted(true)
      setNewPlanShakeKey(k => k + 1)
      // Auto-scroll to the first missing required field
      const targets: { el: HTMLElement | null }[] = [
        { el: !newPlanData.plan_id ? newPlanPlanRef.current : null },
        { el: !newPlanMember?.waiver_agreed_at && !renewWaiverAgreed ? newPlanWaiverRef.current : null },
        { el: newPlanPayment.amount <= 0 ? newPlanPaymentRef.current : null },
        { el: METHODS_REQUIRING_REF.includes(newPlanPayment.payment_method) && !newPlanPayment.transaction_ref.trim() ? newPlanTxnRef.current : null },
      ]
      const first = targets.find(t => t.el)?.el
      first?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      return
    }
    setNewPlanValidationAttempted(false)
    handleNewPlanSave()
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
      // New balance: outstanding balance + plan price - payment made now
      const paymentAmount = newPlanPayment.amount > 0 ? newPlanPayment.amount : 0
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
          transaction_ref: newPlanPayment.transaction_ref.trim() || undefined,
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
      loadAllMembers()
      
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
    setValidationAttempted(false)
    setShakeKey(0)
    setShowForm(true)
    loadMemberPayments(member.id)
  }

  // Load payment history when the edit modal opens
  const loadMemberPayments = async (memberId: number) => {
    setPaymentsLoading(true)
    try {
      const data = await window.electronAPI.getPayments(memberId)
      setMemberPayments(data)
    } catch (error) {
      console.error('Failed to load payments:', error)
    } finally {
      setPaymentsLoading(false)
    }
  }

  // Void or refund a payment (P2 5.2)
  const handlePaymentStatus = async (payment: Payment, status: 'voided' | 'refunded') => {
    const label = status === 'voided' ? 'void' : 'refund'
    const note = window.prompt(`Enter a reason for the ${label} (optional):`, '')
    if (note === null) return // cancelled
    try {
      const result = await window.electronAPI.updatePaymentStatus(payment.id, status, note || undefined)
      if (result.success) {
        showToast('success', `Payment ${label}ed successfully.`)
        if (selectedMember) loadMemberPayments(selectedMember.id)
      } else {
        showToast('error', result.message || `Failed to ${label} payment.`)
      }
    } catch (error: any) {
      showToast('error', error.message || `Failed to ${label} payment.`)
    }
  }

  const getPlanName = (planId?: number) => {
    if (!planId) return 'No plan'
    const plan = plans.find(p => p.id === planId)
    return plan?.name || 'Unknown'
  }

  // Open QR code modal for a member
  const handleShowQr = async (member: Member) => {
    setQrMember(member)
    setQrCodeUrl(null)
    setQrError('')
    try {
      const url = await QRCode.toDataURL(member.member_id, {
        width: 320,
        margin: 2,
        color: { dark: '#101215', light: '#ffffff' },
      })
      setQrCodeUrl(url)
    } catch (error) {
      console.error('Failed to generate QR:', error)
      setQrError('Failed to generate the QR code. Please try again.')
    }
  }

  // P2 5.1: Printable member ID card
  const openIdCard = async (member: Member) => {
    setIdCardMember(member)
    setIdCardQr('')
    try {
      const url = await QRCode.toDataURL(member.member_id, {
        width: 160,
        margin: 1,
        color: { dark: '#101215', light: '#ffffff' },
      })
      setIdCardQr(url)
    } catch (error) {
      console.error('Failed to generate ID card QR:', error)
    }
  }

  const handlePrintIdCard = async () => {
    if (!idCardMember || !idCardQr) return
    setIdCardPrinting(true)
    try {
      const member = idCardMember
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ID Card</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 24px; display: flex; justify-content: center; background: #eef0f4; }
  .card { width: 340px; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,.15); }
  .card-top { background: #1a1a2e; color: #fff; padding: 14px 16px; display: flex; align-items: center; gap: 12px; }
  .card-top .brand { font-size: 13px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; }
  .card-top .id-code { font-size: 11px; color: #aab; font-family: monospace; margin-left: auto; }
  .card-photo { display: flex; justify-content: center; padding: 18px 0 8px; }
  .card-photo img { width: 120px; height: 120px; border-radius: 50%; object-fit: cover; border: 4px solid #eef0f4; }
  .card-photo .avatar { width: 120px; height: 120px; border-radius: 50%; background: #1a1a2e; color: #fff; font-size: 40px; display: flex; align-items: center; justify-content: center; }
  .card-name { text-align: center; font-size: 20px; font-weight: 700; padding: 4px 16px 2px; }
  .card-plan { text-align: center; font-size: 12px; color: #2e7d32; font-weight: 600; padding-bottom: 12px; }
  .card-body { display: flex; padding: 0 20px 14px; }
  .card-info { flex: 1; font-size: 11px; color: #666; }
  .card-info .row { margin-bottom: 4px; }
  .card-info .lbl { text-transform: uppercase; font-size: 8px; color: #999; letter-spacing: .5px; }
  .card-info .val { font-weight: 600; color: #222; }
  .card-qr { width: 92px; height: 92px; }
  .card-qr img { width: 92px; height: 92px; }
  .card-bottom { background: #f4f5f7; padding: 8px; text-align: center; font-size: 9px; color: #999; border-top: 1px solid #e3e6ea; }
  @media print { body { background: #fff; padding: 0; } .card { box-shadow: none; } }
</style></head>
<body>
  <div class="card">
    <div class="card-top">
      <span class="brand">REPCHECK GYM</span>
      <span class="id-code">${String(member.member_id).replace(/</g, '&lt;')}</span>
    </div>
    <div class="card-photo">
      ${member.photo
        ? `<img src="${member.photo}" alt="" />`
        : `<div class="avatar">${String(member.name.charAt(0)).toUpperCase()}</div>`}
    </div>
    <div class="card-name">${String(member.name).replace(/</g, '&lt;')}</div>
    <div class="card-plan">${String(member.plan_name || 'No Plan').replace(/</g, '&lt;')}</div>
    <div class="card-body">
      <div class="card-info">
        <div class="row"><div class="lbl">Status</div><div class="val">${String(member.status).toUpperCase()}</div></div>
        ${member.plan_end ? `<div class="row"><div class="lbl">Valid Until</div><div class="val">${String(new Date(member.plan_end).toLocaleDateString()).replace(/</g, '&lt;')}</div></div>` : ''}
        <div class="row"><div class="lbl">Balance</div><div class="val">₱${Number(member.balance || 0).toFixed(2)}</div></div>
      </div>
      <div class="card-qr"><img src="${idCardQr}" alt="QR" /></div>
    </div>
    <div class="card-bottom">Present this card at the front desk for check-in</div>
  </div>
</body></html>`
      const result = await window.electronAPI.printIdCard(html)
      if (!result.success) {
        console.error('Print failed:', result.message)
      }
    } catch (error) {
      console.error('Print ID card failed:', error)
    } finally {
      setIdCardPrinting(false)
    }
  }

  // Styled Excel export (.xls with HTML formatting) — same approach as the Reports page
  const handleExportExcel = async () => {
    setExporting(true)
    try {
      // Export the FULL member list (not just the current page) so "all members" is accurate
      const allForExport = (await window.electronAPI.getMembers()) || members
      const esc = (s: string | undefined | null): string => {
        if (!s) return ''
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      }
      const statusClass = (s: string) => s === 'active' ? 'tag-active' : s === 'inactive' ? 'tag-inactive' : 'tag-expired'
      const style = `<style>
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #222; padding: 20px; }
        h1 { font-size: 16pt; font-weight: 700; text-align: center; margin: 0 0 4px; color: #1a1a2e; }
        .subtitle { text-align: center; font-size: 10pt; color: #666; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
        th { padding: 6px 8px; text-align: left; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #fff; background: #1a1a2e; border: 1px solid #1a1a2e; }
        td { padding: 5px 8px; border: 1px solid #dde1e6; vertical-align: middle; font-size: 9pt; }
        tr:nth-child(even) { background: #f8f9fb; }
        .mono { font-family: 'Consolas', 'Courier New', monospace; font-size: 8.5pt; }
        .amt { text-align: right; font-weight: 600; }
        .tag { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 7pt; font-weight: 700; }
        .tag-active { background: #e8f5e9; color: #2e7d32; }
        .tag-inactive { background: #e0e0e0; color: #555; }
        .tag-expired { background: #fdecea; color: #c62828; }
        .tag-yes { background: #e8f5e9; color: #2e7d32; }
        .tag-no { background: #fdecea; color: #c62828; }
        .footer { text-align: center; font-size: 8pt; color: #999; margin-top: 16px; border-top: 1px solid #dde1e6; padding-top: 8px; }
      </style>`
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>members-${todayLocal()}</title>${style}</head><body>
<h1>Members List</h1>
<div class="subtitle">${allForExport.length} member${allForExport.length !== 1 ? 's' : ''} · Generated ${new Date().toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
<table>
  <thead><tr><th>Member ID</th><th>Name</th><th>Email</th><th>Phone</th><th>Plan</th><th>Status</th><th>Balance</th><th>Plan Start</th><th>Plan End</th><th>Sessions Used</th><th>Waiver</th><th>Member Since</th></tr></thead>
  <tbody>
    ${allForExport.map(m => `<tr>
      <td class="mono">${esc(m.member_id)}</td>
      <td>${esc(m.name)}</td>
      <td>${esc(m.email || '')}</td>
      <td>${esc(m.phone || '')}</td>
      <td>${esc(m.plan_name || 'No Plan')}</td>
      <td><span class="tag ${statusClass(m.status)}">${esc(m.status)}</span></td>
      <td class="mono amt">${(m.balance || 0).toFixed(2)}</td>
      <td class="mono">${esc(m.plan_start || '')}</td>
      <td class="mono">${esc(m.plan_end || '')}</td>
      <td class="mono">${String(m.sessions_used || 0)}</td>
      <td>${m.waiver_agreed_at ? '<span class="tag tag-yes">Yes</span>' : '<span class="tag tag-no">No</span>'}</td>
      <td class="mono">${m.created_at ? esc(new Date(m.created_at).toLocaleString()) : ''}</td>
    </tr>`).join('')}
  </tbody>
</table>
<div class="footer">Exported from REPCHECK</div>
</body></html>`
      const encoder = new TextEncoder()
      const bom = new Uint8Array([0xEF, 0xBB, 0xBF])
      const blob = new Blob([bom, encoder.encode(html)], { type: 'application/vnd.ms-excel;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `members-${todayLocal()}.xls`
      // Delay the download briefly so the "Exporting..." indicator is visible on screen
      setTimeout(() => {
        a.click()
        URL.revokeObjectURL(url)
        setExporting(false)
      }, 400)
    } catch (error) {
      console.error('Export failed:', error)
      setExporting(false)
    }
  }

  const calcDaysRemaining = (dateStr?: string): number | null => {
    if (!dateStr) return null
    const now = new Date()
    const end = new Date(dateStr)
    const diff = end.getTime() - now.getTime()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }

  // Expiring = within the next 7 days — keep in sync with the SQL window
  // used by get-expiring-soon / expiringThisWeek in electron/main.ts
  const isExpiring = (member: Member): boolean => {
    const daysPlan = calcDaysRemaining(member.plan_end)
    const daysCoaching = calcDaysRemaining(member.coaching_end)
    const days = Math.min(
      daysPlan ?? Infinity,
      daysCoaching ?? Infinity
    )
    return days <= 7 && days >= 0
  }

  const expiringMembers = allMembers.filter(isExpiring)

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
          <button
            className="btn btn-secondary"
            onClick={handleExportExcel}
            disabled={exporting || allMembers.length === 0}
            title={allMembers.length === 0 ? 'No members to export' : 'Export all members as a styled Excel file'}
          >
            {exporting ? '⏳ Exporting...' : '⬇ Export Excel'}
          </button>
          <button className="btn btn-primary" onClick={() => {
            resetForm()
            setSelectedMember(null)
            setShowForm(true)
            setPaymentForm({ amount: 0, type: 'new_plan', payment_method: 'cash', transaction_ref: '' })
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
          All Members {totalMembers > 0 && <span className="expiring-badge">{totalMembers}</span>}
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
                          openIdCard(member)
                        }}
                        title="Member ID Card"
                      >
                        🪪
                      </button>
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
                            setDeleteTarget(member)
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

      {/* P1 4.2: pagination footer (all tab only) */}
      {memberTab === 'all' && totalMembers > PAGE_SIZE && (
        <div className="members-pagination">
          <span className="pagination-info mono-text">
            Showing {membersLoading ? '…' : (memberPage * PAGE_SIZE) + 1}–{Math.min((memberPage + 1) * PAGE_SIZE, totalMembers)} of {totalMembers}
          </span>
          <div className="pagination-actions">
            <button
              className="btn btn-secondary btn-sm"
              disabled={memberPage === 0 || membersLoading}
              onClick={() => setMemberPage(p => Math.max(0, p - 1))}
            >
              ← Prev
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={(memberPage + 1) * PAGE_SIZE >= totalMembers || membersLoading}
              onClick={() => setMemberPage(p => p + 1)}
            >
              Next →
            </button>
          </div>
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
                              handleShowQr(member)
                            }}
                            title="Show QR Code"
                          >
                            ⬒
                          </button>
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
                                setDeleteTarget(member)
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
                  <label>Plan *</label>
                  <select
                    ref={newPlanPlanRef}
                    className={`input ${newPlanValidationAttempted && newPlanData.plan_id === 0 ? 'input-required-missing' : ''}`}
                    value={newPlanData.plan_id}
                    onChange={(e) => setNewPlanData({ ...newPlanData, plan_id: Number(e.target.value) })}
                  >
                    <option value={0}>— Select a plan —</option>
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} (₱{plan.price})
                      </option>
                    ))}
                  </select>
                  {newPlanValidationAttempted && newPlanData.plan_id === 0 && (
                    <span className="field-required-hint">⚠️ Select a plan</span>
                  )}
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
                <div ref={newPlanWaiverRef} className={`renew-waiver-box ${newPlanValidationAttempted && !newPlanMember.waiver_agreed_at && !renewWaiverAgreed ? 'enrollment-card-required' : ''}`}>
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

              {/* Payment section for new plan — required */}
              <div className="newplan-payment-section">
                <div className="newplan-payment-header">
                  <span className="section-label" style={{ margin: 0 }}>💰 Payment <span className="req-badge">Required</span></span>
                  <span className="newplan-balance mono-text">
                    Current Balance: <strong className={newPlanMember.balance > 0 ? 'danger' : ''}>₱{(newPlanMember.balance || 0).toFixed(2)}</strong>
                  </span>
                </div>
                <div className="payment-form newplan-payment-form">
                  <div className="payment-form-grid">
                    <div className="form-group">
                      <label>Amount *</label>
                      <input
                        ref={newPlanPaymentRef}
                        type="number"
                        className={`input ${newPlanValidationAttempted && newPlanPayment.amount <= 0 ? 'input-required-missing' : ''}`}
                        value={newPlanPayment.amount || ''}
                        onChange={(e) => setNewPlanPayment({ ...newPlanPayment, amount: Number(e.target.value) })}
                        placeholder="0.00"
                        step="0.01"
                        min="1"
                      />
                      {newPlanValidationAttempted && newPlanPayment.amount <= 0 && (
                        <span className="field-required-hint">⚠️ Enter a payment amount</span>
                      )}
                    </div>
                    <div className="form-group">
                      <label>Payment Method</label>
                      <select
                        className="input"
                        value={newPlanPayment.payment_method}
                        onChange={(e) => setNewPlanPayment({ ...newPlanPayment, payment_method: e.target.value, transaction_ref: '' })}
                      >
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="gcash">GCash</option>
                        <option value="maya">Maya</option>
                        <option value="bank_transfer">Bank Transfer</option>
                      </select>
                    </div>
                    {METHODS_REQUIRING_REF.includes(newPlanPayment.payment_method) && (
                      <div className="form-group">
                        <label>Transaction Number *</label>
                        <input
                          ref={newPlanTxnRef}
                          type="text"
                          className={`input ${newPlanValidationAttempted && !newPlanPayment.transaction_ref.trim() ? 'input-required-missing' : ''}`}
                          value={newPlanPayment.transaction_ref}
                          onChange={(e) => setNewPlanPayment({ ...newPlanPayment, transaction_ref: e.target.value })}
                          placeholder="e.g. 1234567890"
                        />
                        {newPlanValidationAttempted && !newPlanPayment.transaction_ref.trim() && (
                          <span className="field-required-hint">⚠️ Transaction number required for this method</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              {newPlanMissing.length > 0 ? (
                <span key={newPlanShakeKey} className={`footer-required-note ${newPlanValidationAttempted ? 'flash' : ''}`}>
                  ⚠️ Missing: {newPlanMissing.join(', ')}
                </span>
              ) : (
                <span className="footer-required-note ok">✓ All required fields complete</span>
              )}
              <button className="btn btn-secondary" onClick={() => setShowNewPlanModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleNewPlanSubmit}
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
                  <div ref={waiverRef} className={`enrollment-card ${!selectedMember && !waiverAgreed ? 'enrollment-card-required' : ''}`}>
                    <label className="section-label">
                      📄 Waiver Agreement{' '}
                      {!selectedMember && <span className="req-badge">Required</span>}
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
                            {selectedMember ? 'Waiver was not signed during enrollment' : 'Required — member must sign the waiver before they can be created'}
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
                          onChange={(e) => handleMemberIdChange(e.target.value)}
                          placeholder="Auto-generated if empty"
                          disabled={!!selectedMember}
                        />
                        {!selectedMember && lastMemberIdLoaded && lastMemberId.last > 0 && !formData.member_id.trim() && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm member-id-suggest"
                            onClick={() => handleMemberIdChange(String(lastMemberId.next))}
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
                        className={`input ${!formData.name.trim() ? 'input-required-missing' : ''}`}
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Full name"
                        required
                        ref={nameRef}
                      />
                      {!formData.name.trim() && (
                        <span className="field-required-hint">⚠️ Name is required</span>
                      )}
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
                      <label>Birthday</label>
                      <input
                        type="date"
                        className="input"
                        value={formData.birthday}
                        onChange={(e) => setFormData({ ...formData, birthday: e.target.value })}
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
                                  <td className="td-amount mono-text">₱{Number(pay.amount).toFixed(2)}</td>
                                  <td>
                                    <span className={`pay-status ${pay.status || 'completed'}`}>
                                      {pay.status || 'completed'}
                                    </span>
                                  </td>
                                  <td>
                                    {(pay.status === 'completed' || !pay.status) && isAdmin && (
                                      <div className="table-actions">
                                        <button
                                          className="btn-icon"
                                          title="Refund payment"
                                          onClick={() => handlePaymentStatus(pay, 'refunded')}
                                        >↩️</button>
                                        <button
                                          className="btn-icon danger"
                                          title="Void payment"
                                          onClick={() => handlePaymentStatus(pay, 'voided')}
                                        >✕</button>
                                      </div>
                                    )}
                                    {pay.note && (
                                      <span title={pay.note} style={{ cursor: 'help', color: 'var(--text-faint)' }}>ℹ️</span>
                                    )}
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
                        ref={planRef}
                        className={`input ${formData.plan_id === 0 ? 'input-required-missing' : ''}`}
                        value={formData.plan_id}
                        onChange={(e) => {
                          const planId = Number(e.target.value)
                          const plan = plans.find(p => p.id === planId)
                          // Auto-set balance to plan price when creating a new member
                          if (!selectedMember) {
                            const prevPlan = plans.find(p => p.id === formData.plan_id)
                            setFormData({ ...formData, plan_id: planId, balance: plan ? plan.price : 0 })
                            // Auto-fill the payment amount with the plan price
                            setPaymentForm((prev) => {
                              // Switching to "No plan": clear an amount that was auto-filled
                              if (planId === 0) {
                                if (prevPlan && prev.amount === prevPlan.price) return { ...prev, amount: 0 }
                                return prev
                              }
                              // Refresh the amount if it's still empty or still the previous plan's auto-filled price
                              const wasAutoFilled = prevPlan ? prev.amount === prevPlan.price : false
                              if (prev.amount <= 0 || wasAutoFilled) {
                                return { ...prev, amount: plan ? plan.price : 0 }
                              }
                              return prev
                            })
                          } else {
                            setFormData({ ...formData, plan_id: planId })
                          }
                        }}
                      >
                        <option value={0}>— Select a plan —</option>
                        {plans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.name} (₱{plan.price})
                          </option>
                        ))}
                      </select>
                      {formData.plan_id === 0 && (
                        <span className="field-required-hint">⚠️ Select a plan</span>
                      )}
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
                          setFormData({
                            ...formData,
                            coach_id: cid,
                            coaching_start: cid > 0 ? formData.coaching_start : '',
                            coaching_end: cid > 0 ? formData.coaching_end : '',
                          })
                        }}
                      >
                        <option value={0}>No coach</option>
                        {coaches.map((coach) => (
                          <option key={coach.id} value={coach.id}>
                            {coach.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {formData.coach_id > 0 && (
                      <div className="form-group">
                        <label>Coaching Start</label>
                        <input
                          type="date"
                          className="input"
                          value={formData.coaching_start}
                          onChange={(e) => setFormData({ ...formData, coaching_start: e.target.value })}
                        />
                      </div>
                    )}
                    {formData.coach_id > 0 && (
                      <div className="form-group">
                        <label>Coaching End</label>
                        <input
                          type="date"
                          className="input"
                          value={formData.coaching_end}
                          onChange={(e) => setFormData({ ...formData, coaching_end: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                  </div>
                  )}
                </div>
              </div>

              {/* ── Payments Section (create mode only) — required ── */}
              {!selectedMember && (
                <div className="payment-section">
                  <div className="payment-section-header">
                    <h3 className="section-label" style={{ margin: 0 }}>
                      💰 Payments <span className="req-badge">Required</span>
                    </h3>
                    <div className="payment-section-actions">
                      <span className="payment-hint">A payment is required to create this member</span>
                    </div>
                  </div>

                  {/* Required Payment Form */}
                  <div className="payment-form">
                    <div className="payment-form-grid">
                      <div className="form-group">
                        <label>Amount *</label>
                      <input
                        ref={paymentRef}
                        type="number"
                        className={`input ${paymentForm.amount <= 0 ? 'input-required-missing' : ''}`}
                        value={paymentForm.amount || ''}
                          onChange={(e) => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })}
                          placeholder="0.00"
                          step="0.01"
                          min="1"
                        />
                        {paymentForm.amount <= 0 && (
                          <span className="field-required-hint">⚠️ Enter a payment amount</span>
                        )}
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
                          onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value, transaction_ref: '' })}
                        >
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
                            ref={transactionRefRef}
                            type="text"
                            className={`input ${!paymentForm.transaction_ref.trim() ? 'input-required-missing' : ''}`}
                            value={paymentForm.transaction_ref}
                            onChange={(e) => setPaymentForm({ ...paymentForm, transaction_ref: e.target.value })}
                            placeholder="e.g. 1234567890"
                          />
                          {!paymentForm.transaction_ref.trim() && (
                            <span className="field-required-hint">⚠️ Transaction number required for this method</span>
                          )}
                        </div>
                      )}
                      <div className="form-group payment-form-actions">
                        <label>&nbsp;</label>
                        <div className="payment-btn-row">
                          <span className="payment-create-note">
                            Payment will be applied when you click "Create Member"
                          </span>
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
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSubmitClick}
              >
                {selectedMember ? 'Save Changes' : 'Create Member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── QR Code Modal ── */}
      {qrMember && (
        <div className="modal-overlay" onClick={() => setQrMember(null)}>
          <div className="modal qr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="display-text">⬒ Member QR Code</h2>
              <button className="btn-icon" onClick={() => setQrMember(null)}>✕</button>
            </div>
            <div className="modal-body qr-modal-body">
              <div className="qr-member-info">
                <span className="qr-member-name">{qrMember.name}</span>
                <span className="mono-text qr-member-id">ID: {qrMember.member_id}</span>
                <span className={`status-badge ${qrMember.status}`}>{qrMember.status}</span>
              </div>
              <div className="qr-code-container">
                {qrCodeUrl ? (
                  <img src={qrCodeUrl} alt={`QR for ${qrMember.member_id}`} className="qr-code-img" />
                ) : (
                  <div className="qr-loading">{qrError || 'Generating...'}</div>
                )}
              </div>
              <p className="qr-hint">
                Show this code at the kiosk and tap <strong>📷 Scan QR Code</strong> to check in.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setQrMember(null)}>Close</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  // Open a dedicated print window so we never print the whole app
                  if (!qrCodeUrl || !qrMember) return
                  const win = window.open('', '_blank', 'width=400,height=520')
                  if (!win) {
                    alert('Please allow pop-ups to print the QR code.')
                    return
                  }
                  const escHtml = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                  win.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>QR — ${escHtml(qrMember.member_id)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; text-align: center; padding: 24px; }
  .qr { margin: 20px auto; }
  .name { font-size: 16px; font-weight: 700; }
  .id { font-size: 13px; color: #555; margin-top: 4px; }
</style></head><body>
  <div class="name">${escHtml(qrMember.name)}</div>
  <div class="id">ID: ${escHtml(qrMember.member_id)}</div>
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
              {!selectedMember && (
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
              )}
            </div>
          </div>
        </div>
      )}

      {/* P2 5.1: Member ID card modal */}
      {idCardMember && (
        <div className="modal-overlay" onClick={() => setIdCardMember(null)}>
          <div className="modal id-card-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="display-text">🪪 Member ID Card</h2>
              <button className="btn-icon" onClick={() => setIdCardMember(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="id-card-preview">
                <div className="id-card-front">
                  <div className="id-card-top">
                    <span className="id-card-brand display-text">REPCHECK</span>
                    <span className="id-card-code mono-text">{idCardMember.member_id}</span>
                  </div>
                  <div className="id-card-photo-row">
                    {idCardMember.photo ? (
                      <img src={idCardMember.photo} alt={idCardMember.name} className="id-card-photo" />
                    ) : (
                      <div className="id-card-photo-placeholder">{idCardMember.name.charAt(0).toUpperCase()}</div>
                    )}
                    <div className="id-card-details">
                      <span className="id-card-name">{idCardMember.name}</span>
                      <span className="id-card-plan">{idCardMember.plan_name || 'No Plan'}</span>
                      <span className={`status-badge ${idCardMember.status}`}>{idCardMember.status}</span>
                    </div>
                  </div>
                  <div className="id-card-meta">
                    <div>
                      <span className="id-card-label">Valid Until</span>
                      <span className="id-card-value">{idCardMember.plan_end ? new Date(idCardMember.plan_end).toLocaleDateString() : 'N/A'}</span>
                    </div>
                    <div>
                      <span className="id-card-label">Balance</span>
                      <span className="id-card-value">₱{(idCardMember.balance || 0).toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="id-card-label">Coach</span>
                      <span className="id-card-value">{idCardMember.coach_name || '—'}</span>
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
              <button className="btn btn-secondary" onClick={() => setIdCardMember(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handlePrintIdCard} disabled={idCardPrinting || !idCardQr}>
                {idCardPrinting ? 'Printing…' : '🖨️ Print ID Card'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* P2 5.7: destructive-action confirmation via ConfirmModal */}
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Member"
        message={`Are you sure you want to delete ${deleteTarget?.name ? `"${deleteTarget.name}"` : 'this member'}? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmVariant="danger"
        icon="🗑️"
        onConfirm={() => deleteTarget && handleDelete(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

export default Members
