// ── Pure helpers (no Electron imports — unit-testable) ─────────────────────

/** Local-time YYYY-MM-DD for "today" (fixes the UTC rollover bug: "today" must reset at local midnight, e.g. PH +8). */
export function todayLocal(): string {
  const d = new Date()
  return formatDateLocal(d)
}

/** Local-time YYYY-MM-DD HH:MM:SS (for checked_out_at etc.). */
export function nowLocal(): string {
  const d = new Date()
  return `${formatDateLocal(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

/** Format a Date as a local YYYY-MM-DD string. */
export function formatDateLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Add N days to a YYYY-MM-DD string and return the local YYYY-MM-DD result. */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return formatDateLocal(d)
}

// ── Validation helpers ──────────────────────────────────────────────────────

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function isNonNegativeNumber(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0
}

export function isPositiveNumber(v: unknown): v is number {
  return isFiniteNumber(v) && v > 0
}

/** Date check: accepts a real calendar date as YYYY-MM-DD (also tolerates empty/undefined). */
export function isDateStr(v: unknown): v is string {
  if (v === undefined || v === null || v === '') return true
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

export const PLAN_TYPES = ['monthly', 'quarterly', 'annual', 'session_pack', 'family'] as const
export const PAYMENT_TYPES = ['new_plan', 'renewal', 'top_up'] as const
/** Payment methods that require a transaction reference number (for audit/traceability). */
export const PAYMENT_METHODS_REQUIRING_REF = ['gcash', 'maya', 'bank_transfer', 'card'] as const
export const PAYMENT_STATUSES = ['completed', 'refunded', 'voided'] as const
export const CHECKIN_STATUSES = ['success', 'failed', 'override'] as const
export const CHECKIN_METHODS = ['fingerprint', 'manual'] as const
export const STAFF_ROLES = ['admin', 'staff'] as const

/** Basic validation for member create/update payloads. Returns an error string or null. */
export function validateMember(v: Record<string, unknown>): string | null {
  if (!isNonEmptyString(v.name)) return 'Name is required.'
  if (v.member_id !== undefined && v.member_id !== '' && !isNonEmptyString(v.member_id)) return 'Member ID must be text.'
  if (!isDateStr(v.plan_start)) return 'Plan start must be a valid date.'
  if (!isDateStr(v.plan_end)) return 'Plan end must be a valid date.'
  if (v.height !== undefined && v.height !== null && v.height !== '' && !isNonNegativeNumber(Number(v.height))) return 'Height must be a non-negative number.'
  if (v.weight !== undefined && v.weight !== null && v.weight !== '' && !isNonNegativeNumber(Number(v.weight))) return 'Weight must be a non-negative number.'
  if (v.balance !== undefined && v.balance !== null && !isNonNegativeNumber(Number(v.balance))) return 'Balance must be a non-negative number.'
  return null
}

/** Basic validation for plan payloads. */
export function validatePlan(v: Record<string, unknown>): string | null {
  if (!isNonEmptyString(v.name)) return 'Plan name is required.'
  if (!PLAN_TYPES.includes(v.type as any)) return 'Invalid plan type.'
  if (!isNonNegativeNumber(Number(v.price))) return 'Price must be a non-negative number.'
  if (v.duration_days !== undefined && v.duration_days !== null && v.duration_days !== '' && !isPositiveNumber(Number(v.duration_days))) return 'Duration must be a positive number.'
  if (v.sessions !== undefined && v.sessions !== null && v.sessions !== '' && !isPositiveNumber(Number(v.sessions))) return 'Sessions must be a positive number.'
  return null
}

/** Basic validation for payment payloads. */
export function validatePayment(v: Record<string, unknown>): string | null {
  if (!isPositiveNumber(Number(v.amount))) return 'Payment amount must be greater than zero.'
  if (!PAYMENT_TYPES.includes(v.type as any)) return 'Invalid payment type.'
  if (v.payment_method !== undefined && v.payment_method !== '' && !isNonEmptyString(v.payment_method)) return 'Invalid payment method.'
  if (PAYMENT_METHODS_REQUIRING_REF.includes(v.payment_method as any) && !isNonEmptyString(v.transaction_ref)) {
    return 'A transaction reference number is required for this payment method.'
  }
  return null
}

/** Basic validation for coach payloads. */
export function validateCoach(v: Record<string, unknown>): string | null {
  if (!isNonEmptyString(v.name)) return 'Coach name is required.'
  if (v.professional_fee !== undefined && v.professional_fee !== null && !isNonNegativeNumber(Number(v.professional_fee))) return 'Professional fee must be a non-negative number.'
  return null
}

/** Basic validation for staff (user) payloads. */
export function validateUser(v: Record<string, unknown>, requirePassword: boolean): string | null {
  if (!isNonEmptyString(v.username)) return 'Username is required.'
  if (!STAFF_ROLES.includes(v.role as any)) return 'Invalid role.'
  if (requirePassword && (!isNonEmptyString(v.password) || String(v.password).length < 6)) return 'Password must be at least 6 characters.'
  if (!requirePassword && v.password !== undefined && v.password !== '' && String(v.password).length < 6) return 'Password must be at least 6 characters.'
  return null
}

/** Basic validation for check-in payloads. */
export function validateCheckin(v: Record<string, unknown>): string | null {
  if (!isFiniteNumber(v.member_id)) return 'Member id is required.'
  if (!CHECKIN_METHODS.includes(v.method as any)) return 'Invalid check-in method.'
  if (v.status !== undefined && !CHECKIN_STATUSES.includes(v.status as any)) return 'Invalid check-in status.'
  return null
}

/** Clamp a user-supplied number to a sane range. */
export function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Escape LIKE wildcards so user search text can't act as % / _ / \\ patterns. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`)
}
