import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

/**
 * Global app-settings context.
 *
 * The "Show Member Photos" toggle lives in Settings, but its value must be
 * enforced across every component (members table, dashboards, check-in feeds,
 * kiosk screens, ...). Instead of each page re-reading the DB, this provider
 * loads the value once and broadcasts it via context — and Settings calls
 * `refreshSettings()` after saving so every consumer updates instantly.
 */
interface SettingsContextValue {
  showMemberPhotos: boolean
  refreshSettings: () => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue>({
  showMemberPhotos: true,
  refreshSettings: async () => {},
})

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [showMemberPhotos, setShowMemberPhotos] = useState(true)

  const refreshSettings = useCallback(async () => {
    try {
      const data = await window.electronAPI.getSettings()
      setShowMemberPhotos(data.showMemberPhotos !== 'false')
    } catch {
      // Not running inside Electron (browser dev) — assume photos shown
      setShowMemberPhotos(true)
    }
  }, [])

  useEffect(() => {
    refreshSettings()
  }, [refreshSettings])

  return (
    <SettingsContext.Provider value={{ showMemberPhotos, refreshSettings }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext)
}

/** Convenience hook: true when member photos should be displayed. */
export function useShowMemberPhotos(): boolean {
  return useContext(SettingsContext).showMemberPhotos
}
