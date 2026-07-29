import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),

  // Members
  getMembers: () => ipcRenderer.invoke('get-members'),
  getMember: (id: number) => ipcRenderer.invoke('get-member', id),
  createMember: (member: any) => ipcRenderer.invoke('create-member', member),
  updateMember: (id: number, member: any) => ipcRenderer.invoke('update-member', id, member),
  deleteMember: (id: number) => ipcRenderer.invoke('delete-member', id),
  searchMembers: (query: string) => ipcRenderer.invoke('search-members', query),

  // Plans
  getPlans: () => ipcRenderer.invoke('get-plans'),
  createPlan: (plan: any) => ipcRenderer.invoke('create-plan', plan),
  updatePlan: (id: number, plan: any) => ipcRenderer.invoke('update-plan', id, plan),
  deletePlan: (id: number) => ipcRenderer.invoke('delete-plan', id),

  // Check-ins
  getCheckins: (date?: string) => ipcRenderer.invoke('get-checkins', date),
  createCheckin: (checkin: any) => ipcRenderer.invoke('create-checkin', checkin),

  // Stats
  getTodayStats: () => ipcRenderer.invoke('get-today-stats'),
  getExpiringSoon: () => ipcRenderer.invoke('get-expiring-soon'),

  // Fingerprint
  saveFingerprint: (memberId: number, template: Buffer, quality: number) =>
    ipcRenderer.invoke('save-fingerprint', memberId, template, quality),
  saveFingerprintCredential: (memberId: string, credentialId: string) =>
    ipcRenderer.invoke('save-fingerprint-credential', memberId, credentialId),
  getFingerprint: (memberId: number) => ipcRenderer.invoke('get-fingerprint', memberId),
  matchFingerprint: (template: Buffer) => ipcRenderer.invoke('match-fingerprint', template),

  // Payments
  getPayments: (memberId?: number) => ipcRenderer.invoke('get-payments', memberId),
  createPayment: (payment: any) => ipcRenderer.invoke('create-payment', payment),

  // Backup & Restore
  createBackup: () => ipcRenderer.invoke('create-backup'),
  restoreBackup: () => ipcRenderer.invoke('restore-backup'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getSetting: (key: string) => ipcRenderer.invoke('get-setting', key),
  saveSetting: (key: string, value: string) => ipcRenderer.invoke('save-setting', key, value),
  saveSettings: (settings: Record<string, string>) => ipcRenderer.invoke('save-settings', settings),
})
