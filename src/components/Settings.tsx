import React, { useState, useEffect } from 'react'
import './Settings.css'
import { log } from '../lib/logger'

interface SettingsState {
  appName: string
  scannerEnabled: boolean
  matchThreshold: number
  autoLockTimeout: number
  showMemberPhotos: boolean
  enableNotifications: boolean
  appLogo: string
}

type UpdateStatusState =
  | { type: 'idle' }
  | { type: 'checking'; message: string }
  | { type: 'available'; message: string; version?: string }
  | { type: 'downloading'; message: string; percent: number }
  | { type: 'downloaded'; message: string; version?: string }
  | { type: 'up-to-date'; message: string }
  | { type: 'error'; message: string }

type BannerState =
  | { type: 'none' }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string }
  | { type: 'loading'; message: string }

function Settings({ onAppNameChange, onAppLogoChange }: { onAppNameChange?: (name: string) => void; onAppLogoChange?: (logo: string) => void }) {
  const [settings, setSettings] = useState<SettingsState>({
    appName: 'REPCHECK',
    scannerEnabled: true,
    matchThreshold: 90,
    autoLockTimeout: 30,
    showMemberPhotos: true,
    enableNotifications: true,
    appLogo: '',
  })
  const [saved, setSaved] = useState(false)
  const [backupBanner, setBackupBanner] = useState<BannerState>({ type: 'none' })
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusState>({ type: 'idle' })

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const data = await window.electronAPI.getSettings()
      if (data.appName) setSettings(prev => ({ ...prev, appName: data.appName }))
      if (data.scannerEnabled) setSettings(prev => ({ ...prev, scannerEnabled: data.scannerEnabled === 'true' }))
      if (data.matchThreshold) setSettings(prev => ({ ...prev, matchThreshold: Number(data.matchThreshold) }))
      if (data.autoLockTimeout) setSettings(prev => ({ ...prev, autoLockTimeout: Number(data.autoLockTimeout) }))
      if (data.showMemberPhotos) setSettings(prev => ({ ...prev, showMemberPhotos: data.showMemberPhotos === 'true' }))
      if (data.enableNotifications) setSettings(prev => ({ ...prev, enableNotifications: data.enableNotifications === 'true' }))
      if (data.appLogo) setSettings(prev => ({ ...prev, appLogo: data.appLogo }))
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

  const handleSave = async () => {
    try {
      await window.electronAPI.saveSettings({
        appName: settings.appName,
        scannerEnabled: settings.scannerEnabled.toString(),
        matchThreshold: settings.matchThreshold.toString(),
        autoLockTimeout: settings.autoLockTimeout.toString(),
        showMemberPhotos: settings.showMemberPhotos.toString(),
        enableNotifications: settings.enableNotifications.toString(),
        appLogo: settings.appLogo,
      })
      setSaved(true)
      if (onAppNameChange) onAppNameChange(settings.appName)
      log.updateSettings({
        scannerEnabled: settings.scannerEnabled,
        matchThreshold: settings.matchThreshold,
        autoLockTimeout: settings.autoLockTimeout,
        showMemberPhotos: settings.showMemberPhotos,
        enableNotifications: settings.enableNotifications,
      })
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
  }

  // Logo upload handler
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onloadend = async () => {
      const base64 = reader.result as string
      setSettings(prev => ({ ...prev, appLogo: base64 }))
      if (onAppLogoChange) onAppLogoChange(base64)
      log.uploadLogo()
      // Auto-save the logo immediately
      try {
        await window.electronAPI.saveSetting('appLogo', base64)
      } catch (error) {
        console.error('Failed to save logo:', error)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveLogo = async () => {
    setSettings(prev => ({ ...prev, appLogo: '' }))
    if (onAppLogoChange) onAppLogoChange('')
    log.removeLogo()
    try {
      await window.electronAPI.saveSetting('appLogo', '')
    } catch (error) {
      console.error('Failed to remove logo:', error)
    }
  }

  // Backup & Restore handlers
  const handleBackup = async () => {
    setBackupBanner({ type: 'loading', message: 'Creating backup...' })
    try {
      const result = await window.electronAPI.createBackup()
      if (result.success) {
        setBackupBanner({ type: 'success', message: `Backup saved successfully!` })
        if (result.path) log.createBackup(result.path)
      } else if (result.reason === 'cancelled') {
        setBackupBanner({ type: 'none' })
      } else {
        setBackupBanner({ type: 'error', message: `Backup failed: ${result.reason}` })
      }
    } catch (error: any) {
      setBackupBanner({ type: 'error', message: `Backup failed: ${error.message}` })
    }
  }

  const handleRestore = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to restore from a backup?\n\n' +
      'This will REPLACE all current data (members, plans, check-ins, etc.) ' +
      'with the data from the backup file. This action cannot be undone.'
    )
    if (!confirmed) return

    setBackupBanner({ type: 'loading', message: 'Restoring from backup...' })
    try {
      const result = await window.electronAPI.restoreBackup()
      if (result.success) {
        setBackupBanner({ type: 'success', message: 'Backup restored successfully! Reloading data...' })
        log.restoreBackup()
        // Reload settings after restore
        await loadSettings()
      } else if (result.reason === 'cancelled') {
        setBackupBanner({ type: 'none' })
      } else {
        setBackupBanner({ type: 'error', message: `Restore failed: ${result.reason}` })
      }
    } catch (error: any) {
      setBackupBanner({ type: 'error', message: `Restore failed: ${error.message}` })
    }
  }

  // ── Auto-update ──
  useEffect(() => {
    const unsubscribe = window.electronAPI.onUpdateStatus((status) => {
      switch (status.status) {
        case 'checking':
          setUpdateStatus({ type: 'checking', message: status.message })
          break
        case 'available':
          setUpdateStatus({ type: 'available', message: status.message, version: status.version })
          break
        case 'up-to-date':
          setUpdateStatus({ type: 'up-to-date', message: status.message })
          setTimeout(() => setUpdateStatus({ type: 'idle' }), 4000)
          break
        case 'downloading':
          setUpdateStatus({ type: 'downloading', message: status.message, percent: status.percent ?? 0 })
          break
        case 'downloaded':
          setUpdateStatus({ type: 'downloaded', message: status.message, version: status.version })
          break
        case 'error':
          setUpdateStatus({ type: 'error', message: status.message })
          break
      }
    })
    return unsubscribe
  }, [])

  const handleCheckForUpdates = async () => {
    setUpdateStatus({ type: 'checking', message: 'Checking for updates...' })
    const result = await window.electronAPI.checkForUpdates()
    if (result.status === 'error') {
      setUpdateStatus({ type: 'error', message: result.message || 'Failed to check for updates' })
    }
  }

  const handleRestartApp = () => {
    window.electronAPI.restartApp()
  }

  const dismissBanner = () => setBackupBanner({ type: 'none' })

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1 className="display-text page-title">Settings</h1>
      </div>

      <div className="settings-content">
        <section className="settings-section">
          <h2 className="section-title">General</h2>
          <div className="settings-group">
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Application Name</span>
                <span className="setting-description">Display name shown in the title bar</span>
              </div>
              <input
                type="text"
                className="input setting-input"
                value={settings.appName}
                onChange={(e) => setSettings({ ...settings, appName: e.target.value })}
              />
            </div>

            <div className="setting-item logo-setting-item">
              <div className="setting-info">
                <span className="setting-label">Application Logo</span>
                <span className="setting-description">Custom logo shown next to the app name in the title bar</span>
              </div>
              <div className="logo-upload-area">
                {settings.appLogo ? (
                  <div className="logo-preview-wrapper">
                    <img src={settings.appLogo} alt="App Logo" className="logo-preview" />
                    <button
                      type="button"
                      className="btn-icon logo-remove-btn"
                      onClick={handleRemoveLogo}
                      title="Remove logo"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="logo-placeholder">
                    <span className="logo-placeholder-icon">🖼</span>
                  </div>
                )}
                <label className="btn btn-secondary btn-sm logo-upload-btn">
                  {settings.appLogo ? 'Change' : 'Upload'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif,image/ico"
                    onChange={handleLogoUpload}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="section-title">Fingerprint Scanner</h2>
          <div className="settings-group">
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Enable Scanner</span>
                <span className="setting-description">Use fingerprint scanner for check-ins</span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.scannerEnabled}
                  onChange={(e) => setSettings({ ...settings, scannerEnabled: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Match Confidence Threshold</span>
                <span className="setting-description">
                  Minimum match score required (currently: {settings.matchThreshold}%)
                </span>
              </div>
              <input
                type="range"
                className="range-input"
                min="70"
                max="100"
                value={settings.matchThreshold}
                onChange={(e) => setSettings({ ...settings, matchThreshold: Number(e.target.value) })}
              />
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="section-title">Display</h2>
          <div className="settings-group">
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Show Member Photos</span>
                <span className="setting-description">Display photos on member profiles</span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.showMemberPhotos}
                  onChange={(e) => setSettings({ ...settings, showMemberPhotos: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Enable Notifications</span>
                <span className="setting-description">Show desktop notifications for events</span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.enableNotifications}
                  onChange={(e) => setSettings({ ...settings, enableNotifications: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="section-title">Security</h2>
          <div className="settings-group">
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Auto-lock Timeout</span>
                <span className="setting-description">Minutes before the kiosk auto-locks</span>
              </div>
              <select
                className="input setting-select"
                value={settings.autoLockTimeout}
                onChange={(e) => setSettings({ ...settings, autoLockTimeout: Number(e.target.value) })}
              >
                <option value={0}>Never</option>
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
              </select>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="section-title">Backup & Restore</h2>
          <div className="settings-group">
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Create Backup</span>
                <span className="setting-description">
                  Export all data including member photos, plans, check-ins, and settings to a ZIP file
                </span>
              </div>
              <button className="btn btn-primary" onClick={handleBackup}>
                📦 Backup
              </button>
            </div>
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Restore from Backup</span>
                <span className="setting-description">
                  Replace all current data with a previously created backup ZIP file
                </span>
              </div>
              <button className="btn btn-secondary restore-btn" onClick={handleRestore}>
                🔄 Restore
              </button>
            </div>
          </div>

          {/* Banner for backup/restore status */}
          {backupBanner.type !== 'none' && (
            <div className={`banner banner-${backupBanner.type}`}>
              <span className="banner-text">
                {backupBanner.type === 'loading' && '⏳ '}
                {backupBanner.type === 'success' && '✅ '}
                {backupBanner.type === 'error' && '❌ '}
                {backupBanner.message}
              </span>
              {backupBanner.type !== 'loading' && (
                <button className="banner-dismiss" onClick={dismissBanner}>✕</button>
              )}
            </div>
          )}
        </section>

        <section className="settings-section">
          <h2 className="section-title">Updates</h2>
          <div className="settings-group">
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Check for Updates</span>
                <span className="setting-description">
                  Check if a new version of REPCHECK is available for download
                </span>
              </div>
              {updateStatus.type === 'idle' && (
                <button className="btn btn-primary" onClick={handleCheckForUpdates}>
                  🔍 Check for Updates
                </button>
              )}
              {updateStatus.type === 'checking' && (
                <div className="update-status checking">
                  <div className="update-spinner" />
                  <span>{updateStatus.message}</span>
                </div>
              )}
              {updateStatus.type === 'available' && (
                <div className="update-status available">
                  <span className="update-icon">📥</span>
                  <span>{updateStatus.message}</span>
                </div>
              )}
              {updateStatus.type === 'downloading' && (
                <div className="update-status downloading">
                  <div className="update-progress-bar">
                    <div className="update-progress-fill" style={{ width: `${updateStatus.percent}%` }} />
                  </div>
                  <span>{updateStatus.message}</span>
                </div>
              )}
              {updateStatus.type === 'downloaded' && (
                <div className="update-status downloaded">
                  <span className="update-icon">✅</span>
                  <span>Update ready! v{updateStatus.version}</span>
                  <button className="btn btn-primary btn-sm" onClick={handleRestartApp}>
                    🔄 Restart Now
                  </button>
                </div>
              )}
              {updateStatus.type === 'up-to-date' && (
                <div className="update-status up-to-date">
                  <span className="update-icon">✅</span>
                  <span>{updateStatus.message}</span>
                </div>
              )}
              {updateStatus.type === 'error' && (
                <div className="update-status error">
                  <span className="update-icon">⚠️</span>
                  <span>{updateStatus.message}</span>
                  <button className="btn btn-secondary btn-sm" onClick={handleCheckForUpdates}>
                    Retry
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="settings-actions">
          {saved && <span className="save-success">✓ Settings saved!</span>}
          <button className="btn btn-primary" onClick={handleSave}>
            Save Settings
          </button>
        </div>
      </div>
    </div>
  )
}

export default Settings
