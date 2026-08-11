import React, { useState, useEffect } from 'react'
import './Settings.css'
import { StaffUser, FingerprintStatus, SmsStatus, SmsLog } from '../types/electron'
import { log } from '../lib/logger'
import ConfirmModal from './ConfirmModal'
import { useSettings } from '../lib/settingsContext'
import { notifyDataChanged } from '../lib/data'
import { WaiverTemplate } from '../types/electron'

interface SettingsState {
  appName: string
  scannerEnabled: boolean
  autoLockTimeout: number
  showMemberPhotos: boolean
  enableNotifications: boolean
  allowMultipleDailyCheckins: boolean
  backupEnabled: boolean
  backupHour: number
  backupKeep: number
  backupEncryptionEnabled: boolean
  backupPassword: string
  balanceBlockThreshold: number
  currency: string
  appLogo: string
  kioskLogo: string
  smtpHost: string
  smtpPort: string
  smtpUser: string
  smtpPass: string
  smtpFromEmail: string
  reportOwnerEmail: string
  autoReportEnabled: boolean
  autoReportHour: number
  autoRemindersEnabled: boolean
  reminderHour: number
  welcomeEmailEnabled: boolean
  receiptEmailEnabled: boolean
  theme: 'dark' | 'light'
  // Cloud SMS (PhilSMS)
  smsChannel: string
  cloudProvider: string
  cloudApiKey: string
  cloudSender: string
  renewalSmsTemplate: string
  receiptSmsTemplate: string
}

type UpdateStatusState =
  | { type: 'idle' }
  | { type: 'checking'; message: string }
  | { type: 'available'; message: string; version?: string }
  | { type: 'downloading'; message: string; percent: number }
  | { type: 'downloaded'; message: string; version?: string }
  | { type: 'backing-up'; message: string }
  | { type: 'up-to-date'; message: string }
  | { type: 'error'; message: string }

type BannerState =
  | { type: 'none' }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string }
  | { type: 'loading'; message: string }

// Default renewal-reminder SMS (sent from Reports → Send Reminders to members
// expiring within 3 days). Keep ASCII — Unicode messages cost 2 credits.
const DEFAULT_SMS_RENEWAL_TEMPLATE = 'Hi {{name}}, your {{plan}} membership at {{gym}} expires on {{date}} ({{days}} days left). Renew to keep your workouts going!'
// Default payment-receipt SMS (sent automatically after every payment — new
// plan, renewal, top-up, auto-renewal). Keep ASCII — Unicode costs 2 credits.
const DEFAULT_SMS_RECEIPT_TEMPLATE = 'Hi {{name}}, payment received: {{amount}} ({{method}}). Thank you! - {{gym}}'

const DEFAULT_WAIVER_TEMPLATE: WaiverTemplate = {
  id: 1,
  title: 'Membership Waiver & Release',
  content: 'I, the undersigned, acknowledge that I am voluntarily participating in the programs and activities offered by this fitness facility. I understand that there are inherent risks involved in physical exercise and the use of fitness equipment and facilities.\n\nI acknowledge that I have been informed of the potential risks associated with my participation, including but not limited to: muscle strains, sprains, fractures, cardiovascular complications, and other physical injuries. I voluntarily assume all risks associated with my participation.\n\nI represent that I am in good physical health and have no medical condition that would prevent safe participation in exercise programs. I understand that it is my responsibility to consult with a physician prior to beginning any exercise program.\n\nI hereby release, waive, and discharge this facility, its owners, employees, and agents from any and all liability, claims, demands, actions, or causes of action arising out of or related to any loss, damage, or injury, including death, that may be sustained by me while participating in any activities at this facility.\n\nI agree to use all equipment and facilities in a safe and responsible manner. I understand that I must follow all posted rules and staff instructions. I will report any damaged or unsafe equipment to staff immediately.\n\nI grant permission to the facility to use photographs, video, or other media of me for promotional and marketing purposes, unless I notify the facility in writing of my objection.\n\nBy clicking "I Agree", I confirm that I have read, understood, and voluntarily agree to the terms and conditions of this waiver and release of liability.',
  is_default: true,
}

