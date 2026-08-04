import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  printIdCard: (html: string) => ipcRenderer.invoke('print-id-card', html),

  // Members
  getMembers: () => ipcRenderer.invoke('get-members'),
  getMember: (id: number) => ipcRenderer.invoke('get-member', id),
  createMember: (member: any) => ipcRenderer.invoke('create-member', member),
  updateMember: (id: number, member: any) => ipcRenderer.invoke('update-member', id, member),
  deleteMember: (id: number) => ipcRenderer.invoke('delete-member', id),
  searchMembers: (query: string) => ipcRenderer.invoke('search-members', query),
  getMembersPage: (opts?: { offset?: number; limit?: number; search?: string }) => ipcRenderer.invoke('get-members-page', opts),
  checkMemberIdExists: (memberId: string) => ipcRenderer.invoke('check-member-id-exists', memberId),
  getLastMemberId: () => ipcRenderer.invoke('get-last-member-id'),

  // Plans
  getPlans: () => ipcRenderer.invoke('get-plans'),
  createPlan: (plan: any) => ipcRenderer.invoke('create-plan', plan),
  updatePlan: (id: number, plan: any) => ipcRenderer.invoke('update-plan', id, plan),
  deletePlan: (id: number) => ipcRenderer.invoke('delete-plan', id),

  // Check-ins
  getCheckins: (date?: string, opts?: { offset?: number; limit?: number }) => ipcRenderer.invoke('get-checkins', date, opts),
  getCheckinsCount: (date?: string) => ipcRenderer.invoke('get-checkins-count', date),
  createCheckin: (checkin: any) => ipcRenderer.invoke('create-checkin', checkin),
  getActiveCheckins: () => ipcRenderer.invoke('get-active-checkins'),
  checkoutMember: (checkinId: number) => ipcRenderer.invoke('checkout-member', checkinId),

  // Guest / trial check-ins
  createGuestCheckin: (guest: { name: string; phone?: string; type?: string }) => ipcRenderer.invoke('create-guest-checkin', guest),
  getGuestCheckins: (date?: string) => ipcRenderer.invoke('get-guest-checkins', date),
  getGuestCheckinsCount: (date?: string) => ipcRenderer.invoke('get-guest-checkins-count', date),
  checkoutGuest: (id: number) => ipcRenderer.invoke('checkout-guest', id),

  // Stats
  getTodayStats: () => ipcRenderer.invoke('get-today-stats'),
  getExpiringSoon: () => ipcRenderer.invoke('get-expiring-soon'),

  // Fingerprint (native U.are.U SDK — worker thread)
  getFingerprintStatus: () => ipcRenderer.invoke('fingerprint-status'),
  captureFingerprint: (timeoutMs?: number) => ipcRenderer.invoke('fingerprint-capture', timeoutMs),
  stopFingerprintCapture: () => ipcRenderer.invoke('fingerprint-stop-capture'),
  createFingerprintFmd: (imageBase64: string) => ipcRenderer.invoke('fingerprint-create-fmd', imageBase64),
  identifyFingerprint: (fmdBase64: string, templates: { fmdBase64: string }[]) =>
    ipcRenderer.invoke('fingerprint-identify', fmdBase64, templates),
  getAllFingerprintTemplates: () => ipcRenderer.invoke('get-all-fingerprint-templates'),
  replaceFingerprints: (memberId: number, fingerprints: { fmdBase64?: string; quality?: number }[]) =>
    ipcRenderer.invoke('replace-fingerprints', memberId, fingerprints),
  getAllStaffFingerprintTemplates: () => ipcRenderer.invoke('get-all-staff-fingerprint-templates'),
  replaceStaffFingerprints: (staffId: number, fingerprints: { fmdBase64?: string; quality?: number }[]) =>
    ipcRenderer.invoke('replace-staff-fingerprints', staffId, fingerprints),

  // Payments
  getPayments: (memberId?: number, opts?: { offset?: number; limit?: number }) => ipcRenderer.invoke('get-payments', memberId, opts),
  getPaymentsCount: (memberId?: number) => ipcRenderer.invoke('get-payments-count', memberId),
  createPayment: (payment: any) => ipcRenderer.invoke('create-payment', payment),
  updatePaymentStatus: (id: number, status: string, note?: string) =>
    ipcRenderer.invoke('update-payment-status', id, status, note),

  // Reports
  getDailyReport: (date: string) => ipcRenderer.invoke('get-daily-report', date),
  getMonthlyReport: (yearMonth: string) => ipcRenderer.invoke('get-monthly-report', yearMonth),
  getAtRiskMembers: () => ipcRenderer.invoke('get-at-risk-members'),
  sendRenewalReminders: () => ipcRenderer.invoke('send-renewal-reminders'),
  sendReportEmail: (data: { html: string; recipient: string; appName: string; filename: string }) =>
    ipcRenderer.invoke('send-report-email', data),
  testSmtp: () => ipcRenderer.invoke('test-smtp'),

  // Activity Logs
  createActivityLog: (log: any) => ipcRenderer.invoke('create-activity-log', log),
  getActivityLogs: (opts?: { limit?: number; user?: string; action?: string; offset?: number }) =>
    ipcRenderer.invoke('get-activity-logs', opts),

  // Backup & Restore
  createBackup: () => ipcRenderer.invoke('create-backup'),
  restoreBackup: (password?: string) => ipcRenderer.invoke('restore-backup', password),

  // Coaches
  getCoaches: () => ipcRenderer.invoke('get-coaches'),
  getCoach: (id: number) => ipcRenderer.invoke('get-coach', id),
  createCoach: (coach: any) => ipcRenderer.invoke('create-coach', coach),
  updateCoach: (id: number, coach: any) => ipcRenderer.invoke('update-coach', id, coach),
  deleteCoach: (id: number) => ipcRenderer.invoke('delete-coach', id),
  getCoachMembers: (coachId: number) => ipcRenderer.invoke('get-coach-members', coachId),

  // Coach Fee Payments
  getCoachFeePayments: (coachId: number) => ipcRenderer.invoke('get-coach-fee-payments', coachId),
  createCoachFeePayment: (payment: any) => ipcRenderer.invoke('create-coach-fee-payment', payment),
  getCoachFeeCollected: (coachId: number) => ipcRenderer.invoke('get-coach-fee-collected', coachId),

  // Coach Payment Tracking
  getCoachPaymentsByDate: (coachId: number, date: string) =>
    ipcRenderer.invoke('get-coach-payments-by-date', coachId, date),
  getCoachMonthlyTotal: (coachId: number, date: string) =>
    ipcRenderer.invoke('get-coach-monthly-total', coachId, date),
  getCoachMonthlyPayments: (coachId: number, date: string) =>
    ipcRenderer.invoke('get-coach-monthly-payments', coachId, date),

  // Kiosk window
  getKioskStatus: () => ipcRenderer.invoke('get-kiosk-status'),
  openKioskWindow: () => ipcRenderer.invoke('open-kiosk-window'),
  closeKioskWindow: () => ipcRenderer.invoke('close-kiosk-window'),
  onKioskStatusChanged: (callback: (open: boolean) => void) => {
    const handler = (_: any, open: boolean) => callback(open)
    ipcRenderer.on('kiosk-status-changed', handler)
    return () => ipcRenderer.removeListener('kiosk-status-changed', handler)
  },

  // Auth / Staff
  login: (username: string, password: string) => ipcRenderer.invoke('login', username, password),
  getUsers: () => ipcRenderer.invoke('get-users'),
  createUser: (user: any) => ipcRenderer.invoke('create-user', user),
  updateUser: (id: number, user: any) => ipcRenderer.invoke('update-user', id, user),
  deleteUser: (id: number) => ipcRenderer.invoke('delete-user', id),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getSetting: (key: string) => ipcRenderer.invoke('get-setting', key),
  saveSetting: (key: string, value: string) => ipcRenderer.invoke('save-setting', key, value),
  saveSettings: (settings: Record<string, string>) => ipcRenderer.invoke('save-settings', settings),

  // Theme
  getTheme: () => ipcRenderer.invoke('get-setting', 'theme'),
  saveTheme: (theme: string) => ipcRenderer.invoke('save-setting', 'theme', theme),

  // License Activation
  validateLicense: (key: string) => ipcRenderer.invoke('validate-license', key),
  getLicenseInfo: () => ipcRenderer.invoke('get-license-info'),

  // Auto-update
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  restartAppWithBackup: () => ipcRenderer.invoke('restart-app-with-backup'),
  onUpdateStatus: (callback: (status: any) => void) => {
    const handler = (_: any, status: any) => callback(status)
    ipcRenderer.on('update-status', handler)
    return () => ipcRenderer.removeListener('update-status', handler)
  },
  // Cross-window data refresh (P2 6.5): the main process broadcasts this after
  // any window mutates data (e.g. a kiosk check-in), so every window can re-fetch.
  onDataChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('data-changed', handler)
    return () => ipcRenderer.removeListener('data-changed', handler)
  },
})
