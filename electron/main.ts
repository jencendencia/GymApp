import { app, BrowserWindow, ipcMain, dialog, screen, session, shell, safeStorage, protocol, net } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import Database from 'better-sqlite3'
import AdmZip from 'adm-zip'
import nodemailer from 'nodemailer'
import { autoUpdater } from 'electron-updater'
import { todayLocal, nowLocal, validateMember, validatePlan, validatePayment, validateCoach, validateUser, validateCheckin, clampNumber, isNonEmptyString, escapeLike, addDays } from './utils'

let mainWindow: BrowserWindow | null = null
let kioskWindow: BrowserWindow | null = null
let db: Database.Database | null = null

// ── App icon ──
// Resolve the icon path for the window/taskbar. Works in dev (project root) and
// in the packaged app where Repcheck_icon.png is bundled at the app root.
function appIconPath(): string {
  return path.join(__dirname, '../Repcheck_icon.png')
}

// ── Password hashing (scrypt with per-user salt) ──
const SCRYPT_KEYLEN = 64
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 }
const SCRYPT_PREFIX = 'scrypt$'

// Hash a password into the portable format: scrypt$N$r$p$saltHex$hashHex
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS)
  return `${SCRYPT_PREFIX}${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('hex')}$${hash.toString('hex')}`
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

// Verify a password against a stored hash. Supports both the new scrypt format
// and legacy unsalted SHA-256 hashes (so existing users can still log in).
function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || typeof stored !== 'string') return false
  if (stored.startsWith(SCRYPT_PREFIX)) {
    const parts = stored.split('$')
    if (parts.length !== 6) return false
    const n = Number(parts[1])
    const r = Number(parts[2])
    const p = Number(parts[3])
    const salt = Buffer.from(parts[4], 'hex')
    const expected = Buffer.from(parts[5], 'hex')
    if (!n || !r || !p || salt.length === 0 || expected.length === 0) return false
    try {
      const actual = crypto.scryptSync(password, salt, expected.length, { N: n, r, p })
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
    } catch {
      return false
    }
  }
  // Legacy SHA-256 hash
  const legacy = crypto.createHash('sha256').update(password).digest('hex')
  return timingSafeEqualStr(legacy, stored)
}

// ── Secret settings encryption at rest (Electron safeStorage / DPAPI on Windows) ──
// Secrets (SMTP password, owner email) are stored in the DB encrypted with safeStorage
// so a copied database file doesn't leak credentials. Values are prefixed so we can
// distinguish ciphertext from legacy plaintext and from non-secret settings.
const SECRET_PREFIX = 'enc:v1:'
const SECRET_KEYS = new Set(['smtpPass', 'reportOwnerEmail', 'backupPassword'])

function isSecretSetting(key: string): boolean {
  return SECRET_KEYS.has(key)
}

function encryptSecret(value: string): string {
  if (!value) return value
  if (value.startsWith(SECRET_PREFIX)) return value // already encrypted
  if (!safeStorage.isEncryptionAvailable()) {
    logMain('warn', 'safeStorage unavailable — storing secret in plaintext')
    return value
  }
  try {
    const buf = safeStorage.encryptString(value)
    return SECRET_PREFIX + buf.toString('base64')
  } catch (error: any) {
    logMain('error', 'Failed to encrypt secret setting', { error: error.message })
    return value
  }
}

function decryptSecret(value: string | null | undefined): string {
  if (!value) return value || ''
  if (!value.startsWith(SECRET_PREFIX)) return value // legacy plaintext or non-secret
  if (!safeStorage.isEncryptionAvailable()) {
    logMain('warn', 'safeStorage unavailable — cannot decrypt secret')
    return ''
  }
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(SECRET_PREFIX.length), 'base64'))
  } catch (error: any) {
    // e.g. DB copied to another machine/user where DPAPI cannot decrypt
    logMain('error', 'Failed to decrypt secret setting', { error: error.message })
    return ''
  }
}

// ── Login rate limiting (in-memory, per-username lockout) ──
const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000 // 15 minutes
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>()

function recordFailedLogin(username: string) {
  const key = username.toLowerCase()
  const now = Date.now()
  const entry = loginAttempts.get(key)
  if (!entry || now > entry.lockedUntil) {
    loginAttempts.set(key, { count: 1, lockedUntil: 0 })
    return
  }
  const count = entry.count + 1
  const lockedUntil = count >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCKOUT_MS : entry.lockedUntil
  loginAttempts.set(key, { count, lockedUntil })
}

// ── Structured file logging (P2 6.8) ──
// Writes rotating JSONL logs to userData/logs/repcheck.log (max ~2MB per file, keeps 3).
function logMain(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(logDir, { recursive: true })
    const file = path.join(logDir, 'repcheck.log')
    const line = JSON.stringify({ ts: new Date().toISOString(), level, message, meta })
    fs.appendFileSync(file, line + '\n')
    // Rotate when file exceeds ~2MB
    if (fs.statSync(file).size > 2 * 1024 * 1024) {
      fs.renameSync(file, `${file}.1`)
      try { fs.renameSync(`${file}.1`, `${file}.2`) } catch { /* keep oldest */ }
    }
  } catch {
    // logging must never crash the app
  }
}

// Returns remaining lockout ms (0 if not locked)
function isLoginLocked(username: string): number {
  const key = username.toLowerCase()
  const entry = loginAttempts.get(key)
  if (!entry || !entry.lockedUntil) return 0
  const now = Date.now()
  if (now < entry.lockedUntil) return entry.lockedUntil - now
  loginAttempts.delete(key)
  return 0
}

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'repcheck.db')
  db = new Database(dbPath)
  
  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL')
  // Enforce foreign key constraints (P1 3.4) — soft-deletes keep history and prevent orphans
  db.pragma('foreign_keys = ON')

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('monthly', 'quarterly', 'annual', 'session_pack', 'family')),
      duration_days INTEGER,
      sessions INTEGER,
      price REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS coaches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      specialty TEXT,
      professional_fee REAL DEFAULT 0,
      archived INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      photo TEXT,
      emergency_contact TEXT,
      emergency_phone TEXT,
      plan_id INTEGER,
      plan_start DATE,
      plan_end DATE,
      height REAL,
      weight REAL,
      birthday DATE,
      coach_id INTEGER,
      coaching_start DATE,
      coaching_end DATE,
      sessions_used INTEGER DEFAULT 0,
      balance REAL DEFAULT 0,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'expired')),
      archived INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (plan_id) REFERENCES plans(id),
      FOREIGN KEY (coach_id) REFERENCES coaches(id)
    );

    CREATE TABLE IF NOT EXISTS fingerprint_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      template BLOB NOT NULL,
      quality REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id)
    );

    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      method TEXT NOT NULL CHECK(method IN ('fingerprint', 'manual')),
      match_confidence REAL,
      status TEXT DEFAULT 'success' CHECK(status IN ('success', 'failed', 'override')),
      FOREIGN KEY (member_id) REFERENCES members(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('new_plan', 'renewal', 'top_up')),
      plan_id INTEGER,
      payment_method TEXT DEFAULT 'cash',
      transaction_ref TEXT,
      staff_id INTEGER,
      status TEXT DEFAULT 'completed' CHECK(status IN ('completed', 'refunded', 'voided')),
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id),
      FOREIGN KEY (plan_id) REFERENCES plans(id)
    );

    CREATE TABLE IF NOT EXISTS coach_fee_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coach_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (coach_id) REFERENCES coaches(id),
      FOREIGN KEY (member_id) REFERENCES members(id)
    );

    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'staff' CHECK(role IN ('admin', 'staff')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      user TEXT DEFAULT 'staff',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'renewal_reminder',
      channel TEXT NOT NULL DEFAULT 'email',
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id)
    );

    -- Guest / trial check-ins (P2 5.1) — day-pass or trial visitors without a full member record
    CREATE TABLE IF NOT EXISTS guest_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      type TEXT NOT NULL DEFAULT 'guest' CHECK(type IN ('guest', 'trial')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // Migrate existing databases: add columns if they don't exist
  const columnsToAdd = [
    { table: 'members', column: 'height', def: 'REAL DEFAULT NULL' },
    { table: 'members', column: 'weight', def: 'REAL DEFAULT NULL' },
    { table: 'members', column: 'birthday', def: 'DATE DEFAULT NULL' },
    { table: 'members', column: 'coach_id', def: 'INTEGER DEFAULT NULL REFERENCES coaches(id)' },
    { table: 'members', column: 'coaching_start', def: 'DATE DEFAULT NULL' },
    { table: 'members', column: 'coaching_end', def: 'DATE DEFAULT NULL' },
    { table: 'coaches', column: 'professional_fee', def: 'REAL DEFAULT 0' },
    { table: 'payments', column: 'payment_method', def: 'TEXT DEFAULT \'cash\'' },
    { table: 'payments', column: 'transaction_ref', def: 'TEXT DEFAULT NULL' },
    { table: 'payments', column: 'staff_id', def: 'INTEGER DEFAULT NULL' },
    { table: 'checkins', column: 'checked_out_at', def: 'DATETIME DEFAULT NULL' },
    { table: 'members', column: 'waiver_agreed_at', def: 'DATETIME DEFAULT NULL' },
    { table: 'staff', column: 'photo', def: 'TEXT DEFAULT NULL' },
    { table: 'staff', column: 'display_name', def: 'TEXT DEFAULT NULL' },
    { table: 'members', column: 'archived', def: 'INTEGER DEFAULT 0' },
    { table: 'coaches', column: 'archived', def: 'INTEGER DEFAULT 0' },
    { table: 'payments', column: 'status', def: "TEXT DEFAULT 'completed'" },
    { table: 'payments', column: 'note', def: 'TEXT DEFAULT NULL' },
    // P2 5.2: auto-renew flag — renews the plan automatically on expiry
    { table: 'members', column: 'auto_renew', def: 'INTEGER DEFAULT 0' },
  ]

  for (const col of columnsToAdd) {
    try {
      db!.exec(`ALTER TABLE ${col.table} ADD COLUMN ${col.column} ${col.def}`)
    } catch {
      // Column already exists — ignore
    }
  }

  // Seed default admin if no staff exist
  const staffCount = db?.prepare('SELECT COUNT(*) as count FROM staff').get() as any
  if (staffCount && staffCount.count === 0) {
    const hash = hashPassword('admin')
    db?.prepare('INSERT INTO staff (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)')
      .run('admin', hash, 'admin', 'Administrator')
    logMain('info', 'Default admin user created (admin/admin)')
  }

  // ── Indexes on hot query columns (P1 4.1) ──
  db!.exec(`
    CREATE INDEX IF NOT EXISTS idx_checkins_member ON checkins(member_id);
    CREATE INDEX IF NOT EXISTS idx_checkins_timestamp ON checkins(timestamp);
    CREATE INDEX IF NOT EXISTS idx_payments_member ON payments(member_id);
    CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);
    CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
    CREATE INDEX IF NOT EXISTS idx_members_plan_end ON members(plan_end);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);
  `)

  // ── Versioned migrations (P2 6.7) — bump PRAGMA user_version as schema evolves ──
  // P1 4.5: migrate any legacy base64 member photos to disk at startup
  migratePhotosToDisk()

  const runMigrations = () => {
    const row = db!.prepare('PRAGMA user_version').get() as any
    const current = row?.user_version ?? 0
    if (current < 1) {
      // v1: soft-delete flags + payment status
      const cols = [
        { table: 'members', column: 'archived', def: 'INTEGER DEFAULT 0' },
        { table: 'coaches', column: 'archived', def: 'INTEGER DEFAULT 0' },
        { table: 'payments', column: 'status', def: "TEXT DEFAULT 'completed'" },
        { table: 'payments', column: 'note', def: 'TEXT DEFAULT NULL' },
      ]
      for (const c of cols) {
        try {
          db!.exec(`ALTER TABLE ${c.table} ADD COLUMN ${c.column} ${c.def}`)
        } catch {
          // column exists
        }
      }
      db!.pragma('user_version = 1')
      logMain('info', 'DB migration to v1 applied')
    }
  }
  runMigrations()

  // One-time hardening: encrypt any legacy plaintext secret settings at startup so
  // existing databases are protected immediately (not only after the next Save).
  if (safeStorage.isEncryptionAvailable()) {
    SECRET_KEYS.forEach((key) => {
      try {
        const row = db!.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
        if (row?.value && typeof row.value === 'string' && !row.value.startsWith(SECRET_PREFIX)) {
          const encrypted = encryptSecret(row.value)
          if (encrypted.startsWith(SECRET_PREFIX)) {
            db!.prepare('UPDATE settings SET value = ? WHERE key = ?').run(encrypted, key)
            logMain('info', 'Encrypted legacy secret setting', { key })
          }
        }
      } catch (error: any) {
        logMain('error', 'Failed to encrypt legacy secret setting', { key, error: (error as Error).message })
      }
    })
  }

  return db
}

