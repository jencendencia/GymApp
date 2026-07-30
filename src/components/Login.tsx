import React, { useState, useEffect } from 'react'
import './Login.css'
import { StaffUser } from '../types/electron'

interface LoginProps {
  onLogin: (user: StaffUser) => void
}

function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [appName, setAppName] = useState('REPCHECK')
  const [appLogo, setAppLogo] = useState('')

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
        </div>

        <p className="login-footer">
          REPCHECK v1.4.0
        </p>
      </div>
    </div>
  )
}

export default Login
