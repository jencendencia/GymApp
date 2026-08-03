# bin — U.are.U SDK DLLs

This folder holds the DigitalPersona native fingerprint SDK runtime DLLs the app
uses to talk to the U.R.U. 4500 reader. They were sourced from the official
U.are.U SDK (x64) so dev mode works without a system-wide SDK install.

## What's here

| File          | Role                                                        |
|---------------|-------------------------------------------------------------|
| `dpfpdd.dll`  | Device driver library — captures images (dpfpdd_capture)    |
| `dpfj.dll`    | FingerJet engine — template creation + 1:N matching         |
| `dpfpapi.dll` | Shared DigitalPersona runtime — required by dpfpdd.dll      |

All three are **x64** (the app is an x64 Electron build). `dpfpdd.dll` imports
from `dpfpapi.dll`, so `dpfpapi.dll` MUST sit in the same folder — without it,
loading `dpfpdd.dll` fails with "The specified module could not be found".

## When do you need this folder?

Usually you DON'T — if you installed the **HID DigitalPersona 4500 Non-WBF
Driver**, the DLLs are on the Windows search path and the app finds them
automatically.

You only need this folder if:
- You want to test in dev mode without installing the SDK system-wide, **or**
- The app's Settings → Fingerprint Scanner → **Check Scanner** reports
  "dpfpdd.dll / dpfj.dll not found".

## How the app finds the DLLs (search order)

1. `bin` folder in the app user-data directory
2. `bin` folder next to the app executable (packaged installs)
3. `bin` folder next to the built worker (`dist-electron/../bin`)
4. `bin` folder in the current working directory — **this folder** (`<project>/bin`)
5. The Windows system search path (installed driver)

So for **dev mode from VSCode**, having these DLLs here is enough. For a
**packaged install**, put them in a `bin` folder next to the `.exe` (or rely on
the installed driver). Add `bin/**/*` to `build.files` in `package.json` so
electron-builder bundles them next to the executable.

## ⚠️ Driver warning (READ THIS)

Even with these DLLs in place, the scanner will NOT work while Windows uses the
**WBF driver** (`4500_wbf_driver_5.0.0.5_rs3`). WBF is for Windows Hello and
**blocks** the native SDK from seeing the reader — the app's Check Scanner will
report `dpfpdd_init failed` even though the reader is plugged in.

Fix: install the **Non-WBF (Legacy) Driver**:
`SFW-02580-DP4500 Fingerprint Reader Driver (Legacy) with installer
v.4.1.1.221` → run `setup_x64.msi`. After install, the reader appears on the
legacy DigitalPersona stack, and `dpfpdd_init`/`dpfpdd_query_devices` succeed.

## ✅ Verified working (Aug 2026)

The full chain is tested against a live U.are.U 4500:

1. **Legacy driver** `usbdpfp` (oem60.inf) installed → reader on the DigitalPersona
   stack (not WBF).
2. **U.are.U SDK runtime** installed → `DpHost` service (DigitalPersona
   Fingerprint Service, `DpHostW.exe`) is **running** — `dpfpdd_init` needs it.
3. **DLLs in `bin/`** (x64, byte-identical to the SDK's `Windows/Lib/x64`):
   `dpfpdd_init` → 0, `dpfpdd_query_devices` → finds the reader,
   `dpfpdd_open`/`dpfpdd_capture` succeed (capture waits for a finger).

Four SDK calling conventions matter and are now handled in `electron/fingerprint.ts`:

- `dpfpdd_query_devices` must be called **two-step** (probe `count=0` + NULL to get
  the required count, then fill) and every `DPFPDD_DEV_INFO` entry's `size` field
  must be **pre-set to `sizeof(DPFPDD_DEV_INFO)`**. Passing a larger capacity or
  zeroed entries → `DPFPDD_E_INVALID_PARAMETER`.
- `dpfpdd_capture` rejects `image_res = 0` → use the reader's resolution (500 dpi
  for the 4500, matching the official samples). On success this SDK build leaves
  `image_size` at the **input buffer capacity** (the real size is only written on
  `DPFPDD_E_MORE_DATA`), so the returned ANSI-381 `"FIR\0"` FID must be trimmed
  to its self-declared record length at header offset 10 (big-endian) — passing
  the padded buffer makes `dpfj_create_fmd_from_fid` return `DPFJ_E_INVALID_FID`.
- `dpfj_create_fmd_from_fid` may return `DPFJ_E_MORE_DATA` (dense fingerprints
  produce ANSI-378 templates bigger than the 1562-byte initial buffer) → re-allocate
  to the size reported in `fmd_size` and retry. Every output struct (`DPFPDD_CAPTURE_RESULT`,
  `DPFJ_CANDIDATE`) must also have its `size` field pre-set.
- `dpfj_identify` requires `candidate_cnt` = allocated candidate slots (1 for a
  single slot) and `DPFJ_CANDIDATE.size` pre-set — a zeroed capacity →
  `DPFJ_E_INVALID_PARAMETER`.

Verified against a live reader: `dpfpdd_init`→0, reader enumerated, `dpfpdd_capture`
→ 357×392 @500 dpi ANSI-381 FID (139,994 bytes), `dpfj_create_fmd_from_fid` →
valid ANSI-378 FMD, `dpfj_identify` self-match → index 0.