// ── Member photos on disk (P1 4.5) ──
// Photos are written to userData/photos/ and referenced via a repcheck-photo:// URL,
// so the SQLite DB no longer grows with base64 blobs. Legacy base64 values are
// migrated at startup (initDatabase) and again after a restore.
const PHOTO_PROTOCOL = 'repcheck-photo'

// Register the custom scheme as standard + secure so repcheck-photo:// URLs are
// parsed with the filename in the path and are allowed to load in <img> tags.
// Must be called at module scope (before the app 'ready' event).
protocol.registerSchemesAsPrivileged([
  { scheme: PHOTO_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

function photoDir(): string {
  return path.join(app.getPath('userData'), 'photos')
}

function ensurePhotoDir() {
  fs.mkdirSync(photoDir(), { recursive: true })
}

// Save a base64 data-URL photo to disk and return a repcheck-photo:// URL.
// Non-data values (already URLs, empty, null) are returned unchanged.
function savePhotoToDisk(photo: string | null | undefined): string | null {
  if (!photo) return null
  if (!photo.startsWith('data:')) return photo
  try {
    ensurePhotoDir()
    const match = photo.match(/^data:image\/([a-zA-Z+]+);base64,([\s\S]+)$/)
    if (!match) return photo
    const rawExt = match[1].toLowerCase()
    const ext = rawExt === 'jpeg' ? 'jpg' : rawExt === 'svg+xml' ? 'svg' : rawExt.replace('+', '-')
    const buf = Buffer.from(match[2], 'base64')
    const filename = `member-${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`
    fs.writeFileSync(path.join(photoDir(), filename), buf)
    return `${PHOTO_PROTOCOL}://${filename}`
  } catch (error: any) {
    logMain('error', 'Failed to save photo to disk', { error: error.message })
    return photo // fall back to the base64 value so nothing breaks
  }
}

// Migrate legacy base64 member photos to disk (also re-run after a restore).
function migratePhotosToDisk() {
  try {
    const rows = db!.prepare("SELECT id, photo FROM members WHERE photo IS NOT NULL AND photo LIKE 'data:%'").all() as any[]
    let migrated = 0
    for (const row of rows) {
      const url = savePhotoToDisk(row.photo)
      if (url && url !== row.photo) {
        db!.prepare('UPDATE members SET photo = ? WHERE id = ?').run(url, row.id)
        migrated++
      }
    }
    if (migrated > 0) logMain('info', 'Migrated member photos to disk', { count: migrated })
  } catch (error: any) {
    logMain('error', 'Photo migration failed', { error: error.message })
  }
}

// Serve repcheck-photo://<filename> from the photos dir (path-traversal safe).
function registerPhotoProtocol() {
  protocol.handle(PHOTO_PROTOCOL, (request) => {
    try {
      const url = new URL(request.url)
      // Accept both repcheck-photo://photo/<file> (path-style) and the host-style
      // repcheck-photo://<file> written by older saves.
      const raw = url.pathname && url.pathname !== '/' ? url.pathname : url.hostname
      const filename = path.basename(decodeURIComponent(raw))
      const filePath = path.join(photoDir(), filename)
      // Guard: resolved path must stay inside the photos dir
      if (!filePath.startsWith(path.join(photoDir(), ''))) {
        return new Response('Not found', { status: 404 })
      }
      if (!fs.existsSync(filePath)) {
        return new Response('Not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })
}

// ── Utility: Generate a unique machine ID ──
function getMachineId(): string {
  const raw = `${os.hostname()}-${os.platform()}-${app.getPath('userData')}`
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i)
    hash = hash & hash
  }
  return `${Math.abs(hash).toString(16).padStart(8, '0')}-${os.hostname().slice(0, 8).padEnd(8, '_')}`
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'REPCHECK',
    icon: appIconPath(),
    backgroundColor: '#101215',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    frame: false,
    titleBarStyle: 'hidden',
  })

  // Auto-updater setup
  setupAutoUpdater()

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // If the main window closes, also close the kiosk window
  mainWindow.on('closed', () => {
    if (kioskWindow && !kioskWindow.isDestroyed()) {
      kioskWindow.close()
      kioskWindow = null
    }
    mainWindow = null
  })
}

// ── Kiosk Window (external monitor) ──
function createKioskWindow() {
  // If already open, just focus it
  if (kioskWindow && !kioskWindow.isDestroyed()) {
    kioskWindow.focus()
    return
  }

  // Find the best display for the kiosk
  // We look for a display NOT at x:0 (the primary/original display is always at x=0)
  const displays = screen.getAllDisplays()
  console.log('Available displays:', displays.length, displays.map(d => ({ bounds: d.bounds })))
  const secondaryDisplay = displays.find(d => d.bounds.x !== 0) || displays[0]
  console.log('Target display for kiosk:', secondaryDisplay.bounds)

  kioskWindow = new BrowserWindow({
    title: 'REPCHECK Kiosk',
    frame: false,
    resizable: false,
    alwaysOnTop: false,
    icon: appIconPath(),
    backgroundColor: '#101215',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // Load the app with kiosk mode query param
  const kioskUrl = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}?mode=kiosk`
    : `file://${path.join(__dirname, '../dist/index.html').replace(/\\/g, '/')}?mode=kiosk`
  kioskWindow.loadURL(kioskUrl)

  // Once ready, position on the secondary display and show
  kioskWindow.once('ready-to-show', () => {
    const currentDisplays = screen.getAllDisplays()
    const target = currentDisplays.find(d => d.bounds.x !== 0) || currentDisplays[0]
    console.log('Moving kiosk to display:', target.bounds)
    kioskWindow?.setBounds(target.bounds)
    kioskWindow?.show()
  })

  kioskWindow.on('closed', () => {
    kioskWindow = null
  })
}

// ── Kiosk Auto-Launch ──
function setupKioskAutoLaunch() {
  // Check for secondary display on startup (look for display NOT at x:0)
  const checkAndLaunch = () => {
    const displays = screen.getAllDisplays()
    const hasSecondary = displays.some(d => d.bounds.x !== 0)
    if (hasSecondary && mainWindow && !mainWindow.isDestroyed()) {
      createKioskWindow()
    }
  }

  // Check immediately on startup (with a small delay to let the main window settle)
  setTimeout(checkAndLaunch, 1500)

  // Listen for new displays being added (monitor plugged in)
  screen.on('display-added', () => {
    console.log('Display added — auto-launching kiosk window')
    createKioskWindow()
  })

  // Listen for displays being removed (monitor unplugged)
  screen.on('display-removed', () => {
    const displays = screen.getAllDisplays()
    const hasSecondary = displays.some(d => d.bounds.x !== 0)
    if (!hasSecondary && kioskWindow && !kioskWindow.isDestroyed()) {
      console.log('Secondary display removed — closing kiosk window')
      kioskWindow.close()
      kioskWindow = null
    }
  })
}

// ── Auto-renewal (P2 5.2): members flagged auto_renew are renewed automatically ──
// When a member's plan lapses and they have auto-renew enabled + a plan with a duration,
// a renewal payment is recorded and the plan_end is extended. Runs inside autoExpireMembers.
function processAutoRenewals() {
  const due = db?.prepare(`
    SELECT m.id, m.member_id, m.name, m.plan_end, p.duration_days, p.price, p.id as plan_id
    FROM members m
    LEFT JOIN plans p ON m.plan_id = p.id
    WHERE m.auto_renew = 1 AND m.status = 'active' AND m.archived = 0
      AND m.plan_end IS NOT NULL AND m.plan_end != '' AND m.plan_end < date('now', 'localtime')
      AND p.duration_days IS NOT NULL AND p.duration_days > 0
  `).all() as any[] || []
  for (const m of due) {
    try {
      const start = m.plan_end
      const end = addDays(start, m.duration_days)
      // Record the renewal payment (method 'auto') and extend the plan
      db?.prepare(`INSERT INTO payments (member_id, amount, type, plan_id, payment_method, status, note)
        VALUES (?, ?, 'renewal', ?, 'auto', 'completed', ?)`)
        .run(m.id, m.price, m.plan_id, `Auto-renewed from ${start}`)
      db?.prepare(`UPDATE members SET plan_start = ?, plan_end = ?, sessions_used = 0, status = 'active' WHERE id = ?`)
        .run(start, end, m.id)
      db?.prepare(`INSERT INTO activity_logs (action, entity_type, entity_id, details, user)
        VALUES ('auto_renewal', 'member', ?, ?, 'system')`)
        .run(m.id, JSON.stringify({ member_name: m.name, plan_end: end, amount: m.price }))
      logMain('info', 'Auto-renewed member', { id: m.id, name: m.name, newEnd: end })
    } catch (error: any) {
      logMain('error', 'Auto-renewal failed', { id: m.id, error: error.message })
    }
  }
}

// Auto-expire members whose plan_end has passed (local-time aware)
function autoExpireMembers() {
  // Renew auto-renew members first so they stay active (P2 5.2)
  processAutoRenewals()
  db?.prepare(`
    UPDATE members SET status = 'expired'
    WHERE plan_end IS NOT NULL AND plan_end < date('now', 'localtime') AND status = 'active' AND archived = 0
      AND (auto_renew IS NULL OR auto_renew = 0)
  `).run()
}

// ── SMTP Email (module scope — shared by manual sends and the auto daily report) ──
function createSmtpTransport() {
  const host = db?.prepare('SELECT value FROM settings WHERE key = ?').get('smtpHost') as any
  const port = db?.prepare('SELECT value FROM settings WHERE key = ?').get('smtpPort') as any
  const user = db?.prepare('SELECT value FROM settings WHERE key = ?').get('smtpUser') as any
  const pass = db?.prepare('SELECT value FROM settings WHERE key = ?').get('smtpPass') as any
  const fromEmail = db?.prepare('SELECT value FROM settings WHERE key = ?').get('smtpFromEmail') as any

  if (!host?.value) throw new Error('SMTP not configured. Go to Settings to set up email.')

  return {
    transport: nodemailer.createTransport({
      host: host.value,
      port: port?.value ? parseInt(port.value, 10) : 587,
      secure: port?.value ? parseInt(port.value, 10) === 465 : false,
      auth: {
        user: user?.value || '',
        pass: pass?.value ? decryptSecret(pass.value) : '',
      },
    }),
    fromEmail: fromEmail?.value || user?.value || '',
  }
}

// Build the daily report payload (shared by the IPC handler and the auto-send scheduler)
function getDailyReportData(date: string) {
  const today = date || todayLocal()

  const totalRevenueRow = db?.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM payments WHERE DATE(created_at, 'localtime') = ? AND status = 'completed'
  `).get(today) as any

  const byType = (db?.prepare(`
    SELECT type, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
    FROM payments WHERE DATE(created_at, 'localtime') = ? AND status = 'completed'
    GROUP BY type
  `).all(today) as any[]) || []

  const byMethod = (db?.prepare(`
    SELECT payment_method, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
    FROM payments WHERE DATE(created_at, 'localtime') = ? AND status = 'completed'
    GROUP BY payment_method
  `).all(today) as any[]) || []

  const transactions = (db?.prepare(`
    SELECT p.*, m.name as member_name, m.member_id as member_code, pl.name as plan_name
    FROM payments p
    JOIN members m ON p.member_id = m.id
    LEFT JOIN plans pl ON p.plan_id = pl.id
    WHERE DATE(p.created_at, 'localtime') = ?
    ORDER BY p.created_at DESC
  `).all(today) as any[]) || []

  const newMembersRow = db?.prepare(`
    SELECT COUNT(*) as count FROM members WHERE DATE(created_at, 'localtime') = ?
  `).get(today) as any

  const renewalsRow = db?.prepare(`
    SELECT COUNT(*) as count FROM payments
    WHERE type = 'renewal' AND DATE(created_at, 'localtime') = ?
  `).get(today) as any

  const outstanding = (db?.prepare(`
    SELECT DISTINCT m.id, m.member_id, m.name, m.balance
    FROM members m
    JOIN checkins c ON c.member_id = m.id
    WHERE DATE(c.timestamp, 'localtime') = ? AND m.balance > 0 AND m.archived = 0
    ORDER BY m.balance DESC
  `).all(today) as any[]) || []

  return {
    date: today,
    totalRevenue: totalRevenueRow?.total || 0,
    byType,
    byMethod,
    transactions,
    newMembers: newMembersRow?.count || 0,
    renewals: renewalsRow?.count || 0,
    outstandingCount: outstanding.length,
    outstanding,
  }
}

// Build a styled HTML email body for the daily sales report
function buildDailyReportEmailHtml(appName: string, r: ReturnType<typeof getDailyReportData>): string {
  const esc = (s: unknown): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const fmt = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const methodLabel = (m: string) => (m || 'cash').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const typeLabel = (t: string) => t === 'new_plan' ? 'New' : t === 'renewal' ? 'Renewal' : 'Top Up'
  const timeFmt = (ts: string) => new Date(ts.replace(' ', 'T') + 'Z').toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  const dateLabel = new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  const methodRows = r.byMethod.map(m =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(methodLabel(m.payment_method))}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${m.count}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right"><strong>${fmt(m.total)}</strong></td></tr>`
  ).join('')

  const txnRows = r.transactions.map(t =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(t.member_name || 'Unknown')}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(t.member_code || '')}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(t.plan_name || '—')}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${typeLabel(t.type)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(methodLabel(t.payment_method || ''))}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(t.status || 'completed')}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmt(t.amount)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${timeFmt(t.created_at)}</td></tr>`
  ).join('')

  const outstandingRows = r.outstanding.map(o =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(o.name)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(o.member_id)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:#c62828">${fmt(o.balance)}</td></tr>`
  ).join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(appName)} Daily Report</title></head><body style="margin:0;padding:0;background:#f4f5f7;font-family:'Segoe UI',Arial,sans-serif;color:#222">
