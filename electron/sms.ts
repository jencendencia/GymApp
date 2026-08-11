// ── Cloud SMS (PhilSMS) — PHILSMS_SETUP_GUIDE.md ──
//
// Deliveries are queued in the `sms_logs` table as PENDING and picked up by the
// queue worker every 1s. Failures retry up to MAX_ATTEMPTS times (800ms backoff)
// then flip to FAILED (retryable from the UI). When the delivery channel is
// 'simulator', messages are marked SENT without touching the network so the app
// can be tested with zero credits.
//
// Endpoints (dashboard host — app.philsms.com rejects tokens):
//   GET  https://dashboard.philsms.com/api/v3/balance
//   POST https://dashboard.philsms.com/api/v3/sms/send
//         Authorization: Bearer <api_token>
//         { recipient: 639171234567, sender_id: "TAPINSCHL",
//           type: "plain"|"unicode", message: "…" }
//
// Settings keys (all stored in the `settings` table):
//   smsChannel          'off' | 'simulator' | 'cloud'
//   cloudProvider       'philsms' (only provider today)
//   cloudApiKey         PhilSMS API token (stored encrypted — in SECRET_KEYS)
//   cloudSender         Sender ID (<= 11 chars, alphanumeric)
//   renewalSmsTemplate  Renewal-reminder template ({{gym}} {{name}} {{plan}}
//                       {{date}} {{days}})
//   receiptSmsTemplate  Payment-receipt template ({{gym}} {{name}} {{amount}}
//                       {{method}} {{type}} {{plan}} {{date}} {{ref}})
//
// Phone numbers are normalized automatically: 09171234567 → 639171234567.

import { BrowserWindow, net } from 'electron'
import type Database from 'better-sqlite3'
// Reuse the main process secret decryption (cloudApiKey is stored encrypted via
// safeStorage/DPAPI — SECRET_KEYS in main.ts) and its file logger. Both modules
// are bundled into a single dist-electron/main.js, and decryptSecret/logMain
// are only called at runtime, so the main ↔ sms circular import resolves safely.
import { decryptSecret, logMain } from './main'

const API_BASE = 'https://dashboard.philsms.com/api/v3'
const MAX_ATTEMPTS = 5
const POLL_MS = 1000
const RETRY_DELAY_MS = 800
const REQUEST_TIMEOUT_MS = 10000
const VERIFY_INTERVAL_MS = 60 * 1000
const VERIFY_FIRST_DELAY_MS = 3000

// Renewal-reminder SMS (manual run from Reports). Keep ASCII so each message
// costs 1 credit and passes telco filters. Placeholders: {{gym}} {{name}}
// {{plan}} {{date}} {{days}}.
export const SMS_RENEWAL_DEFAULT_TEMPLATE = 'Hi {{name}}, your {{plan}} membership at {{gym}} expires on {{date}} ({{days}} days left). Renew to keep your workouts going!'
// Payment-receipt SMS (queued automatically after every payment — Settings →
// SMS → Payment Receipt SMS Template). Keep ASCII so each message costs 1
// credit and passes telco filters. Placeholders: {{gym}} {{name}} {{amount}}
// {{method}} {{type}} {{plan}} {{date}} {{ref}}.
export const SMS_RECEIPT_DEFAULT_TEMPLATE = 'Hi {{name}}, payment received: {{amount}} ({{method}}). Thank you! - {{gym}}'

export interface SmsLogRow {
  id: number
  recipient: string
  sender_id: string
  message: string
  type: 'plain' | 'unicode'
  status: 'PENDING' | 'SENT' | 'FAILED'
  attempts: number
  last_error: string | null
  created_at: string
  sent_at: string | null
}

export type SmsStatusKind = 'off' | 'simulator' | 'not_configured' | 'ok' | 'no_credits' | 'rejected' | 'timeout' | 'error' | 'unknown'

export interface SmsStatus {
  verified: boolean
  kind: SmsStatusKind
  balance: number | null
  message: string
  checkedAt: number
}

interface SmsConfig {
  channel: 'off' | 'simulator' | 'cloud'
  provider: string
  apiKey: string
  sender: string
}

let dbRef: Database.Database | null = null
let workerStarted = false
let verifierStarted = false

let lastStatus: SmsStatus = {
  verified: false,
  kind: 'unknown',
  balance: null,
  message: 'SMS not configured',
  checkedAt: 0,
}

