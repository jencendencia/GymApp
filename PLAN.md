# REPCHECK — App Improvement Plan

> **Goal:** A prioritized roadmap of improvements for REPCHECK, the fingerprint gym check-in system.
> Built from a full code audit (React + Electron + better-sqlite3) and research into modern gym management software (Mindbody, Glofox, Zenoti, Club OS, PushPress).
>
> **Legend:** 🐛 = bug · 🔒 = security · 💾 = data/reliability · ✨ = feature · 🧹 = tech debt
> **Priority:** P0 = should do ASAP · P1 = high value · P2 = nice to have

---

## 1. Current State Summary

| Area | What exists today |
|---|---|
| **Core stack** | Electron + React 18 + TypeScript + Vite, SQLite (better-sqlite3, WAL mode) |
| **Check-in** | Kiosk with WebAuthn fingerprint (Windows Hello / U.R.U. 4500), manual search, member-ID entry, override entry, active-check-in/check-out |
| **Members** | CRUD, photo, emergency contacts, height/weight/birthday, plan + coach assignment, payment, waiver (required), balance tracking |
| **Plans** | monthly / quarterly / annual / session_pack / family, CRUD |
| **Coaches** | CRUD, member assignment, coach fee payments, daily/monthly fee tracking |
| **Payments** | cash + method, new_plan / renewal / top_up types, per-member history |
| **Reports** | daily + monthly revenue reports (by type/method/weekly), SMTP email delivery |
| **Staff** | login (admin/staff roles), CRUD users, per-page admin gating (Users, Settings), audit activity log |
| **Ops** | manual backup/restore (ZIP), GitHub auto-updater, online license activation, secondary-monitor kiosk window |
| **Tests** | ❌ none — no test framework configured |

---

## 2. P0 — Bugs & Data Integrity (do first)

### 🐛 2.1 Expired-member stat is always 0
`electron/main.ts` — `autoExpireMembers()` sets `status = 'inactive'`, but `get-today-stats` counts `status = 'expired'`. Nothing ever sets `'expired'`, so the Dashboard/RightPanel "Expired Members" tile is permanently 0.
**Fix:** `autoExpireMembers` should set `'expired'` (and optionally mark members whose `plan_end` was never given / canceled as `'inactive'`). Keep the kiosk `expired` state working with the same value.

