import React, { useState, useEffect, useRef } from 'react'
import './Members.css'
import { Member, Plan } from '../types/electron'

interface FingerprintState {
  scanning: boolean
  captured: boolean
  credentialId: string | null
  error: string | null
}

function Members() {
  const [members, setMembers] = useState<Member[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [fingerprint, setFingerprint] = useState<FingerprintState>({
    scanning: false,
    captured: false,
    credentialId: null,
    error: null
  })
  const fileInputRef = useRef<HTMLInputElement>(null)
  
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
    balance: 0,
    status: 'active' as 'active' | 'inactive' | 'expired',
    photo: ''
  })

  useEffect(() => {
    loadPlans()
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
      await window.electronAPI.createMember({
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
        balance: formData.balance || 0,
      })
      
      // Save the fingerprint credential if captured
      if (fingerprint.captured && fingerprint.credentialId) {
        // Store the WebAuthn credential ID associated with this member
        await window.electronAPI.saveFingerprintCredential(memberId, fingerprint.credentialId)
      }
      
      setShowForm(false)
      resetForm()
      loadMembers()
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
        balance: formData.balance || 0,
        status: formData.status,
      })
      
      // Update fingerprint credential if newly captured
      if (fingerprint.captured && fingerprint.credentialId) {
        await window.electronAPI.saveFingerprintCredential(selectedMember.member_id, fingerprint.credentialId)
      }
      
      setShowForm(false)
      setSelectedMember(null)
      resetForm()
      loadMembers()
    } catch (error) {
      console.error('Failed to update member:', error)
    }
  }

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this member?')) {
      try {
        await window.electronAPI.deleteMember(id)
        setSelectedMember(null)
        loadMembers()
      } catch (error) {
        console.error('Failed to delete member:', error)
      }
    }
  }

  const resetForm = () => {
    setFormData({
      member_id: '',
      name: '',
      email: '',
      phone: '',
      emergency_contact: '',
      emergency_phone: '',
      plan_id: 0,
      plan_start: '',
      plan_end: '',
      balance: 0,
      status: 'active',
      photo: ''
    })
    setPhotoPreview(null)
    setFingerprint({ scanning: false, captured: false, credentialId: null, error: null })
  }

  const generateMemberId = () => {
    return 'MEM-' + Date.now().toString(36).toUpperCase()
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
      balance: member.balance || 0,
      status: member.status,
      photo: member.photo || ''
    })
    setPhotoPreview(member.photo || null)
    setShowForm(true)
  }

  const getPlanName = (planId?: number) => {
    if (!planId) return 'No plan'
    const plan = plans.find(p => p.id === planId)
    return plan?.name || 'Unknown'
  }

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
          }}>
            + Add Member
          </button>
        </div>
      </div>

      <div className="members-table-container">
        <table className="members-table">
          <thead>
            <tr>
              <th>Photo</th>
              <th>Member ID</th>
              <th>Name</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Balance</th>
              <th>Expiry</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-row">No members found</td>
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
                  <td>
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
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
                        className="input"
                        value={formData.member_id}
                        onChange={(e) => setFormData({ ...formData, member_id: e.target.value })}
                        placeholder="Auto-generated if empty"
                        disabled={!!selectedMember}
                      />
                    </div>
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
                        onChange={(e) => setFormData({ ...formData, plan_id: Number(e.target.value) })}
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
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={selectedMember ? handleUpdate : handleCreate}
                disabled={!formData.name}
              >
                {selectedMember ? 'Save Changes' : 'Create Member'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Members