/** Attach the DB handle (called from main.ts after initDatabase). */
export function initSms(db: Database.Database) {
  dbRef = db
}

function getSetting(key: string): string {
  if (!dbRef) return ''
  const row = dbRef.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined
  if (!row?.value) return ''
  // cloudApiKey is stored encrypted (in SECRET_KEYS) — decrypt before use.
  return key === 'cloudApiKey' ? decryptSecret(row.value) : row.value
}

/** Current SMS delivery config, resolved from settings. */
export function getSmsConfig(): SmsConfig {
  const channel = getSetting('smsChannel')
  const channelNorm = channel === 'simulator' ? 'simulator' : channel === 'cloud' ? 'cloud' : 'off'
  return {
    channel: channelNorm,
    provider: getSetting('cloudProvider') || 'philsms',
    apiKey: getSetting('cloudApiKey') || '',
    sender: getSetting('cloudSender') || '',
  }
}

// ── Phone normalization ──
// Accepts 09xxxxxxxxx (11-digit PH mobile), 639xxxxxxxxx, +639xxxxxxxxx and the
// bare 10-digit form. Returns 639xxxxxxxxx or null when the number is unusable.
export function normalizePhPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let digits = String(raw).replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  if (digits.startsWith('63') && digits.length === 12) return digits
  if (digits.startsWith('0') && digits.length === 11) return '63' + digits.slice(1)
  if (digits.length === 10) return '63' + digits
  return null
}

// ── SMS type selection ──
// plain = ASCII (1 credit), unicode = anything else (2 credits + telco filters).
export function chooseSmsType(message: string): 'plain' | 'unicode' {
  return /^[\x00-\x7F]*$/.test(message) ? 'plain' : 'unicode'
}

// ── Template rendering ──
// Placeholders: {{gym}} {{name}} {{section}} {{action}} {{time}} {{flag}}
// {{plan}} {{date}} {{days}}. {{gym}} is the app/gym name from Settings;
// {{school}} is kept as an alias for templates saved before the rename.
// Unknown placeholders are left as-is; empty flags render as empty strings.
export function renderSmsTemplate(template: string, vars: Record<string, string>): string {
  const tokens: Record<string, string> = {
    '{{gym}}': vars.school ?? '',
    '{{school}}': vars.school ?? '',
    '{{name}}': vars.name ?? '',
    '{{section}}': vars.section ?? '',
    '{{action}}': vars.action ?? '',
    '{{time}}': vars.time ?? '',
    '{{flag}}': vars.flag ?? '',
    '{{plan}}': vars.plan ?? '',
    '{{date}}': vars.date ?? '',
    '{{days}}': vars.days ?? '',
    '{{amount}}': vars.amount ?? '',
    '{{method}}': vars.method ?? '',
    '{{type}}': vars.type ?? '',
    '{{ref}}': vars.ref ?? '',
  }
  let out = template
  for (const [token, value] of Object.entries(tokens)) {
    out = out.split(token).join(value)
  }
  return out.trim()
}

/** Sender ID resolution: configured sender → gym name (<= 11 chars) → PhilSMS. */
export function resolveSender(sender: string, schoolName: string): string {
  const cleaned = sender.trim()
  if (cleaned) return cleaned.slice(0, 11)
  const fallback = (schoolName || 'REPCHECK').trim().slice(0, 11)
  return fallback || 'PhilSMS'
}

// ── Low-level API calls (net.fetch + timeout) ──
interface ApiResult {
  status: number
  ok: boolean
  json: any
  text: string
  error?: string
}

async function apiFetch(path: string, token: string, init: { method: string; body?: string }): Promise<ApiResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await net.fetch(API_BASE + path, {
      method: init.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      body: init.body,
      signal: controller.signal,
    })
    const text = await res.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { status: res.status, ok: res.ok, json, text }
  } catch (error: any) {
    return { status: 0, ok: false, json: null, text: '', error: error?.message || 'Network error' }
  } finally {
    clearTimeout(timer)
  }
}

// ── Response parsing (PhilSMS v3) ──
// The dashboard API is Laravel-style and its response shapes aren't publicly
// documented, so parsing is deliberately defensive: accept the balance under a
// range of common key names at any nesting depth, and surface explicit API
// error messages when a 2xx body reports a failed request.

function readNumeric(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const t = value.trim()
    if (t === '') return null
    // PhilSMS returns formatted amounts like "₱119" or "1,200.50" — strip
    // currency symbols, commas and spaces before parsing.
    const cleaned = t.replace(/[^\d.\-]/g, '')
    if (cleaned !== '' && !isNaN(Number(cleaned))) return Number(cleaned)
  }
  return null
}

