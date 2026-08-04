export interface ElectronAPI {
  // Window controls
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  printIdCard: (html: string) => Promise<{ success: boolean; message?: string }>

  // Members
  getMembers: () => Promise<Member[]>
  getMember: (id: number) => Promise<Member>
  createMember: (member: CreateMemberInput) => Promise<any>
  updateMember: (id: number, member: UpdateMemberInput) => Promise<any>
  deleteMember: (id: number) => Promise<any>
  searchMembers: (query: string) => Promise<Member[]>
  getMembersPage: (opts?: { offset?: number; limit?: number; search?: string }) => Promise<{ rows: Member[]; total: number; offset: number; limit: number }>
  checkMemberIdExists: (memberId: string) => Promise<{ id: number; name: string } | null>
  getLastMemberId: () => Promise<{ last: number; next: number }>

  // Plans
  getPlans: () => Promise<Plan[]>
  createPlan: (plan: CreatePlanInput) => Promise<any>
  updatePlan: (id: number, plan: UpdatePlanInput) => Promise<any>
  deletePlan: (id: number) => Promise<any>

  // Check-ins
  getCheckins: (date?: string, opts?: { offset?: number; limit?: number }) => Promise<Checkin[]>
  getCheckinsCount: (date?: string) => Promise<number>
  createCheckin: (checkin: CreateCheckinInput) => Promise<{ success: boolean; reason?: string; message?: string; id?: number }>
  getActiveCheckins: () => Promise<ActiveCheckin[]>
  checkoutMember: (checkinId: number) => Promise<{ success: boolean }>

  // Guest / trial check-ins
  createGuestCheckin: (guest: { name: string; phone?: string; type?: string }) => Promise<any>
  getGuestCheckins: (date?: string) => Promise<GuestCheckin[]>
  getGuestCheckinsCount: (date?: string) => Promise<number>
  checkoutGuest: (id: number) => Promise<{ success: boolean }>

  // Stats
  getTodayStats: () => Promise<TodayStats>
  getExpiringSoon: () => Promise<Member[]>

  // Fingerprint (native U.are.U SDK — worker thread)
  getFingerprintStatus: () => Promise<FingerprintStatus>
  captureFingerprint: (timeoutMs?: number) => Promise<FingerprintCaptureResult>
  stopFingerprintCapture: () => Promise<void>
  createFingerprintFmd: (imageBase64: string) => Promise<{ fmdBase64: string } | { error: string }>
  identifyFingerprint: (fmdBase64: string, templates: { fmdBase64: string }[]) => Promise<{ index: number } | { error: string }>
  getAllFingerprintTemplates: () => Promise<FingerprintTemplateInfo[]>
  replaceFingerprints: (memberId: number, fingerprints: { fmdBase64?: string; quality?: number }[]) => Promise<{ success: boolean }>
  getAllStaffFingerprintTemplates: () => Promise<StaffFingerprintTemplateInfo[]>
  replaceStaffFingerprints: (staffId: number, fingerprints: { fmdBase64?: string; quality?: number }[]) => Promise<{ success: boolean }>

  // Payments
  getPayments: (memberId?: number, opts?: { offset?: number; limit?: number }) => Promise<Payment[]>
  getPaymentsCount: (memberId?: number) => Promise<number>
  createPayment: (payment: CreatePaymentInput) => Promise<any>
  updatePaymentStatus: (id: number, status: 'completed' | 'refunded' | 'voided', note?: string) =>
    Promise<{ success: boolean; message?: string }>

  // Coaches
  getCoaches: () => Promise<Coach[]>
  getCoach: (id: number) => Promise<Coach>
  createCoach: (coach: CreateCoachInput) => Promise<any>
  updateCoach: (id: number, coach: CreateCoachInput) => Promise<any>
  deleteCoach: (id: number) => Promise<any>
  getCoachMembers: (coachId: number) => Promise<Member[]>

  // Coach Fee Payments
  getCoachFeePayments: (coachId: number) => Promise<CoachFeePayment[]>
  createCoachFeePayment: (payment: CreateCoachFeePaymentInput) => Promise<any>
  getCoachFeeCollected: (coachId: number) => Promise<number>

  // Coach Payment Tracking
  getCoachPaymentsByDate: (coachId: number, date: string) => Promise<{ payments: CoachFeePayment[]; dailyTotal: number }>
  getCoachMonthlyTotal: (coachId: number, date: string) => Promise<number>
  getCoachMonthlyPayments: (coachId: number, date: string) => Promise<CoachFeePayment[]>

  // Reports
  getDailyReport: (date: string) => Promise<DailyReport>
  getMonthlyReport: (yearMonth: string) => Promise<MonthlyReport>
  getAtRiskMembers: () => Promise<AtRiskMember[]>
  sendRenewalReminders: () => Promise<{
    success: boolean
    message?: string
    sent: number
    skipped: number
    results: { member_id: number; name: string; sent: boolean; message: string }[]
  }>
  sendReportEmail: (data: { html: string; recipient: string; appName: string; filename: string }) =>
    Promise<{ success: boolean; filePath?: string; message?: string }>
  testSmtp: () => Promise<{ success: boolean; message: string }>

  // Activity Logs
  createActivityLog: (log: CreateActivityLogInput) => Promise<any>
  getActivityLogs: (opts?: { limit?: number; user?: string; action?: string; offset?: number }) => Promise<ActivityLog[]>

  // Backup & Restore
  createBackup: () => Promise<{ success: boolean; path?: string; reason?: string }>
  restoreBackup: (password?: string) => Promise<{ success: boolean; reason?: string; message?: string }>

  // Kiosk window
  getKioskStatus: () => Promise<{ open: boolean }>
  openKioskWindow: () => Promise<void>
  closeKioskWindow: () => Promise<void>
  onKioskStatusChanged: (callback: (open: boolean) => void) => () => void

  // Auth / Staff
  login: (username: string, password: string) => Promise<{ success: boolean; user?: StaffUser; message?: string }>
  getUsers: () => Promise<StaffUser[]>
  createUser: (user: CreateStaffInput) => Promise<{ success: boolean; message?: string; id?: number }>
  updateUser: (id: number, user: UpdateStaffInput) => Promise<{ success: boolean; message?: string }>
  deleteUser: (id: number) => Promise<{ success: boolean; message?: string }>

  // Settings
  getSettings: () => Promise<Record<string, string>>
  getSetting: (key: string) => Promise<string | null>
  saveSetting: (key: string, value: string) => Promise<void>
  saveSettings: (settings: Record<string, string>) => Promise<void>

  // Theme
  getTheme: () => Promise<string | null>
  saveTheme: (theme: string) => Promise<void>

  // License Activation
  validateLicense: (key: string) => Promise<{ valid: boolean; message: string }>
  getLicenseInfo: () => Promise<{ activated: boolean; machineId: string | null; storedMachineId: string | null }>

  // Auto-update
  checkForUpdates: () => Promise<{ status: string; message?: string }>
  restartApp: () => Promise<void>
  restartAppWithBackup: () => Promise<{ success: boolean; path?: string; message?: string }>
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void

  // Cross-window data refresh (P2 6.5): fires when any window mutates data
  // (e.g. a kiosk check-in), so this window can re-fetch its dashboard/lists.
  onDataChanged: (callback: () => void) => () => void
}

