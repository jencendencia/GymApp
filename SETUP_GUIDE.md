# REPCHECK New-PC Setup Guide (Fingerprint Scanner)

Use this checklist when setting up REPCHECK on a new Windows PC with the
**U.are.U 4500** fingerprint reader. Following these steps in order fixes the
common `dpfpdd_init failed (code -2147023181)` error.

## What you need (all downloadable from the GitHub release page)

| File | Purpose |
|---|---|
| `REPCHECK.Setup.X.X.X.exe` | The app installer (contains the app + bundled SDK DLLs) |
| `SFW-02580-DP4500.Fingerprint.Reader.Driver.Legacy.v4.1.1.221.zip` | Legacy (Non-WBF) reader driver — install `setup_x64.msi` inside |
| **`U.are.U.SDK.Runtime.WithInstaller.zip`** | **The U.are.U SDK runtime — one zip containing BOTH the installer MSI AND the 3 runtime DLLs. This is the fix for `dpfpdd_init failed`.** |
| `U.are.U.SDK.Bin.Runtime.zip` | The 3 SDK runtime DLLs only (`dpfpdd.dll`, `dpfj.dll`, `dpfpapi.dll`) — fallback if the app reports "DLLs not found" |

> ⚠️ **Do NOT use the WBF driver** (`4500_wbf_driver_5.0.0.5_rs3.zip`). It is for
> Windows Hello and **blocks** the SDK — the scanner will fail even with the
> reader plugged in.

## ⚠️ READ THIS FIRST — "DLLs" vs "the installer"

There are two different things in the release:

- **The 3 DLLs** (`dpfpdd.dll`, `dpfj.dll`, `dpfpapi.dll`) — these are the SDK
  *runtime libraries* the app loads. **They are not an installer** — you don't
  "run" them. They only get used if the app says the DLLs can't be found.
- **The installer MSI** (`DigitalPersona.U.are.U.SDK.2.2.0.414.msi`) — this is
  the file you actually **run** (as administrator). It installs the SDK runtime
  system-wide and registers the **DpHost** service, which is what makes
  `dpfpdd_init` succeed.

> 💡 **To avoid confusion, download `U.are.U.SDK.Runtime.WithInstaller.zip`** —
> it contains both the installer MSI **and** the 3 DLLs in one place. Extract it
> and you'll see:
> ```
> U.are.U.SDK.Runtime.WithInstaller/
> ├── DigitalPersona.U.are.U.SDK.2.2.0.414.msi   ← RUN THIS (the installer)
> └── bin/
>     ├── dpfpdd.dll
>     ├── dpfj.dll
>     ├── dpfpapi.dll
>     └── README.md
> ```

## Installation steps (in this order)

1. **Install the app** — run `REPCHECK.Setup.X.X.X.exe`.

2. **Install the legacy driver** — extract
   `SFW-02580-DP4500...Legacy.v4.1.1.221.zip`, then right-click
   `setup_x64.msi` → **Run as administrator** → finish the wizard → restart the PC.
   - If a WBF driver is present, uninstall it first (Settings → Apps → uninstall
     "4500 WBF" / "HID fingerprint") and restart.

3. **Install the U.are.U SDK runtime** (the important fix) — download and extract
   `U.are.U.SDK.Runtime.WithInstaller.zip`, then right-click
   **`DigitalPersona.U.are.U.SDK.2.2.0.414.msi`** (the file inside the zip) →
   **Run as administrator** → finish the wizard → restart.
   - This registers the **DpHost** service ("DigitalPersona Authentication
     Service"), which `dpfpdd_init` requires. Without it you get
     `dpfpdd_init failed (code -2147023181)`.

4. **Plug in the reader** (USB) and open REPCHECK →
   **Settings → Fingerprint Scanner → Check Scanner**. Expected:
   - ✅ `dpfpdd.dll / dpfj.dll loaded`
   - ✅ `dpfpdd_init ok`
   - ✅ `DigitalPersona U.are.U 4500` detected

5. **Re-enroll member fingerprints** — enrollments don't transfer between PCs.

## Troubleshooting

| Check Scanner says | Cause / fix |
|---|---|
| `dpfpdd_init failed (code -2147023181)` | DpHost service missing/stopped → install the SDK MSI (step 3) or run `sc query DpHost` / `net start DpHost` (admin) |
| `dpfpdd.dll / dpfj.dll not found` | SDK DLLs not found → extract the 3 DLLs from `U.are.U.SDK.Bin.Runtime.zip` (or the `bin/` folder inside the WithInstaller zip) and drop them in a `bin` folder next to the app `.exe` |
| `No fingerprint reader detected` | Driver not installed (step 2) or reader unplugged / try another USB port |
| WBF driver installed | Reader on Windows Hello stack blocks the SDK → uninstall WBF, install the legacy driver |

## Verify the service manually (optional)

```
sc query DpHost
```

Expect `STATE : 4 RUNNING`. If it's not, from an admin prompt:

```
net start DpHost
```
