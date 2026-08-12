import React, { useState, useEffect } from 'react'
import './Activation.css'

function Activation({ initialMessage = '' }: { initialMessage?: string }) {
  const [licenseKey, setLicenseKey] = useState('')
  const [status, setStatus] = useState<'idle' | 'validating' | 'success' | 'error'>(initialMessage ? 'error' : 'idle')
  const [message, setMessage] = useState(initialMessage)
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
  }, [])

  const handleActivate = async () => {
    const trimmed = licenseKey.trim()
    if (!trimmed) {
      setStatus('error')
      setMessage('Please enter a license key.')
      return
    }

    setStatus('validating')
    setMessage('')

    try {
      const result = await window.electronAPI.validateLicense(trimmed)

      if (result.valid) {
        setStatus('success')
        setMessage(result.message || 'License activated successfully!')
        // Reload the app after a brief delay to show the success message
        setTimeout(() => {
          window.location.reload()
        }, 1500)
      } else {
        setStatus('error')
        setMessage(result.message || 'Invalid license key.')
      }
    } catch (error: any) {
      setStatus('error')
      setMessage(error.message || 'Activation failed. Please try again.')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleActivate()
    }
  }

  return (
    <div className="activation-overlay">
      <div className="activation-card">
        {/* Logo */}
        <div className="activation-logo-container">
          {appLogo ? (
            <img src={appLogo} alt="Logo" className="activation-logo" />
          ) : (
            <div className="activation-logo-placeholder">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <rect x="4" y="4" width="40" height="40" rx="10" stroke="var(--accent)" strokeWidth="3" fill="none" />
                <path d="M16 28L20 24L16 20" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M28 28L32 24L28 20" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M22 32L26 16" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>

        {/* Title */}
        <h1 className="activation-title">{appName}</h1>
        <p className="activation-subtitle">Activate your license to continue</p>

        {/* Input */}
        <div className="activation-input-group">
          <input
            type="text"
            className="activation-input"
            placeholder="Enter your license key"
            value={licenseKey}
            onChange={e => {
              setLicenseKey(e.target.value)
              if (message) setMessage('')
            }}
            onKeyDown={handleKeyDown}
            disabled={status === 'validating'}
            autoFocus
          />
          <button
            className="activation-btn"
            onClick={handleActivate}
            disabled={status === 'validating'}
          >
            {status === 'validating' ? (
              <span className="activation-btn-loading">
                <span className="spinner-sm" />
                Activating...
              </span>
            ) : (
              'Activate'
            )}
          </button>
        </div>

        {/* Status message */}
        {message && (
          <div className={`activation-message activation-message--${status === 'success' ? 'success' : status === 'error' ? 'error' : ''}`}>
            {status === 'success' && (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M6 9L8 11L12 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {status === 'error' && (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M6 6L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M12 6L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
            {message}
          </div>
        )}

        {/* Info */}
        <p className="activation-info">
          Don't have a license key? Contact your administrator or
          {' '}
          <a
            href="https://github.com/jencendencia/GymApp"
            target="_blank"
            rel="noopener noreferrer"
            className="activation-link"
          >
            request one here
          </a>.
        </p>
      </div>
    </div>
  )
}

export default Activation
