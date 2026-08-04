import React, { useState, useEffect, useRef, useCallback } from 'react'
import './Login.css'
import { StaffUser } from '../types/electron'
import { FingerprintIcon, FingerprintScanRings } from './FingerprintArt'

interface LoginProps {
  onLogin: (user: StaffUser) => void
}

function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // P2 6.9: automatic biometric sign-in (staff/admin fingerprint) — the reader
  // listens continuously, so there is no button to click.
  const [fpSigningIn, setFpSigningIn] = useState(false)
  const [fpError, setFpError] = useState('')
  const [appName, setAppName] = useState('REPCHECK')
  const [appLogo, setAppLogo] = useState('')
  // Refs for the self-scheduling fingerprint listener (mirrors the kiosk loop)
  const fpMountedRef = useRef(true)
  const fpScanningRef = useRef(false)
  const fpLoggedInRef = useRef(false)
  const fpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadingRef = useRef(false)

  // Keep the password-login flag in a ref so the fingerprint listener can pause
  // while a manual login request is in flight (never races the scanner).
  useEffect(() => {
    loadingRef.current = loading
  }, [loading])

  // Clear any pending scan timer when the login page unmounts
  useEffect(() => {
    fpMountedRef.current = true
    return () => {
      fpMountedRef.current = false
      if (fpTimerRef.current) {
        clearTimeout(fpTimerRef.current)
        fpTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const name = await window.electronAPI.getSetting('appName')
        if (name) setAppName(name)
      } catch {}
      try {
        const logo = await window.electronAPI.getSetting('appLogo')
        if (logo) setAppLogo(logo)
      } catch {}
    }
    load()

    // Force window focus after logout (native confirm() can steal focus)
    window.focus()
  }, [])

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('Please enter username and password')
      return
    }

    setLoading(true)
    setError('')

    try {
      const result = await window.electronAPI.login(username.trim(), password)
      if (result.success && result.user) {
        onLogin(result.user)
      } else {
        setError(result.message || 'Login failed')
      }
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLogin()
    }
  }

  // Schedule the next fingerprint scan attempt (no-op after unmount)
  const scheduleFpScan = (delay: number) => {
    if (!fpMountedRef.current) return
    fpTimerRef.current = setTimeout(() => {
      runFpScan()
    }, delay)
  }

  // Continuous fingerprint listener (U.are.U 4500): every outcome re-arms the
  // next capture, so the login page is ALWAYS listening — a staff/admin just
  // places an enrolled finger on the scanner to sign in.
  const runFpScan = useCallback(async () => {
    if (!fpMountedRef.current) return
    // A capture is already in flight — it will re-arm itself when it finishes.
    if (fpScanningRef.current) return
    // While a password login is being processed, don't start a new capture.
    if (loadingRef.current) {
      scheduleFpScan(1200)
      return
    }
    fpScanningRef.current = true
    setFpSigningIn(true)
    setError('')
    setFpError('')
    try {
      const status = await window.electronAPI.getFingerprintStatus()
      if (!status.available) {
        const detail = status.steps.filter(s => !s.ok).map(s => s.message).join(' ')
        setFpError(detail || 'Fingerprint scanner is not available. Check that the U.R.U. 4500 is plugged in and the SDK is installed (see Settings → Fingerprint Scanner).')
        // Retry slowly so a scanner connected later is picked up
        scheduleFpScan(5000)
        return
      }

      const capture = await window.electronAPI.captureFingerprint(30000)
      if (!capture.ok) {
        // No finger placed yet — clear any transient message and keep listening
        setFpError('')
        scheduleFpScan(1200)
        return
      }

      const fmdRes = await window.electronAPI.createFingerprintFmd(capture.sample.imageBase64)
      if ('error' in fmdRes) {
        setFpError(fmdRes.error)
        scheduleFpScan(2500)
        return
      }

      const staffTemplates = await window.electronAPI.getAllStaffFingerprintTemplates()
      if (staffTemplates.length === 0) {
        setFpError('No staff fingerprints enrolled yet. An admin can enroll them under Users → Edit User → Fingerprint Sign-in.')
        scheduleFpScan(5000)
        return
      }

      const identify = await window.electronAPI.identifyFingerprint(fmdRes.fmdBase64, staffTemplates)
      if ('error' in identify || identify.index < 0 || identify.index >= staffTemplates.length) {
        setFpError('Fingerprint not recognized. Try again or sign in with your password.')
        scheduleFpScan(2500)
        return
      }

      const matched = staffTemplates[identify.index]
      const users = await window.electronAPI.getUsers()
      const user = users.find(u => u.id === matched.staff_id)
      if (!user) {
        setFpError('No account matches this fingerprint.')
        scheduleFpScan(2500)
        return
      }
      // Guard against a second success if the login page hasn't unmounted yet
      if (fpLoggedInRef.current) return
      fpLoggedInRef.current = true
      // Audit trail: biometric logins bypass the main-process login handler,
      // so record the authentication here (P2 6.9).
      try {
        await window.electronAPI.createActivityLog({
          action: 'staff_fingerprint_auth',
          entity_type: 'staff',
          entity_id: user.id,
          details: JSON.stringify({
            staff_name: user.display_name || user.username,
            role: user.role,
            context: 'login',
          }),
          user: `${user.display_name || user.username} (${user.role === 'admin' ? 'Admin' : 'Staff'})`,
        })
      } catch {
        // Logging must never block a successful sign-in
      }
      onLogin(user)
    } catch (err: any) {
      setFpError(err?.message || 'Fingerprint sign-in failed.')
      scheduleFpScan(2500)
    } finally {
      fpScanningRef.current = false
      setFpSigningIn(false)
    }
  }, [onLogin])

  // Start the fingerprint listener as soon as the login page mounts
  useEffect(() => {
    const t = setTimeout(() => {
      runFpScan()
    }, 500)
    return () => clearTimeout(t)
  }, [runFpScan])

  return (
    <div className="login-overlay">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo-container">
          {appLogo ? (
            <img src={appLogo} alt="Logo" className="login-logo" />
          ) : (
            <div className="login-logo-placeholder">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <rect x="4" y="4" width="40" height="40" rx="10" stroke="var(--accent)" strokeWidth="3" fill="none" />
                <path d="M16 28L20 24L16 20" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M28 28L32 24L28 20" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M22 32L26 16" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>

        <h1 className="login-title">{appName}</h1>
        <p className="login-subtitle">Sign in to your account</p>

        <div className="login-form">
          <div className="login-field">
            <label className="login-label">Username</label>
            <input
              type="text"
              className="login-input"
              placeholder="Enter username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              autoFocus
              autoComplete="username"
            />
          </div>
          <div className="login-field">
            <label className="login-label">Password</label>
            <div className="password-input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                className="login-input password-input"
                placeholder="Enter password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" fill="none" />
                <path d="M5 5L11 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M11 5L5 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              {error}
            </div>
          )}

          <button
            className="login-btn"
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <span className="login-btn-loading">
                <span className="spinner-sm" />
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>

          {/* P2 6.9: automatic staff/admin fingerprint sign-in — the reader is
              always listening, so there is no button to click. Just place an
              enrolled finger on the scanner. */}
          <div className="login-fp-divider"><span>or</span></div>
          <div className={`login-fp-card${fpSigningIn ? ' active' : ''}`}>
            <div className="login-fp-icon-wrap">
              <FingerprintIcon progress={1} className="login-fp-icon" />
              {fpSigningIn && <FingerprintScanRings />}
            </div>
            <span className="login-fp-card-title">Waiting for fingerprint…</span>
            <span className="login-fp-card-hint">
              Place an enrolled staff/admin finger on the scanner to sign in
            </span>
          </div>
          {fpError && (
            <div className="login-fp-error">
              <span>⚠️ {fpError}</span>
            </div>
          )}
        </div>

        <p className="login-footer">
          REPCHECK v1.4.0
        </p>
      </div>
    </div>
  )
}

export default Login
