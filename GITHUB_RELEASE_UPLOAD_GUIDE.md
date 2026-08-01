# GitHub Release Upload Guide — GymApp (REPCHECK)

This guide documents the correct process for publishing a new REPCHECK release to GitHub so the built-in auto-updater works. It covers the real repo, build script, and the **filename mismatch problem** that breaks the auto-updater.

> **Repo:** `jencendencia/GymApp`
> **Product:** REPCHECK (Electron + React + TypeScript + electron-builder)
> **Build script:** `npm run electron:build` — output goes to the `release/` folder
> **Auto-updater:** `electron-updater` configured via `build.publish` in `package.json`
> **Versions in examples:** the current version is `1.5.0`; examples below use `1.5.1` as the *next* release — substitute your actual version.

---

## The Problem (filename mismatch)

When electron-builder generates the NSIS installer it writes files with **spaces** on disk:

```
release/REPCHECK Setup 1.5.0.exe
release/REPCHECK Setup 1.5.0.exe.blockmap
```

The generated `release/latest.yml` references the filename with **hyphens**:

```yaml
path: REPCHECK-Setup-1.5.0.exe
```

But the assets uploaded to GitHub must use **dots** (the app is auto-downloaded by name from the release):

```
REPCHECK.Setup.1.5.0.exe
```

If `latest.yml` doesn't exactly match the uploaded asset name, the auto-updater gets a **404** when downloading the update.

**Rule of thumb:** local/build filenames use **spaces or hyphens** → uploaded asset names and `latest.yml` must use **dots**.

---

## Step-by-Step Process

### 1. Bump Version

Edit `package.json` and update the version:

```json
{
  "version": "1.5.1"
}
```

Check the current published version first so you don't reuse an existing tag:

```bash
gh release list --repo jencendencia/GymApp
```

### 2. Build the Installer

```bash
npm run electron:build -- --publish never
```

- `--publish never` prevents electron-builder from auto-publishing; we upload manually for control over asset names.
- This creates files in the `release/` folder:
  - `REPCHECK Setup X.X.X.exe`
  - `REPCHECK Setup X.X.X.exe.blockmap`
  - `latest.yml`

### 3. Fix `latest.yml` (CRITICAL)

Open `release/latest.yml` and replace **hyphens with dots** in the filename.

**Before (wrong — 404 on update):**
```yaml
version: 1.5.1
files:
  - url: REPCHECK-Setup-1.5.1.exe
    sha512: ...
    size: ...
path: REPCHECK-Setup-1.5.1.exe
sha512: ...
releaseDate: '...'
```

**After (correct):**
```yaml
version: 1.5.1
files:
  - url: REPCHECK.Setup.1.5.1.exe
    sha512: ...
    size: ...
path: REPCHECK.Setup.1.5.1.exe
sha512: ...
releaseDate: '...'
```

Quick one-liner (replace `1.5.1` with your version):

```bash
sed -i 's/REPCHECK-Setup-1.5.1.exe/REPCHECK.Setup.1.5.1.exe/g' release/latest.yml
```

> **Tip:** `latest.yml` stores the SHA-512 as **base64**, while `sha512sum` outputs hex. Don't compare them directly — see Step 7 for the correct check.

### 4. Delete Old Release (only if re-releasing the same version)