<div style="max-width:720px;margin:0 auto;padding:24px">
  <div style="background:#1a1a2e;color:#fff;border-radius:10px 10px 0 0;padding:20px 24px">
    <h1 style="margin:0;font-size:20px">${esc(appName)} — Daily Sales Report</h1>
    <p style="margin:4px 0 0;color:#aab;font-size:13px">${esc(dateLabel)}</p>
  </div>
  <div style="background:#fff;border:1px solid #e3e6ea;border-top:none;border-radius:0 0 10px 10px;padding:24px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr>
        <td style="width:25%;text-align:center;padding:14px 8px;background:#f0fdf4;border-radius:8px"><div style="font-size:20px;font-weight:700;color:#2e7d32">${fmt(r.totalRevenue)}</div><div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-top:2px">Total Revenue</div></td>
        <td style="width:25%;text-align:center;padding:14px 8px;background:#eef4fd;border-radius:8px"><div style="font-size:20px;font-weight:700;color:#1565c0">${r.newMembers}</div><div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-top:2px">New Enrollments</div></td>
        <td style="width:25%;text-align:center;padding:14px 8px;background:#fff7ed;border-radius:8px"><div style="font-size:20px;font-weight:700;color:#e65100">${r.renewals}</div><div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-top:2px">Renewals</div></td>
        <td style="width:25%;text-align:center;padding:14px 8px;background:#fef2f2;border-radius:8px"><div style="font-size:20px;font-weight:700;color:#c62828">${r.outstandingCount}</div><div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-top:2px">Outstanding</div></td>
      </tr>
    </table>

    <h2 style="font-size:14px;color:#1a1a2e;margin:0 0 8px;padding-bottom:6px;border-bottom:2px solid #1a1a2e">Revenue by Payment Method</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <thead><tr><th style="padding:6px 10px;text-align:left;background:#1a1a2e;color:#fff;font-size:10px;text-transform:uppercase">Method</th><th style="padding:6px 10px;text-align:right;background:#1a1a2e;color:#fff;font-size:10px;text-transform:uppercase">Transactions</th><th style="padding:6px 10px;text-align:right;background:#1a1a2e;color:#fff;font-size:10px;text-transform:uppercase">Total</th></tr></thead>
      <tbody>${methodRows || '<tr><td colspan="3" style="padding:10px;color:#999">No payments today</td></tr>'}</tbody>
    </table>

    <h2 style="font-size:14px;color:#1a1a2e;margin:0 0 8px;padding-bottom:6px;border-bottom:2px solid #1a1a2e">Transaction Details</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <thead><tr><th style="padding:6px 10px;text-align:left;background:#1a1a2e;color:#fff;font-size:10px;text-transform:uppercase">Member</th><th style="padding:6px 10px;text-align:left;background:#1a1a2e;color:#fff;font-size:10px;text-transform:uppercase">ID</th><th style="padding:6px 10px;text-align:left;background:#1a1a2e;color:#fff;font-size:10px;text-transform:uppercase">Plan</th><th style="padding:6px 10px;text-align:left;background:#1a1a2e;color:#fff;font-size:10px;text-transform:uppercase">Type</th><th style="padding:6px 10px;text-align:left;background:#1a1a2e;color:#fff;font-size:10px;text-transform:uppercase">Method</th><th style="padding:6px 10px;text-align:left;background:#1a1a2e;color:#fff;font-size:10px;text-transform:uppercase">Status</th><th style="padding:6px 10px;text-align:right;background:#1a1a2e;color:#fff;font-size:10px;text-transform:uppercase">Amount</th><th style="padding:6px 10px;text-align:left;background:#1a1a2e;color:#fff;font-size:10px;text-transform:uppercase">Time</th></tr></thead>
      <tbody>${txnRows || '<tr><td colspan="8" style="padding:10px;color:#999">No transactions today</td></tr>'}</tbody>
    </table>

    ${r.outstanding.length > 0 ? `
    <h2 style="font-size:14px;color:#c62828;margin:0 0 8px;padding-bottom:6px;border-bottom:2px solid #c62828">Outstanding Balances</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <thead><tr><th style="padding:6px 10px;text-align:left;background:#c62828;color:#fff;font-size:10px;text-transform:uppercase">Member</th><th style="padding:6px 10px;text-align:left;background:#c62828;color:#fff;font-size:10px;text-transform:uppercase">ID</th><th style="padding:6px 10px;text-align:right;background:#c62828;color:#fff;font-size:10px;text-transform:uppercase">Balance</th></tr></thead>
      <tbody>${outstandingRows}</tbody>
    </table>` : ''}

    <p style="color:#999;font-size:11px;border-top:1px solid #eee;padding-top:12px;margin:0">This is an automated end-of-day report generated by ${esc(appName)}.</p>
  </div>
</div>
</body></html>`
}

// Send the end-of-day report email to the configured owner address (once per day)
async function sendAutoDailyReport() {
  const enabled = db?.prepare("SELECT value FROM settings WHERE key = 'autoReportEnabled'").get() as any
  if (enabled?.value !== 'true') return
  const hourRow = db?.prepare("SELECT value FROM settings WHERE key = 'autoReportHour'").get() as any
  const hour = clampNumber(hourRow?.value, 0, 23, 23)
  if (new Date().getHours() !== hour) return
  const lastRow = db?.prepare("SELECT value FROM settings WHERE key = 'lastAutoReport'").get() as any
  if (lastRow?.value === todayLocal()) return
  const ownerRow = db?.prepare("SELECT value FROM settings WHERE key = 'reportOwnerEmail'").get() as any
  const ownerEmail = ownerRow?.value ? decryptSecret(ownerRow.value) : ''
  if (!ownerEmail) return

  try {
    const { transport, fromEmail } = createSmtpTransport()
    const appNameRow = db?.prepare("SELECT value FROM settings WHERE key = 'appName'").get() as any
    const appName = appNameRow?.value || 'REPCHECK'
    const report = getDailyReportData(todayLocal())
    const html = buildDailyReportEmailHtml(appName, report)
    await transport.sendMail({
      from: `"${appName}" <${fromEmail}>`,
      to: ownerEmail,
      subject: `${appName} — Daily Sales Report (${todayLocal()})`,
      html,
    })
    transport.close()
    db?.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastAutoReport', ?)").run(todayLocal())
    logMain('info', 'Auto daily report email sent', { to: ownerEmail })
  } catch (error: any) {
    logMain('error', 'Auto daily report email failed', { error: error.message })
  }
}

// ── P2 5.5: Welcome + receipt email templates ──
// Setting-gated (welcomeEmailEnabled / receiptEmailEnabled). SMTP must be configured.
function emailTemplateShell(appName: string, title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escHtml(appName)}</title></head><body style="margin:0;padding:0;background:#f4f5f7;font-family:'Segoe UI',Arial,sans-serif;color:#222">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#1a1a2e;color:#fff;border-radius:10px 10px 0 0;padding:18px 22px">
    <h1 style="margin:0;font-size:18px">${escHtml(title)}</h1>
  </div>
  <div style="background:#fff;border:1px solid #e3e6ea;border-top:none;border-radius:0 0 10px 10px;padding:22px">
    ${bodyHtml}
    <p style="color:#999;font-size:11px;border-top:1px solid #eee;padding-top:12px;margin:16px 0 0">Sent by ${escHtml(appName)}</p>
  </div>
</div>
</body></html>`
}

function escHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function sendWelcomeEmail(memberId: number) {
  try {
    const enabled = db?.prepare("SELECT value FROM settings WHERE key = 'welcomeEmailEnabled'").get() as any
    if (enabled?.value !== 'true') return
    const member = db?.prepare(`
      SELECT m.*, p.name as plan_name FROM members m
      LEFT JOIN plans p ON m.plan_id = p.id
      WHERE m.id = ?
    `).get(memberId) as any
    if (!member?.email) return
    const { transport, fromEmail } = createSmtpTransport()
    const appNameRow = db?.prepare("SELECT value FROM settings WHERE key = 'appName'").get() as any
    const appName = appNameRow?.value || 'REPCHECK'
    const planName = member.plan_name || 'a membership plan'
    const body = `
      <p style="font-size:15px;margin:0 0 14px">Hi <strong>${escHtml(member.name)}</strong>,</p>
      <p style="margin:0 0 14px;line-height:1.6">Welcome to <strong>${escHtml(appName)}</strong>! We're thrilled to have you on board.</p>
      <div style="background:#f0fdf4;border:1px solid #d0e8d4;border-radius:8px;padding:14px 16px;margin:0 0 16px">
        <strong style="color:#2e7d32">${escHtml(planName)}</strong><br/>
        ${member.plan_start ? `<span style="color:#555;font-size:13px">Start: ${escHtml(member.plan_start)}</span><br/>` : ''}
        ${member.plan_end ? `<span style="color:#555;font-size:13px">Valid until: ${escHtml(member.plan_end)}</span>` : ''}
      </div>
      <p style="margin:0 0 14px;line-height:1.6">Your member ID is <strong style="font-family:monospace">${escHtml(member.member_id)}</strong>. Keep it handy for check-in and renewals.</p>
      <p style="margin:0;line-height:1.6">See you at the gym! 💪</p>`
    await transport.sendMail({
      from: `"${appName}" <${fromEmail}>`,
      to: member.email,
      subject: `Welcome to ${appName}, ${member.name}!`,
      html: emailTemplateShell(appName, `Welcome to ${appName}`, body),
    })
    transport.close()
    logMain('info', 'Welcome email sent', { memberId, to: member.email })
  } catch (error: any) {
    logMain('warn', 'Welcome email not sent (SMTP unconfigured or failed)', { memberId, error: error.message })
  }
}

