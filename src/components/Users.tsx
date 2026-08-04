import React, { useState, useEffect } from 'react'
import './Users.css'
import { StaffUser } from '../types/electron'
import ConfirmModal from './ConfirmModal'
import FingerprintEnrollment, { ENROLL_STEPS, FingerprintSlotData, emptyFingerSlots } from './FingerprintEnrollment'
import { log } from '../lib/logger'

function Users() {
  const [users, setUsers] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingUser, setEditingUser] = useState<StaffUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StaffUser | null>(null)
  const [form, setForm] = useState({ username: '', password: '', confirm_password: '', role: 'staff' as 'admin' | 'staff', display_name: '', photo: '' })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  // P2 6.9: staff/admin fingerprint enrollment (up to 3 fingers) for biometric sign-in
  const [userFp, setUserFp] = useState<FingerprintSlotData[]>(emptyFingerSlots())

  useEffect(() => { loadUsers() }, [])

  const loadUsers = async () => {
    setLoading(true)
    try {
      const data = await window.electronAPI.getUsers()
      setUsers(data)
    } catch (err) {
      console.error('Failed to load users:', err)
    } finally {
      setLoading(false)
    }
  }

  const openCreate = () => {
    setEditingUser(null)
    setForm({ username: '', password: '', confirm_password: '', role: 'staff', display_name: '', photo: '' })
    setFormError('')
    setUserFp(emptyFingerSlots())
    setShowModal(true)
  }

  const openEdit = (user: StaffUser) => {
    setEditingUser(user)
    setForm({ username: user.username, password: '', confirm_password: '', role: user.role, display_name: user.display_name || '', photo: user.photo || '' })
    setFormError('')
    setUserFp(emptyFingerSlots())
    loadStaffFingerprints(user.id)
    setShowModal(true)
  }

  // Pre-fill the fingerprint slots with this user's enrolled templates (edit mode)
  const loadStaffFingerprints = async (staffId: number) => {
    try {
      const all = await window.electronAPI.getAllStaffFingerprintTemplates()
      const mine = all.filter(t => t.staff_id === staffId).slice(0, ENROLL_STEPS)
      setUserFp(Array.from({ length: ENROLL_STEPS }, (_, i) => ({
        fmdBase64: mine[i]?.fmdBase64 || null,
        quality: 0,
      })))
    } catch {
      // Leave slots empty — enrollment is optional
    }
  }

  // Capture one finger from the U.are.U 4500 (same pipeline as member enrollment)
  const captureFingerOnce = async (): Promise<FingerprintSlotData | null> => {
    const status = await window.electronAPI.getFingerprintStatus()
    if (!status.available) {
      const detail = status.steps.filter(s => !s.ok).map(s => s.message).join(' ')
      throw new Error(detail || 'Fingerprint scanner is not available. Check that the U.R.U. 4500 is plugged in and the SDK is installed (see Settings → Fingerprint Scanner).')
    }
    const capture = await window.electronAPI.captureFingerprint(30000)
    if (!capture.ok) return null
    const fmdRes = await window.electronAPI.createFingerprintFmd(capture.sample.imageBase64)
    if ('error' in fmdRes) throw new Error(fmdRes.error)
    return { fmdBase64: fmdRes.fmdBase64, quality: capture.sample.qualityCode || 0 }
  }

  // Persist the enrolled fingerprints (replaces the user's old set)
  const saveStaffFingerprints = async (staffId: number) => {
    const enrolled = userFp.filter(f => f.fmdBase64)
    await window.electronAPI.replaceStaffFingerprints(
      staffId,
      enrolled.map(f => ({ fmdBase64: f.fmdBase64!, quality: f.quality || 0 }))
    )
    if (enrolled.length > 0) {
      log.action({
        action: 'register_staff_fingerprint',
        entity_type: 'staff',
        entity_id: staffId,
        details: JSON.stringify({ staff_name: form.display_name || form.username, count: enrolled.length }),
      })
    }
  }

  const handlePhotoUpload = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/svg+xml,image/webp,image/gif'
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        setForm(prev => ({ ...prev, photo: ev.target?.result as string }))
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  const handleRemovePhoto = () => {
    setForm(prev => ({ ...prev, photo: '' }))
  }

  const handleSave = async () => {
    if (!form.username.trim()) {
      setFormError('Username is required')
      return
    }
    if (!editingUser && !form.password.trim()) {
      setFormError('Password is required for new users')
      return
    }
    if (form.password !== form.confirm_password) {
      setFormError('Passwords do not match')
      return
    }

    setSaving(true)
    setFormError('')

    try {
      if (editingUser) {
        const result = await window.electronAPI.updateUser(editingUser.id, {
          username: form.username,
          role: form.role,
          display_name: form.display_name || undefined,
          photo: form.photo || undefined,
          ...(form.password ? { password: form.password } : {}),
        })
        if (!result.success) {
          setFormError(result.message || 'Failed to update user')
          setSaving(false)
          return
        }
        // P2 6.9: save the staff fingerprint enrollments (replaces old set)
        await saveStaffFingerprints(editingUser.id)
      } else {
        const result = await window.electronAPI.createUser({
          username: form.username,
          password: form.password,
          role: form.role,
          display_name: form.display_name || undefined,
          photo: form.photo || undefined,
        })
        if (!result.success) {
          setFormError(result.message || 'Failed to create user')
          setSaving(false)
          return
        }
        // P2 6.9: save fingerprints right after the account row exists
        if (result.id) await saveStaffFingerprints(result.id)
      }
      setShowModal(false)
      await loadUsers()
    } catch (err: any) {
      setFormError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (user: StaffUser) => {
    setDeleteTarget(null)
    try {
      const result = await window.electronAPI.deleteUser(user.id)
      if (result.success) {
        await loadUsers()
      } else {
        alert(result.message || 'Failed to delete user')
      }
    } catch (err: any) {
      alert(err.message || 'Delete failed')
    }
  }

  const roleBadge = (role: string) => (
    <span className={`user-role-badge role-${role}`}>{role === 'admin' ? 'Admin' : 'Staff'}</span>
  )

  return (
    <div className="users-page">
      <div className="users-topbar">
        <h1 className="display-text page-title">Users</h1>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>+ Add User</button>
      </div>

      {loading ? (
        <div className="users-loading"><div className="loading-spinner" /><p>Loading users...</p></div>
      ) : (
        <div className="users-table-wrapper">
          <table className="users-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Username</th>
                <th>Role</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={5} className="users-empty">No users found</td></tr>
              ) : (
                users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div className="user-cell">
                        <div className="user-avatar-sm">
                          {u.photo ? <img src={u.photo} alt="" /> : (u.display_name || u.username).charAt(0).toUpperCase()}
                        </div>
                        <span>{u.display_name || u.username}</span>
                      </div>
                    </td>
                    <td className="mono-text">{u.username}</td>
                    <td>{roleBadge(u.role)}</td>
                    <td className="mono-text">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td>
                      <div className="user-actions">
                        <button className="btn btn-sm btn-secondary" onClick={() => openEdit(u)}>Edit</button>
                        <button className="btn btn-sm btn-danger" onClick={() => setDeleteTarget(u)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* P2 5.7: destructive-action confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete User"
        message={`Are you sure you want to delete the user "${deleteTarget?.username || ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmVariant="danger"
        icon="🗑️"
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* ── User Modal ── */}
      {showModal && (
        <div className="users-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="users-modal" onClick={e => e.stopPropagation()}>
            <div className="users-modal-header">
              <h2 className="users-modal-title">{editingUser ? 'Edit User' : 'Add User'}</h2>
              <button className="modal-close-btn" onClick={() => setShowModal(false)}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M13.5 4.5L4.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M4.5 4.5L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            <div className="users-modal-body">
              {/* Photo */}
              <div className="user-photo-section">
                <div className="user-photo-upload" onClick={handlePhotoUpload}>
                  {form.photo ? (
                    <img src={form.photo} alt="Avatar" className="user-photo-preview" />
                  ) : (
                    <div className="user-photo-placeholder">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                        <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12Z" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M18 20C18 17.79 15.31 16 12 16C8.69 16 6 17.79 6 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                      <span>Upload Photo</span>
                    </div>
                  )}
                  {form.photo && (
                    <button className="user-photo-remove" onClick={handleRemovePhoto}>✕</button>
                  )}
                </div>
              </div>

              {/* P2 6.9: fingerprint enrollment — biometric sign-in + kiosk executive access */}
              <div className="user-fp-section">
                <div className="user-fp-header">
                  <span className="user-fp-title">🖐️ Fingerprint Sign-in</span>
                  <span className="user-fp-hint">
                    Enroll up to 3 fingers. This user can then log in by fingerprint, and admins
                    scanning at the kiosk open the Daily Executive Report.
                  </span>
                </div>
                <FingerprintEnrollment
                  compact
                  initialFingers={userFp}
                  captureFinger={captureFingerOnce}
                  onEnrolled={setUserFp}
                  hint="Tap the finger 3 times to finish enrollment."
                />
              </div>

              <div className="user-form-grid">
                <div className="user-form-field">
                  <label>Display Name</label>
                  <input type="text" className="input" placeholder="Full name" value={form.display_name}
                    onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))} />
                </div>
                <div className="user-form-field">
                  <label>Username *</label>
                  <input type="text" className="input" placeholder="Username" value={form.username}
                    onChange={e => setForm(p => ({ ...p, username: e.target.value }))} autoFocus />
                </div>
                <div className="user-form-field">
                  <label>{editingUser ? 'New Password (leave blank to keep)' : 'Password *'}</label>
                  <input type="password" className="input" placeholder={editingUser ? 'Leave blank to keep current' : 'Password'}
                    value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
                </div>
                <div className="user-form-field">
                  <label>{editingUser ? 'Confirm New Password' : 'Confirm Password *'}</label>
                  <input type="password"
                    className={`input ${form.password !== form.confirm_password ? 'mismatch' : ''}`}
                    placeholder={editingUser ? 'Re-enter new password' : 'Confirm password'}
                    value={form.confirm_password}
                    onChange={e => setForm(p => ({ ...p, confirm_password: e.target.value }))} />
                  {form.password !== form.confirm_password && (
                    <span className="user-form-hint error">⚠️ Passwords do not match</span>
                  )}
                </div>
                <div className="user-form-field">
                  <label>Role</label>
                  <select className="input" value={form.role}
                    onChange={e => setForm(p => ({ ...p, role: e.target.value as 'admin' | 'staff' }))}>
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>

              {formError && <div className="user-form-error">{formError}</div>}
            </div>

            <div className="users-modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editingUser ? 'Update User' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Users