If the tag already exists (e.g. you're re-uploading v1.5.1), delete it first:

```bash
gh release delete v1.5.1 --repo jencendencia/GymApp --yes
```

You also need to delete the local tag if it exists:

```bash
git tag -d v1.5.1 && git push origin :v1.5.1
```

### 5. Create the Release and Upload

Use the `#` upload-label syntax to force the exact **dot-named** asset on GitHub, matching the fixed `latest.yml`:

```bash
gh release create v1.5.1 \
  'release/REPCHECK Setup 1.5.1.exe#REPCHECK.Setup.1.5.1.exe' \
  'release/REPCHECK Setup 1.5.1.exe.blockmap#REPCHECK.Setup.1.5.1.exe.blockmap' \
  'release/latest.yml' \
  --repo jencendencia/GymApp \
  --title 'v1.5.1' \
  --notes 'v1.5.1 - Brief description of changes'
```

Notes:
- The `filename#newname` syntax uploads the local file but names the GitHub asset `newname`. This guarantees dots — do **not** rely on GitHub converting spaces automatically.
- Line-continuation character depends on your shell: **cmd.exe** uses `^`, **PowerShell** uses a backtick (`` ` ``), and **bash** (Git Bash) uses `\`.
- The release becomes the **Latest** release automatically (published, non-draft).

### 6. Verify the Upload

```bash
gh release view v1.5.1 --repo jencendencia/GymApp \
  --json tagName,name,isDraft,isPrerelease,url,assets \
  --jq '{tag: .tagName, name: .name, draft: .isDraft, prerelease: .isPrerelease, url: .url, assets: [.assets[] | {name: .name, size: .size}]}'
```

Check that:
- Asset names use **dots** (e.g. `REPCHECK.Setup.1.5.1.exe`)
- `latest.yml` is uploaded and references the same dot-named file
- The release is **not** a draft/prerelease

### 7. Verify `latest.yml` sha512 Matches the Installer

`latest.yml` stores the SHA-512 in **base64**; convert it to hex before comparing with `sha512sum`:

```bash
cd <path-to-project>   # e.g. 'E:/Joel/Gym App'
exe_sha=$(sha512sum 'release/REPCHECK Setup 1.5.1.exe' | awk '{print $1}')
yml_b64=$(grep '^sha512:' release/latest.yml | head -1 | awk '{print $2}')
yml_hex=$(node -e "console.log(Buffer.from('$yml_b64','base64').toString('hex'))")
echo "exe: $exe_sha"
echo "yml: $yml_hex"
[ "$exe_sha" = "$yml_hex" ] && echo 'MATCH: sha512 verified OK' || echo 'MISMATCH!'
```

## Quick Reference Checklist

- [ ] Version bumped in `package.json` (don't reuse an existing tag)
- [ ] Ran `npm run electron:build -- --publish never`
- [ ] Fixed `release/latest.yml` — hyphens → dots in filename
- [ ] Deleted old release + tag (only if re-releasing the same version)
- [ ] Created release with all 3 files:
  - `.exe` installer (uploaded as `REPCHECK.Setup.X.X.X.exe`)
  - `.exe.blockmap` (uploaded as `REPCHECK.Setup.X.X.X.exe.blockmap`)
  - `latest.yml` (with dots in filename)
- [ ] Verified asset names use dots
- [ ] Verified `latest.yml` sha512 matches the installer

---

## Token Management

**For public repos:** no token needed for the auto-updater — users download directly from the public release.

**For private repos / CLI uploads:** pass the token via environment variable (never hardcode it):

```bash
export GH_TOKEN="ghp_your_token_here"
npm run electron:build -- --publish never
gh release create ...   # uses GH_TOKEN automatically
```

Or authenticate once:

```bash
gh auth login
```

**Never commit tokens to source code** — GitHub's secret scanning will block the push.

---

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| 404 when downloading update | `latest.yml` filename doesn't match uploaded asset | Fix `latest.yml` to use dots AND upload with `#` label |
| Push rejected (secret scanning) | Token in committed code | Remove token, use `GH_TOKEN` env var |
| Release not found | Old release/tag not deleted | Delete old release + tag first |
| `isLatest` unknown field in `gh` | Not a valid JSON field for `gh release view` | Use `isDraft` / `isPrerelease` instead |
| sha512 mismatch when comparing | `latest.yml` uses base64, `sha512sum` outputs hex | Convert base64 → hex (see Step 7) |

---

## Notes on This Guide vs. Older Guides

- The **old guide** referenced `jencendencia/dtr-app` and "Biometric DTR System" — **outdated**. This repo is `jencendencia/GymApp` / REPCHECK.
- The old guide said to run `npm run dist` — this project has no `dist` script; use `npm run electron:build` (outputs to `release/`, not `dist/`).
- The old guide assumed GitHub auto-converts spaces to dots on upload. That's unreliable — this guide **forces** dot names with the `#` upload-label syntax.