// Keys that commonly hold an account balance on PH SMS gateways.
const BALANCE_KEY_RE = /(^|_)(balance|credits?|wallet|points?|amount|remaining|available)(_|$)/i

function scanBalanceKeys(node: any): number | null {
  if (!node || typeof node !== 'object') return null
  for (const [key, value] of Object.entries(node)) {
    if (BALANCE_KEY_RE.test(key)) {
      const n = readNumeric(value)
      if (n !== null) return n
    }
  }
  return null
}

function deepFindBalance(node: any, depth = 0): number | null {
  if (depth > 6 || node === null || typeof node !== 'object') return null
  const direct = scanBalanceKeys(node)
  if (direct !== null) return direct
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const n = deepFindBalance(value, depth + 1)
      if (n !== null) return n
    }
  }
  return null
}

function extractBalance(json: any): number | null {
  if (json === null || json === undefined) return null
  // Bare numeric body (e.g. a raw 25.5 or "25.50")
  const bare = readNumeric(json)
  if (bare !== null) return bare
  if (typeof json !== 'object') return null
  // Fast path: common containers — top level, data, result (or data as number)
  const direct = scanBalanceKeys(json)
  if (direct !== null) return direct
  for (const container of [json.data, json.result]) {
    if (container && typeof container === 'object') {
      const n = scanBalanceKeys(container)
      if (n !== null) return n
    } else {
      const n = readNumeric(container)
      if (n !== null) return n
    }
  }
  // Slow path: any balance-ish key anywhere in the tree
  return deepFindBalance(json)
}

// Strict balance lookup for the SEND response only. The send endpoint echoes
// fields like `price`, `amount` and `credits_used`, which the broad balance
// scan would misfire on — so the remaining balance (if echoed at all) is read
// from an exact `balance` key at the top level / data / result.
function extractStrictBalance(json: any): number | null {
  if (!json || typeof json !== 'object') return null
  for (const obj of [json, json.data, json.result]) {
    if (!obj || typeof obj !== 'object') continue
    const n = readNumeric(obj.balance)
    if (n !== null) return n
  }
  return null
}

// Defensive error-message extraction for send failures.
function extractApiError(json: any, text: string): string {
  if (!json || typeof json !== 'object') {
    const clean = (text || '').trim()
    return clean.length > 0 && clean.length < 300 ? clean : 'Unknown PhilSMS error'
  }
  for (const key of ['message', 'error', 'errors', 'detail']) {
    const v = json[key]
    if (typeof v === 'string' && v) return v
    if (Array.isArray(v) && v.length > 0) return String(v[0])
  }
  if (json.data && typeof json.data === 'object') {
    for (const key of ['message', 'error', 'errors', 'detail']) {
      const v = json.data[key]
      if (typeof v === 'string' && v) return v
    }
  }
  return 'Unknown PhilSMS error'
}

