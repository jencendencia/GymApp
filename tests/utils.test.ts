import { describe, it, expect } from 'vitest'
import {
  todayLocal,
  nowLocal,
  formatDateLocal,
  addDays,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeNumber,
  isPositiveNumber,
  isDateStr,
  validateMember,
  validatePlan,
  validatePayment,
  validateCoach,
  validateUser,
  validateCheckin,
  clampNumber,
} from '../electron/utils'

describe('date helpers (local time)', () => {
  it('formats a date as local YYYY-MM-DD', () => {
    expect(formatDateLocal(new Date(2026, 6, 31))).toBe('2026-07-31')
  })

  it('addDays adds calendar days', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01')
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('todayLocal and nowLocal return well-formed strings', () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(nowLocal()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})

describe('validation primitives', () => {
  it('isNonEmptyString', () => {
    expect(isNonEmptyString('abc')).toBe(true)
    expect(isNonEmptyString('   ')).toBe(false)
    expect(isNonEmptyString('')).toBe(false)
    expect(isNonEmptyString(5)).toBe(false)
  })

  it('isFiniteNumber / isNonNegativeNumber / isPositiveNumber', () => {
    expect(isFiniteNumber(3)).toBe(true)
    expect(isFiniteNumber(NaN)).toBe(false)
    expect(isFiniteNumber('3')).toBe(false)
    expect(isNonNegativeNumber(0)).toBe(true)
    expect(isNonNegativeNumber(-1)).toBe(false)
    expect(isPositiveNumber(1)).toBe(true)
    expect(isPositiveNumber(0)).toBe(false)
  })

  it('isDateStr tolerates empty values and validates YYYY-MM-DD', () => {
    expect(isDateStr(undefined)).toBe(true)
    expect(isDateStr('')).toBe(true)
    expect(isDateStr('2026-07-31')).toBe(true)
    expect(isDateStr('31/07/2026')).toBe(false)
    expect(isDateStr('2026-13-99')).toBe(false)
  })
})

describe('validateMember', () => {
  it('rejects missing name', () => {
    expect(validateMember({ name: '' })).toBe('Name is required.')
  })

  it('accepts a valid member payload', () => {
    expect(validateMember({ name: 'Joel', plan_start: '2026-07-01', plan_end: '2026-08-01', balance: 0 })).toBeNull()
  })

  it('rejects negative balance and bad dates', () => {
    expect(validateMember({ name: 'Joel', balance: -5 })).toBe('Balance must be a non-negative number.')
    expect(validateMember({ name: 'Joel', plan_end: 'garbage' })).toBe('Plan end must be a valid date.')
  })

  it('validates the referral referrer_id (P2 5.8)', () => {
    expect(validateMember({ name: 'Joel', referrer_id: 5 })).toBeNull()
    expect(validateMember({ name: 'Joel', referrer_id: 0 })).toBeNull()
    expect(validateMember({ name: 'Joel', referrer_id: undefined })).toBeNull()
    expect(validateMember({ name: 'Joel', referrer_id: -3 })).toBe('Invalid referrer.')
    expect(validateMember({ name: 'Joel', referrer_id: 'x' })).toBe('Invalid referrer.')
  })
})

describe('validatePlan / validatePayment / validateCoach', () => {
  it('validatePlan', () => {
    expect(validatePlan({ name: '', price: 100 })).toBe('Plan name is required.')
    expect(validatePlan({ name: 'M', type: 'monthly', price: 100 })).toBeNull()
    expect(validatePlan({ name: 'M', type: 'monthly', price: -1 })).toBe('Price must be a non-negative number.')
    expect(validatePlan({ name: 'M', type: 'weird', price: 100 })).toBe('Invalid plan type.')
  })

  it('validatePlan is type-aware about sessions and duration', () => {
    // Time-based plans default to 0 sessions — must be accepted (the create-plan bug fix).
    expect(validatePlan({ name: 'M', type: 'monthly', price: 100, duration_days: 30, sessions: 0 })).toBeNull()
    expect(validatePlan({ name: 'M', type: 'family', price: 100, duration_days: 30, sessions: 0 })).toBeNull()
    // Session packs require positive sessions.
    expect(validatePlan({ name: 'M', type: 'session_pack', price: 100, sessions: 0 })).toBe('Sessions must be a positive number.')
    expect(validatePlan({ name: 'M', type: 'session_pack', price: 100, sessions: 10 })).toBeNull()
    // Time-based plans require a positive duration.
    expect(validatePlan({ name: 'M', type: 'monthly', price: 100, duration_days: 0, sessions: 0 })).toBe('Duration must be a positive number.')
    // A session pack may have no fixed duration, but never a negative one.
    expect(validatePlan({ name: 'M', type: 'session_pack', price: 100, duration_days: 0, sessions: 10 })).toBeNull()
    expect(validatePlan({ name: 'M', type: 'session_pack', price: 100, duration_days: -5, sessions: 10 })).toBe('Duration must be a non-negative number.')
  })

  it('validatePayment', () => {
    expect(validatePayment({ amount: 0 })).toBe('Payment amount must be greater than zero.')
    expect(validatePayment({ amount: 50, type: 'renewal', payment_method: 'cash' })).toBeNull()
    expect(validatePayment({ amount: 50, type: 'bogus' })).toBe('Invalid payment type.')
  })

  it('requires a transaction reference for GCash / Maya / bank transfer / card', () => {
    const refMethods = ['gcash', 'maya', 'bank_transfer', 'card']
    for (const method of refMethods) {
      const base = { amount: 50, type: 'renewal', payment_method: method }
      expect(validatePayment(base)).toBe('A transaction reference number is required for this payment method.')
      expect(validatePayment({ ...base, transaction_ref: 'REF-123' })).toBeNull()
    }
    // cash never needs a ref
    expect(validatePayment({ amount: 50, type: 'renewal', payment_method: 'cash' })).toBeNull()
  })

  it('validateCoach', () => {
    expect(validateCoach({ name: '' })).toBe('Coach name is required.')
    expect(validateCoach({ name: 'Coach A', professional_fee: 100 })).toBeNull()
  })
})

describe('validateUser / validateCheckin', () => {
  it('requires username + strong password on create', () => {
    expect(validateUser({ username: '', role: 'admin' }, true)).toBe('Username is required.')
    expect(validateUser({ username: 'admin', role: 'admin', password: '123' }, true)).toBe('Password must be at least 6 characters.')
    expect(validateUser({ username: 'admin', role: 'admin', password: 'secret1' }, true)).toBeNull()
    expect(validateUser({ username: 'admin', role: 'hacker', password: 'secret1' }, true)).toBe('Invalid role.')
  })

  it('allows empty password on update but still enforces length when provided', () => {
    expect(validateUser({ username: 'admin', role: 'staff', password: '' }, false)).toBeNull()
    expect(validateUser({ username: 'admin', role: 'staff', password: 'abc' }, false)).toBe('Password must be at least 6 characters.')
  })

  it('validateCheckin', () => {
    expect(validateCheckin({ member_id: 1, method: 'fingerprint' })).toBeNull()
    expect(validateCheckin({ member_id: 'x', method: 'fingerprint' })).toBe('Member id is required.')
    expect(validateCheckin({ member_id: 1, method: 'magic' })).toBe('Invalid check-in method.')
  })
})

describe('clampNumber', () => {
  it('clamps within range and falls back on NaN', () => {
    expect(clampNumber(50, 1, 100, 30)).toBe(50)
    expect(clampNumber(999, 1, 100, 30)).toBe(100)
    expect(clampNumber('abc', 1, 100, 30)).toBe(30)
    expect(clampNumber(undefined, 1, 100, 30)).toBe(30)
  })
})
