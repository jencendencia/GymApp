import { app, BrowserWindow, ipcMain, dialog, screen, shell } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import AdmZip from 'adm-zip'
import nodemailer from 'nodemailer'
import { autoUpdater } from 'electron-updater'

let mainWindow: BrowserWindow | null = null
let kioskWindow: BrowserWindow | null = null
let db: Database.Database | null = null

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'repcheck.db')
  db = new Database(dbPath)
  
  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL')

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
      staff_id INTEGER,
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
    { table: 'payments', column: 'staff_id', def: 'INTEGER DEFAULT NULL' },
    { table: 'checkins', column: 'checked_out_at', def: 'DATETIME DEFAULT NULL' },
    { table: 'members', column: 'waiver_agreed_at', def: 'DATETIME DEFAULT NULL' },
    { table: 'staff', column: 'photo', def: 'TEXT DEFAULT NULL' },
    { table: 'staff', column: 'display_name', def: 'TEXT DEFAULT NULL' },
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
    const hash = crypto.createHash('sha256').update('admin').digest('hex')
    db?.prepare('INSERT INTO staff (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)')
      .run('admin', hash, 'admin', 'Administrator')
    console.log('Default admin user created (admin/admin)')
  }

  return db
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

// Auto-expire members whose plan_end has passed
function autoExpireMembers() {
  db?.prepare(`
    UPDATE members SET status = 'inactive'
    WHERE plan_end IS NOT NULL AND plan_end < date('now') AND status = 'active'
  `).run()
}

