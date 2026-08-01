import React, { useState, useEffect, useRef } from 'react'
import './Members.css'
import QRCode from 'qrcode'
import { Member, Plan, Coach, StaffUser, Payment } from '../types/electron'
import { log } from '../lib/logger'
import { useToast } from '../lib/toast'
import { todayLocal, todayLocalOf } from '../lib/dates'
import { notifyDataChanged, useDataVersion } from '../lib/data'
import { getCurrencySymbol } from '../lib/format'
import ConfirmModal from './ConfirmModal'
import MembersTable from './members/MembersTable'
import MemberFormModal, { MemberFormData, PaymentFormData, FingerprintState } from './members/MemberFormModal'
import NewPlanModal, { NewPlanData, NewPlanPayment } from './members/NewPlanModal'
import { QrCodeModal, IdCardModal } from './members/MemberModals'

// Payment methods that require a transaction reference number
const METHODS_REQUIRING_REF = ['gcash', 'maya', 'bank_transfer', 'card']

function Members({ currentUser, initialSearch, onSearchConsumed }: { currentUser?: StaffUser | null; initialSearch?: string; onSearchConsumed?: () => void }) {
  const isAdmin = currentUser?.role === 'admin'
  const { showToast } = useToast()
  const dataVersion = useDataVersion()
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
    error: null,
  })
  const [waiverAgreed, setWaiverAgreed] = useState(false)
  const [waiverAgreedAt, setWaiverAgreedAt] = useState<string | null>(null)
  const [validationAttempted, setValidationAttempted] = useState(false)
  const [shakeKey, setShakeKey] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const planRef = useRef<HTMLSelectElement>(null)
  const waiverRef = useRef<HTMLDivElement>(null)
  const paymentRef = useRef<HTMLInputElement>(null)
  const transactionRefRef = useRef<HTMLInputElement>(null)
  const [memberIdWarning, setMemberIdWarning] = useState<string | null>(null)
  const [checkingMemberId, setCheckingMemberId] = useState(false)
  const memberIdCheckTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [newPlanMember, setNewPlanMember] = useState<Member | null>(null)
  const [showNewPlanModal, setShowNewPlanModal] = useState(false)
  const [newPlanData, setNewPlanData] = useState<NewPlanData>({
    plan_id: 0,
    plan_start: '',
    plan_end: '',
  })

  // Payment recording state (create mode only)
  const [paymentForm, setPaymentForm] = useState<PaymentFormData>({
    amount: 0,
    type: 'new_plan',
    payment_method: 'cash',
    transaction_ref: '',
  })

  // New Plan modal payment state (always visible & required)
  const [newPlanPayment, setNewPlanPayment] = useState<NewPlanPayment>({
    amount: 0,
    payment_method: 'cash',
    transaction_ref: '',
  })

  // P2 5.2: auto-renew flags (new-plan modal + member form)
  const [newPlanAutoRenew, setNewPlanAutoRenew] = useState(false)
  const [formAutoRenew, setFormAutoRenew] = useState(false)

  // Last staff-entered numeric member ID (to suggest the next ID in the new-member form)
  const [lastMemberId, setLastMemberId] = useState<{ last: number; next: number }>({ last: 0, next: 1 })
  const [lastMemberIdLoaded, setLastMemberIdLoaded] = useState(false)

  // Renewal waiver state
  const [renewWaiverAgreed, setRenewWaiverAgreed] = useState(false)
  const [renewWaiverAgreedAt, setRenewWaiverAgreedAt] = useState<string | null>(null)

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

  const [formData, setFormData] = useState<MemberFormData>({
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
    status: 'active',
    photo: '',
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

  // P2 6.5: re-fetch whenever the data layer bumps (any page mutates data)
  useEffect(() => {
    loadMembers()
    // Full list is only needed for the expiring badge on the 'all' tab (the expiring tab fetches it directly)
    if (memberTab === 'all') {
      loadAllMembers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, memberTab, memberPage, dataVersion])

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
      const challenge = new Uint8Array(32)
      crypto.getRandomValues(challenge)

      const userId = new TextEncoder().encode(formData.member_id || generateMemberId())

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: 'REPCHECK Gym Check-In',
            id: window.location.hostname || 'localhost',
          },
          user: {
            id: userId,
            name: formData.email || formData.member_id || 'member',
            displayName: formData.name || 'Member',
          },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' },   // ES256
            { alg: -257, type: 'public-key' }, // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'required',
          },
          timeout: 60000,
          attestation: 'none',
        },
      }) as PublicKeyCredential | null

      if (credential) {
        const credentialIdArray = new Uint8Array(credential.rawId)
        const credentialIdHex = Array.from(credentialIdArray)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')

        setFingerprint({
          scanning: false,
          captured: true,
          credentialId: credentialIdHex,
          error: null,
        })
      } else {
        setFingerprint({
          scanning: false,
          captured: false,
          credentialId: null,
          error: 'Registration cancelled',
        })
      }
    } catch (error: any) {
      console.error('Fingerprint registration error:', error)
      setFingerprint({
        scanning: false,
        captured: false,
        credentialId: null,
        error: error.message || 'Registration failed',
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
        auto_renew: formAutoRenew ? 1 : 0,
      })

      // Get the numeric ID of the newly created member
      const newNumericId = result?.lastInsertRowid ? Number(result.lastInsertRowid) : 0

      // Save the fingerprint credential if captured
      if (fingerprint.captured && fingerprint.credentialId) {
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
      notifyDataChanged()

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
      notifyDataChanged()

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
      notifyDataChanged()
      if (member) {
        log.deleteMember(id, member.name)
      }
    } catch (error) {
      console.error('Failed to delete member:', error)
    }
  }

  const getDefaultStartDate = () => todayLocal()

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
      photo: '',
    })
    setPhotoPreview(null)
    setFingerprint({ scanning: false, captured: false, credentialId: null, error: null })
    setWaiverAgreed(false)
    setWaiverAgreedAt(null)
    setValidationAttempted(false)
    setShakeKey(0)
    setPaymentForm({ amount: 0, type: 'new_plan', payment_method: 'cash', transaction_ref: '' })
    setFormAutoRenew(false)
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
    setNewPlanAutoRenew(!!member.auto_renew)
    // Initialize waiver state based on existing member waiver
    setRenewWaiverAgreed(!!member.waiver_agreed_at)
    setRenewWaiverAgreedAt(member.waiver_agreed_at || null)
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
        auto_renew: newPlanAutoRenew ? 1 : 0,
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
      notifyDataChanged()

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
      photo: member.photo || '',
    })
    setPhotoPreview(member.photo || null)
    setWaiverAgreed(!!member.waiver_agreed_at)
    setWaiverAgreedAt(member.waiver_agreed_at || null)
    setFormAutoRenew(!!member.auto_renew)
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
        notifyDataChanged()
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
        <div class="row"><div class="lbl">Balance</div><div class="val">${getCurrencySymbol()}${Number(member.balance || 0).toFixed(2)}</div></div>
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

      <MembersTable
        memberTab={memberTab}
        members={members}
        expiringMembers={expiringMembers}
        totalMembers={totalMembers}
        memberPage={memberPage}
        pageSize={PAGE_SIZE}
        loading={membersLoading}
        isAdmin={isAdmin}
        getPlanName={getPlanName}
        onTabChange={setMemberTab}
        onPageChange={setMemberPage}
        onOpenEdit={openEditForm}
        onOpenIdCard={openIdCard}
        onOpenNewPlan={openNewPlanModal}
        onDelete={(m) => setDeleteTarget(m)}
        onShowQr={handleShowQr}
      />

      {/* New Plan Modal */}
      {showNewPlanModal && newPlanMember && (
        <NewPlanModal
          member={newPlanMember}
          plans={plans}
          data={newPlanData}
          payment={newPlanPayment}
          waiverAgreed={renewWaiverAgreed}
          waiverAgreedAt={renewWaiverAgreedAt}
          validationAttempted={newPlanValidationAttempted}
          shakeKey={newPlanShakeKey}
          missing={newPlanMissing}
          onDataChange={setNewPlanData}
          onPaymentChange={setNewPlanPayment}
          autoRenew={newPlanAutoRenew}
          onAutoRenewChange={setNewPlanAutoRenew}
          onWaiverAgree={() => {
            setRenewWaiverAgreed(true)
            const now = new Date().toISOString()
            setRenewWaiverAgreedAt(now)
            log.action({
              action: 'waiver_signed',
              entity_type: 'member',
              details: JSON.stringify({ member_name: newPlanMember?.name || 'Member', agreed_at: now, context: 'renewal' }),
            })
          }}
          onSubmit={handleNewPlanSubmit}
          onCancel={() => {
            setShowNewPlanModal(false)
            setNewPlanMember(null)
          }}
        />
      )}

      {/* Create / Edit Member Modal */}
      {showForm && (
        <MemberFormModal
          selectedMember={selectedMember}
          plans={plans}
          coaches={coaches}
          formData={formData}
          onFormDataChange={setFormData}
          paymentForm={paymentForm}
          onPaymentFormChange={setPaymentForm}
          photoPreview={photoPreview}
          fingerprint={fingerprint}
          waiverAgreed={waiverAgreed}
          waiverAgreedAt={waiverAgreedAt}
          validationAttempted={validationAttempted}
          shakeKey={shakeKey}
          missingRequired={missingRequired}
          memberIdWarning={memberIdWarning}
          checkingMemberId={checkingMemberId}
          lastMemberId={lastMemberId}
          lastMemberIdLoaded={lastMemberIdLoaded}
          memberPayments={memberPayments}
          paymentsLoading={paymentsLoading}
          isAdmin={isAdmin}
          autoRenew={formAutoRenew}
          onAutoRenewChange={setFormAutoRenew}
          refs={{ fileInputRef, nameRef, planRef, waiverRef, paymentRef, transactionRefRef }}
          onMemberIdChange={handleMemberIdChange}
          onPhotoUpload={handlePhotoUpload}
          onCameraCapture={handleCameraCapture}
          onFingerprintScan={handleFingerprintScan}
          onRetakeFingerprint={handleRetakeFingerprint}
          onPaymentStatus={handlePaymentStatus}
          onWaiverAgree={() => {
            setWaiverAgreed(true)
            const now = new Date().toISOString()
            setWaiverAgreedAt(now)
            log.action({
              action: 'waiver_signed',
              entity_type: 'member',
              details: JSON.stringify({ member_name: formData.name || 'New Member', agreed_at: now }),
            })
          }}
          onSubmit={handleSubmitClick}
          onClose={() => {
            setShowForm(false)
            setSelectedMember(null)
          }}
        />
      )}

      {/* QR Code Modal */}
      {qrMember && (
        <QrCodeModal
          member={qrMember}
          qrCodeUrl={qrCodeUrl}
          qrError={qrError}
          onClose={() => setQrMember(null)}
        />
      )}

      {/* Member ID card modal */}
      {idCardMember && (
        <IdCardModal
          member={idCardMember}
          idCardQr={idCardQr}
          printing={idCardPrinting}
          onPrint={handlePrintIdCard}
          onClose={() => setIdCardMember(null)}
        />
      )}

      {/* Destructive-action confirmation via ConfirmModal */}
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
