import { CreateActivityLogInput, StaffUser } from '../types/electron'

// Track the currently logged-in user so activity logs show who did what (P2 5.6).
// The FULL session identity (username + display name + role) is kept so the
// audit trail resolves the real actor: an admin's full name + role, never a
// generic "staff" label (P2 6.9 / Activity Log identity fix).
let currentUser: { username: string; displayName?: string; role?: string } | null = null

export function setLogUser(user: StaffUser | null) {
  currentUser = user
    ? { username: user.username, displayName: user.display_name, role: user.role }
    : null
}

// "Display Name (Role)" with a username fallback — e.g. "Joel Encendencia (Admin)".
function actorLabel(): string {
  if (!currentUser) return ''
  const name = currentUser.displayName || currentUser.username
  const role = currentUser.role === 'admin' ? 'Admin' : currentUser.role === 'staff' ? 'Staff' : ''
  return role ? `${name} (${role})` : name
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
        // Resolve the authenticated session identity first; fall back to the
        // caller-provided user, then to 'Kiosk' for scans with no session.
        user: actorLabel() || input.user || 'Kiosk',
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

  // ── Referral rewards (P2 5.8) ──
  referralReward(referrerId: number, referrerName: string, referredName: string, points: number) {
    return this.action({
      action: 'referral_reward',
      entity_type: 'member',
      entity_id: referrerId,
      details: JSON.stringify({ member_name: referrerName, referred: referredName, points }),
    })
  },

  redeemFreeMonth(memberId: number, memberName: string, points: number, planEnd: string) {
    return this.action({
      action: 'redeem_free_month',
      entity_type: 'member',
      entity_id: memberId,
      details: JSON.stringify({ member_name: memberName, points, plan_end: planEnd }),
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