// IPC Handlers
function setupIPC() {
  // Members
  ipcMain.handle('get-members', async () => {
    try {
      autoExpireMembers()
      return db?.prepare(`
        SELECT m.*, p.name as plan_name, c.name as coach_name
        FROM members m
        LEFT JOIN plans p ON m.plan_id = p.id
        LEFT JOIN coaches c ON m.coach_id = c.id
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
      WHERE m.id = ?
    `).get(id)
  })

  ipcMain.handle('check-member-id-exists', (_, memberId: string) => {
    const existing = db?.prepare('SELECT id, name FROM members WHERE member_id = ?').get(memberId) as any
    return existing || null
  })

  ipcMain.handle('create-member', (_, member) => {
    return db?.prepare(`
      INSERT INTO members (member_id, name, email, phone, photo, emergency_contact, emergency_phone, plan_id, plan_start, plan_end, height, weight, birthday, coach_id, coaching_start, coaching_end, balance, waiver_agreed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      member.member_id,
      member.name,
      member.email,
      member.phone,
      member.photo || null,
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
      member.waiver_agreed_at || null
    )
  })

  ipcMain.handle('update-member', (_, id: number, member) => {
    return db?.prepare(`
      UPDATE members SET name = ?, email = ?, phone = ?, photo = ?, emergency_contact = ?, emergency_phone = ?, plan_id = ?, plan_start = ?, plan_end = ?, height = ?, weight = ?, birthday = ?, coach_id = ?, coaching_start = ?, coaching_end = ?, balance = ?, status = ?, waiver_agreed_at = ?
      WHERE id = ?
    `).run(
      member.name,
      member.email,
      member.phone,
      member.photo || null,
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
      id
    )
  })

  ipcMain.handle('delete-member', (_, id: number) => {
    return db?.prepare('DELETE FROM members WHERE id = ?').run(id)
  })

  ipcMain.handle('search-members', (_, query: string) => {
    autoExpireMembers()
    return db?.prepare(`
      SELECT m.*, p.name as plan_name, c.name as coach_name
      FROM members m
      LEFT JOIN plans p ON m.plan_id = p.id
      LEFT JOIN coaches c ON m.coach_id = c.id
      WHERE m.name LIKE ? OR m.member_id LIKE ? OR m.email LIKE ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`)
  })

  // Plans
  ipcMain.handle('get-plans', () => {
    return db?.prepare('SELECT * FROM plans').all()
  })

  ipcMain.handle('create-plan', (_, plan) => {
    return db?.prepare(`
      INSERT INTO plans (name, type, duration_days, sessions, price)
      VALUES (?, ?, ?, ?, ?)
    `).run(plan.name, plan.type, plan.duration_days, plan.sessions, plan.price)
  })

  ipcMain.handle('update-plan', (_, id: number, plan) => {
    return db?.prepare(`
      UPDATE plans SET name = ?, type = ?, duration_days = ?, sessions = ?, price = ?
      WHERE id = ?
    `).run(plan.name, plan.type, plan.duration_days, plan.sessions, plan.price, id)
  })

  ipcMain.handle('delete-plan', (_, id: number) => {
    return db?.prepare('DELETE FROM plans WHERE id = ?').run(id)
  })

  // Check-ins
  ipcMain.handle('get-checkins', (_, date?: string) => {
    if (date) {
      return db?.prepare(`
        SELECT c.*, m.name, m.member_id as member_code, m.photo as member_photo
        FROM checkins c
        JOIN members m ON c.member_id = m.id
        WHERE DATE(c.timestamp) = ?
        ORDER BY c.timestamp DESC
      `).all(date)
    }
    return db?.prepare(`
      SELECT c.*, m.name, m.member_id as member_code, m.photo as member_photo
      FROM checkins c
      JOIN members m ON c.member_id = m.id
      ORDER BY c.timestamp DESC
      LIMIT 100
    `).all()
  })

  ipcMain.handle('get-active-checkins', () => {
    const today = new Date().toISOString().split('T')[0]
    return db?.prepare(`
      SELECT c.*, m.name, m.member_id as member_code, m.photo as member_photo, m.balance
      FROM checkins c
      JOIN members m ON c.member_id = m.id
      WHERE DATE(c.timestamp) = ? AND c.checked_out_at IS NULL
      ORDER BY c.timestamp ASC
    `).all(today) || []
  })

  ipcMain.handle('checkout-member', (_, checkinId: number) => {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
    db?.prepare('UPDATE checkins SET checked_out_at = ? WHERE id = ?').run(now, checkinId)
    return { success: true }
  })

  ipcMain.handle('create-checkin', (_, checkin) => {
    return db?.prepare(`
      INSERT INTO checkins (member_id, method, match_confidence, status)
      VALUES (?, ?, ?, ?)
    `).run(checkin.member_id, checkin.method, checkin.match_confidence, checkin.status)
  })

  ipcMain.handle('get-today-stats', () => {
    autoExpireMembers()
    const today = new Date().toISOString().split('T')[0]
    const totalCheckins = db?.prepare(`
      SELECT COUNT(*) as count FROM checkins WHERE DATE(timestamp) = ?
    `).get(today) as any

    const activeMembers = db?.prepare(`
      SELECT COUNT(*) as count FROM members WHERE status = 'active'
    `).get() as any

    const expiredMembers = db?.prepare(`
      SELECT COUNT(*) as count FROM members WHERE status = 'expired'
    `).get() as any

    const expiringThisWeek = db?.prepare(`
      SELECT COUNT(*) as count FROM members 
      WHERE plan_end BETWEEN ? AND date(?, '+7 days')
      AND status = 'active'
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
    const today = new Date().toISOString().split('T')[0]
    return db?.prepare(`
      SELECT m.*, p.name as plan_name, c.name as coach_name
      FROM members m
      LEFT JOIN plans p ON m.plan_id = p.id
      LEFT JOIN coaches c ON m.coach_id = c.id
      WHERE m.plan_end BETWEEN ? AND date(?, '+7 days')
      AND m.status = 'active'
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

  ipcMain.handle('match-fingerprint', (_, template: Buffer) => {
    // In a real app, this would use SourceAFIS or similar library
    // For now, return a simulated match
    return { matched: false, memberId: null, confidence: 0 }
  })

  // Payments
  ipcMain.handle('get-payments', (_, memberId?: number) => {
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
      LIMIT 100
    `).all()
  })

  ipcMain.handle('create-payment', (_, payment) => {
    return db?.prepare(`
      INSERT INTO payments (member_id, amount, type, plan_id, payment_method, staff_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      payment.member_id,
      payment.amount,
      payment.type,
      payment.plan_id,
      payment.payment_method || 'cash',
      payment.staff_id || null
    )
  })

  // Coaches
  ipcMain.handle('get-coaches', () => {
    return db?.prepare('SELECT * FROM coaches ORDER BY name ASC').all()
  })

  ipcMain.handle('get-coach', (_, id: number) => {
    return db?.prepare('SELECT * FROM coaches WHERE id = ?').get(id)
  })

  ipcMain.handle('create-coach', (_, coach) => {
    return db?.prepare(`
      INSERT INTO coaches (name, email, phone, specialty, professional_fee)
      VALUES (?, ?, ?, ?, ?)
    `).run(coach.name, coach.email || null, coach.phone || null, coach.specialty || null, coach.professional_fee ?? 0)
  })

  ipcMain.handle('update-coach', (_, id: number, coach) => {
    return db?.prepare(`
      UPDATE coaches SET name = ?, email = ?, phone = ?, specialty = ?, professional_fee = ?
      WHERE id = ?
    `).run(coach.name, coach.email || null, coach.phone || null, coach.specialty || null, coach.professional_fee ?? 0, id)
  })

  ipcMain.handle('delete-coach', (_, id: number) => {
    // Unassign members from this coach before deleting
    db?.prepare('UPDATE members SET coach_id = NULL WHERE coach_id = ?').run(id)
    return db?.prepare('DELETE FROM coaches WHERE id = ?').run(id)
  })

  ipcMain.handle('get-coach-members', (_, coachId: number) => {
    autoExpireMembers()
    return db?.prepare(`
      SELECT m.*, p.name as plan_name, c.name as coach_name
      FROM members m
      LEFT JOIN plans p ON m.plan_id = p.id
      LEFT JOIN coaches c ON m.coach_id = c.id
      WHERE m.coach_id = ?
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
    rows.forEach(row => { settings[row.key] = row.value })
    return settings
  })

  ipcMain.handle('get-setting', (_, key: string) => {
    const row = db?.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
    return row?.value || null
  })

  ipcMain.handle('save-setting', (_, key: string, value: string) => {
    return db?.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
  })

  ipcMain.handle('save-settings', (_, settings: Record<string, string>) => {
    const stmt = db?.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    const insertMany = db?.transaction((entries: [string, string][]) => {
      entries.forEach(([key, value]) => stmt?.run(key, value))
    })
    insertMany(Object.entries(settings))
  })

  // Backup & Restore
  ipcMain.handle('create-backup', async () => {
    try {
      if (!db) throw new Error('Database not initialized')

      // Export all data from every table
      const backupData: Record<string, any[]> = {
        members: db.prepare('SELECT * FROM members').all() as any[],
        plans: db.prepare('SELECT * FROM plans').all() as any[],
        checkins: db.prepare('SELECT * FROM checkins').all() as any[],
        fingerprint_templates: db.prepare('SELECT * FROM fingerprint_templates').all() as any[],
        payments: db.prepare('SELECT * FROM payments').all() as any[],
        coaches: db.prepare('SELECT * FROM coaches').all() as any[],
        settings: db.prepare('SELECT * FROM settings').all() as any[],
      }

      // Serialize Buffer fields to base64 strings for JSON compatibility
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

      const jsonContent = JSON.stringify(serialized, null, 2)

      // Show save dialog
      const defaultName = `repcheck-backup-${new Date().toISOString().split('T')[0]}.zip`
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Save Backup',
        defaultPath: defaultName,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      })

      if (result.canceled || !result.filePath) return { success: false, reason: 'cancelled' }

      // Create zip with the JSON data
      const zip = new AdmZip()
      zip.addFile('data.json', Buffer.from(jsonContent, 'utf-8'))
      zip.writeZip(result.filePath)

      // Also save a timestamp of this backup in settings
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_backup', ?)")
        .run(new Date().toISOString())

      return { success: true, path: result.filePath }
    } catch (error: any) {
      console.error('Backup error:', error)
      return { success: false, reason: error.message }
    }
  })

  ipcMain.handle('restore-backup', async () => {
    try {
      if (!db) throw new Error('Database not initialized')

      // Show open dialog
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Select Backup File',
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, reason: 'cancelled' }
      }

      const zipPath = result.filePaths[0]

      // Read and parse the zip
      const zip = new AdmZip(zipPath)
      const zipEntries = zip.getEntries()

      const dataEntry = zipEntries.find(e => e.entryName === 'data.json')
      if (!dataEntry) {
        return { success: false, reason: 'Invalid backup file: data.json not found' }
      }

      const jsonData = dataEntry.getData().toString('utf-8')
      const backupData: Record<string, any[]> = JSON.parse(jsonData)

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
        db!.exec('DELETE FROM members')
        db!.exec('DELETE FROM plans')
        db!.exec('DELETE FROM coaches')
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
        if (deserialized.checkins) insertRows('checkins', deserialized.checkins)
        if (deserialized.fingerprint_templates) insertRows('fingerprint_templates', deserialized.fingerprint_templates)
        if (deserialized.payments) insertRows('payments', deserialized.payments)
        if (deserialized.settings) insertRows('settings', deserialized.settings)

        // Re-enable foreign key checks
        db!.pragma('foreign_keys = ON')
      })

      restoreAll()

      return { success: true }
    } catch (error: any) {
      console.error('Restore error:', error)
      return { success: false, reason: error.message }
    }
  })

  // ─── Reports ────────────────────────────────────────

  ipcMain.handle('get-daily-report', (_, date: string) => {
    try {
      const today = date || new Date().toISOString().split('T')[0]

      // Total revenue for the day
      const totalRevenueRow = db?.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM payments WHERE DATE(created_at) = ?
      `).get(today) as any

      // Revenue by payment type
      const byType = db?.prepare(`
        SELECT type, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
        FROM payments WHERE DATE(created_at) = ?
        GROUP BY type
      `).all(today) || []

      // Revenue by payment method
      const byMethod = db?.prepare(`
        SELECT payment_method, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
        FROM payments WHERE DATE(created_at) = ?
        GROUP BY payment_method
      `).all(today) || []

      // Itemized transaction list
      const transactions = db?.prepare(`
        SELECT p.*, m.name as member_name, m.member_id as member_code, pl.name as plan_name
        FROM payments p
        JOIN members m ON p.member_id = m.id
        LEFT JOIN plans pl ON p.plan_id = pl.id
        WHERE DATE(p.created_at) = ?
        ORDER BY p.created_at DESC
      `).all(today) || []

      // New members enrolled today
      const newMembersRow = db?.prepare(`
        SELECT COUNT(*) as count FROM members WHERE DATE(created_at) = ?
      `).get(today) as any

      // Renewals today
      const renewalsRow = db?.prepare(`
        SELECT COUNT(*) as count FROM payments
        WHERE type = 'renewal' AND DATE(created_at) = ?
      `).get(today) as any

      // Members with outstanding balance who checked in today
      const outstanding = db?.prepare(`
        SELECT DISTINCT m.id, m.member_id, m.name, m.balance
        FROM members m
        JOIN checkins c ON c.member_id = m.id
        WHERE DATE(c.timestamp) = ? AND m.balance > 0
        ORDER BY m.balance DESC
      `).all(today) || []

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
    } catch (error) {
      console.error('get-daily-report error:', error)
      throw error
    }
  })

  ipcMain.handle('get-monthly-report', (_, yearMonth: string) => {
    try {
      // yearMonth format: 'YYYY-MM'
      const ym = yearMonth || new Date().toISOString().slice(0, 7)

      // Parse the month boundaries
      const [y, m] = ym.split('-').map(Number)
      const monthStart = `${ym}-01`
      const nextMonth = m === 12 ? `${y + 1}-01` : `${ym.slice(0, 5)}${String(m + 1).padStart(2, '0')}-01`

      // Previous month for comparison
      const prevMonth = m === 1
        ? `${y - 1}-${String(12).padStart(2, '0')}`
        : `${ym.slice(0, 5)}${String(m - 1).padStart(2, '0')}`

      // Total revenue this month
      const revenueRow = db?.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM payments WHERE strftime('%Y-%m', created_at) = ?
      `).get(ym) as any

      // Total revenue last month
      const prevRevenueRow = db?.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM payments WHERE strftime('%Y-%m', created_at) = ?
      `).get(prevMonth) as any

      // Weekly revenue breakdown (weeks 1-4)
      const weekly = db?.prepare(`
        SELECT
          CASE
            WHEN CAST(strftime('%d', created_at) AS INTEGER) <= 7 THEN 'Week 1'
            WHEN CAST(strftime('%d', created_at) AS INTEGER) <= 14 THEN 'Week 2'
            WHEN CAST(strftime('%d', created_at) AS INTEGER) <= 21 THEN 'Week 3'
            ELSE 'Week 4'
          END as week,
          COALESCE(SUM(amount), 0) as total,
          COUNT(*) as count
        FROM payments WHERE strftime('%Y-%m', created_at) = ?
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
        WHERE strftime('%Y-%m', p.created_at) = ?
        GROUP BY plan_type ORDER BY total DESC
      `).all(ym) || []

      // Revenue by payment method
      const byMethod = db?.prepare(`
        SELECT payment_method, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
        FROM payments WHERE strftime('%Y-%m', created_at) = ?
        GROUP BY payment_method
      `).all(ym) || []

      // New members this month
      const newMembersRow = db?.prepare(`
        SELECT COUNT(*) as count FROM members
        WHERE DATE(created_at) >= ? AND DATE(created_at) < ?
      `).get(monthStart, nextMonth) as any

      // Renewals this month
      const renewalsRow = db?.prepare(`
        SELECT COUNT(*) as count FROM payments
        WHERE type = 'renewal' AND strftime('%Y-%m', created_at) = ?
      `).get(ym) as any

      // Churned members (plan ended this month)
      const churnedRow = db?.prepare(`
        SELECT COUNT(*) as count FROM members
        WHERE DATE(plan_end) >= ? AND DATE(plan_end) < ? AND status = 'inactive'
      `).get(monthStart, nextMonth) as any

      // Members with outstanding balance as of month-end
      const outstanding = db?.prepare(`
        SELECT id, member_id, name, balance
        FROM members WHERE balance > 0
        ORDER BY balance DESC LIMIT 50
      `).all() || []

      // Average revenue per active member
      const activeCountRow = db?.prepare(`
        SELECT COUNT(*) as count FROM members WHERE status = 'active'
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
    return db?.prepare(`
      INSERT INTO activity_logs (action, entity_type, entity_id, details, user)
      VALUES (?, ?, ?, ?, ?)
    `).run(log.action, log.entity_type, log.entity_id || null, log.details || null, log.user || 'staff')
  })

  ipcMain.handle('get-activity-logs', (_, limit?: number) => {
    return db?.prepare(`
      SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ?
    `).all(limit || 100)
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
      const hash = crypto.createHash('sha256').update(password).digest('hex')
      const user = db?.prepare('SELECT id, username, role, photo, display_name FROM staff WHERE username = ? AND password_hash = ?')
        .get(username, hash) as any
      if (user) {
        return { success: true, user }
      }
      return { success: false, message: 'Invalid username or password' }
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
      // Check if username already exists
      const existing = db?.prepare('SELECT id FROM staff WHERE username = ?').get(user.username) as any
      if (existing) {
        return { success: false, message: 'Username already exists' }
      }
      const hash = crypto.createHash('sha256').update(user.password).digest('hex')
      db?.prepare('INSERT INTO staff (username, password_hash, role, photo, display_name) VALUES (?, ?, ?, ?, ?)')
        .run(user.username, hash, user.role || 'staff', user.photo || null, user.display_name || null)
      return { success: true }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  })

  ipcMain.handle('update-user', async (_, id: number, user: { username?: string; password?: string; role?: string; display_name?: string; photo?: string }) => {
    try {
      if (user.password) {
        const hash = crypto.createHash('sha256').update(user.password).digest('hex')
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
          pass: pass?.value || '',
        },
      }),
      fromEmail: fromEmail?.value || user?.value || '',
    }
  }

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

app.whenReady().then(() => {
  try {
    console.log('Starting REPCHECK...')
    initDatabase()
    console.log('Database initialized successfully')
    autoExpireMembers()
    setupIPC()
    console.log('IPC handlers set up')
    createWindow()
    console.log('Window created')
    setupKioskAutoLaunch()
    console.log('Kiosk auto-launch configured')
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
