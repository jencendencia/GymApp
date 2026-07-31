import { CreateActivityLogInput } from '../types/electron'

// Track the currently logged-in user so activity logs show who did what (P2 5.6)
let currentUser: string | null = null

export function setLogUser(username: string | null) {
  currentUser = username
}

/**
 * Unified activity logger for the entire app.
 * Call `log.action(...)` from any component to record user activity.
 */
export const log = {
  async action(input: CreateActivityLogInput) {
    try {
      await window.electronAPI.createActivityLog({
        ...input,
        user: currentUser || input.user || 'staff',
      })
    } catch (error) {
      console.error('Failed to log activity:', error)
    }
  },

  // ── Kiosk ──
  checkinFingerprint(memberId: number, memberName: string) {
    return this.action({
      action: 'checkin_fingerprint',
      entity_type: 'checkin',
      entity_id: memberId,
      details: JSON.stringify({ member_name: memberName, method: 'fingerprint' }),
    })
  },

  checkinManual(memberId: number, memberName: string) {
    return this.action({
      action: 'checkin_manual',
      entity_type: 'checkin',
      entity_id: memberId,
      details: JSON.stringify({ member_name: memberName, method: 'manual' }),
    })
  },

  checkinOverride(memberId: number, memberName: string) {
    return this.action({
      action: 'checkin_override',
      entity_type: 'checkin',
      entity_id: memberId,
      details: JSON.stringify({ member_name: memberName, status: 'override' }),
    })
  },

  // ── Members ──
  createMember(memberId: number, name: string) {
    return this.action({
      action: 'create_member',
      entity_type: 'member',
      entity_id: memberId,
      details: JSON.stringify({ name }),
    })
  },

  updateMember(memberId: number, name: string, changes: Record<string, any>) {
    return this.action({
      action: 'update_member',
      entity_type: 'member',
      entity_id: memberId,
      details: JSON.stringify({ name, changes }),
    })
  },

  deleteMember(memberId: number, name: string) {
    return this.action({
      action: 'delete_member',
      entity_type: 'member',
      entity_id: memberId,
      details: JSON.stringify({ name }),
    })
  },

  assignPlan(memberId: number, memberName: string, planName: string) {
    return this.action({
      action: 'assign_plan',
      entity_type: 'member',
      entity_id: memberId,
      details: JSON.stringify({ member_name: memberName, plan_name: planName }),
    })
  },

  registerFingerprint(memberId: number, memberName: string) {
    return this.action({
      action: 'register_fingerprint',
      entity_type: 'member',
      entity_id: memberId,
      details: JSON.stringify({ member_name: memberName }),
    })
  },

  // ── Coaches ──
  createCoach(coachId: number, name: string) {
    return this.action({
      action: 'create_coach',
      entity_type: 'coach',
      entity_id: coachId,
      details: JSON.stringify({ name }),
    })
  },

  updateCoach(coachId: number, name: string, changes: Record<string, any>) {
    return this.action({
      action: 'update_coach',
      entity_type: 'coach',
      entity_id: coachId,
      details: JSON.stringify({ name, changes }),
    })
  },

  deleteCoach(coachId: number, name: string) {
    return this.action({
      action: 'delete_coach',
      entity_type: 'coach',
      entity_id: coachId,
      details: JSON.stringify({ name }),
    })
  },

  recordFeePayment(coachId: number, coachName: string, memberName: string, amount: number) {
    return this.action({
      action: 'record_fee_payment',
      entity_type: 'coach',
      entity_id: coachId,
      details: JSON.stringify({ coach_name: coachName, member_name: memberName, amount }),
    })
  },

  // ── Plans ──
  createPlan(planId: number, name: string, price: number) {
    return this.action({
      action: 'create_plan',
      entity_type: 'plan',
      entity_id: planId,
      details: JSON.stringify({ name, price }),
    })
  },

  updatePlan(planId: number, name: string, changes: Record<string, any>) {
    return this.action({
      action: 'update_plan',
      entity_type: 'plan',
      entity_id: planId,
      details: JSON.stringify({ name, changes }),
    })
  },

  deletePlan(planId: number, name: string) {
    return this.action({
      action: 'delete_plan',
      entity_type: 'plan',
      entity_id: planId,
      details: JSON.stringify({ name }),
    })
  },

  // ── Settings ──
  updateSettings(changes: Record<string, any>) {
    return this.action({
      action: 'update_settings',
      entity_type: 'settings',
      details: JSON.stringify({ changes }),
    })
  },

  uploadLogo() {
    return this.action({
      action: 'upload_logo',
      entity_type: 'settings',
    })
  },

  removeLogo() {
    return this.action({
      action: 'remove_logo',
      entity_type: 'settings',
    })
  },

  createBackup(path?: string) {
    return this.action({
      action: 'create_backup',
      entity_type: 'settings',
      details: JSON.stringify({ path }),
    })
  },

  restoreBackup() {
    return this.action({
      action: 'restore_backup',
      entity_type: 'settings',
    })
  },
}