function Settings({ currentUser, onAppNameChange, onAppLogoChange }: { currentUser?: StaffUser | null; onAppNameChange?: (name: string) => void; onAppLogoChange?: (logo: string) => void }) {
  const isAdmin = currentUser?.role === 'admin'
  // P2 6.9: broadcast settings changes (e.g. showMemberPhotos) to every component
  const { refreshSettings } = useSettings()
  const [settings, setSettings] = useState<SettingsState>({
    appName: 'REPCHECK',
    scannerEnabled: true,
    autoLockTimeout: 30,
    showMemberPhotos: true,
    enableNotifications: true,
    allowMultipleDailyCheckins: false,
    backupEnabled: false,
    backupHour: 23,
    backupKeep: 7,
    backupEncryptionEnabled: false,
    backupPassword: '',
    balanceBlockThreshold: 0,
    currency: '₱',
    appLogo: '',
    kioskLogo: '',
    smtpHost: '',
    smtpPort: '587',
    smtpUser: '',
    smtpPass: '',
    smtpFromEmail: '',
    reportOwnerEmail: '',
    autoReportEnabled: false,
    autoReportHour: 23,
    autoRemindersEnabled: false,
    reminderHour: 9,
    welcomeEmailEnabled: false,
    receiptEmailEnabled: false,
    theme: 'dark',
    smsChannel: 'off',
    cloudProvider: 'philsms',
    cloudApiKey: '',
    cloudSender: '',
    renewalSmsTemplate: DEFAULT_SMS_RENEWAL_TEMPLATE,
    receiptSmsTemplate: DEFAULT_SMS_RECEIPT_TEMPLATE,
  })
  const [saved, setSaved] = useState(false)
  const [scannerChecking, setScannerChecking] = useState(false)
  const [scannerStatus, setScannerStatus] = useState<FingerprintStatus | null>(null)
  const [smtpProvider, setSmtpProvider] = useState('')
  const [smtpTestResult, setSmtpTestResult] = useState<BannerState>({ type: 'none' })
  const [smtpPassWarning, setSmtpPassWarning] = useState('')
  const [backupBanner, setBackupBanner] = useState<BannerState>({ type: 'none' })
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusState>({ type: 'idle' })
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
  const [waiverTemplates, setWaiverTemplates] = useState<WaiverTemplate[]>([DEFAULT_WAIVER_TEMPLATE])
  const [waiverForm, setWaiverForm] = useState<{ id: number | null; title: string; content: string }>({ id: null, title: '', content: '' })
  // Cloud SMS (PhilSMS) state
  const [smsStatus, setSmsStatus] = useState<SmsStatus | null>(null)
  const [smsBanner, setSmsBanner] = useState<BannerState>({ type: 'none' })
  const [smsTestPhone, setSmsTestPhone] = useState('')
  const [smsLogs, setSmsLogs] = useState<SmsLog[]>([])

  const loadSmsLogs = async () => {
    try {
      const rows = await window.electronAPI.getSmsLogs(10)
      setSmsLogs(rows)
    } catch {
      /* ignore */
    }
  }

  // Live PhilSMS gateway status (broadcast from the main process on boot +
  // every 60s, and after every Verify Connection click). Reload the outbox too,
  // since the queue worker broadcasts after each delivery tick.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onSmsStatus((status) => {
      setSmsStatus(status)
      loadSmsLogs()
    })
    window.electronAPI.getSmsStatus().then(setSmsStatus).catch(() => {})
    loadSmsLogs()
    return unsubscribe
  }, [])

  useEffect(() => {
    loadSettings()
  }, [])

  // P2 5.7: apply the theme immediately when the toggle changes (persisted on Save)
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  const loadSettings = async () => {
    try {
      const data = await window.electronAPI.getSettings()
      if (data.appName) setSettings(prev => ({ ...prev, appName: data.appName }))
      if (data.scannerEnabled) setSettings(prev => ({ ...prev, scannerEnabled: data.scannerEnabled === 'true' }))
      if (data.autoLockTimeout) setSettings(prev => ({ ...prev, autoLockTimeout: Number(data.autoLockTimeout) }))
      if (data.showMemberPhotos) setSettings(prev => ({ ...prev, showMemberPhotos: data.showMemberPhotos === 'true' }))
      if (data.enableNotifications) setSettings(prev => ({ ...prev, enableNotifications: data.enableNotifications === 'true' }))
      if (data.allowMultipleDailyCheckins) setSettings(prev => ({ ...prev, allowMultipleDailyCheckins: data.allowMultipleDailyCheckins === 'true' }))
      if (data.backupEnabled) setSettings(prev => ({ ...prev, backupEnabled: data.backupEnabled === 'true' }))
      if (data.backupHour) setSettings(prev => ({ ...prev, backupHour: Number(data.backupHour) }))
      if (data.backupKeep) setSettings(prev => ({ ...prev, backupKeep: Number(data.backupKeep) }))
      if (data.backupEncryptionEnabled) setSettings(prev => ({ ...prev, backupEncryptionEnabled: data.backupEncryptionEnabled === 'true' }))
      if (data.backupPassword) setSettings(prev => ({ ...prev, backupPassword: data.backupPassword }))
      if (data.balanceBlockThreshold) setSettings(prev => ({ ...prev, balanceBlockThreshold: Number(data.balanceBlockThreshold) }))
      if (data.currency) setSettings(prev => ({ ...prev, currency: data.currency }))
      if (data.appLogo) setSettings(prev => ({ ...prev, appLogo: data.appLogo }))
      if (data.kioskLogo) setSettings(prev => ({ ...prev, kioskLogo: data.kioskLogo }))
      if (data.smtpHost) {
        setSettings(prev => ({ ...prev, smtpHost: data.smtpHost }))
        // Auto-detect the provider from saved host
        if (data.smtpHost === 'smtp.gmail.com') setSmtpProvider('smtp.gmail.com')
        else if (data.smtpHost === 'smtp.office365.com') setSmtpProvider('smtp.office365.com')
        else if (data.smtpHost === 'smtp.mail.yahoo.com') setSmtpProvider('smtp.mail.yahoo.com')
        else setSmtpProvider('')
      }

      // Warn when a stored SMTP password exists but can't be decrypted on this
      // machine (e.g. restored from a backup made elsewhere) — this is what
      // causes the confusing "Missing credentials for PLAIN" error on send.
      if (data.smtpHost || data.smtpUser) {
        try {
          const status = await window.electronAPI.getSecretStatus('smtpPass')
          if (status.stored && !status.decrypted) {
            setSmtpPassWarning('The saved SMTP password could not be decrypted on this machine. Re-enter your password below and Save.')
          } else {
            setSmtpPassWarning('')
          }
        } catch {
          /* ignore */
        }
      }
      if (data.smtpPort) setSettings(prev => ({ ...prev, smtpPort: data.smtpPort }))
      if (data.smtpUser) setSettings(prev => ({ ...prev, smtpUser: data.smtpUser }))
      if (data.smtpPass) setSettings(prev => ({ ...prev, smtpPass: data.smtpPass }))
      if (data.smtpFromEmail) setSettings(prev => ({ ...prev, smtpFromEmail: data.smtpFromEmail }))
      if (data.reportOwnerEmail) setSettings(prev => ({ ...prev, reportOwnerEmail: data.reportOwnerEmail }))
      if (data.autoReportEnabled) setSettings(prev => ({ ...prev, autoReportEnabled: data.autoReportEnabled === 'true' }))
      if (data.autoReportHour) setSettings(prev => ({ ...prev, autoReportHour: Number(data.autoReportHour) }))
      if (data.autoRemindersEnabled) setSettings(prev => ({ ...prev, autoRemindersEnabled: data.autoRemindersEnabled === 'true' }))
      if (data.reminderHour) setSettings(prev => ({ ...prev, reminderHour: Number(data.reminderHour) }))
      if (data.welcomeEmailEnabled) setSettings(prev => ({ ...prev, welcomeEmailEnabled: data.welcomeEmailEnabled === 'true' }))
      if (data.receiptEmailEnabled) setSettings(prev => ({ ...prev, receiptEmailEnabled: data.receiptEmailEnabled === 'true' }))
      if (data.theme) setSettings(prev => ({ ...prev, theme: data.theme === 'light' ? 'light' : 'dark' }))
      // Cloud SMS (PhilSMS)
      if (data.smsChannel) setSettings(prev => ({ ...prev, smsChannel: data.smsChannel }))
      if (data.cloudProvider) setSettings(prev => ({ ...prev, cloudProvider: data.cloudProvider }))
      if (data.cloudApiKey) setSettings(prev => ({ ...prev, cloudApiKey: data.cloudApiKey }))
      if (data.cloudSender) setSettings(prev => ({ ...prev, cloudSender: data.cloudSender }))
      if (data.renewalSmsTemplate) setSettings(prev => ({ ...prev, renewalSmsTemplate: data.renewalSmsTemplate }))
      if (data.receiptSmsTemplate) setSettings(prev => ({ ...prev, receiptSmsTemplate: data.receiptSmsTemplate }))
      if (data.waiverTemplates) {
        try {
          const parsed = JSON.parse(data.waiverTemplates) as WaiverTemplate[]
          if (Array.isArray(parsed) && parsed.length > 0) {
            const normalized = parsed.map((template, index) => ({
              ...template,
              is_default: Boolean(template.is_default) || (index === 0 && !parsed.some(t => t.is_default)),
            }))
            setWaiverTemplates(normalized)
          }
        } catch {
          setWaiverTemplates([DEFAULT_WAIVER_TEMPLATE])
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

  // Live scanner status from the native U.are.U SDK (worker thread)
  const handleCheckScanner = async () => {
    setScannerChecking(true)
    try {
      const status = await window.electronAPI.getFingerprintStatus()
      setScannerStatus(status)
    } catch (error: any) {
      setScannerStatus({
        available: false,
        readerName: '',
        steps: [{ name: 'Scanner', ok: false, message: error?.message || 'Failed to query the fingerprint scanner.' }],
      })
    } finally {
      setScannerChecking(false)
    }
  }

  const handleSave = async () => {
    try {
      await window.electronAPI.saveSettings({
        appName: settings.appName,
        scannerEnabled: settings.scannerEnabled.toString(),
        autoLockTimeout: settings.autoLockTimeout.toString(),
        showMemberPhotos: settings.showMemberPhotos.toString(),
        enableNotifications: settings.enableNotifications.toString(),
        allowMultipleDailyCheckins: settings.allowMultipleDailyCheckins.toString(),
        backupEnabled: settings.backupEnabled.toString(),
        backupHour: settings.backupHour.toString(),
        backupKeep: settings.backupKeep.toString(),
        backupEncryptionEnabled: settings.backupEncryptionEnabled.toString(),
        backupPassword: settings.backupPassword,
        balanceBlockThreshold: settings.balanceBlockThreshold.toString(),
        currency: settings.currency,
        appLogo: settings.appLogo,
        kioskLogo: settings.kioskLogo,
        smtpHost: settings.smtpHost,
        smtpPort: settings.smtpPort,
        smtpUser: settings.smtpUser,
        smtpPass: settings.smtpPass,
        smtpFromEmail: settings.smtpFromEmail,
        reportOwnerEmail: settings.reportOwnerEmail,
        autoReportEnabled: settings.autoReportEnabled.toString(),
        autoReportHour: settings.autoReportHour.toString(),
        autoRemindersEnabled: settings.autoRemindersEnabled.toString(),
        reminderHour: settings.reminderHour.toString(),
        welcomeEmailEnabled: settings.welcomeEmailEnabled.toString(),
        receiptEmailEnabled: settings.receiptEmailEnabled.toString(),
        theme: settings.theme,
        waiverTemplates: JSON.stringify(waiverTemplates),
        smsChannel: settings.smsChannel,
        cloudProvider: settings.cloudProvider,
        cloudApiKey: settings.cloudApiKey,
        cloudSender: settings.cloudSender,
        renewalSmsTemplate: settings.renewalSmsTemplate || DEFAULT_SMS_RENEWAL_TEMPLATE,
        receiptSmsTemplate: settings.receiptSmsTemplate || DEFAULT_SMS_RECEIPT_TEMPLATE,
      })
      setSaved(true)
      // If a valid password was just saved, clear the undecryptable warning
      if (settings.smtpPass) setSmtpPassWarning('')
      notifyDataChanged()
      // Broadcast the new settings (showMemberPhotos, etc.) to the whole app
      await refreshSettings()
      if (onAppNameChange) onAppNameChange(settings.appName)
      log.updateSettings({
        scannerEnabled: settings.scannerEnabled,
        autoLockTimeout: settings.autoLockTimeout,
        showMemberPhotos: settings.showMemberPhotos,
        enableNotifications: settings.enableNotifications,
        allowMultipleDailyCheckins: settings.allowMultipleDailyCheckins,
        backupEnabled: settings.backupEnabled,
        backupHour: settings.backupHour,
        backupKeep: settings.backupKeep,
        backupEncryptionEnabled: settings.backupEncryptionEnabled,
        balanceBlockThreshold: settings.balanceBlockThreshold,
        currency: settings.currency,
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

  // ── Kiosk Logo handlers ──
  const handleKioskLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onloadend = async () => {
      const base64 = reader.result as string
      setSettings(prev => ({ ...prev, kioskLogo: base64 }))
      try {
        await window.electronAPI.saveSetting('kioskLogo', base64)
      } catch (error) {
        console.error('Failed to save kiosk logo:', error)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveKioskLogo = async () => {
    setSettings(prev => ({ ...prev, kioskLogo: '' }))
    try {
      await window.electronAPI.saveSetting('kioskLogo', '')
    } catch (error) {
      console.error('Failed to remove kiosk logo:', error)
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
    setShowRestoreConfirm(false)
    setBackupBanner({ type: 'loading', message: 'Restoring from backup...' })
    try {
      // Encrypted backups need the passphrase (P1 3.6) — prompt until correct or cancelled
      let result = await window.electronAPI.restoreBackup()
      while (result.reason === 'needs_password' || result.reason === 'wrong_password') {
        const pw = window.prompt(
          result.reason === 'wrong_password'
            ? 'Incorrect password. Enter the backup password to decrypt this backup:'
            : 'This backup is encrypted. Enter the backup password to decrypt it:'
        )
        if (pw === null) {
          setBackupBanner({ type: 'error', message: 'Restore cancelled — password required to decrypt this backup.' })
          return
        }
        result = await window.electronAPI.restoreBackup(pw)
      }
      if (result.success) {
        setBackupBanner({ type: 'success', message: 'Backup restored successfully! Reloading data...' })
        log.restoreBackup()
        // Reload settings after restore
        await loadSettings()
        // Bump the local data bus so every page in THIS window (Members,
        // Dashboard, Checkins, etc.) re-fetches the restored data. The main
        // process already broadcasts to the OTHER windows via broadcastDataChanged(),
        // but it excludes the sender (this Settings window), so we refresh here.
        notifyDataChanged()
      } else if (result.reason === 'cancelled') {
        setBackupBanner({ type: 'none' })
      } else {
        setBackupBanner({ type: 'error', message: `Restore failed: ${result.reason || result.message}` })
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

  // Restart Now — requires a backup to be created before the update is applied
  const handleRestartApp = async () => {
    setUpdateStatus({ type: 'backing-up', message: 'Creating a safety backup before updating...' })
    try {
      const result = await window.electronAPI.restartAppWithBackup()
      if (!result.success) {
        setUpdateStatus({ type: 'error', message: result.message || 'Backup failed — update aborted.' })
      }
      // On success the app quits and installs; nothing else to do here.
    } catch (error: any) {
      setUpdateStatus({ type: 'error', message: `Backup failed: ${error.message}` })
    }
  }

  const dismissBanner = () => setBackupBanner({ type: 'none' })

  // ── Cloud SMS (PhilSMS) handlers ──
  const handleVerifySms = async () => {
    setSmsBanner({ type: 'loading', message: 'Verifying PhilSMS connection...' })
    try {
      const status = await window.electronAPI.verifySms()
      setSmsStatus(status)
      setSmsBanner(status.verified
        ? { type: 'success', message: status.message }
        : { type: 'error', message: status.message })
    } catch (error: any) {
      setSmsBanner({ type: 'error', message: error.message })
    }
    setTimeout(() => setSmsBanner(b => b.type !== 'loading' ? { type: 'none' } : b), 8000)
  }

  const handleSendTestSms = async () => {
    if (!smsTestPhone.trim()) return
    setSmsBanner({ type: 'loading', message: 'Sending test SMS...' })
    try {
      const result = await window.electronAPI.sendTestSms(smsTestPhone.trim())
      setSmsBanner(result.success
        ? { type: 'success', message: result.message }
        : { type: 'error', message: result.message })
      loadSmsLogs()
    } catch (error: any) {
      setSmsBanner({ type: 'error', message: error.message })
    }
    setTimeout(() => setSmsBanner(b => b.type !== 'loading' ? { type: 'none' } : b), 8000)
  }

  const handleRetrySms = async (id: number) => {
    try {
      await window.electronAPI.retrySms(id)
      setSmsBanner({ type: 'success', message: 'Message re-queued for delivery.' })
      loadSmsLogs()
    } catch (error: any) {
      setSmsBanner({ type: 'error', message: error.message })
    }
    setTimeout(() => setSmsBanner(b => b.type !== 'loading' ? { type: 'none' } : b), 4000)
  }

  const resetWaiverForm = () => setWaiverForm({ id: null, title: '', content: '' })

  const startEditWaiver = (template: WaiverTemplate) => {
    setWaiverForm({ id: template.id, title: template.title, content: template.content })
  }

  const normalizeDefaultWaiver = (templates: WaiverTemplate[]) => {
    const hasDefault = templates.some(template => template.is_default)
    if (!hasDefault && templates.length > 0) {
      return templates.map((template, index) => ({ ...template, is_default: index === 0 }))
    }
    return templates.map(template => ({ ...template, is_default: Boolean(template.is_default) }))
  }

  const handleWaiverTemplateSave = () => {
    const title = waiverForm.title.trim()
    const content = waiverForm.content.trim()
    if (!title || !content) return

    setWaiverTemplates(prev => {
      const next = waiverForm.id
        ? prev.map(t => t.id === waiverForm.id ? { ...t, title, content, updated_at: new Date().toISOString() } : t)
        : [
          ...prev,
          {
            id: Date.now(),
            title,
            content,
            updated_at: new Date().toISOString(),
            is_default: prev.length === 0,
          },
        ]
      return normalizeDefaultWaiver(next)
    })
    resetWaiverForm()
  }

  const handleWaiverTemplateDelete = (id: number) => {
    setWaiverTemplates(prev => {
      const next = prev.filter(t => t.id !== id)
      const normalized = normalizeDefaultWaiver(next)
      return normalized
    })
    if (waiverForm.id === id) resetWaiverForm()
  }

  const handleSetDefaultWaiver = (id: number) => {
    setWaiverTemplates(prev => normalizeDefaultWaiver(prev.map(template => ({
      ...template,
      is_default: template.id === id,
    }))))
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1 className="display-text page-title">Settings</h1>
      </div>        {/* Read-only banner for staff */}
        {!isAdmin && (
          <div className="settings-readonly-banner">
            <span>👁️ Viewing settings in read-only mode</span>
            <span className="settings-readonly-hint">Only administrators can modify settings.</span>
          </div>
        )}

        <fieldset disabled={!isAdmin} className="settings-fieldset">
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

            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Currency</span>
                <span className="setting-description">Symbol used across the app for prices and balances (P2 5.7)</span>
              </div>
              <select
                className="input setting-select"
                value={settings.currency}
                onChange={(e) => setSettings({ ...settings, currency: e.target.value })}
                style={{ width: 160 }}
              >
                <option value="₱">₱ — Philippine Peso</option>
                <option value="$">$ — US Dollar</option>
                <option value="€">€ — Euro</option>
                <option value="£">£ — Pound Sterling</option>
                <option value="¥">¥ — Yen / Yuan</option>
              </select>
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

            <div className="setting-item logo-setting-item">
              <div className="setting-info">
                <span className="setting-label">Kiosk Logo</span>
                <span className="setting-description">Large logo displayed on the kiosk check-in screen</span>
              </div>
              <div className="logo-upload-area">
                {settings.kioskLogo ? (
                  <div className="kiosk-logo-preview-wrapper">
                    <img src={settings.kioskLogo} alt="Kiosk Logo" className="kiosk-logo-preview" />
                    <button
                      type="button"
                      className="btn-icon logo-remove-btn"
                      onClick={handleRemoveKioskLogo}
                      title="Remove kiosk logo"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="kiosk-logo-placeholder">
                    <span className="logo-placeholder-icon">🏢</span>
                  </div>
                )}
                <label className="btn btn-secondary btn-sm logo-upload-btn">
                  {settings.kioskLogo ? 'Change' : 'Upload'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                    onChange={handleKioskLogoUpload}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="section-title">Membership Waiver</h2>
          <div className="settings-group">
            <div className="setting-item" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 12 }}>
              <div className="setting-info">
                <span className="setting-label">Waiver Templates</span>
                <span className="setting-description">Create, edit, and delete the waiver wording shown during member enrollment and renewal.</span>
              </div>
              <div className="waiver-template-list" style={{ width: '100%' }}>
                {waiverTemplates.map((template) => (
                  <div key={template.id} className="waiver-template-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                    <div>
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{template.title}</span>
                        {template.is_default && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            borderRadius: 999,
                            padding: '2px 8px',
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: 0.4,
                            color: 'var(--primary-contrast, #fff)',
                            background: 'var(--primary, #4f46e5)',
                          }}>
                            Default
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{template.updated_at ? new Date(template.updated_at).toLocaleString() : 'No edit timestamp'}</div>
                    </div>
                    <div className="waiver-template-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {!template.is_default && (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleSetDefaultWaiver(template.id)}>Set as Default</button>
                      )}
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEditWaiver(template)}>Edit</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleWaiverTemplateDelete(template.id)} style={{ color: 'var(--danger)' }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="waiver-template-editor" style={{ width: '100%', display: 'grid', gap: 10 }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Waiver title"
                  value={waiverForm.title}
                  onChange={(e) => setWaiverForm(prev => ({ ...prev, title: e.target.value }))}
                />
                <textarea
                  className="input"
                  rows={10}
                  placeholder="Waiver content"
                  value={waiverForm.content}
                  onChange={(e) => setWaiverForm(prev => ({ ...prev, content: e.target.value }))}
                />
                <div className="waiver-template-editor-actions" style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleWaiverTemplateSave}>{waiverForm.id ? 'Save Changes' : 'Add Waiver'}</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={resetWaiverForm}>Clear</button>
                </div>
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

          </div>

          {/* U.R.U. 4500 setup info + live scanner status */}
          <div style={{ marginTop: 12, padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--accent)' }}>🖐️ Digital Persona U.R.U. 4500</strong>
            <p style={{ margin: '6px 0 0' }}>
              The app captures fingerprints <strong>directly from the U.R.U. 4500 reader</strong> using the
              DigitalPersona U.are.U SDK — no Windows Hello, no passkeys, and no limit on how many members can enroll.
            </p>
            <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              <li>Plug in the U.R.U. 4500 via USB</li>
              <li>Install the DigitalPersona U.are.U SDK (the reader's <strong>dpfpdd.dll / dpfj.dll</strong>) — the
                one-time setup registers the SDK on this PC; see the HID Global download page</li>
              <li>If the DLLs aren't in the system path, drop them in a <strong>"bin" folder</strong> next to the app</li>
              <li>Back in the app, click <strong>Check Scanner</strong> below — it should report the reader as detected</li>
              <li>Enroll members under <strong>Members → Add Member → Fingerprint Registration</strong>, and the
                <strong>Kiosk</strong> will match them by fingerprint automatically</li>
            </ol>
            <p style={{ margin: '8px 0 0' }}>
              ℹ️ <strong>Note:</strong> the U.are.U driver replaces the Windows Hello (WBF) driver on the reader —
              fingerprints enrolled through Windows Hello won't carry over; re-enroll members once after installing.
            </p>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleCheckScanner}
                disabled={scannerChecking}
              >
                {scannerChecking ? '⏳ Checking...' : '🔍 Check Scanner'}
              </button>
              {scannerStatus && (
                <span style={{ fontSize: 12, fontWeight: 600, color: scannerStatus.available ? 'var(--accent)' : 'var(--warn)' }}>
                  {scannerStatus.available
                    ? `✅ ${scannerStatus.readerName || 'Fingerprint reader'} detected`
                    : '⚠️ Scanner not ready'}
                </span>
              )}
            </div>
            {scannerStatus && !scannerStatus.available && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-muted)' }}>
                {scannerStatus.steps.filter(s => !s.ok).map((s, i) => (
                  <li key={i}>
                    <strong>{s.name}:</strong> {s.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="settings-section">
          <h2 className="section-title">Display</h2>
          <div className="settings-group">
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Theme</span>
                <span className="setting-description">Switch between dark and light appearance (P2 5.7)</span>
              </div>
              <div className="theme-toggle-row">
                <button
                  className={`btn btn-sm ${settings.theme === 'dark' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setSettings({ ...settings, theme: 'dark' })}
                >
                  🌙 Dark
                </button>
                <button
                  className={`btn btn-sm ${settings.theme === 'light' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setSettings({ ...settings, theme: 'light' })}
                >
                  ☀️ Light
                </button>
              </div>
            </div>

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
          <h2 className="section-title">Check-ins</h2>
          <div className="settings-group">
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Allow Multiple Daily Check-ins</span>
                <span className="setting-description">
                  When OFF, a member is blocked from checking in again while they are still checked in (until they check out).
                  When ON, members can check in multiple times per day.
                </span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.allowMultipleDailyCheckins}
                  onChange={(e) => setSettings({ ...settings, allowMultipleDailyCheckins: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Block Check-in Over Due Balance</span>
                <span className="setting-description">
                  Members with an outstanding balance above this amount ({settings.currency || '₱'}) are blocked at the kiosk until they settle.
                  Set to 0 to disable.
                </span>
              </div>
              <input
                type="number"
                className="input setting-input"
                value={settings.balanceBlockThreshold || ''}
                onChange={(e) => setSettings({ ...settings, balanceBlockThreshold: Number(e.target.value) })}
                placeholder="0 = disabled"
                style={{ width: 120 }}
                min="0"
                step="50"
              />
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
          <h2 className="section-title">Email (SMTP)</h2>
          <div className="settings-group">
            <div className="setting-item" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20 }}>
              <div className="setting-info">
                <span className="setting-label">Email Provider</span>
                <span className="setting-description">Select your provider to auto-fill SMTP settings</span>
              </div>
              <select
                className="input setting-select"
                value={smtpProvider}
                onChange={(e) => {
                  const provider = e.target.value
                  setSmtpProvider(provider)
                  if (provider === 'smtp.gmail.com') {
                    setSettings({ ...settings, smtpHost: 'smtp.gmail.com', smtpPort: '587' })
                  } else if (provider === 'smtp.office365.com') {
                    setSettings({ ...settings, smtpHost: 'smtp.office365.com', smtpPort: '587' })
                  } else if (provider === 'smtp.mail.yahoo.com') {
                    setSettings({ ...settings, smtpHost: 'smtp.mail.yahoo.com', smtpPort: '465' })
                  }
                  // Custom/Other selected = do nothing, user fills manually
                }}
              >
                <option value="">— Custom / Other —</option>
                <option value="smtp.gmail.com">📧 Gmail</option>
                <option value="smtp.office365.com">📧 Outlook / Hotmail</option>
                <option value="smtp.mail.yahoo.com">📧 Yahoo Mail</option>
              </select>
            </div>
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">SMTP Host</span>
                <span className="setting-description">SMTP server address</span>
              </div>
              <input
                type="text"
                className="input setting-input"
                value={settings.smtpHost}
                onChange={(e) => setSettings({ ...settings, smtpHost: e.target.value })}
                placeholder="smtp.example.com"
              />
            </div>
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">SMTP Port</span>
                <span className="setting-description">587 (TLS) or 465 (SSL)</span>
              </div>
              <input
                type="number"
                className="input setting-input"
                value={settings.smtpPort}
                onChange={(e) => setSettings({ ...settings, smtpPort: e.target.value })}
                style={{ width: 100 }}
              />
            </div>
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Username</span>
                <span className="setting-description">Your full email address</span>
              </div>
              <input
                type="text"
                className="input setting-input"
                value={settings.smtpUser}
                onChange={(e) => setSettings({ ...settings, smtpUser: e.target.value })}
                placeholder="you@gmail.com"
              />
            </div>
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Password</span>
                <span className="setting-description">
                  {settings.smtpHost === 'smtp.gmail.com'
                    ? 'Use an App Password (not your regular password). Get one at myaccount.google.com/apppasswords'
                    : settings.smtpHost === 'smtp.office365.com'
                    ? 'Your Outlook password or an app password if 2FA is enabled'
                    : settings.smtpHost === 'smtp.mail.yahoo.com'
                    ? 'Use an App Password. Generate one at your Yahoo account security settings'
                    : 'SMTP password or API key'}
                  {' '}· 🔒 Stored encrypted (Windows security)
                </span>
              </div>
              <input
                type="password"
                className="input setting-input"
                value={settings.smtpPass}
                onChange={(e) => setSettings({ ...settings, smtpPass: e.target.value })}
                placeholder="••••••••"
              />
            </div>
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">From Email</span>
                <span className="setting-description">Sender address shown to recipients (usually your email)</span>
              </div>
              <input
                type="email"
                className="input setting-input"
                value={settings.smtpFromEmail}
                onChange={(e) => setSettings({ ...settings, smtpFromEmail: e.target.value })}
                placeholder="you@gmail.com"
              />
            </div>
            <div className="setting-item" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20 }}>
              <div className="setting-info">
                <span className="setting-label">Default Owner Email</span>
                <span className="setting-description">Recipient used for the automatic end-of-day report and pre-filled when emailing reports · 🔒 Stored encrypted (Windows security)</span>
              </div>
              <input
                type="email"
                className="input setting-input"
                value={settings.reportOwnerEmail}
                onChange={(e) => setSettings({ ...settings, reportOwnerEmail: e.target.value })}
                placeholder="owner@example.com"
              />
            </div>
            <div className="setting-item" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20 }}>
              <div className="setting-info">
                <span className="setting-label">Auto-send Daily Report</span>
                <span className="setting-description">Email the daily sales report to the owner at the end of each day (requires SMTP + owner email)</span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.autoReportEnabled}
                  onChange={(e) => setSettings({ ...settings, autoReportEnabled: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="setting-item" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20 }}>
              <div className="setting-info">
                <span className="setting-label">Welcome Email</span>
                <span className="setting-description">Send a welcome email to new members on enrollment (requires SMTP, member email) (P2 5.5)</span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.welcomeEmailEnabled}
                  onChange={(e) => setSettings({ ...settings, welcomeEmailEnabled: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="setting-item" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20 }}>
              <div className="setting-info">
                <span className="setting-label">Receipt Email</span>
                <span className="setting-description">Email a payment receipt to members after each payment (requires SMTP, member email) (P2 5.5)</span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.receiptEmailEnabled}
                  onChange={(e) => setSettings({ ...settings, receiptEmailEnabled: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="setting-item" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20 }}>
              <div className="setting-info">
                <span className="setting-label">Report Hour</span>
                <span className="setting-description">Hour of day (24h) to send the automatic end-of-day report</span>
              </div>
              <select
                className="input setting-select"
                value={settings.autoReportHour}
                onChange={(e) => setSettings({ ...settings, autoReportHour: Number(e.target.value) })}
                disabled={!settings.autoReportEnabled}
              >
                <option value={21}>9 PM</option>
                <option value={22}>10 PM</option>
                <option value={23}>11 PM</option>
                <option value={0}>12 AM</option>
              </select>
            </div>
            <div className="setting-item" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20 }}>
              <div className="setting-info">
                <span className="setting-label">Auto-send Renewal Reminders</span>
                <span className="setting-description">
                  Email members expiring in 7 days and SMS members expiring in 3 days, once per day at the
                  chosen hour (runs while the app is open). Each member is reminded at most once per 7 days per channel.
                </span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.autoRemindersEnabled}
                  onChange={(e) => setSettings({ ...settings, autoRemindersEnabled: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="setting-item" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20 }}>
              <div className="setting-info">
                <span className="setting-label">Reminder Hour</span>
                <span className="setting-description">Hour of day (24h) to send automatic renewal reminders</span>
              </div>
              <select
                className="input setting-select"
                value={settings.reminderHour}
                onChange={(e) => setSettings({ ...settings, reminderHour: Number(e.target.value) })}
                disabled={!settings.autoRemindersEnabled}
              >
                <option value={6}>6 AM</option>
                <option value={8}>8 AM</option>
                <option value={9}>9 AM</option>
                <option value={10}>10 AM</option>
                <option value={12}>12 PM</option>
                <option value={17}>5 PM</option>
                <option value={20}>8 PM</option>
                <option value={21}>9 PM</option>
                <option value={22}>10 PM</option>
                <option value={23}>11 PM</option>
                <option value={0}>12 AM</option>
              </select>
            </div>
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Test Connection</span>
                <span className="setting-description">Save & verify SMTP settings</span>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  setSmtpTestResult({ type: 'loading', message: 'Testing SMTP connection...' })
                  try {
                    await window.electronAPI.saveSettings({
                      smtpHost: settings.smtpHost,
                      smtpPort: settings.smtpPort,
                      smtpUser: settings.smtpUser,
                      smtpPass: settings.smtpPass,
                      smtpFromEmail: settings.smtpFromEmail,
                    })
                    const result = await window.electronAPI.testSmtp()
                    if (result.success) {
                      setSmtpTestResult({ type: 'success', message: result.message })
                    } else {
                      setSmtpTestResult({ type: 'error', message: result.message })
                    }
                  } catch (error: any) {
                    setSmtpTestResult({ type: 'error', message: error.message })
                  }
                  setTimeout(() => setSmtpTestResult(t => t.type !== 'loading' ? { type: 'none' } : t), 6000)
                }}
                disabled={!settings.smtpHost || !settings.smtpUser}
              >
                Test Connection
              </button>
            </div>
          </div>
          <div style={{ marginTop: 12, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--accent)' }}>💡 Gmail users:</strong> You need an <strong>App Password</strong> (not your regular password) because 2-factor authentication is usually enabled.
            Create one at{' '}
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
              myaccount.google.com/apppasswords
            </a>
            . After generating, copy the 16-character password and paste it above.
          </div>
          {smtpPassWarning && (
            <div className="banner banner-error" style={{ marginTop: 12 }}>
              <span className="banner-text">⚠️ {smtpPassWarning}</span>
              <button className="banner-dismiss" onClick={() => setSmtpPassWarning('')}>✕</button>
            </div>
          )}
          {smtpTestResult.type !== 'none' && (
            <div className={`banner banner-${smtpTestResult.type}`} style={{ marginTop: 12 }}>
              <span className="banner-text">
                {smtpTestResult.type === 'loading' && '⏳ '}
                {smtpTestResult.type === 'success' && '✅ '}
                {smtpTestResult.type === 'error' && '❌ '}
                {smtpTestResult.message}
              </span>
              {smtpTestResult.type !== 'loading' && (
                <button className="banner-dismiss" onClick={() => setSmtpTestResult({ type: 'none' })}>✕</button>
              )}
            </div>
          )}
        </section>

        <section className="settings-section">
          <h2 className="section-title">SMS (Text Alerts)</h2>
          <div className="settings-group">
            <div className="setting-item" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20 }}>
              <div className="setting-info">
                <span className="setting-label">Delivery Channel</span>
                <span className="setting-description">
                  How member text alerts are delivered. <strong>Cloud SMS API</strong> needs internet + PhilSMS credits;
                  <strong> Simulator</strong> logs messages as sent without using credits (great for testing).
                </span>
              </div>
              <select
                className="input setting-select"
                value={settings.smsChannel}
                onChange={(e) => setSettings({ ...settings, smsChannel: e.target.value })}
              >
                <option value="off">Off</option>
                <option value="simulator">Simulator (test only)</option>
                <option value="cloud">Cloud SMS API (internet required)</option>
              </select>
            </div>

            <div className="setting-item" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20 }}>
              <div className="setting-info">
                <span className="setting-label">Cloud Provider</span>
                <span className="setting-description">SMS gateway used when the delivery channel is Cloud SMS API</span>
              </div>
              <select
                className="input setting-select"
                value={settings.cloudProvider}
                onChange={(e) => setSettings({ ...settings, cloudProvider: e.target.value })}
                disabled={settings.smsChannel !== 'cloud'}
              >
                <option value="philsms">PhilSMS (Philippines)</option>
              </select>
            </div>

            <div className="setting-item" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20 }}>
              <div className="setting-info">
                <span className="setting-label">API Key</span>
                <span className="setting-description">
                  Your PhilSMS API token from the dashboard (dashboard.philsms.com → API settings).
                  🔒 Stored encrypted (Windows security)
                </span>
              </div>
              <input
                type="password"
                className="input setting-input"
                value={settings.cloudApiKey}
                onChange={(e) => setSettings({ ...settings, cloudApiKey: e.target.value })}
                placeholder="Paste your PhilSMS API token"
                style={{ maxWidth: 340 }}
              />
            </div>

            <div className="setting-item" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20 }}>
              <div className="setting-info">
                <span className="setting-label">Sender Name / ID</span>
                <span className="setting-description">
                  Required by PhilSMS — up to 11 characters (letters &amp; numbers). Falls back to the gym name if empty.
                </span>
              </div>
              <input
                type="text"
                className="input setting-input"
                value={settings.cloudSender}
                onChange={(e) => setSettings({ ...settings, cloudSender: e.target.value.toUpperCase() })}
                placeholder="e.g. REPCHECK"
                maxLength={11}
                style={{ width: 180 }}
              />
            </div>

            <div className="setting-item" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20, flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
              <div className="setting-info">
                <span className="setting-label">Renewal Reminder SMS Template</span>
                <span className="setting-description">
                  Sent from <strong>Reports → Send Reminders</strong> to members expiring within 3 days.
                  Placeholders: {'{{gym}}'} {'{{name}}'} {'{{plan}}'} {'{{date}}'} {'{{days}}'}
                </span>
              </div>
              <textarea
                className="input"
                rows={3}
                value={settings.renewalSmsTemplate}
                onChange={(e) => setSettings({ ...settings, renewalSmsTemplate: e.target.value })}
                style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
              />
            </div>

            <div className="setting-item" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20, flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
              <div className="setting-info">
                <span className="setting-label">Payment Receipt SMS Template</span>
                <span className="setting-description">
                  Sent automatically to the member after every payment (new plan, renewal, top-up, auto-renewal).
                  Placeholders: {'{{gym}}'} {'{{name}}'} {'{{amount}}'} {'{{method}}'} {'{{type}}'} {'{{plan}}'} {'{{date}}'} {'{{ref}}'}
                </span>
              </div>
              <textarea
                className="input"
                rows={3}
                value={settings.receiptSmsTemplate}
                onChange={(e) => setSettings({ ...settings, receiptSmsTemplate: e.target.value })}
                style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
              />
            </div>

            <div className="setting-item" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20 }}>
              <div className="setting-info">
                <span className="setting-label">Gateway Status</span>
                <span className="setting-description">
                  Live verification of your PhilSMS token — the app checks the account balance on boot and every 60 seconds.
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {smsStatus && (
                  <span className={`sms-status-pill ${smsStatus.verified ? 'ok' : smsStatus.kind === 'off' || smsStatus.kind === 'simulator' ? 'idle' : 'bad'}`}>
                    <span className="sms-status-dot" />
                    {smsStatus.message}
                  </span>
                )}
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleVerifySms}>
                  Verify Connection
                </button>
              </div>
            </div>

            <div className="setting-item" style={{ borderBottom: 'none' }}>
              <div className="setting-info">
                <span className="setting-label">Send Test SMS</span>
                <span className="setting-description">
                  Send a sample message to a Philippine mobile number to test the gateway, e.g. 09171234567
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="tel"
                  className="input"
                  value={smsTestPhone}
                  onChange={(e) => setSmsTestPhone(e.target.value)}
                  placeholder="09171234567"
                  style={{ width: 180 }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleSendTestSms}
                  disabled={!smsTestPhone.trim()}
                >
                  Send Test
                </button>
              </div>
            </div>

            {smsLogs.length > 0 && (
              <div className="setting-item" style={{ borderBottom: 'none', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
                <div className="setting-info">
                  <span className="setting-label">Recent Messages</span>
                  <span className="setting-description">Latest entries from the SMS outbox — FAILED messages can be retried</span>
                </div>
                <div style={{ width: '100%', display: 'grid', gap: 6 }}>
                  {smsLogs.map(log => (
                    <div
                      key={log.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                    >
                      <span className={`sms-log-status ${log.status.toLowerCase()}`}>{log.status}</span>
                      <span style={{ fontFamily: 'monospace' }}>{log.recipient}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)' }} title={log.message}>{log.message}</span>
                      {log.status === 'FAILED' && log.last_error && (
                        <span style={{ color: 'var(--danger)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.last_error}>{log.last_error}</span>
                      )}
                      {log.status === 'FAILED' && (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleRetrySms(log.id)}>Retry</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {smsBanner.type !== 'none' && (
            <div className={`banner banner-${smsBanner.type}`} style={{ marginTop: 12 }}>
              <span className="banner-text">
                {smsBanner.type === 'loading' && '⏳ '}
                {smsBanner.type === 'success' && '✅ '}
                {smsBanner.type === 'error' && '❌ '}
                {smsBanner.message}
              </span>
              {smsBanner.type !== 'loading' && (
                <button className="banner-dismiss" onClick={() => setSmsBanner({ type: 'none' })}>✕</button>
              )}
            </div>
          )}
        </section>

        <section className="settings-section">
          <h2 className="section-title">Backup & Restore</h2>
          <div className="settings-group">
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Create Backup</span>
                <span className="setting-description">
                  Export ALL data to a ZIP file — member photos, fingerprints, plans, check-ins, payments, coaches, staff, logs & settings
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
              <button className="btn btn-secondary restore-btn" onClick={() => setShowRestoreConfirm(true)}>
                🔄 Restore
              </button>
            </div>
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Automatic Daily Backups</span>
                <span className="setting-description">
                  Automatically save a backup each day at the selected hour (kept in the app's backup folder).
                </span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.backupEnabled}
                  onChange={(e) => setSettings({ ...settings, backupEnabled: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Encrypt Backups</span>
                <span className="setting-description">
                  AES-256 encrypts every backup (manual + automatic) with the password below (P1 3.6).
                  Keep the password safe — you'll need it to restore.
                </span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.backupEncryptionEnabled}
                  onChange={(e) => setSettings({ ...settings, backupEncryptionEnabled: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="setting-item" style={{ borderBottom: 'none' }}>
              <div className="setting-info">
                <span className="setting-label">Backup Password</span>
                <span className="setting-description">
                  🔒 Stored encrypted (Windows security). Required to decrypt backups.
                </span>
              </div>
              <input
                type="password"
                className="input setting-input"
                value={settings.backupPassword}
                onChange={(e) => setSettings({ ...settings, backupPassword: e.target.value })}
                placeholder={settings.backupEncryptionEnabled ? 'Enter a backup password' : 'Encryption is off'}
                disabled={!settings.backupEncryptionEnabled}
                style={{ maxWidth: 280 }}
              />
            </div>
            <div className="setting-item" style={{ borderBottom: 'none' }}>
              <div className="setting-info">
                <span className="setting-label">Backup Hour</span>
                <span className="setting-description">Hour of day (24h) to run the automatic backup</span>
              </div>
              <select
                className="input setting-select"
                value={settings.backupHour}
                onChange={(e) => setSettings({ ...settings, backupHour: Number(e.target.value) })}
                disabled={!settings.backupEnabled}
              >
                <option value={23}>11 PM</option>
                <option value={0}>12 AM</option>
                <option value={1}>1 AM</option>
                <option value={2}>2 AM</option>
                <option value={3}>3 AM</option>
                <option value={4}>4 AM</option>
                <option value={5}>5 AM</option>
                <option value={6}>6 AM</option>
                <option value={12}>12 PM</option>
                <option value={18}>6 PM</option>
                <option value={21}>9 PM</option>
              </select>
            </div>
            <div className="setting-item" style={{ borderBottom: 'none' }}>
              <div className="setting-info">
                <span className="setting-label">Keep Backups</span>
                <span className="setting-description">Number of automatic backups to keep before pruning</span>
              </div>
              <select
                className="input setting-select"
                value={settings.backupKeep}
                onChange={(e) => setSettings({ ...settings, backupKeep: Number(e.target.value) })}
                disabled={!settings.backupEnabled}
              >
                <option value={3}>3</option>
                <option value={7}>7</option>
                <option value={14}>14</option>
                <option value={30}>30</option>
              </select>
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
                  <span className="update-status-hint">A backup is created automatically before the update applies.</span>
                </div>
              )}
              {updateStatus.type === 'backing-up' && (
                <div className="update-status backing-up">
                  <div className="update-spinner" />
                  <span>{updateStatus.message}</span>
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

      {/* P2 5.7: destructive-action confirmation */}
      <ConfirmModal
        open={showRestoreConfirm}
        title="Restore from Backup"
        message="This will REPLACE all current data (members, plans, check-ins, payments, etc.) with the data from the backup file. This action cannot be undone. A safety backup is created automatically first."
        confirmLabel="Restore"
        cancelLabel="Cancel"
        confirmVariant="danger"
        icon="🔄"
        onConfirm={handleRestore}
        onCancel={() => setShowRestoreConfirm(false)}
      />

        <div className="settings-actions">
          {saved && <span className="save-success">✓ Settings saved!</span>}
          {isAdmin && (
            <button className="btn btn-primary" onClick={handleSave}>
              Save Settings
            </button>
          )}
        </div>
      </div>
      </fieldset>
    </div>
  )
}

export default Settings
