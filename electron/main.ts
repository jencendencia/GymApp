import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import Database from 'better-sqlite3'
import AdmZip from 'adm-zip'

let mainWindow: BrowserWindow | null = null
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
      sessions_used INTEGER DEFAULT 0,
      balance REAL DEFAULT 0,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'expired')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (plan_id) REFERENCES plans(id)
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id),
      FOREIGN KEY (plan_id) REFERENCES plans(id)
    );

    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'staff' CHECK(role IN ('admin', 'staff')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)

  return db
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

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// IPC Handlers
function setupIPC() {
  // Members
  ipcMain.handle('get-members', async () => {
    try {
      return db?.prepare(`
        SELECT m.*, p.name as plan_name
        FROM members m
        LEFT JOIN plans p ON m.plan_id = p.id
      `).all() || []
    } catch (error) {
      console.error('get-members error:', error)
      throw error
    }
  })

  ipcMain.handle('get-member', (_, id: number) => {
    return db?.prepare(`
      SELECT m.*, p.name as plan_name
      FROM members m
      LEFT JOIN plans p ON m.plan_id = p.id
      WHERE m.id = ?
    `).get(id)
  })

  ipcMain.handle('create-member', (_, member) => {
    return db?.prepare(`
      INSERT INTO members (member_id, name, email, phone, photo, emergency_contact, emergency_phone, plan_id, plan_start, plan_end, balance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      member.balance
    )
  })

  ipcMain.handle('update-member', (_, id: number, member) => {
    return db?.prepare(`
      UPDATE members SET name = ?, email = ?, phone = ?, photo = ?, emergency_contact = ?, emergency_phone = ?, plan_id = ?, plan_start = ?, plan_end = ?, balance = ?, status = ?
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
      member.balance,
      member.status,
      id
    )
  })

  ipcMain.handle('delete-member', (_, id: number) => {
    return db?.prepare('DELETE FROM members WHERE id = ?').run(id)
  })

  ipcMain.handle('search-members', (_, query: string) => {
    return db?.prepare(`
      SELECT m.*, p.name as plan_name
      FROM members m
      LEFT JOIN plans p ON m.plan_id = p.id
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

  ipcMain.handle('create-checkin', (_, checkin) => {
    return db?.prepare(`
      INSERT INTO checkins (member_id, method, match_confidence, status)
      VALUES (?, ?, ?, ?)
    `).run(checkin.member_id, checkin.method, checkin.match_confidence, checkin.status)
  })

  ipcMain.handle('get-today-stats', () => {
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
    const today = new Date().toISOString().split('T')[0]
    return db?.prepare(`
      SELECT m.*, p.name as plan_name
      FROM members m
      LEFT JOIN plans p ON m.plan_id = p.id
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
      INSERT INTO payments (member_id, amount, type, plan_id)
      VALUES (?, ?, ?, ?)
    `).run(payment.member_id, payment.amount, payment.type, payment.plan_id)
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

app.whenReady().then(() => {
  try {
    console.log('Starting REPCHECK...')
    initDatabase()
    console.log('Database initialized successfully')
    setupIPC()
    console.log('IPC handlers set up')
    createWindow()
    console.log('Window created')
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
