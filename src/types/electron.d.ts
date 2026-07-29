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

  // Backup & Restore
  createBackup: () => Promise<{ success: boolean; path?: string; reason?: string }>
  restoreBackup: () => Promise<{ success: boolean; reason?: string }>

  // Settings
  getSettings: () => Promise<Record<string, string>>
  getSetting: (key: string) => Promise<string | null>
  saveSetting: (key: string, value: string) => Promise<void>
  saveSettings: (settings: Record<string, string>) => Promise<void>
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
  sessions_used: number
  balance: number
  status: 'active' | 'inactive' | 'expired'
  created_at: string
  plan_name?: string
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
  created_at: string
  name?: string
  plan_name?: string
}

export interface CreatePaymentInput {
  member_id: number
  amount: number
  type: 'new_plan' | 'renewal' | 'top_up'
  plan_id?: number
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