export interface Coach {
  id: number
  name: string
  email?: string
  phone?: string
  specialty?: string
  professional_fee?: number
  created_at: string
}

export interface CreateCoachInput {
  name: string
  email?: string
  phone?: string
  specialty?: string
  professional_fee?: number
}

export interface Member {
  id: number
  member_id: string
  name: string
  email?: string
  phone?: string
  photo?: string
  emergency_contact?: string
  emergency_phone?: string
  plan_id?: number
  plan_start?: string
  plan_end?: string
  height?: number
  weight?: number
  birthday?: string
  coach_id?: number
  coaching_start?: string
  coaching_end?: string
  sessions_used: number
  balance: number
  status: 'active' | 'inactive' | 'expired'
  created_at: string
  waiver_agreed_at?: string
  auto_renew?: number
  plan_name?: string
  coach_name?: string
  plan_type?: string
  plan_sessions?: number
}

export interface CreateMemberInput {
  member_id: string
  name: string
  email?: string
  phone?: string
  photo?: string
  emergency_contact?: string
  emergency_phone?: string
  plan_id?: number
  plan_start?: string
  plan_end?: string
  height?: number
  weight?: number
  birthday?: string
  coach_id?: number
  coaching_start?: string
  coaching_end?: string
  balance?: number
  waiver_agreed_at?: string
  auto_renew?: number
}

export interface UpdateMemberInput {
  name: string
  email?: string
  phone?: string
  photo?: string
  emergency_contact?: string
  emergency_phone?: string
  plan_id?: number
  plan_start?: string
  plan_end?: string
  height?: number
  weight?: number
  birthday?: string
  coach_id?: number
  coaching_start?: string
  coaching_end?: string
  balance?: number
  status?: 'active' | 'inactive' | 'expired'
  waiver_agreed_at?: string
  sessions_used?: number
  auto_renew?: number
}

export interface Plan {
  id: number
  name: string
  type: 'monthly' | 'quarterly' | 'annual' | 'session_pack' | 'family'
  duration_days?: number
  sessions?: number
  price: number
  created_at: string
}

export interface CreatePlanInput {
  name: string
  type: 'monthly' | 'quarterly' | 'annual' | 'session_pack' | 'family'
  duration_days?: number
  sessions?: number
  price: number
}

export interface UpdatePlanInput {
  name: string
  type: 'monthly' | 'quarterly' | 'annual' | 'session_pack' | 'family'
  duration_days?: number
  sessions?: number
  price: number
}

