# GitHub Release Guide — GymApp (REPCHECK)

This guide documents how to publish a new REPCHECK release to GitHub so the built-in auto-updater works.

> **Repo:** `jencendencia/GymApp`
> **Product:** REPCHECK (Electron + React + TypeScript + electron-builder)
> **Build script:** `npm run electron:build` — output goes to the `release/` folder
> **Auto-updater:** `electron-updater` configured via `build.publish` in `package.json`
> **Versions in examples:** current version is `1.5.8`; examples use `1.5.9` as the *next* release — substitute your actual version.

---

## The Two Release Paths

| Path | When to use |
|------|-------------|
| **Automatic (recommended)** | Normal releases — push a `vX.Y.Z` tag and CI builds + publishes everything |
| **Manual fallback** | CI is unavailable/broken, or you need to attach extra files before publishing |

---

## Automatic Release (recommended)

The CI workflow (`.github/workflows/ci.yml`) has a `publish` job that runs on `v*` tags, builds the Windows installer, and uploads it to GitHub Releases via electron-builder's `--publish always`. **No local build or manual upload is needed.**

### Step-by-Step

1. **Bump the version** in `package.json` (don't reuse an existing tag):

   ```json
   { "version": "1.5.9" }
   ```

   Check existing tags first:

   ```bash
   gh release list --repo jencendencia/GymApp
   ```

2. **Commit and push** to `main`:

   ```bash
   git add package.json
   git commit -m "release: bump version to 1.5.9"
   git push origin main
   ```

3. **Create and push the tag** — this triggers the `publish` job:

   ```bash
   git tag -a v1.5.9 -m "v1.5.9"
   git push origin v1.5.9
   ```

4. **Wait for CI** (~5–8 min for the Windows build) and verify:

   ```bash
   gh run watch --repo jencendencia/GymApp
   gh release view v1.5.9 --repo jencendencia/GymApp \
     --json tagName,name,isDraft,isPrerelease,assets \
     --jq '{tag: .tagName, name: .name, draft: .isDraft, prerelease: .isPrerelease, assets: [.assets[].name]}'
   ```

   Expect three assets: `REPCHECK.Setup.1.5.9.exe`, `REPCHECK.Setup.1.5.9.exe.blockmap`, `latest.yml`.

   **Draft gotcha:** electron-builder sometimes leaves the created release as a **draft** — check `draft` in the output above. If it's `true`, publish it (the auto-updater only sees non-draft, latest releases):

   ```bash
   gh release edit v1.5.9 --repo jencendencia/GymApp --draft=false
   ```

   > Note: the `publish` job has `needs: test` — the release build waits for the test job to pass first.

### How the automatic publish works

The `publish` job in `.github/workflows/ci.yml`:

```yaml
publish:
  needs: test
  if: startsWith(github.ref, 'refs/tags/v')
  runs-on: windows-latest
  permissions:
    contents: write          # REQUIRED — repo default GITHUB_TOKEN is read-only
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  steps:
    # checkout, node, npm ci ...
    - name: Build & publish to GitHub Releases
      run: npm run electron:build -- --publish always
```

- `permissions: contents: write` is **required**. Without it the job fails with `403 Forbidden — Resource not accessible by integration`, because creating releases and uploading assets needs write access to `contents`. (This was the failure for v1.5.8.)
- electron-builder reads `build.publish` (`provider: github`, `owner: jencendencia`, `repo: GymApp`) and `GH_TOKEN` to create the release and upload the installer, blockmap, and `latest.yml`.

### Why the auto-updater won't 404 anymore

`package.json` pins the Windows installer name:

```json
"win": {
  "artifactName": "${productName}.Setup.${version}.${ext}"
}
```

This resolves to `REPCHECK.Setup.1.5.9.exe` — **dots, no spaces, no hyphens** — so three things are always identical:

1. the file electron-builder writes to `release/`
2. the filename inside `release/latest.yml`
3. the asset name uploaded to GitHub

When all three match, the auto-updater downloads correctly. **No `latest.yml` fixing or `#`-label renaming is needed anymore.** (Older releases were built without this config and required a manual fix — see "Background" below.)

### Editing release notes

The auto-published release gets minimal notes. After CI finishes, edit them:

```bash
gh release edit v1.5.9 --repo jencendencia/GymApp \
  --notes "## v1.5.9 ..."
```

---

## Manual Fallback (only if CI is unavailable)

Do this only when you can't use the automatic tag flow. With the dot-named `artifactName`, the old space/hyphen/sed dance is gone — build output is already correct.

### 1. Bump version

Same as the automatic flow — edit `package.json`, don't reuse an existing tag.

### 2. Build the installer locally

```bash
npm run electron:build -- --publish never
```

Creates in `release/`:

- `REPCHECK.Setup.1.5.9.exe`
- `REPCHECK.Setup.1.5.9.exe.blockmap`
- `latest.yml` (already references the same dot-named file)

### 3. Create the release and upload

```bash
gh release create v1.5.9 \
  'release/REPCHECK.Setup.1.5.9.exe' \
  'release/REPCHECK.Setup.1.5.9.exe.blockmap' \
  'release/latest.yml' \
  --repo jencendencia/GymApp \
  --title 'v1.5.9' \
  --notes 'v1.5.9 - Brief description of changes'
```

> Line-continuation character depends on your shell: **cmd.exe** uses `^`, **PowerShell** uses a backtick, and **bash** (Git Bash) uses `\`.

### 4. Re-releasing the same version (optional)

If the tag already exists (e.g. re-uploading v1.5.9), delete it first:

```bash
gh release delete v1.5.9 --repo jencendencia/GymApp --yes
git tag -d v1.5.9 && git push origin :v1.5.9
```

### 5. Verify (optional but recommended)

Check assets and that `latest.yml`'s sha512 (base64) matches the installer (hex):

```bash
gh release view v1.5.9 --repo jencendencia/GymApp --json assets --jq '.assets[].name'
exe_sha=$(sha512sum 'release/REPCHECK.Setup.1.5.9.exe' | awk '{print $1}')
yml_b64=$(grep '^sha512:' release/latest.yml | head -1 | awk '{print $2}')
yml_hex=$(node -e "console.log(Buffer.from('$yml_b64','base64').toString('hex'))")
[ "$exe_sha" = "$yml_hex" ] && echo 'MATCH: sha512 verified OK' || echo 'MISMATCH!'
```

> `latest.yml` stores SHA-512 as **base64**, while `sha512sum` outputs hex — don't compare them directly.

---

## Attaching Extra Setup Assets

Past releases also carried setup extras (fingerprint drivers, U.are.U SDK, logos, waiver template, `SETUP_GUIDE.md`). **The automatic flow does not attach these** — if you want them on a release, upload after CI finishes:

Grab the extras from the previous release into a local `release-extras/` folder, then upload:

```bash
gh release download v1.5.8 --repo jencendencia/GymApp -D release-extras/  # pull the prior set
gh release upload v1.5.9 --repo jencendencia/GymApp \
  'release-extras/4500.Legacy.Driver.4.1.0.217.WithInstaller.zip' \
  'release-extras/DigitalPersona.U.are.U.SDK.2.2.0.414.msi' \
  ...
```

(`release-extras/` is a local scratch folder, not part of the repo. See `SETUP_GUIDE.md` for what each file is for.)

---

## Quick Reference Checklist (automatic flow)

- [ ] Version bumped in `package.json` (don't reuse an existing tag)
- [ ] Committed + pushed to `main`
- [ ] Tag `vX.Y.Z` created + pushed (triggers CI publish)
- [ ] CI `publish` job succeeded
- [ ] Release is **not** a draft/prerelease (see draft gotcha above)
- [ ] Assets present: `.exe`, `.exe.blockmap`, `latest.yml` (dot-named)

---

## Token Management

- **Public repo auto-updater:** no token needed — users download directly from the public release.
- **CI publish:** uses `secrets.GITHUB_TOKEN` automatically (permission granted via the job's `permissions: contents: write`).
- **Local CLI (`gh release create/upload`):** authenticate once with `gh auth login`, or pass `GH_TOKEN` via environment variable.

**Never commit tokens to source code** — GitHub's secret scanning will block the push.

---

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Publish job: `403 Forbidden — Resource not accessible by integration` | Publish job missing `permissions: contents: write` | Add it to the `publish` job in `.github/workflows/ci.yml` |
| 404 when downloading update | `latest.yml` filename doesn't match uploaded asset | Ensure `artifactName` is `${productName}.Setup.${version}.${ext}` and don't rename uploads |
| Release not found | Old release/tag not deleted when re-releasing | Delete old release + tag first (manual section, step 4) |
| `isLatest` unknown field in `gh` | Not a valid JSON field for `gh release view` | Use `isDraft` / `isPrerelease` instead |
| sha512 mismatch when comparing | `latest.yml` uses base64, `sha512sum` outputs hex | Convert base64 → hex (manual section, step 5) |
| Push rejected (secret scanning) | Token in committed code | Remove token, use `GH_TOKEN` env var |

---

## Background

- **Old guide:** referenced `jencendencia/dtr-app` and "Biometric DTR System" — **outdated**. This repo is `jencendencia/GymApp` / REPCHECK.
- The old guide said to run `npm run dist` — this project has no `dist` script; use `npm run electron:build` (outputs to `release/`, not `dist/`).
- **Why the filename mismatch existed:** electron-builder used to write the installer with spaces (`REPCHECK Setup 1.5.0.exe`) while `latest.yml` referenced hyphens (`REPCHECK-Setup-1.5.0.exe`), and GitHub uploads needed dots (`REPCHECK.Setup.1.5.0.exe`). Releases ≤ v1.5.8 were published manually with a `sed` fix + `#`-label renaming to work around this. Since v1.5.9 the `artifactName` config makes all three names identical automatically.