/** Verify the PhilSMS token by checking the account balance (GET /api/v3/balance). */
export async function verifySmsConnection(): Promise<SmsStatus> {
  const cfg = getSmsConfig()
  const checkedAt = Date.now()
  if (cfg.channel === 'off' || !cfg.channel) {
    return { verified: false, kind: 'off', balance: null, message: 'SMS delivery is off — enable it in Settings', checkedAt }
  }
  if (cfg.channel === 'simulator') {
    return { verified: false, kind: 'simulator', balance: null, message: 'Simulator mode — messages are logged, not sent', checkedAt }
  }
  if (!cfg.apiKey) {
    return { verified: false, kind: 'not_configured', balance: null, message: 'Cloud SMS not configured — enter your PhilSMS API token', checkedAt }
  }
  const res = await apiFetch('/balance', cfg.apiKey, { method: 'GET' })
  if (res.error) {
    return { verified: false, kind: 'timeout', balance: null, message: 'Key verification timed out — the kiosk PC cannot reach dashboard.philsms.com (check internet/firewall)', checkedAt }
  }
  if (res.status === 401 || res.status === 403) {
    return { verified: false, kind: 'rejected', balance: null, message: 'PhilSMS rejected the API token (401) — re-check the token from the dashboard', checkedAt }
  }
  if (!res.ok) {
    return { verified: false, kind: 'error', balance: null, message: `PhilSMS balance check failed (HTTP ${res.status}) — ${extractApiError(res.json, res.text)}`, checkedAt }
  }
  const balance = extractBalance(res.json)
  if (balance === null) {
    const snippet = (res.text || '').replace(/\s+/g, ' ').trim().slice(0, 180)
    logMain('warn', 'PhilSMS balance response unrecognized', { status: res.status, body: res.text })
    // 2xx body that explicitly reports a failed request (e.g. invalid token)
    if (res.json && typeof res.json === 'object' && (res.json.success === false || res.json.status === 'error' || res.json.status === 'failed')) {
      const apiErr = extractApiError(res.json, res.text)
      const detail = apiErr !== 'Unknown PhilSMS error' ? apiErr : (snippet || '(empty body)')
      return { verified: false, kind: 'rejected', balance: null, message: `PhilSMS rejected the API token: ${detail}`, checkedAt }
    }
    // Otherwise surface the raw body so the actual response shape is visible
    // (and the full body is in the app log for diagnosis).
    return {
      verified: false,
      kind: 'error',
      balance: null,
      message: `Unexpected PhilSMS balance response — token may be invalid. Response: ${snippet || '(empty body)'}`,
      checkedAt,
    }
  }
  return {
    verified: true,
    kind: balance > 0 ? 'ok' : 'no_credits',
    balance,
    message: balance > 0
      ? `PhilSMS verified — balance ₱${balance.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : 'PhilSMS verified — no credits left, top up to send',
    checkedAt,
  }
}

/**
 * Send one SMS synchronously (used by the queue worker, the Settings test
 * button, and manual retries). Returns the provider result.
 */
export async function sendSmsNow(
  recipient: string,
  message: string,
  opts?: { sender?: string; token?: string; provider?: string; channel?: SmsConfig['channel'] }
): Promise<{ ok: boolean; error?: string; balance?: number | null }> {
  const cfg = getSmsConfig()
  const channel = opts?.channel ?? cfg.channel
  const token = opts?.token ?? cfg.apiKey
  const sender = opts?.sender ?? resolveSender(cfg.sender, getSetting('appName'))
  const school = getSetting('appName') || 'REPCHECK'
  const finalSender = sender || resolveSender('', school)
  const type = chooseSmsType(message)

  if (channel === 'simulator') {
    // Simulate a successful send with a tiny delay so the queue shows SENT.
    await new Promise((r) => setTimeout(r, 150))
    return { ok: true }
  }
  if (!token) {
    return { ok: false, error: 'No API key configured — paste your PhilSMS API token in Settings' }
  }

  const res = await apiFetch('/sms/send', token, {
    method: 'POST',
    body: JSON.stringify({ recipient, sender_id: finalSender, type, message }),
  })
  if (res.error) {
    return { ok: false, error: `Could not reach PhilSMS: ${res.error}` }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'PhilSMS rejected the API token (401) — check the token in Settings' }
  }
  if (res.ok) {
    // Strict lookup — the send response has price/amount/credits_used fields
    // that the broad balance scan would misread as the account balance.
    const balance = extractStrictBalance(res.json)
    return { ok: true, balance }
  }
  return { ok: false, error: extractApiError(res.json, res.text) }
}

/** Insert a message into sms_logs with the given status (used by queue + tests). */
function insertSmsLog(payload: {
  recipient: string
  message: string
  senderId?: string
  status?: 'PENDING' | 'SENT' | 'FAILED'
  attempts?: number
  lastError?: string | null
}): number | null {
  if (!dbRef) return null
  const cfg = getSmsConfig()
  const sender = payload.senderId || resolveSender(cfg.sender, getSetting('appName'))
  const type = chooseSmsType(payload.message)
  const status = payload.status || 'PENDING'
  const attempts = payload.attempts ?? 0
  const sentAt = status === 'SENT' ? new Date().toISOString() : null
  const res = dbRef.prepare(
    `INSERT INTO sms_logs (recipient, sender_id, message, type, status, attempts, last_error, created_at, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(payload.recipient, sender, payload.message, type, status, attempts, payload.lastError ?? null, new Date().toISOString(), sentAt)
  return Number(res.lastInsertRowid)
}

/** Insert a PENDING message into sms_logs (fire-and-forget, worker sends it). */
export function queueSms(payload: { recipient: string; message: string; senderId?: string }): number | null {
  return insertSmsLog({ ...payload, status: 'PENDING', attempts: 0 })
}

/**
 * Queue a renewal-reminder SMS for a member (manual run from Reports →
 * "Send Reminders"). Targets members expiring within 3 days (the 3/1-day
 * escalation window); the actual send happens via the queue worker, so
 * retries, the simulator, and the outbox all behave like the SMS queue.
 * Gated on the delivery channel; returns the sms_logs id or null when
 * skipped (no phone / channel off / empty message).
 */
export function queueRenewalSms(
  member: { id: number; name: string; phone?: string | null; plan_end?: string | null },
  planName: string,
  daysLeft: number
): number | null {
  if (!dbRef) return null
  const cfg = getSmsConfig()
  if (cfg.channel === 'off') return null
  const recipient = normalizePhPhone(member.phone)
  if (!recipient) return null
  const school = getSetting('appName') || 'REPCHECK'
  const template = getSetting('renewalSmsTemplate') || SMS_RENEWAL_DEFAULT_TEMPLATE
  const dateLabel = member.plan_end
    ? new Date(member.plan_end + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : ''
  const message = renderSmsTemplate(template, {
    school,
    name: member.name,
    plan: planName || 'membership',
    date: dateLabel,
    days: String(Math.max(0, Math.round(daysLeft))),
  })
  if (!message) return null
  return queueSms({ recipient, message })
}

/**
 * Queue a payment-receipt SMS for a member (automatic — fired right after a
 * payment is recorded: new plan, renewal, top-up, and auto-renewal). Gated on
 * the delivery channel; the actual send happens via the queue worker, so
 * retries, the simulator, and the outbox all behave like the SMS queue.
 * Returns the sms_logs id or null when skipped (no phone / channel off /
 * empty message). Amount/method are pre-formatted; the member row is expected
 * to carry `name` / `phone` / `plan_name` (see getPaymentReceiptRow in main).
 */
export function queuePaymentReceiptSms(payment: {
  amount?: number
  type?: string
  payment_method?: string | null
  transaction_ref?: string | null
  plan_name?: string | null
  member_name?: string | null
  member_phone?: string | null
}): number | null {
  if (!dbRef) return null
  const cfg = getSmsConfig()
  if (cfg.channel === 'off') return null
  // Fields come from getPaymentReceiptRow in main (member columns aliased as
  // member_name / member_phone), matching sendReceiptEmail's row shape.
  const recipient = normalizePhPhone(payment.member_phone)
  if (!recipient) return null
  const school = getSetting('appName') || 'REPCHECK'
  const template = getSetting('receiptSmsTemplate') || SMS_RECEIPT_DEFAULT_TEMPLATE
  const amountLabel = Number(payment.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const methodLabel = (payment.payment_method || 'cash').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const typeLabel = payment.type === 'new_plan' ? 'New Plan' : payment.type === 'renewal' ? 'Renewal' : 'Top Up'
  const dateLabel = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const message = renderSmsTemplate(template, {
    school,
    name: payment.member_name || '',
    amount: amountLabel,
    method: methodLabel,
    type: typeLabel,
    plan: payment.plan_name || '',
    date: dateLabel,
    ref: payment.transaction_ref || '',
  })
  if (!message) return null
  return queueSms({ recipient, message })
}

// ── Queue worker (1s poll, retry up to 5× with 800ms backoff, then FAILED) ──
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// Re-entrancy guard: a tick can take far longer than the 1s interval (up to
// 5 attempts × (10s request timeout + 800ms backoff) per message), so without
// this the next setInterval tick would start concurrently, re-select the same
// PENDING rows, and double-send every message.
let tickRunning = false

async function processQueueTick() {
  if (!dbRef || tickRunning) return
  tickRunning = true
  try {
    const cfg = getSmsConfig()
    if (cfg.channel === 'off') return

    const rows = dbRef.prepare(
      `SELECT * FROM sms_logs WHERE status = 'PENDING' ORDER BY id ASC LIMIT 10`
    ).all() as SmsLogRow[]

    let changed = false
    for (const row of rows) {
      if (cfg.channel === 'simulator') {
        dbRef.prepare(
          `UPDATE sms_logs SET status = 'SENT', attempts = attempts + 1, sent_at = ?, last_error = NULL WHERE id = ?`
        ).run(new Date().toISOString(), row.id)
        changed = true
        continue
      }
      if (!cfg.apiKey) {
        dbRef.prepare(
          `UPDATE sms_logs SET status = 'FAILED', attempts = attempts + 1, last_error = ? WHERE id = ?`
        ).run('No API key configured — add your PhilSMS token in Settings', row.id)
        changed = true
        continue
      }

      let lastError = ''
      let ok = false
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const result = await sendSmsNow(row.recipient, row.message, { token: cfg.apiKey })
        if (result.ok) {
          ok = true
          break
        }
        lastError = result.error || 'Unknown error'
        if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS)
      }

      if (ok) {
        dbRef.prepare(
          `UPDATE sms_logs SET status = 'SENT', attempts = attempts + 1, sent_at = ?, last_error = NULL WHERE id = ?`
        ).run(new Date().toISOString(), row.id)
      } else {
        dbRef.prepare(
          `UPDATE sms_logs SET status = 'FAILED', attempts = attempts + 1, last_error = ? WHERE id = ?`
        ).run(lastError.slice(0, 500), row.id)
      }
      changed = true
    }
    if (changed) broadcastSmsStatus()
  } finally {
    tickRunning = false
  }
}

export function startSmsQueueWorker(db: Database.Database) {
  initSms(db)
  if (workerStarted) return
  workerStarted = true
  setInterval(() => {
    processQueueTick().catch((error: any) => {
      // never let a queue error crash the main process
      console.error('SMS queue tick error:', error)
    })
  }, POLL_MS)
}

// ── Status broadcast (kiosk header dot, Settings card, …) ──
export function broadcastSmsStatus() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('sms-status', lastStatus)
    }
  }
}