async function sendReceiptEmail(paymentId: number) {
  try {
    const enabled = db?.prepare("SELECT value FROM settings WHERE key = 'receiptEmailEnabled'").get() as any
    if (enabled?.value !== 'true') return
    const payment = db?.prepare(`
      SELECT p.*, m.name as member_name, m.email as member_email, m.member_id as member_code, pl.name as plan_name
      FROM payments p
      JOIN members m ON p.member_id = m.id
      LEFT JOIN plans pl ON p.plan_id = pl.id
      WHERE p.id = ?
    `).get(paymentId) as any
    if (!payment?.member_email) return
    const { transport, fromEmail } = createSmtpTransport()
    const appNameRow = db?.prepare("SELECT value FROM settings WHERE key = 'appName'").get() as any
    const appName = appNameRow?.value || 'REPCHECK'
    const methodLabel = (payment.payment_method || 'cash').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    const typeLabel = payment.type === 'new_plan' ? 'New Plan' : payment.type === 'renewal' ? 'Renewal' : 'Top Up'
    const body = `
      <p style="font-size:15px;margin:0 0 14px">Hi <strong>${escHtml(payment.member_name)}</strong>,</p>
      <p style="margin:0 0 14px">Thank you! Here's your receipt for your recent payment:</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px">
        <tr><td style="padding:8px 10px;border:1px solid #e3e6ea">Transaction #</td><td style="padding:8px 10px;border:1px solid #e3e6ea;font-family:monospace">#${payment.id}</td></tr>
        <tr><td style="padding:8px 10px;border:1px solid #e3e6ea">Date</td><td style="padding:8px 10px;border:1px solid #e3e6ea">${new Date(payment.created_at.replace(' ', 'T') + 'Z').toLocaleString()}</td></tr>
        <tr><td style="padding:8px 10px;border:1px solid #e3e6ea">Type</td><td style="padding:8px 10px;border:1px solid #e3e6ea">${typeLabel}</td></tr>
        ${payment.plan_name ? `<tr><td style="padding:8px 10px;border:1px solid #e3e6ea">Plan</td><td style="padding:8px 10px;border:1px solid #e3e6ea">${escHtml(payment.plan_name)}</td></tr>` : ''}
        <tr><td style="padding:8px 10px;border:1px solid #e3e6ea">Payment Method</td><td style="padding:8px 10px;border:1px solid #e3e6ea">${methodLabel}</td></tr>
        <tr><td style="padding:8px 10px;border:1px solid #e3e6ea">Amount</td><td style="padding:8px 10px;border:1px solid #e3e6ea"><strong>₱${Number(payment.amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td></tr>
      </table>
      <p style="margin:0;line-height:1.6">If you have any questions, just ask at the front desk.</p>`
    await transport.sendMail({
      from: `"${appName}" <${fromEmail}>`,
      to: payment.member_email,
      subject: `${appName} — Payment Receipt (#${payment.id})`,
      html: emailTemplateShell(appName, 'Payment Receipt', body),
    })
    transport.close()
    logMain('info', 'Receipt email sent', { paymentId, to: payment.member_email })
  } catch (error: any) {
    logMain('warn', 'Receipt email not sent (SMTP unconfigured or failed)', { paymentId, error: error.message })
  }
}

// ── Backup helpers (module scope — used by manual, safety, and scheduled backups) ──
// Build the JSON payload for a full backup (Buffer fields base64-encoded)
function buildBackupJson(): string {
  if (!db) throw new Error('Database not initialized')
  const backupData: Record<string, any[]> = {
    members: db.prepare('SELECT * FROM members').all() as any[],
    plans: db.prepare('SELECT * FROM plans').all() as any[],
    checkins: db.prepare('SELECT * FROM checkins').all() as any[],
    fingerprint_templates: db.prepare('SELECT * FROM fingerprint_templates').all() as any[],
    payments: db.prepare('SELECT * FROM payments').all() as any[],
    coaches: db.prepare('SELECT * FROM coaches').all() as any[],
    coach_fee_payments: db.prepare('SELECT * FROM coach_fee_payments').all() as any[],
    staff: db.prepare('SELECT * FROM staff').all() as any[],
    activity_logs: db.prepare('SELECT * FROM activity_logs').all() as any[],
    reminders: db.prepare('SELECT * FROM reminders').all() as any[],
    guest_checkins: db.prepare('SELECT * FROM guest_checkins').all() as any[],
    settings: db.prepare('SELECT * FROM settings').all() as any[],
  }
  const serialize = (data: any[]): any[] =>
    data.map(row => {
      const obj: any = {}
      for (const [key, value] of Object.entries(row)) {
        if (value instanceof Buffer) {
          obj[key] = { __type: 'Buffer', data: value.toString('base64') }
        } else {
          obj[key] = value
        }
      }
      return obj
    })
  const serialized: Record<string, any[]> = {}
  for (const [table, rows] of Object.entries(backupData)) {
    serialized[table] = serialize(rows)
  }
  return JSON.stringify(serialized, null, 2)
}

// ── Backup encryption (P1 3.6): optional AES-256-GCM when a backup password is set ──
function backupPasswordSetting(): string | null {
  const row = db?.prepare("SELECT value FROM settings WHERE key = 'backupPassword'").get() as any
  if (!row?.value) return null
  return decryptSecret(row.value)
}

// Write a full backup ZIP to the given path (used by manual + safety + scheduled backups)
function writeBackupZip(targetPath: string) {
  const zip = new AdmZip()
  const json = Buffer.from(buildBackupJson(), 'utf-8')
  const encRow = db?.prepare("SELECT value FROM settings WHERE key = 'backupEncryptionEnabled'").get() as any
  const password = encRow?.value === 'true' ? backupPasswordSetting() : null
  if (password) {
    // AES-256-GCM with a scrypt-derived key; salt/iv/authTag stored in backup.meta
    const salt = crypto.randomBytes(16)
    const iv = crypto.randomBytes(12)
    const key = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 })
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update(json), cipher.final()])
    const authTag = cipher.getAuthTag()
    zip.addFile('data.enc', ciphertext)
    zip.addFile('backup.meta', Buffer.from(JSON.stringify({
      version: 1, kdf: 'scrypt', N: 16384, r: 8, p: 1,
      salt: salt.toString('base64'), iv: iv.toString('base64'), authTag: authTag.toString('base64'),
    })))
  } else {
    zip.addFile('data.json', json)
  }
  // P1 4.5: include the on-disk member photos folder so backups stay complete
  try {
    const photos = photoDir()
    if (fs.existsSync(photos)) {
      for (const f of fs.readdirSync(photos)) {
        zip.addFile(`photos/${f}`, fs.readFileSync(path.join(photos, f)))
      }
    }
  } catch (error: any) {
    logMain('warn', 'Failed to include photos in backup', { error: error.message })
  }
  zip.writeZip(targetPath)
  db?.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_backup', ?)")
    .run(new Date().toISOString())
}