export interface Checkin {
  id: number
  member_id: number
  timestamp: string
  method: 'fingerprint' | 'manual'
  match_confidence?: number
  status: 'success' | 'failed' | 'override'
  checked_out_at?: string
  name?: string
  member_code?: string
  member_photo?: string
}

export interface ActiveCheckin extends Checkin {
  balance?: number
}

export interface CreateCheckinInput {
  member_id: number
  method: 'fingerprint' | 'manual'
  match_confidence?: number
  status?: 'success' | 'failed' | 'override'
}

export interface Payment {
  id: number
  member_id: number
  amount: number
  type: 'new_plan' | 'renewal' | 'top_up'
  plan_id?: number
  payment_method?: string
  transaction_ref?: string
  staff_id?: number
  status?: 'completed' | 'refunded' | 'voided'
  note?: string
  created_at: string
  name?: string
  member_name?: string
  member_code?: string
  plan_name?: string
}

export interface CreatePaymentInput {
  member_id: number
  amount: number
  type: 'new_plan' | 'renewal' | 'top_up'
  plan_id?: number
  payment_method?: string
  transaction_ref?: string
  staff_id?: number
}

export interface DailyReport {
  date: string
  totalRevenue: number
  byType: { type: string; count: number; total: number }[]
  byMethod: { payment_method: string; count: number; total: number }[]
  transactions: Payment[]
  newMembers: number
  renewals: number
  outstandingCount: number
  outstanding: { id: number; member_id: string; name: string; balance: number }[]
}

export interface MonthlyReportWeek {
  week: string
  total: number
  count: number
}

export interface MonthlyReport {
  yearMonth: string
  totalRevenue: number
  previousMonthRevenue: number
  percentChange: number
  weekly: MonthlyReportWeek[]
  byPlanType: { plan_type: string; count: number; total: number }[]
  byMethod: { payment_method: string; count: number; total: number }[]
  newMembers: number
  renewals: number
  churned: number
  outstanding: { id: number; member_id: string; name: string; balance: number }[]
  outstandingCount: number
  activeMemberCount: number
  avgRevenuePerMember: number
}

export interface CoachFeePayment {
  id: number
  coach_id: number
  member_id: number
  amount: number
  notes?: string
  created_at: string
  member_name?: string
  member_code?: string
  coach_name?: string
}

export interface CreateCoachFeePaymentInput {
  coach_id: number
  member_id: number
  amount: number
  notes?: string
}

export interface GuestCheckin {
  id: number
  name: string
  phone?: string
  type: 'guest' | 'trial'
  created_at: string
  checked_out_at?: string | null
}

export interface ActivityLog {
  id: number
  action: string
  entity_type: string
  entity_id?: number
  details?: string
  user: string
  created_at: string
}

export interface CreateActivityLogInput {
  action: string
  entity_type: string
  entity_id?: number
  details?: string
  user?: string
}

export interface StaffUser {
  id: number
  username: string
  role: 'admin' | 'staff'
  photo?: string
  display_name?: string
  created_at: string
}

export interface CreateStaffInput {
  username: string
  password: string
  role: 'admin' | 'staff'
  display_name?: string
  photo?: string
}

export interface UpdateStaffInput {
  username?: string
  password?: string
  role?: 'admin' | 'staff'
  display_name?: string
  photo?: string
}

export interface UpdateStatus {
  status: 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'
  message: string
  version?: string
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  error?: string
  info?: any
}

export interface TodayStats {
  totalCheckins: number
  activeMembers: number
  expiredMembers: number
  expiringThisWeek: number
}

export interface FingerprintSample {
  success: boolean
  qualityCode: number
  error: number
  width: number
  height: number
  resolution: number
  imageSize: number
  /** ANSI-381 FID bytes (base64) — input for createFingerprintFmd */
  imageBase64: string
}

export interface FingerprintStatusStep {
  name: string
  ok: boolean
  message: string
}

export interface FingerprintStatus {
  available: boolean
  readerName: string
  steps: FingerprintStatusStep[]
}

export type FingerprintCaptureResult =
  | { ok: true; sample: FingerprintSample }
  | { ok: false; reason: 'unavailable' | 'device' | 'timeout' | 'cancelled'; message?: string }

export interface FingerprintTemplateInfo {
  member_id: number
  member_name: string
  status: string
  fmdBase64: string
}

export interface StaffFingerprintTemplateInfo {
  staff_id: number
  username: string
  display_name?: string | null
  role: 'admin' | 'staff'
  fmdBase64: string
}

export interface AtRiskMember {
  id: number
  member_id: string
  name: string
  email?: string | null
  plan_name?: string | null
  plan_end?: string | null
  checkins_recent: number
  checkins_prev: number
  drop_pct: number
  days_since_last_checkin: number | null
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