/** Re-run verification and broadcast the fresh status to every window. */
export async function refreshSmsStatus(): Promise<SmsStatus> {
  lastStatus = await verifySmsConnection()
  broadcastSmsStatus()
  return lastStatus
}

export function getCurrentSmsStatus(): SmsStatus {
  return { ...lastStatus }
}

/** Periodic verifier: shortly after boot, then every 60s. */
export function startSmsVerifier(db: Database.Database) {
  initSms(db)
  if (verifierStarted) return
  verifierStarted = true
  setTimeout(() => {
    refreshSmsStatus().catch(() => {})
  }, VERIFY_FIRST_DELAY_MS)
  setInterval(() => {
    refreshSmsStatus().catch(() => {})
  }, VERIFY_INTERVAL_MS)
}

// ── Manual retry (SMS Outbox / Settings) ──
export function retrySmsLog(id: number): void {
  if (!dbRef) return
  dbRef.prepare(
    `UPDATE sms_logs SET status = 'PENDING', attempts = 0, last_error = NULL WHERE id = ?`
  ).run(id)
}

export function getSmsLogs(limit = 50): SmsLogRow[] {
  if (!dbRef) return []
  return dbRef.prepare(`SELECT * FROM sms_logs ORDER BY id DESC LIMIT ?`).all(limit) as SmsLogRow[]
}

