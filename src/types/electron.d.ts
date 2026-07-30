export interface ElectronAPI {
  // Window controls
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>

  // Members
  getMembers: () => Promise<Member[]>
  getMember: (id: number) => Promise<Member>
  createMember: (member: CreateMemberInput) => Promise<any>
  updateMember: (id: number, member: UpdateMemberInput) => Promise<any>
  deleteMember: (id: number) => Promise<any>
  searchMembers: (query: string) => Promise<Member[]>

  // Plans
  getPlans: () => Promise<Plan[]>
  createPlan: (plan: CreatePlanInput) => Promise<any>
  updatePlan: (id: number, plan: UpdatePlanInput) => Promise<any>
  deletePlan: (id: number) => Promise<any>

  // Check-ins
  getCheckins: (date?: string) => Promise<Checkin[]>
  createCheckin: (checkin: CreateCheckinInput) => Promise<any>

  // Stats
  getTodayStats: () => Promise<TodayStats>
  getExpiringSoon: () => Promise<Member[]>

  // Fingerprint
  saveFingerprint: (memberId: number, template: Buffer, quality: number) => Promise<any>
  saveFingerprintCredential: (memberId: string, credentialId: string) => Promise<any>
  getFingerprint: (memberId: number) => Promise<any>
  matchFingerprint: (template: Buffer) => Promise<{ matched: boolean; memberId: number | null; confidence: number }>

  // Payments
  getPayments: (memberId?: number) => Promise<Payment[]>
  createPayment: (payment: CreatePaymentInput) => Promise<any>

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

  // Activity Logs
  createActivityLog: (log: CreateActivityLogInput) => Promise<any>
  getActivityLogs: (limit?: number) => Promise<ActivityLog[]>

  // Backup & Restore
  createBackup: () => Promise<{ success: boolean; path?: string; reason?: string }>
  restoreBackup: () => Promise<{ success: boolean; reason?: string }>

  // Kiosk window
  openKioskWindow: () => Promise<void>
  closeKioskWindow: () => Promise<void>

  // Settings
  getSettings: () => Promise<Record<string, string>>
  getSetting: (key: string) => Promise<string | null>
  saveSetting: (key: string, value: string) => Promise<void>
  saveSettings: (settings: Record<string, string>) => Promise<void>

  // License Activation
  validateLicense: (key: string) => Promise<{ valid: boolean; message: string }>
  getLicenseInfo: () => Promise<{ activated: boolean; machineId: string | null; storedMachineId: string | null }>

  // Auto-update
  checkForUpdates: () => Promise<{ status: string; message?: string }>
  restartApp: () => Promise<void>
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
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
  plan_name?: string
  coach_name?: string
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
  name?: string
  member_code?: string
  member_photo?: string
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
  staff_id?: number
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

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