// IPC Handlers
function setupIPC() {
  // Members
  ipcMain.handle('get-members', async () => {
    try {
      autoExpireMembers()
      return db?.prepare(`
        SELECT m.*, p.name as plan_name, c.name as coach_name, p.type as plan_type, p.sessions as plan_sessions
        FROM members m
        LEFT JOIN plans p ON m.plan_id = p.id
        LEFT JOIN coaches c ON m.coach_id = c.id
        WHERE m.archived = 0
        ORDER BY m.name ASC
      `).all() || []
    } catch (error) {
      console.error('get-members error:', error)
      throw error
    }
  })

  ipcMain.handle('get-member', (_, id: number) => {
    autoExpireMembers()
    return db?.prepare(`
      SELECT m.*, p.name as plan_name, c.name as coach_name
      FROM members m
      LEFT JOIN plans p ON m.plan_id = p.id
      LEFT JOIN coaches c ON m.coach_id = c.id
      WHERE m.id = ? AND m.archived = 0
    `).get(id)
  })

  ipcMain.handle('check-member-id-exists', (_, memberId: string) => {
    const existing = db?.prepare('SELECT id, name FROM members WHERE member_id = ? AND archived = 0').get(memberId) as any
    return existing || null
  })

  // Last manually-entered numeric member ID, so the UI can suggest the next ID
  ipcMain.handle('get-last-member-id', () => {
    const rows = db?.prepare('SELECT member_id FROM members WHERE archived = 0').all() as any[] || []
    let last = 0
    for (const r of rows) {
      const id = String(r.member_id || '').trim()
      // Only consider purely-numeric IDs (the staff-entered sequence); ignore auto-generated MEM- ids
      if (/^\d+$/.test(id)) {
        const n = parseInt(id, 10)
        if (n > last) last = n
      }
    }
    return { last, next: last + 1 }
  })

  ipcMain.handle('create-member', (_, member) => {
    const err = validateMember(member)
    if (err) throw new Error(err)
    // P1 4.5: persist a base64 photo to disk, store the repcheck-photo:// URL in the DB
    const photoUrl = savePhotoToDisk(member.photo)
    const res = db?.prepare(`
      INSERT INTO members (member_id, name, email, phone, photo, emergency_contact, emergency_phone, plan_id, plan_start, plan_end, height, weight, birthday, coach_id, coaching_start, coaching_end, balance, waiver_agreed_at, auto_renew)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      member.member_id,
      member.name,
      member.email,
      member.phone,
      photoUrl || null,
      member.emergency_contact,
      member.emergency_phone,
      member.plan_id,
      member.plan_start,
      member.plan_end,
      member.height ?? null,
      member.weight ?? null,
      member.birthday || null,
      member.coach_id || null,
      member.coaching_start || null,
      member.coaching_end || null,
      member.balance,
      member.waiver_agreed_at || null,
      member.auto_renew ? 1 : 0
    )
    // P2 5.5: fire-and-forget welcome email on enrollment (setting-gated, SMTP optional)
    if (res?.lastInsertRowid) {
      sendWelcomeEmail(Number(res.lastInsertRowid)).catch(() => {})
    }
    return res
  })

  ipcMain.handle('update-member', (_, id: number, member) => {
    const err = validateMember(member)
    if (err) throw new Error(err)
    // P1 4.5: persist a base64 photo to disk, store the repcheck-photo:// URL in the DB
    const photoUrl = savePhotoToDisk(member.photo)
    return db?.prepare(`
      UPDATE members SET name = ?, email = ?, phone = ?, photo = ?, emergency_contact = ?, emergency_phone = ?, plan_id = ?, plan_start = ?, plan_end = ?, height = ?, weight = ?, birthday = ?, coach_id = ?, coaching_start = ?, coaching_end = ?, balance = ?, status = ?, waiver_agreed_at = COALESCE(?, waiver_agreed_at), sessions_used = COALESCE(?, sessions_used), auto_renew = COALESCE(?, auto_renew)
      WHERE id = ?
    `).run(
      member.name,
      member.email,
      member.phone,
      photoUrl || null,
      member.emergency_contact,
      member.emergency_phone,
      member.plan_id,
      member.plan_start,
      member.plan_end,
      member.height ?? null,
      member.weight ?? null,
      member.birthday || null,
      member.coach_id || null,
      member.coaching_start || null,
      member.coaching_end,
      member.balance,
      member.status,
      member.waiver_agreed_at || null,
      member.sessions_used ?? undefined,
      member.auto_renew === undefined ? undefined : (member.auto_renew ? 1 : 0),
      id
    )
  })

  // Soft delete: mark archived so check-ins / payments / templates are preserved (P1 3.4)
  ipcMain.handle('delete-member', (_, id: number) => {
    return db?.prepare('UPDATE members SET archived = 1 WHERE id = ?').run(id)
  })

  ipcMain.handle('search-members', (_, query: string) => {
    autoExpireMembers()
    const like = `%${escapeLike(query)}%`
    return db?.prepare(`
      SELECT m.*, p.name as plan_name, c.name as coach_name
      FROM members m
      LEFT JOIN plans p ON m.plan_id = p.id
      LEFT JOIN coaches c ON m.coach_id = c.id
      WHERE m.archived = 0 AND (m.name LIKE ? OR m.member_id LIKE ? OR m.email LIKE ?)
    `).all(like, like, like)
  })

  // P1 4.2: server-side paginated members list (with optional search)
  ipcMain.handle('get-members-page', (_, opts?: { offset?: number; limit?: number; search?: string }) => {
    autoExpireMembers()
    const offset = clampNumber(opts?.offset, 0, 100000, 0)
    const limit = clampNumber(opts?.limit, 1, 500, 50)
    const search = (opts?.search || '').trim()
    let where = 'WHERE m.archived = 0'
    const params: any[] = []
    if (search) {
      where += ' AND (m.name LIKE ? OR m.member_id LIKE ? OR m.email LIKE ?)'
      const like = `%${escapeLike(search)}%`
      params.push(like, like, like)
    }
    const totalRow = db?.prepare(`SELECT COUNT(*) as count FROM members m ${where}`).get(...params) as any
    const rows = db?.prepare(`
      SELECT m.*, p.name as plan_name, c.name as coach_name, p.type as plan_type, p.sessions as plan_sessions
      FROM members m
      LEFT JOIN plans p ON m.plan_id = p.id
      LEFT JOIN coaches c ON m.coach_id = c.id
      ${where}
      ORDER BY m.name ASC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) || []
    return { rows, total: totalRow?.count || 0, offset, limit }
  })

  // ── Guest / trial check-ins (P2 5.1) ──
  ipcMain.handle('create-guest-checkin', (_, guest: { name?: string; phone?: string; type?: string }) => {
    if (!isNonEmptyString(guest?.name)) throw new Error('Guest name is required.')
    const type = guest.type === 'trial' ? 'trial' : 'guest'
    return db?.prepare('INSERT INTO guest_checkins (name, phone, type) VALUES (?, ?, ?)')
      .run(guest.name.trim(), guest.phone?.trim() || null, type)
  })

  ipcMain.handle('get-guest-checkins', (_, date?: string) => {
    const day = date || todayLocal()
    return db?.prepare(`
      SELECT * FROM guest_checkins WHERE DATE(created_at, 'localtime') = ? ORDER BY created_at DESC
    `).all(day) || []
  })

  ipcMain.handle('get-guest-checkins-count', (_, date?: string) => {
    const day = date || todayLocal()
    const row = db?.prepare(`SELECT COUNT(*) as count FROM guest_checkins WHERE DATE(created_at, 'localtime') = ?`).get(day) as any
    return row?.count || 0
  })

  // Plans
  ipcMain.handle('get-plans', () => {
    return db?.prepare('SELECT * FROM plans').all()
  })

  ipcMain.handle('create-plan', (_, plan) => {
    const err = validatePlan(plan)
    if (err) throw new Error(err)
    return db?.prepare(`
      INSERT INTO plans (name, type, duration_days, sessions, price)
      VALUES (?, ?, ?, ?, ?)
    `).run(plan.name, plan.type, plan.duration_days, plan.sessions, plan.price)
  })

  ipcMain.handle('update-plan', (_, id: number, plan) => {
    const err = validatePlan(plan)
    if (err) throw new Error(err)
    return db?.prepare(`
      UPDATE plans SET name = ?, type = ?, duration_days = ?, sessions = ?, price = ?
      WHERE id = ?
    `).run(plan.name, plan.type, plan.duration_days, plan.sessions, plan.price, id)
  })

  ipcMain.handle('delete-plan', (_, id: number) => {
    // Unset references first so foreign_keys=ON doesn't block the delete (P1 3.4)
    db?.prepare('UPDATE members SET plan_id = NULL WHERE plan_id = ?').run(id)
    db?.prepare('UPDATE payments SET plan_id = NULL WHERE plan_id = ?').run(id)
    return db?.prepare('DELETE FROM plans WHERE id = ?').run(id)
  })

  // Check-ins
  ipcMain.handle('get-checkins', (_, date?: string, opts?: { offset?: number; limit?: number }) => {
    const offset = clampNumber(opts?.offset, 0, 100000, 0)
    const limit = clampNumber(opts?.limit, 1, 500, 100)
    if (date) {
      return db?.prepare(`
        SELECT c.*, m.name, m.member_id as member_code, m.photo as member_photo
        FROM checkins c
        JOIN members m ON c.member_id = m.id
        WHERE DATE(c.timestamp, 'localtime') = ?
        ORDER BY c.timestamp DESC
        LIMIT ? OFFSET ?
      `).all(date, limit, offset)
    }
    return db?.prepare(`
      SELECT c.*, m.name, m.member_id as member_code, m.photo as member_photo
      FROM checkins c
      JOIN members m ON c.member_id = m.id
      ORDER BY c.timestamp DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset)
  })

  // Total check-in count for a given date (used for pagination UI)
  ipcMain.handle('get-checkins-count', (_, date?: string) => {
    if (date) {
      const row = db?.prepare(`SELECT COUNT(*) as count FROM checkins WHERE DATE(timestamp, 'localtime') = ?`).get(date) as any
      return row?.count || 0
    }
    const row = db?.prepare('SELECT COUNT(*) as count FROM checkins').get() as any
    return row?.count || 0
  })

  ipcMain.handle('get-active-checkins', () => {
    const today = todayLocal()
    return db?.prepare(`
      SELECT c.*, m.name, m.member_id as member_code, m.photo as member_photo, m.balance
      FROM checkins c
      JOIN members m ON c.member_id = m.id
      WHERE DATE(c.timestamp, 'localtime') = ? AND c.checked_out_at IS NULL
      ORDER BY c.timestamp ASC
    `).all(today) || []
  })

  ipcMain.handle('checkout-member', (_, checkinId: number) => {
    const now = nowLocal()
    db?.prepare('UPDATE checkins SET checked_out_at = ? WHERE id = ?').run(now, checkinId)
    return { success: true }
  })

  ipcMain.handle('create-checkin', (_, checkin) => {
    try {
      const err = validateCheckin(checkin)
      if (err) return { success: false, reason: 'invalid', message: err }

      const member = db?.prepare(`
        SELECT m.*, p.type as plan_type, p.sessions as plan_sessions
        FROM members m
        LEFT JOIN plans p ON m.plan_id = p.id
        WHERE m.id = ? AND m.archived = 0
      `).get(checkin.member_id) as any

      if (!member) return { success: false, reason: 'not_found', message: 'Member not found.' }

      // Manual override entries always go through (explicit staff override)
      if (checkin.status !== 'override') {
        // Balance dunning: block check-in when the outstanding balance exceeds the threshold (setting, 0 = off)
        const blockRow = db?.prepare(
          `SELECT value FROM settings WHERE key = 'balanceBlockThreshold'`
        ).get() as any
        const threshold = Number(blockRow?.value || 0)
        if (threshold > 0 && (member.balance || 0) > threshold) {
          return {
            success: false,
            reason: 'balance_due',
            message: `${member.name} has an outstanding balance of ₱${(member.balance || 0).toFixed(2)}, above the allowed limit. Please settle the balance at the front desk.`,
          }
        }

        // Session-pack enforcement: block when no sessions remain
        if (member.plan_type === 'session_pack' && typeof member.plan_sessions === 'number') {
          const remaining = member.plan_sessions - (member.sessions_used || 0)
          if (remaining <= 0) {
            return {
              success: false,
              reason: 'no_sessions',
              message: `${member.name} has no remaining sessions in their session pack.`,
            }
          }
        }

        // Duplicate check-in prevention (configurable via settings: allowMultipleDailyCheckins)
        // Blocks only while the member is currently checked in (not checked out) — re-entry after
        // checking out is allowed. Override bypasses this entirely.
        const allowMultiple = db?.prepare(
          `SELECT value FROM settings WHERE key = 'allowMultipleDailyCheckins'`
        ).get() as any
        const allowMultipleDaily = allowMultiple?.value === 'true'
        if (!allowMultipleDaily) {
          const today = todayLocal()
          const active = db?.prepare(`
            SELECT COUNT(*) as count FROM checkins
            WHERE member_id = ? AND DATE(timestamp, 'localtime') = ? AND status = 'success' AND checked_out_at IS NULL
          `).get(checkin.member_id, today) as any
          if (active?.count > 0) {
            return {
              success: false,
              reason: 'already_checked_in',
              message: `${member.name} is already checked in.`,
            }
          }
        }
      }

      const res = db?.prepare(`
        INSERT INTO checkins (member_id, method, match_confidence, status)
        VALUES (?, ?, ?, ?)
      `).run(checkin.member_id, checkin.method, checkin.match_confidence, checkin.status)

      // Consume a session for session-pack plans
      if (member.plan_type === 'session_pack') {
        db?.prepare('UPDATE members SET sessions_used = sessions_used + 1 WHERE id = ?')
          .run(checkin.member_id)
      }

      return { success: true, id: res?.lastInsertRowid }
    } catch (error: any) {
      console.error('create-checkin error:', error)
      return { success: false, reason: 'error', message: error.message }
    }
  })

  ipcMain.handle('get-today-stats', () => {
    autoExpireMembers()
    const today = todayLocal()
    const totalCheckins = db?.prepare(`
      SELECT COUNT(*) as count FROM checkins WHERE DATE(timestamp, 'localtime') = ?
    `).get(today) as any

    const activeMembers = db?.prepare(`
      SELECT COUNT(*) as count FROM members WHERE status = 'active' AND archived = 0
    `).get() as any

    const expiredMembers = db?.prepare(`
      SELECT COUNT(*) as count FROM members WHERE status = 'expired' AND archived = 0
    `).get() as any

    const expiringThisWeek = db?.prepare(`
      SELECT COUNT(*) as count FROM members 
      WHERE plan_end BETWEEN ? AND date(?, '+7 days')
      AND status = 'active' AND archived = 0
    `).get(today, today) as any

    return {
      totalCheckins: totalCheckins?.count || 0,
      activeMembers: activeMembers?.count || 0,
      expiredMembers: expiredMembers?.count || 0,
      expiringThisWeek: expiringThisWeek?.count || 0,
    }
  })

  ipcMain.handle('get-expiring-soon', () => {
    autoExpireMembers()
    const today = todayLocal()
    return db?.prepare(`
      SELECT m.*, p.name as plan_name, c.name as coach_name
      FROM members m
      LEFT JOIN plans p ON m.plan_id = p.id
      LEFT JOIN coaches c ON m.coach_id = c.id
      WHERE m.plan_end BETWEEN ? AND date(?, '+7 days')
      AND m.status = 'active' AND m.archived = 0
      ORDER BY m.plan_end ASC
    `).all(today, today)
  })

  // Fingerprint templates
  ipcMain.handle('save-fingerprint', (_, memberId: number, template: Buffer, quality: number) => {
    return db?.prepare(`
      INSERT INTO fingerprint_templates (member_id, template, quality)
      VALUES (?, ?, ?)
    `).run(memberId, template, quality)
  })

  ipcMain.handle('save-fingerprint-credential', async (_, memberCode: string, credentialId: string) => {
    // Look up the member's integer id from the text member_id field
    const member = db?.prepare('SELECT id FROM members WHERE member_id = ?').get(memberCode) as any
    if (!member) throw new Error('Member not found')
    return db?.prepare(`
      INSERT INTO fingerprint_templates (member_id, template, quality)
      VALUES (?, ?, ?)
    `).run(member.id, Buffer.from(credentialId, 'hex'), 100)
  })

  ipcMain.handle('get-fingerprint', (_, memberId: number) => {
    return db?.prepare(`
      SELECT * FROM fingerprint_templates WHERE member_id = ?
    `).all(memberId)
  })

  // Payments
  ipcMain.handle('get-payments', (_, memberId?: number, opts?: { offset?: number; limit?: number }) => {
    const offset = clampNumber(opts?.offset, 0, 100000, 0)
    const limit = clampNumber(opts?.limit, 1, 500, 100)
    if (memberId) {
      return db?.prepare(`
        SELECT p.*, pl.name as plan_name
        FROM payments p
        LEFT JOIN plans pl ON p.plan_id = pl.id
        WHERE p.member_id = ?
        ORDER BY p.created_at DESC
      `).all(memberId)
    }
    return db?.prepare(`
      SELECT p.*, m.name, pl.name as plan_name
      FROM payments p
      JOIN members m ON p.member_id = m.id
      LEFT JOIN plans pl ON p.plan_id = pl.id
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset)
  })

  // Total payment count (for pagination UI)
  ipcMain.handle('get-payments-count', (_, memberId?: number) => {
    if (memberId) {
      const row = db?.prepare('SELECT COUNT(*) as count FROM payments WHERE member_id = ?').get(memberId) as any
      return row?.count || 0
    }
    const row = db?.prepare('SELECT COUNT(*) as count FROM payments').get() as any
    return row?.count || 0
  })

  ipcMain.handle('create-payment', (_, payment) => {
    const err = validatePayment(payment)
    if (err) throw new Error(err)
    const res = db?.prepare(`
      INSERT INTO payments (member_id, amount, type, plan_id, payment_method, transaction_ref, staff_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')
    `).run(
      payment.member_id,
      payment.amount,
      payment.type,
      payment.plan_id,
      payment.payment_method || 'cash',
      payment.transaction_ref || null,
      payment.staff_id || null
    )
    // P2 5.5: fire-and-forget receipt email (setting-gated, SMTP optional)
    if (res?.lastInsertRowid) {
      sendReceiptEmail(Number(res.lastInsertRowid)).catch(() => {})
    }
    return res
  })

  // Void or refund a payment (P2 5.2) — marks status + note; audit-logged
  ipcMain.handle('update-payment-status', (_, id: number, status: string, note?: string) => {
    try {
      if (!['completed', 'refunded', 'voided'].includes(status)) {
        return { success: false, message: 'Invalid payment status.' }
      }
      const payment = db?.prepare('SELECT * FROM payments WHERE id = ?').get(id) as any
      if (!payment) return { success: false, message: 'Payment not found.' }
      db?.prepare('UPDATE payments SET status = ?, note = ? WHERE id = ?').run(status, note || null, id)
      const member = db?.prepare('SELECT name FROM members WHERE id = ?').get(payment.member_id) as any
      db?.prepare(
        `INSERT INTO activity_logs (action, entity_type, entity_id, details, user) VALUES (?, ?, ?, ?, ?)`
      ).run(
        status === 'voided' ? 'payment_voided' : status === 'refunded' ? 'payment_refunded' : 'payment_completed',
        'payment',
        id,
        JSON.stringify({ member_name: member?.name || null, amount: payment.amount, note: note || null }),
        'staff'
      )
      return { success: true }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  })

  // Coaches
  ipcMain.handle('get-coaches', () => {
    return db?.prepare('SELECT * FROM coaches WHERE archived = 0 ORDER BY name ASC').all()
  })

  ipcMain.handle('get-coach', (_, id: number) => {
    return db?.prepare('SELECT * FROM coaches WHERE id = ? AND archived = 0').get(id)
  })

  ipcMain.handle('create-coach', (_, coach) => {
    const err = validateCoach(coach)
    if (err) throw new Error(err)
    return db?.prepare(`
      INSERT INTO coaches (name, email, phone, specialty, professional_fee)
      VALUES (?, ?, ?, ?, ?)
    `).run(coach.name, coach.email || null, coach.phone || null, coach.specialty || null, coach.professional_fee ?? 0)
  })

  ipcMain.handle('update-coach', (_, id: number, coach) => {
    const err = validateCoach(coach)
    if (err) throw new Error(err)
    return db?.prepare(`
      UPDATE coaches SET name = ?, email = ?, phone = ?, specialty = ?, professional_fee = ?
      WHERE id = ?
    `).run(coach.name, coach.email || null, coach.phone || null, coach.specialty || null, coach.professional_fee ?? 0, id)
  })

  ipcMain.handle('delete-coach', (_, id: number) => {
    // Soft-delete: unassign members first (also clearing their coaching dates so
    // unassigned members don't show stale start/end), then archive the coach
    db?.prepare('UPDATE members SET coach_id = NULL, coaching_start = NULL, coaching_end = NULL WHERE coach_id = ?').run(id)
    return db?.prepare('UPDATE coaches SET archived = 1 WHERE id = ?').run(id)
  })

  ipcMain.handle('get-coach-members', (_, coachId: number) => {
    autoExpireMembers()
    return db?.prepare(`
      SELECT m.*, p.name as plan_name, c.name as coach_name
      FROM members m
      LEFT JOIN plans p ON m.plan_id = p.id
      LEFT JOIN coaches c ON m.coach_id = c.id
      WHERE m.coach_id = ? AND m.archived = 0
      ORDER BY m.name ASC
    `).all(coachId)
  })

  // Coach Fee Payments
  ipcMain.handle('get-coach-fee-payments', (_, coachId: number) => {
    return db?.prepare(`
      SELECT cfp.*, m.name as member_name, m.member_id as member_code, c.name as coach_name
      FROM coach_fee_payments cfp
      JOIN members m ON cfp.member_id = m.id
      JOIN coaches c ON cfp.coach_id = c.id
      WHERE cfp.coach_id = ?
      ORDER BY cfp.created_at DESC
    `).all(coachId)
  })

  ipcMain.handle('create-coach-fee-payment', (_, payment) => {
    return db?.prepare(`
      INSERT INTO coach_fee_payments (coach_id, member_id, amount, notes)
      VALUES (?, ?, ?, ?)
    `).run(payment.coach_id, payment.member_id, payment.amount, payment.notes || null)
  })

  ipcMain.handle('get-coach-fee-collected', (_, coachId: number) => {
    const result = db?.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM coach_fee_payments
      WHERE coach_id = ?
    `).get(coachId) as any
    return result?.total || 0
  })

  // Coach Payment Tracking
  ipcMain.handle('get-coach-payments-by-date', (_, coachId: number, date: string) => {
    const payments = db?.prepare(`
      SELECT cfp.*, m.name as member_name, m.member_id as member_code
      FROM coach_fee_payments cfp
      JOIN members m ON cfp.member_id = m.id
      WHERE cfp.coach_id = ? AND DATE(cfp.created_at) = ?
      ORDER BY cfp.created_at DESC
    `    ).all(coachId, date) as any[]

    const totalRow = db?.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM coach_fee_payments
      WHERE coach_id = ? AND DATE(created_at) = ?
    `).get(coachId, date) as any

    return {
      payments: payments || [],
      dailyTotal: totalRow?.total || 0,
    }
  })

  ipcMain.handle('get-coach-monthly-total', (_, coachId: number, date: string) => {
    const result = db?.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM coach_fee_payments
      WHERE coach_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', ?)
    `).get(coachId, date) as any
    return result?.total || 0
  })

  ipcMain.handle('get-coach-monthly-payments', (_, coachId: number, date: string) => {
    return db?.prepare(`
      SELECT cfp.*, m.name as member_name, m.member_id as member_code
      FROM coach_fee_payments cfp
      JOIN members m ON cfp.member_id = m.id
      WHERE cfp.coach_id = ? AND strftime('%Y-%m', cfp.created_at) = strftime('%Y-%m', ?)
      ORDER BY cfp.created_at DESC
    `).all(coachId, date) || []
  })

  // Settings
  ipcMain.handle('get-settings', () => {
    const rows = db?.prepare('SELECT * FROM settings').all() as any[] || []
    const settings: Record<string, string> = {}
    rows.forEach(row => {
      settings[row.key] = isSecretSetting(row.key) ? decryptSecret(row.value) : row.value
    })
    return settings
  })

  ipcMain.handle('get-setting', (_, key: string) => {
    const row = db?.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
    if (!row?.value) return null
    return isSecretSetting(key) ? decryptSecret(row.value) : row.value
  })

  ipcMain.handle('save-setting', (_, key: string, value: string) => {
    const stored = isSecretSetting(key) ? encryptSecret(value) : value
    return db?.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, stored)
  })

  ipcMain.handle('save-settings', (_, settings: Record<string, string>) => {
    const stmt = db?.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    const insertMany = db?.transaction((entries: [string, string][]) => {
      entries.forEach(([key, value]) => {
        const stored = isSecretSetting(key) ? encryptSecret(value) : value
        stmt?.run(key, stored)
      })
    })
    insertMany(Object.entries(settings))
  })

  ipcMain.handle('create-backup', async () => {
    try {
      if (!db) throw new Error('Database not initialized')

      const defaultName = `repcheck-backup-${todayLocal()}.zip`
      const backupDialogOptions = {
        title: 'Save Backup',
        defaultPath: defaultName,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      }
      const result = mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showSaveDialog(mainWindow, backupDialogOptions)
        : await dialog.showSaveDialog(backupDialogOptions)

      if (result.canceled || !result.filePath) return { success: false, reason: 'cancelled' }

      writeBackupZip(result.filePath)
      logMain('info', 'Backup created', { path: result.filePath })
      return { success: true, path: result.filePath }
    } catch (error: any) {
      console.error('Backup error:', error)
      return { success: false, reason: error.message }
    }
  })

  ipcMain.handle('restore-backup', async (_, passwordArg?: string) => {
    try {
      if (!db) throw new Error('Database not initialized')

      // Show open dialog (guard against a closed main window)
      const openDialogOptions: Electron.OpenDialogOptions = {
        title: 'Select Backup File',
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
        properties: ['openFile'],
      }
      const result = mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, openDialogOptions)
        : await dialog.showOpenDialog(openDialogOptions)

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, reason: 'cancelled' }
      }

      const zipPath = result.filePaths[0]

      // Read and parse the zip
      const zip = new AdmZip(zipPath)
      const zipEntries = zip.getEntries()

      const dataEntry = zipEntries.find(e => e.entryName === 'data.json')
      const encEntry = zipEntries.find(e => e.entryName === 'data.enc')
      const metaEntry = zipEntries.find(e => e.entryName === 'backup.meta')

      let jsonData: string
      if (dataEntry) {
        jsonData = dataEntry.getData().toString('utf-8')
      } else if (encEntry && metaEntry) {
        // Encrypted backup (P1 3.6) — need the passphrase
        const password = passwordArg || backupPasswordSetting()
        if (!password) {
          return { success: false, reason: 'needs_password', message: 'This backup is encrypted. Enter the backup password.' }
        }
        try {
          const meta = JSON.parse(metaEntry.getData().toString('utf-8'))
          const key = crypto.scryptSync(password, Buffer.from(meta.salt, 'base64'), 32, {
            N: meta.N || 16384, r: meta.r || 8, p: meta.p || 1,
          })
          const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(meta.iv, 'base64'))
          decipher.setAuthTag(Buffer.from(meta.authTag, 'base64'))
          jsonData = Buffer.concat([decipher.update(encEntry.getData()), decipher.final()]).toString('utf-8')
        } catch {
          return { success: false, reason: 'wrong_password', message: 'Incorrect backup password. The backup could not be decrypted.' }
        }
      } else {
        return { success: false, reason: 'Invalid backup file: data.json not found' }
      }

      let backupData: Record<string, any[]>
      try {
        backupData = JSON.parse(jsonData)
      } catch {
        return { success: false, reason: 'Invalid backup file: corrupt JSON' }
      }

      // Validate the backup schema before touching the live database (P1 4.4)
      const requiredTables = ['members', 'plans', 'checkins', 'payments', 'coaches', 'settings']
      const missingTables = requiredTables.filter(t => !Array.isArray(backupData[t]))
      if (missingTables.length > 0) {
        return { success: false, reason: `Invalid backup file: missing table(s) ${missingTables.join(', ')}` }
      }

      // Safety net: create an automatic pre-restore backup so nothing is lost (P1 4.4)
      try {
        const safetyDir = path.join(app.getPath('userData'), 'backups')
        fs.mkdirSync(safetyDir, { recursive: true })
        const safetyPath = path.join(safetyDir, `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`)
        writeBackupZip(safetyPath)
        logMain('info', 'Pre-restore safety backup created', { path: safetyPath })
      } catch (e: any) {
        logMain('error', 'Failed to create pre-restore safety backup', { error: e.message })
      }

      // Deserialize Buffer fields
      const deserialize = (rows: any[]): any[] =>
        rows.map(row => {
          const obj: any = {}
          for (const [key, value] of Object.entries(row)) {
            if (value && typeof value === 'object' && (value as any).__type === 'Buffer') {
              obj[key] = Buffer.from((value as any).data, 'base64')
            } else {
              obj[key] = value
            }
          }
          return obj
        })

      const deserialized: Record<string, any[]> = {}
      for (const [table, rows] of Object.entries(backupData)) {
        deserialized[table] = deserialize(rows)
      }

      // Restore within a transaction
      const restoreAll = db.transaction(() => {
        // Disable foreign key checks during restore
        db!.pragma('foreign_keys = OFF')

        // Clear existing data (order matters due to foreign keys)
        db!.exec('DELETE FROM fingerprint_templates')
        db!.exec('DELETE FROM checkins')
        db!.exec('DELETE FROM payments')
        db!.exec('DELETE FROM coach_fee_payments')
        db!.exec('DELETE FROM members')
        db!.exec('DELETE FROM plans')
        db!.exec('DELETE FROM coaches')
        db!.exec('DELETE FROM staff')
        db!.exec('DELETE FROM activity_logs')
        db!.exec('DELETE FROM reminders')
        db!.exec('DELETE FROM guest_checkins')
        db!.exec('DELETE FROM settings')

        // Helper to insert rows dynamically (preserves original IDs)
        const insertRows = (table: string, rows: any[]) => {
          if (rows.length === 0) return
          const columns = Object.keys(rows[0])
          const placeholders = columns.map(() => '?').join(',')
          const colNames = columns.join(',')
          const stmt = db!.prepare(`INSERT INTO ${table} (${colNames}) VALUES (${placeholders})`)
          for (const row of rows) {
            stmt.run(...columns.map(c => row[c]))
          }
        }

        // Restore: insert in order respecting FK constraints
        if (deserialized.plans) insertRows('plans', deserialized.plans)
        if (deserialized.coaches) insertRows('coaches', deserialized.coaches)
        if (deserialized.members) insertRows('members', deserialized.members)
        if (deserialized.coach_fee_payments) insertRows('coach_fee_payments', deserialized.coach_fee_payments)
        if (deserialized.checkins) insertRows('checkins', deserialized.checkins)
        if (deserialized.fingerprint_templates) insertRows('fingerprint_templates', deserialized.fingerprint_templates)
        if (deserialized.payments) insertRows('payments', deserialized.payments)
        if (deserialized.staff) insertRows('staff', deserialized.staff)
        if (deserialized.activity_logs) insertRows('activity_logs', deserialized.activity_logs)
        if (deserialized.reminders) insertRows('reminders', deserialized.reminders)
        if (deserialized.guest_checkins) insertRows('guest_checkins', deserialized.guest_checkins)
        if (deserialized.settings) insertRows('settings', deserialized.settings)

        // Re-enable foreign key checks
        db!.pragma('foreign_keys = ON')
      })

      restoreAll()

      // P1 4.5: extract the on-disk photos folder from the backup (if present)
      const photoEntries = zipEntries.filter(e => e.entryName.startsWith('photos/'))
      if (photoEntries.length > 0) {
        ensurePhotoDir()
        for (const entry of photoEntries) {
          try {
            const filename = path.basename(entry.entryName)
            fs.writeFileSync(path.join(photoDir(), filename), entry.getData())
          } catch (e: any) {
            logMain('warn', 'Failed to extract photo from backup', { entry: entry.entryName, error: e.message })
          }
        }
      }
      // Re-run photo migration in case the backup stored legacy base64 photos
      migratePhotosToDisk()

      return { success: true }
    } catch (error: any) {
      console.error('Restore error:', error)
      return { success: false, reason: error.message }
    }
  })

  // ─── Reports ────────────────────────────────────────

  ipcMain.handle('get-daily-report', (_, date: string) => {
    try {
      return getDailyReportData(date || todayLocal())
    } catch (error) {
      console.error('get-daily-report error:', error)
      throw error
    }
  })

  ipcMain.handle('get-monthly-report', (_, yearMonth: string) => {
    try {
      // yearMonth format: 'YYYY-MM'
      const ym = yearMonth || todayLocal().slice(0, 7)

      // Parse the month boundaries
      const [y, m] = ym.split('-').map(Number)
      const monthStart = `${ym}-01`
      const nextMonth = m === 12 ? `${y + 1}-01` : `${ym.slice(0, 5)}${String(m + 1).padStart(2, '0')}-01`

      // Previous month for comparison
      const prevMonth = m === 1
        ? `${y - 1}-${String(12).padStart(2, '0')}`
        : `${ym.slice(0, 5)}${String(m - 1).padStart(2, '0')}`

      // Total revenue this month (completed payments only)
      const revenueRow = db?.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM payments WHERE strftime('%Y-%m', created_at, 'localtime') = ? AND status = 'completed'
      `).get(ym) as any

      // Total revenue last month
      const prevRevenueRow = db?.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM payments WHERE strftime('%Y-%m', created_at, 'localtime') = ? AND status = 'completed'
      `).get(prevMonth) as any

      // Weekly revenue breakdown (weeks 1-4)
      const weekly = db?.prepare(`
        SELECT
          CASE
            WHEN CAST(strftime('%d', created_at, 'localtime') AS INTEGER) <= 7 THEN 'Week 1'
            WHEN CAST(strftime('%d', created_at, 'localtime') AS INTEGER) <= 14 THEN 'Week 2'
            WHEN CAST(strftime('%d', created_at, 'localtime') AS INTEGER) <= 21 THEN 'Week 3'
            ELSE 'Week 4'
          END as week,
          COALESCE(SUM(amount), 0) as total,
          COUNT(*) as count
        FROM payments WHERE strftime('%Y-%m', created_at, 'localtime') = ? AND status = 'completed'
        GROUP BY week ORDER BY week
      `).all(ym) || []

      // Revenue by plan type (join via plan_id)
      const byPlanType = db?.prepare(`
        SELECT
          CASE
            WHEN pl.type IS NULL THEN 'no_plan'
            ELSE pl.type
          END as plan_type,
          COUNT(*) as count,
          COALESCE(SUM(p.amount), 0) as total
        FROM payments p
        LEFT JOIN plans pl ON p.plan_id = pl.id
        WHERE strftime('%Y-%m', p.created_at, 'localtime') = ? AND p.status = 'completed'
        GROUP BY plan_type ORDER BY total DESC
      `).all(ym) || []

      // Revenue by payment method
      const byMethod = db?.prepare(`
        SELECT payment_method, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
        FROM payments WHERE strftime('%Y-%m', created_at, 'localtime') = ? AND status = 'completed'
        GROUP BY payment_method
      `).all(ym) || []

      // New members this month
      const newMembersRow = db?.prepare(`
        SELECT COUNT(*) as count FROM members
        WHERE DATE(created_at, 'localtime') >= ? AND DATE(created_at, 'localtime') < ?
      `).get(monthStart, nextMonth) as any

      // Renewals this month
      const renewalsRow = db?.prepare(`
        SELECT COUNT(*) as count FROM payments
        WHERE type = 'renewal' AND strftime('%Y-%m', created_at, 'localtime') = ?
      `).get(ym) as any

      // Churned members (plan ended this month)
      const churnedRow = db?.prepare(`
        SELECT COUNT(*) as count FROM members
        WHERE DATE(plan_end) >= ? AND DATE(plan_end) < ? AND status = 'inactive' AND archived = 0
      `).get(monthStart, nextMonth) as any

      // Members with outstanding balance as of month-end
      const outstanding = db?.prepare(`
        SELECT id, member_id, name, balance
        FROM members WHERE balance > 0 AND archived = 0
        ORDER BY balance DESC LIMIT 50
      `).all() || []

      // Average revenue per active member
      const activeCountRow = db?.prepare(`
        SELECT COUNT(*) as count FROM members WHERE status = 'active' AND archived = 0
      `).get() as any

      const totalRevenue = revenueRow?.total || 0
      const activeCount = activeCountRow?.count || 1

      return {
        yearMonth: ym,
        totalRevenue,
        previousMonthRevenue: prevRevenueRow?.total || 0,
        percentChange: prevRevenueRow?.total
          ? ((totalRevenue - (prevRevenueRow?.total || 0)) / (prevRevenueRow?.total || 1)) * 100
          : 0,
        weekly,
        byPlanType,
        byMethod,
        newMembers: newMembersRow?.count || 0,
        renewals: renewalsRow?.count || 0,
        churned: churnedRow?.count || 0,
        outstanding,
        outstandingCount: outstanding.length,
        activeMemberCount: activeCount,
        avgRevenuePerMember: activeCount > 0 ? totalRevenue / activeCount : 0,
      }
    } catch (error) {
      console.error('get-monthly-report error:', error)
      throw error
    }
  })

  // Activity Logs
  ipcMain.handle('create-activity-log', (_, log) => {
    if (!log || !isNonEmptyString(log.action)) throw new Error('Invalid activity log')
    return db?.prepare(`
      INSERT INTO activity_logs (action, entity_type, entity_id, details, user)
      VALUES (?, ?, ?, ?, ?)
    `).run(log.action, log.entity_type || 'general', log.entity_id || null, log.details || null, log.user || 'staff')
  })

  // Filterable activity logs (P2 5.6): optional user + action filters
  ipcMain.handle('get-activity-logs', (_, opts?: { limit?: number; user?: string; action?: string; offset?: number }) => {
    const limit = clampNumber(opts?.limit, 1, 1000, 100)
    const offset = clampNumber(opts?.offset, 0, 1000000, 0)
    let sql = 'SELECT * FROM activity_logs WHERE 1=1'
    const params: any[] = []
    if (opts?.user && opts.user !== 'all') {
      sql += ' AND user = ?'
      params.push(opts.user)
    }
    if (opts?.action && opts.action !== 'all') {
      sql += ' AND action = ?'
      params.push(opts.action)
    }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)
    return db?.prepare(sql).all(...params) || []
  })

  // Kiosk window
  ipcMain.handle('open-kiosk-window', () => {
    createKioskWindow()
  })

  ipcMain.handle('close-kiosk-window', () => {
    if (kioskWindow && !kioskWindow.isDestroyed()) {
      kioskWindow.close()
      kioskWindow = null
    }
  })

  // Auto-updater
  ipcMain.handle('check-for-updates', async () => {
    try {
      autoUpdater.checkForUpdates()
      return { status: 'checking' }
    } catch (error: any) {
      return { status: 'error', message: error.message }
    }
  })

  ipcMain.handle('restart-app', () => {
    autoUpdater.quitAndInstall()
  })

  // Require a backup before applying an app update: silently write a backup to the
  // app's backup folder, then quit & install. If the backup fails, the update is aborted.
  ipcMain.handle('restart-app-with-backup', async () => {
    try {
      if (!db) throw new Error('Database not initialized')
      const dir = path.join(app.getPath('userData'), 'backups')
      fs.mkdirSync(dir, { recursive: true })
      const target = path.join(dir, `pre-update-${todayLocal()}-${Date.now()}.zip`)
      writeBackupZip(target)
      logMain('info', 'Pre-update backup created', { path: target })
      autoUpdater.quitAndInstall()
      return { success: true, path: target }
    } catch (error: any) {
      logMain('error', 'Pre-update backup failed — update aborted', { error: error.message })
      return { success: false, message: `Backup failed: ${error.message}. Update aborted.` }
    }
  })

  // ── License Activation ──
  ipcMain.handle('validate-license', async (_, licenseKey: string) => {
    try {
      const machineId = getMachineId()

      const response = await fetch('https://dtr-license-server.jencendencia.workers.dev/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: licenseKey, machineId }),
      })

      const data = await response.json() as { valid: boolean; message: string }

      if (data.valid) {
        // Save license info to settings
        db?.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('license_key', licenseKey)
        db?.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('machine_id', machineId)
        return { valid: true, message: data.message || 'License activated successfully!' }
      }

      return { valid: false, message: data.message || 'Invalid license key.' }
    } catch (error: any) {
      console.error('License validation error:', error)
      return { valid: false, message: 'Could not connect to license server. Check your internet connection.' }
    }
  })

  ipcMain.handle('get-license-info', async () => {
    try {
      const keyRow = db?.prepare('SELECT value FROM settings WHERE key = ?').get('license_key') as any
      const machineRow = db?.prepare('SELECT value FROM settings WHERE key = ?').get('machine_id') as any

      const currentMachineId = getMachineId()

      return {
        activated: !!(keyRow?.value && machineRow?.value === currentMachineId),
        machineId: currentMachineId,
        storedMachineId: machineRow?.value || null,
      }
    } catch (error) {
      return { activated: false, machineId: null, storedMachineId: null }
    }
  })

  // ── Auth / Staff ──
  ipcMain.handle('login', async (_, username: string, password: string) => {
    try {
      // Rate limiting: lock out the username after repeated failures
      const lockMs = isLoginLocked(username)
      if (lockMs > 0) {
        const mins = Math.ceil(lockMs / 60000)
        return {
          success: false,
          message: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
        }
      }

      const user = db?.prepare(
        'SELECT id, username, role, photo, display_name, password_hash FROM staff WHERE username = ?'
      ).get(username) as any

      if (!user || !verifyPassword(password, user.password_hash)) {
        recordFailedLogin(username)
        db?.prepare(
          'INSERT INTO activity_logs (action, entity_type, entity_id, details, user) VALUES (?, ?, ?, ?, ?)'
        ).run('login_failed', 'staff', user?.id ?? null, JSON.stringify({ username }), username)
        return { success: false, message: 'Invalid username or password' }
      }

      // Success — clear any failed-attempt counter
      loginAttempts.delete(username.toLowerCase())

      // Upgrade legacy SHA-256 hashes to scrypt on successful login
      if (!user.password_hash.startsWith(SCRYPT_PREFIX)) {
        db?.prepare('UPDATE staff SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id)
      }

      db?.prepare(
        'INSERT INTO activity_logs (action, entity_type, entity_id, details, user) VALUES (?, ?, ?, ?, ?)'
      ).run('login_success', 'staff', user.id, JSON.stringify({ username }), user.username)

      return {
        success: true,
        user: { id: user.id, username: user.username, role: user.role, photo: user.photo, display_name: user.display_name },
      }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  })

  ipcMain.handle('get-users', async () => {
    try {
      return db?.prepare('SELECT id, username, role, photo, display_name, created_at FROM staff ORDER BY username ASC').all() || []
    } catch (error: any) {
      throw error
    }
  })

  ipcMain.handle('create-user', async (_, user: { username: string; password: string; role: string; display_name?: string; photo?: string }) => {
    try {
      const err = validateUser(user, true)
      if (err) return { success: false, message: err }
      // Check if username already exists
      const existing = db?.prepare('SELECT id FROM staff WHERE username = ?').get(user.username) as any
      if (existing) {
        return { success: false, message: 'Username already exists' }
      }
      const hash = hashPassword(user.password)
      db?.prepare('INSERT INTO staff (username, password_hash, role, photo, display_name) VALUES (?, ?, ?, ?, ?)')
        .run(user.username, hash, user.role || 'staff', user.photo || null, user.display_name || null)
      return { success: true }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  })

  ipcMain.handle('update-user', async (_, id: number, user: { username?: string; password?: string; role?: string; display_name?: string; photo?: string }) => {
    try {
      const err = validateUser(user, false)
      if (err) return { success: false, message: err }
      if (user.password) {
        const hash = hashPassword(user.password)
        db?.prepare('UPDATE staff SET username=?, password_hash=?, role=?, photo=?, display_name=? WHERE id=?')
          .run(user.username, hash, user.role, user.photo || null, user.display_name || null, id)
      } else {
        db?.prepare('UPDATE staff SET username=?, role=?, photo=?, display_name=? WHERE id=?')
          .run(user.username, user.role, user.photo || null, user.display_name || null, id)
      }
      return { success: true }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  })

  ipcMain.handle('delete-user', async (_, id: number) => {
    try {
      // Don't allow deleting the last admin
      const adminCount = db?.prepare("SELECT COUNT(*) as count FROM staff WHERE role = 'admin'").get() as any
      const target = db?.prepare('SELECT role FROM staff WHERE id = ?').get(id) as any
      if (target?.role === 'admin' && adminCount?.count <= 1) {
        return { success: false, message: 'Cannot delete the last admin account' }
      }
      db?.prepare('DELETE FROM staff WHERE id = ?').run(id)
      return { success: true }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  })

  // ── SMTP Email ──
  ipcMain.handle('test-smtp', async () => {
    try {
      const { transport } = createSmtpTransport()
      await transport.verify()
      transport.close()
      return { success: true, message: 'SMTP connection successful!' }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  })

  ipcMain.handle('send-report-email', async (_, data: { html: string; recipient: string; appName: string; filename: string }) => {
    try {
      const { transport, fromEmail } = createSmtpTransport()

      const info = await transport.sendMail({
        from: `"${data.appName}" <${fromEmail}>`,
        to: data.recipient,
        subject: `Report from ${data.appName}`,
        html: data.html,
      })

      transport.close()
      return { success: true, message: `Email sent! Message ID: ${info.messageId}` }
    } catch (error: any) {
      console.error('send-report-email error:', error)
      return { success: false, message: error.message }
    }
  })

  // ── At-Risk Members (retention panel) ──
  // Flags active members whose attendance dropped significantly or who have gone quiet
  ipcMain.handle('get-at-risk-members', () => {
    autoExpireMembers()
    const rows = db?.prepare(`
      SELECT m.id, m.member_id, m.name, m.email, m.plan_end, p.name as plan_name,
        (SELECT COUNT(*) FROM checkins c WHERE c.member_id = m.id AND c.timestamp >= datetime('now', '-30 days')) as checkins_recent,
        (SELECT COUNT(*) FROM checkins c WHERE c.member_id = m.id AND c.timestamp >= datetime('now', '-60 days') AND c.timestamp < datetime('now', '-30 days')) as checkins_prev,
        (SELECT MAX(c.timestamp) FROM checkins c WHERE c.member_id = m.id) as last_checkin
      FROM members m
      LEFT JOIN plans p ON m.plan_id = p.id
      WHERE m.status = 'active' AND m.archived = 0
    `).all() as any[] || []

    const now = Date.now()
    const atRisk = rows
      .filter(m => {
        const recent = m.checkins_recent || 0
        const prev = m.checkins_prev || 0
        const last = m.last_checkin
          ? Math.floor((now - new Date(String(m.last_checkin).replace(' ', 'T') + 'Z').getTime()) / 86400000)
          : Infinity
        // Only flag 'gone quiet' for members who have actually checked in before
        // (a brand-new member with zero check-ins shouldn't be flagged as at-risk)
        const dropped = prev >= 2 && recent < prev * 0.5
        const goneQuiet = m.last_checkin && last >= 14
        return dropped || !!goneQuiet
      })
      .map(m => {
        const prev = m.checkins_prev || 0
        const recent = m.checkins_recent || 0
        const daysSinceLast = m.last_checkin
          ? Math.floor((now - new Date(String(m.last_checkin).replace(' ', 'T') + 'Z').getTime()) / 86400000)
          : null
        const dropPct = prev > 0 ? Math.round(((prev - recent) / prev) * 100) : 0
        return {
          id: m.id,
          member_id: m.member_id,
          name: m.name,
          email: m.email || null,
          plan_name: m.plan_name || null,
          plan_end: m.plan_end || null,
          checkins_recent: recent,
          checkins_prev: prev,
          drop_pct: Math.max(0, dropPct),
          days_since_last_checkin: daysSinceLast,
        }
      })
      .sort((a, b) => (b.drop_pct || b.days_since_last_checkin || 0) - (a.drop_pct || a.days_since_last_checkin || 0))
      .slice(0, 12)

    return atRisk
  })

  // ── Renewal reminder emails (deduplicated via reminders table) ──
  ipcMain.handle('send-renewal-reminders', async () => {
    try {
      const { transport, fromEmail } = createSmtpTransport()
      const today = todayLocal()
      const appNameRow = db?.prepare("SELECT value FROM settings WHERE key = 'appName'").get() as any
      const appDisplayName = appNameRow?.value || 'REPCHECK'

      // Active members with an email expiring in the next 7 days
      const expiring = db?.prepare(`
        SELECT m.id, m.name, m.email, m.plan_end, p.name as plan_name
        FROM members m
        LEFT JOIN plans p ON m.plan_id = p.id
        WHERE m.status = 'active' AND m.archived = 0 AND m.email IS NOT NULL AND m.email != ''
          AND m.plan_end IS NOT NULL AND m.plan_end != ''
          AND m.plan_end BETWEEN ? AND date(?, '+7 days')
      `).all(today, today) as any[] || []

      const results: { member_id: number; name: string; sent: boolean; message: string }[] = []

      for (const member of expiring) {
        // Dedupe: skip if a renewal reminder was sent in the last 7 days
        const recent = db?.prepare(`
          SELECT COUNT(*) as count FROM reminders
          WHERE member_id = ? AND type = 'renewal_reminder' AND sent_at >= datetime('now', '-7 days')
        `).get(member.id) as any
        if (recent?.count > 0) {
          results.push({ member_id: member.id, name: member.name, sent: false, message: 'Reminder already sent recently' })
          continue
        }

        const daysLeft = Math.max(0, Math.ceil((new Date(member.plan_end + 'T00:00:00').getTime() - Date.now()) / 86400000))
        const endLabel = new Date(member.plan_end + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        const html = `
          <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;color:#222">
            <h2 style="color:#1a1a2e;margin:0 0 4px">Hi ${member.name},</h2>
            <p>Your <strong>${member.plan_name || 'membership'}</strong> plan at <strong>${appDisplayName}</strong> expires on <strong>${endLabel}</strong> (${daysLeft} day${daysLeft === 1 ? '' : 's'} left).</p>
            <p>Renew at the front desk to keep your membership active without interruption.</p>
            <p style="color:#888;font-size:12px;margin-top:24px">— ${appDisplayName} · This is an automated reminder.</p>
          </div>`

        await transport.sendMail({
          from: `"${appDisplayName}" <${fromEmail}>`,
          to: member.email,
          subject: `Your ${appDisplayName} membership expires soon`,
          html,
        })

        db?.prepare('INSERT INTO reminders (member_id, type, channel) VALUES (?, ?, ?)')
          .run(member.id, 'renewal_reminder', 'email')
        results.push({ member_id: member.id, name: member.name, sent: true, message: 'Sent' })
      }

      transport.close()
      return {
        success: true,
        sent: results.filter(r => r.sent).length,
        skipped: results.filter(r => !r.sent).length,
        results,
      }
    } catch (error: any) {
      console.error('send-renewal-reminders error:', error)
      return { success: false, message: error.message, sent: 0, skipped: 0, results: [] }
    }
  })

  // ── P2 5.1: Printable member ID card (opens a print dialog) ──
  ipcMain.handle('print-id-card', async (_, html: string) => {
    try {
      const win = new BrowserWindow({
        width: 420,
        height: 620,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      })
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      await new Promise((resolve) => setTimeout(resolve, 400))
      const data = await win.webContents.print({ silent: false, printBackground: true })
      win.destroy()
      return { success: data } as any
    } catch (error: any) {
      console.error('print-id-card error:', error)
      return { success: false, message: error.message }
    }
  })

  // Window controls
  ipcMain.handle('minimize-window', () => mainWindow?.minimize())
  ipcMain.handle('maximize-window', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('close-window', () => mainWindow?.close())
}

// ── Auto-Updater ──
function setupAutoUpdater() {
  // Configure autoUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  // Listen for events
  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('update-status', { status: 'checking', message: 'Checking for updates...' })
  })

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-status', {
      status: 'available',
      message: `Version ${info.version} is available`,
      version: info.version,
      info,
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    mainWindow?.webContents.send('update-status', {
      status: 'up-to-date',
      message: 'You\'re on the latest version!',
      info,
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent)
    mainWindow?.webContents.send('update-status', {
      status: 'downloading',
      message: `Downloading update... ${pct}%`,
      percent: pct,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('error', (error) => {
    mainWindow?.webContents.send('update-status', {
      status: 'error',
      message: `Update error: ${error.message}`,
      error: error.message,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-status', {
      status: 'downloaded',
      message: 'Update ready to install. Restart to apply?',
      version: info.version,
      info,
    })
  })
}

// ── Automated end-of-day report email ──
// Settings: autoReportEnabled ('true'), autoReportHour (0-23), reportOwnerEmail.
function setupAutoReport() {
  const run = () => {
    try {
      sendAutoDailyReport()
    } catch (error: any) {
      logMain('error', 'Auto report tick failed', { error: error.message })
    }
  }
  // Check every minute so no timer alignment is needed
  setInterval(run, 60 * 1000)
  // Also run once shortly after startup (in case the app was opened at the scheduled hour)
  setTimeout(run, 10 * 1000)
}

// ── Automated scheduled backups (P1 4.3) ──
// Settings: backup_enabled ('true'), backup_hour (0-23), backup_keep (count).
function setupAutoBackup() {
  const runScheduledBackup = () => {
    try {
      const enabledRow = db?.prepare("SELECT value FROM settings WHERE key = 'backup_enabled'").get() as any
      if (enabledRow?.value !== 'true') return
      const hourRow = db?.prepare("SELECT value FROM settings WHERE key = 'backup_hour'").get() as any
      const keepRow = db?.prepare("SELECT value FROM settings WHERE key = 'backup_keep'").get() as any
      const hour = clampNumber(hourRow?.value, 0, 23, 23)
      const keep = clampNumber(keepRow?.value, 1, 60, 7)
      const nowHour = new Date().getHours()
      if (nowHour !== hour) return
      // Only back up once per day
      const lastRow = db?.prepare("SELECT value FROM settings WHERE key = 'last_auto_backup'").get() as any
      if (lastRow?.value === todayLocal()) return

      const dir = path.join(app.getPath('userData'), 'backups')
      fs.mkdirSync(dir, { recursive: true })
      const target = path.join(dir, `auto-${todayLocal()}.zip`)
      writeBackupZip(target)
      db?.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_auto_backup', ?)").run(todayLocal())
      logMain('info', 'Automated backup completed', { path: target })

      // Prune old auto backups, keeping the newest N
      try {
        const files = fs.readdirSync(dir).filter(f => f.startsWith('auto-') && f.endsWith('.zip')).sort()
        while (files.length > keep) {
          const old = files.shift()
          if (old) fs.unlinkSync(path.join(dir, old))
        }
      } catch { /* non-fatal */ }
    } catch (error: any) {
      logMain('error', 'Automated backup failed', { error: error.message })
    }
  }

  // Check every minute so no timer alignment is needed
  setInterval(runScheduledBackup, 60 * 1000)
}

app.whenReady().then(() => {
  try {
    console.log('Starting REPCHECK...')
    initDatabase()
    console.log('Database initialized successfully')
    // P1 4.5: serve member photos from disk (must be registered before windows load)
    registerPhotoProtocol()
    autoExpireMembers()
    setupIPC()
    console.log('IPC handlers set up')

    // Allow camera (QR check-in scanning) and desktop notifications in the renderer
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'media' || permission === 'notifications')
    })

    createWindow()
    console.log('Window created')
    setupKioskAutoLaunch()
    console.log('Kiosk auto-launch configured')
    setupAutoBackup()
    console.log('Auto-backup scheduler started')
    setupAutoReport()
    console.log('Auto-report scheduler started')
  } catch (error) {
    console.error('Failed to start app:', error)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  db?.close()
})