/** Send a one-off test SMS and record it in sms_logs (used by Settings). */
export async function sendTestSms(recipientRaw: string): Promise<{ success: boolean; message: string; id?: number }> {
  const recipient = normalizePhPhone(recipientRaw)
  if (!recipient) {
    return { success: false, message: 'Invalid recipient — use a Philippine mobile number like 09171234567' }
  }
  const cfg = getSmsConfig()
  if (cfg.channel === 'off') {
    return { success: false, message: 'SMS delivery is off — enable Simulator or Cloud SMS first' }
  }
  const school = getSetting('appName') || 'REPCHECK'
  // Fixed gateway test message — SMS is used for renewal reminders and payment
  // receipts only, so the check does not depend on any message template.
  const message = `This is a test SMS from ${school}. Your SMS gateway is working!`
  // Send synchronously, then log the row with its FINAL status (never re-queued,
  // so a successful test isn't sent twice by the worker).
  const result = await sendSmsNow(recipient, message)
  const id = insertSmsLog({
    recipient,
    message,
    status: result.ok ? 'SENT' : 'FAILED',
    attempts: 1,
    lastError: result.ok ? null : result.error || 'unknown error',
  })
  if (result.ok) {
    return {
      success: true,
      id: id ?? undefined,
      message: cfg.channel === 'simulator'
        ? 'Test SMS sent (simulator) — logged as SENT without using credits'
        : 'Test SMS sent successfully' + (result.balance != null ? ` — balance ₱${result.balance}` : ''),
    }
  }
  return { success: false, id: id ?? undefined, message: `Test SMS failed: ${result.error || 'unknown error'}` }
}
