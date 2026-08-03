/** Local-time YYYY-MM-DD for "today" (P1 4.6 — fixes UTC rollover so "today" resets at local midnight, e.g. PH +8). */
export function todayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Add N days to a Date and return its local YYYY-MM-DD. */
export function addDaysLocal(d: Date, days: number): string {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  return todayLocalOf(next)
}

/** Compute a plan's end date from its type and a local YYYY-MM-DD start date.
 * - Per-session (single-session) passes are valid for one day → start + 1.
 * - Multi-session packs have no time-based end → '' (valid until sessions run out).
 * - Duration plans (monthly/quarterly/annual/family) → start + duration_days.
 * Returns '' when the plan or start is missing (callers treat '' as 'no end date').
 */
export function planEndDate(
  plan: { type?: string; duration_days?: number | null; sessions?: number | null } | null | undefined,
  start: string
): string {
  if (!plan || !start) return ''
  if (plan.type === 'session_pack') {
    return Number(plan.sessions) === 1 ? addDaysLocal(new Date(`${start}T00:00:00`), 1) : ''
  }
  const days = Number(plan.duration_days) || 0
  return days > 0 ? addDaysLocal(new Date(`${start}T00:00:00`), days) : ''
}

/** Format any Date as a local YYYY-MM-DD string. */
export function todayLocalOf(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
