# Icon Update Tasks

1. ✅ Create `public/` folder and copy `Repcheck_icon.png` → `public/repcheck_icon.png`
2. ✅ Update `index.html` favicon to reference `/repcheck_icon.png`
3. ✅ Update `package.json`:
   - ✅ Add `Repcheck_icon.png` to `build.files`
   - ✅ Add `"icon": "Repcheck_icon.png"` under `build.win`
4. ✅ Update `electron/main.ts`:
   - ✅ Add `appIconPath()` helper
   - ✅ Set `icon: appIconPath()` on main window
   - ✅ Set `icon: appIconPath()` on kiosk window
5. ✅ Rebuild the app so the taskbar/window icon takes effect

