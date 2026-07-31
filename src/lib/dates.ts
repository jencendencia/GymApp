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

/** Format any Date as a local YYYY-MM-DD string. */
export function todayLocalOf(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
