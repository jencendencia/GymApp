import { useEffect, useRef, useState } from 'react'

/**
 * Tiny change-event bus (P2 6.5).
 *
 * Any page that mutates data (create/update/delete) calls `notifyDataChanged()`
 * after a successful IPC call. Pages subscribe with `useDataVersion()` and
 * include the returned version in their load-effect deps, so every open list
 * auto-refreshes without manual cross-page coordination.
 *
 * Note: the bus is per-renderer (module state). The kiosk window and the main
 * window are separate renderers, so cross-window refresh still relies on the
 * existing `onRefresh` plumbing in App.tsx.
 */
let dataVersion = 0
const listeners = new Set<() => void>()

/** Call after any successful mutation so subscribed lists re-fetch. */
export function notifyDataChanged() {
  dataVersion++
  const snapshot = Array.from(listeners)
  snapshot.forEach((l) => l())
}

/** React hook: returns a version number that increments on every notifyDataChanged(). */
export function useDataVersion(): number {
  const [version, setVersion] = useState(dataVersion)
  const versionRef = useRef(version)
  versionRef.current = version

  useEffect(() => {
    const onChange = () => {
      // Only re-render if the version actually changed (avoids loops from setState)
      if (versionRef.current !== dataVersion) setVersion(dataVersion)
    }
    listeners.add(onChange)
    return () => {
      listeners.delete(onChange)
    }
  }, [])

  return version
}