### 🐛 2.2 Backups omit tables → silent data loss on restore
`create-backup` exports only `members, plans, checkins, fingerprint_templates, payments, coaches, settings` — it **excludes `staff`, `activity_logs`, and `coach_fee_payments`**. Restore deletes and re-inserts only the 7 exported tables (the other tables' rows survive), but since those 3 tables are never in the backup file, staff accounts, audit logs, and coach fee history are **not preserved if the database is ever lost or replaced**. 
**Fix:** export all 10 tables; validate backup schema on restore; add a "data integrity" check.

### 🐛 2.3 Session-pack plans are not enforced
`sessions_used` exists on members but nothing increments/decrements it, and the kiosk never blocks a member with 0 remaining sessions. `session_pack` plans are effectively time-unlimited.
**Fix:** decrement on successful check-in (per-day), block when exhausted, show remaining sessions on kiosk/profile. Create also an alert or make the whole modal theme red when expired members login. 

### 🐛 2.4 Duplicate check-ins are allowed
A member can fingerprint in repeatedly (multiple success rows per day). Many gyms want one check-in per day (or an "already checked in / currently inside" message).
**Fix:** dedupe per day in `create-checkin` (configurable via setting), and/or surface "currently checked in" state in the kiosk.

### 🐛 2.5 Kiosk "Renew Plan" button is a stub
`handleRenew` only `console.log`s. On the expired screen, tapping Renew does nothing.
**Fix:** open the renewal flow (reuse Members' new-plan modal or add a compact kiosk renewal dialog that records a `renewal` payment and extends `plan_end`).

### 🐛 2.6 Fingerprint "match" is simulated
`match-fingerprint` always returns `{ matched: false, memberId: null, confidence: 0 }`; `saveFingerprintCredential` stores credential IDs as templates. Kiosk relies on WebAuthn `allowCredentials` enumeration instead — which works, but the `matchFingerprint` IPC surface and Settings "Match Confidence Threshold" imply real 1:N matching.
**Fix (decision needed):** remove the fake IPC + threshold setting, or implement real template matching (SourceAFIS) against stored templates for true 1:N fingerprint scan.

### 🐛 2.7 Settings toggles are dead
`scannerEnabled`, `matchThreshold`, `showMemberPhotos`, `enableNotifications`, `autoLockTimeout` are saved but **never read** anywhere except the Settings page. Turning them off does nothing.
**Fix:** wire them up (kiosk respects `scannerEnabled`; `enableNotifications` gates desktop notifications; `showMemberPhotos` gates photo display; `autoLockTimeout` locks the kiosk after idle) — or remove them.

### 🐛 2.8 `create-backup` uses `mainWindow!` — crash if window closed
If the main window is closed while the kiosk window is still open, backup/restore `dialog.showSaveDialog(mainWindow!)` can throw.
**Fix:** null-check and fall back to a standalone dialog.

---

## 3. P1 — Security Hardening

### 🔒 3.1 Password hashing is weak
Staff passwords are hashed with **plain SHA-256, no salt** (`crypto.createHash('sha256')`). Fast to brute-force; default `admin/admin` is seeded with a known hash.
**Fix:** use salted, slow hashing — `bcrypt` (via `bcryptjs` to avoid native rebuild) or Node's built-in `crypto.scrypt` with per-user salt + timing-safe compare. Force a password change on first login for the default admin. Migrate existing hashes (force reset or versioned hash upgrade on next login).

### 🔒 3.2 No rate limiting / lockout on login
`login` IPC can be hammered. Any local user can brute-force admin credentials.
**Fix:** exponential backoff after N failures per username/IP, temporary lockout, and log failed attempts to `activity_logs`.

### 🔒 3.3 No input validation / parameter sanitization on IPC
All `ipcMain.handle` callbacks trust renderer input: arbitrary `role`, huge strings, negative prices, invalid dates, `type` values outside the CHECK constraint (will throw), `deleteMember` with a plan still referenced, etc.
**Fix:** add a validation layer per handler (types, ranges, enums, required fields) with consistent error objects.

### 🔒 3.4 `delete-member` leaves orphaned records
Deleting a member does not cascade to `checkins`, `payments`, `fingerprint_templates`, `coach_fee_payments`. `foreign_keys` pragma is only toggled during restore — it is **off in normal operation**, so orphans accumulate silently.
**Fix:** enable `PRAGMA foreign_keys = ON` at init + add `ON DELETE CASCADE` (or soft-delete members with an `archived` flag to preserve history).

### 🔒 3.5 No Content-Security-Policy
`index.html` has no CSP meta tag; the renderer loads remote images (member photos) and the license check hits a remote URL.
**Fix:** add a strict CSP; enable Electron `sandbox: true` in webPreferences; review `shell.openExternal` usage.

### 🔒 3.6 Backups & SMTP credentials unencrypted
Backup ZIPs contain PII and fingerprint data with no password; SMTP password is stored in plaintext in `settings`.
**Fix:** optional AES encryption for backups (passphrase), and store SMTP secrets in Windows Credential Manager or Electron `safeStorage` instead of the settings table.

### 🔒 3.7 Machine-ID license binding is weak
`getMachineId()` hashes `hostname + platform + userDataPath` — easily spoofed and changes if the path changes.
**Fix:** use a stable hardware-based ID (e.g., `os.hostname()` + disk serial via `wmic`/`node-machine-id`) and sign license responses.

---

## 4. P1 — Reliability, Performance & Data

### 💾 4.1 No indexes on hot query columns
Reports/stats query `DATE(timestamp)`, `DATE(created_at)`, `member_id`, `plan_end`, `status` on every render. On large datasets this will degrade badly.
**Fix:** add indexes: `checkins(member_id)`, `checkins(timestamp)`, `payments(member_id)`, `payments(created_at)`, `members(status)`, `members(plan_end)`, `activity_logs(created_at)`.

### 💾 4.2 Pagination / lazy loading missing
`get-checkins` (no date) and `get-payments` (all) return `LIMIT 100`, and the Members table loads all members into memory (ActivityLog already limits to 100 rows by default).
**Fix:** server-side pagination + search for members, check-ins, payments, activity logs; virtualized tables for large lists.

### 💾 4.3 No automated backups
Backup is manual-only. A silent DB corruption = total loss.
**Fix:** scheduled backups (daily at close, keep last N), optional cloud/network copy, backup reminder banner, and a "last backup" check on startup.

### 💾 4.4 Restore is all-or-nothing without safety net
Restore wipes everything before validating the import fully.
**Fix:** pre-restore safety backup, dry-run validation (schema/table match), and a confirmation showing what will change.

### 💾 4.5 Member photos stored as base64 blobs in DB
Blows up DB size and slows every member query.
**Fix:** store photos on disk (`userData/photos/`) and keep the path in the DB; migrate existing base64 values.

### 💾 4.6 UTC vs local-day mismatch
Stats use `new Date().toISOString().split('T')[0]` (UTC), so "today" rolls over at 8 AM local in UTC+8 (Philippines) — the Dashboard "Recent Check-ins"/counts reset at 8 AM, not midnight.
**Fix:** use local-time date strings everywhere (`strftime('%Y-%m-%d', datetime(timestamp, 'localtime'))` or compute local `YYYY-MM-DD` in main).

### 💾 4.7 No error handling / error boundary
IPC errors mostly `throw` to the renderer; some pages swallow errors silently. No global React error boundary.
**Fix:** global error boundary + toast/notification system; standardized IPC error responses.

---

## 5. P2 — Feature Roadmap

### ✨ 5.1 Member Experience & Kiosk
- **QR/barcode check-in** — printable member QR (or membership card) scannable at the kiosk/webcam.
- **Kiosk idle screen polish** — branding slideshow/promos, "how to check in" animation, sound cue on success, big photo confirmation.
- **Member self-view** — after check-in, show plan days remaining, sessions left, balance due, coach, and emergency override hints.
- **Guest / trial check-ins** — day-pass or trial-day type without a full member record.
- **Member ID cards** — printable ID card generator (photo, member ID, plan, expiry, QR).

### ✨ 5.2 Billing & Payments
- **Recurring/auto-renewal** — "renew at end of plan" flag + due-date reminders; auto-create renewal payment on plan end.
- **Renewal reminders** — SMS/email to members expiring in 3/1 days (SMTP already exists for email; add SMS via a provider like Semaphore/Chikka for PH or Twilio).
- **Payment methods** — preset list (cash, GCash, Maya, card) instead of free-text; receipts/printable invoices per payment.
- **Partial payments & installments** — record "paid so far" vs remaining balance (balance field already exists).
- **Refunds / void** — mark a payment voided/refunded with reason + audit trail.
- **Overdue balance dunning** — flag members with balance > 0, block check-in when balance exceeds threshold (setting).

### ✨ 5.3 Classes & Coaching
- **Class/group schedule** — weekly schedule per coach with capacity, sign-up list, waitlist.
- **Coach attendance & commission** — attendance-based fee split per class (coach fee payments exist for PT; extend to classes).
- **PT session booking** — book slots against a coach's availability; track sessions delivered.

### ✨ 5.4 Analytics & Retention
- **KPI dashboard v2** — MRR, active member count trend, check-in trends (day/hour heatmap), retention/churn curves, at-risk members (attendance dropped 50% in 30 days), top plans, revenue forecast.
- **Attendance analytics** — per-member visit frequency, no-show tracking, peak hours.
- **Member lifecycle** — prospect → trial → member → renew → churn funnel.
- **CSV export** — members, check-ins, payments, reports (Excel/PDF).

### ✨ 5.5 Communication
- **Email templates** — welcome email on enrollment, expiry reminders, receipt emails (SMTP is already configured; just add templates + triggers).
- **SMS notifications** — via PH providers (Semaphore/Chikka) or Twilio; reminders + promos.
- **In-app notifications** — expiring members, low balance, new check-in (hook into `enableNotifications`).

### ✨ 5.6 Admin & Ops
- **Shift/cashier management** — who opened/closes the register; cash drawer reconciliation vs daily report.
- **Activity log enhancements** — filter/search by user/entity/action; log failed logins; log report sends (logger currently hardcodes user `'staff'` — pass the real logged-in user).
- **Role-based access** — extend beyond admin/staff (e.g., coach-only view, cashier-only) and gate each page + IPC handler.
- **Kiosk auto-lock** — idle lock to the login screen after timeout (wire up `autoLockTimeout`).
- **License/offline mode** — graceful handling when license server unreachable (activation already cached; add expiry grace period).

### ✨ 5.7 UX & Polish
- **Global search (Ctrl+K)** — jump to any member/plan/coach.
- **Keyboard shortcuts** — e.g., Ctrl+1..9 for pages, Esc to close modals (some exist).
- **Dark/light themes** — currently dark-only; CSS variables already used, so a light theme is cheap.
- **Responsive/tablet layout** — many gyms run the admin on a tablet at the front desk.
- **Empty states** — friendly empty/zero states everywhere (some exist).
- **Loading states** — skeletons instead of "Checking..." where latency is visible.
- **Confirm dialogs for destructive actions** — standardize on the existing `ConfirmModal`.
- **Localization** — the app targets the Philippines (₱). Make currency + labels configurable (i18n).

---

## 6. P2 — Tech Debt & DX

### 🧹 6.1 Tests — none exist
No test runner in `package.json`. Add Vitest (unit) + Playwright (E2E for kiosk/member flows), starting with the money paths: create member with payment+waiver, renewal, daily/monthly report sums, backup/restore round-trip.

### 🧹 6.2 Linting & formatting
No ESLint/Prettier config. Add `eslint` + `prettier` with a TS/React preset and a pre-commit hook.

### 🧹 6.3 CI pipeline
No CI. Add GitHub Actions: typecheck → lint → test → `electron-builder` → publish to GitHub Releases (the repo already has auto-updater + a release upload guide).

### 🧹 6.4 Type safety
`electron/main.ts` uses `as any` liberally; IPC payloads are untyped at the boundary. Share the `electron.d.ts` types with main process and add strict `noImplicitAny` for new code.

### 🧹 6.5 State management & data layer
App state lives in `App.tsx` with no refresh/pub-sub; after any mutation pages must re-fetch manually. Extract a small data layer (typed IPC wrappers + a change event) so lists auto-refresh.

### 🧹 6.6 Monolithic component files
`Members.tsx` (~1,500+ lines) mixes table, two modals, payment, and waiver flows. Split into focused sub-components/hooks.

### 🧹 6.7 Schema migrations
Column adds are done via try/catch `ALTER TABLE`. Move to a versioned migration system (`PRAGMA user_version`) for safe upgrades, including the new tables below.

### 🧹 6.8 Logging & observability
Renderer logs go to console; main logs too. Add structured logging with levels + a rotating file for debugging production installs.

---

## 7. Suggested New Schema (for the feature work above)

```sql
-- Soft-delete members
ALTER TABLE members ADD COLUMN archived INTEGER DEFAULT 0;

-- Photo storage on disk
ALTER TABLE members ADD COLUMN photo_path TEXT;          -- (migration from base64 photo)

-- Payments
ALTER TABLE payments ADD COLUMN status TEXT DEFAULT 'completed' CHECK(status IN ('completed','refunded','voided'));
ALTER TABLE payments ADD COLUMN note TEXT;

-- Class schedules
CREATE TABLE classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_id INTEGER REFERENCES coaches(id),
  title TEXT NOT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  capacity INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE class_attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER REFERENCES classes(id),
  member_id INTEGER REFERENCES members(id),
  status TEXT DEFAULT 'booked' CHECK(status IN ('booked','attended','no_show','waitlist','cancelled')),
  UNIQUE(class_id, member_id)
);

-- Renewal/reminder tracking
CREATE TABLE reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER REFERENCES members(id),
  type TEXT CHECK(type IN ('expiry_3d','expiry_1d','low_balance','welcome')),
  channel TEXT CHECK(channel IN ('email','sms','inapp')),
  sent_at DATETIME,
  UNIQUE(member_id, type)
);

-- Scheduled backups
ALTER TABLE settings ... -- 'backup_enabled', 'backup_hour', 'backup_keep'
```

---

## 8. Recommended Execution Order

1. **P0 sweep** — fix stats bug, backup completeness, session-pack enforcement, dedupe check-ins, wire-up kiosk Renew, remove/honor dead settings. *(1–2 weeks)*
2. **Security** — scrypt/bcrypt passwords, login lockout, IPC validation, foreign keys + cascade, CSP. *(1 week)*
3. **Data layer** — indexes, local-time dates, photos to disk, automated backups, pagination. *(1–2 weeks)*
4. **Feature wave 1 (highest ROI)** — renewal reminders (email), payment methods + receipts, QR check-in, CSV exports, at-risk retention panel. *(2–3 weeks)*
5. **Feature wave 2** — classes/scheduling, SMS, member ID cards, light theme, kiosk idle polish. *(3–4 weeks)*
6. **DX** — tests, lint, CI, refactors, migrations — continuously alongside the above.

---

*Research sources: feature sets of Mindbody, Glofox, Zenoti, Club OS, Wodify, PushPress (gym management benchmarks); Electron security best practices; SQLite performance guidance (indexes, WAL, foreign_keys).*
