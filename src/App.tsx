import React, { useState, useEffect, useCallback } from 'react'
import './App.css'
import Sidebar from './components/Sidebar'
import Kiosk from './components/Kiosk'
import Dashboard from './components/Dashboard'
import Activation from './components/Activation'
import Login from './components/Login'
import RightPanel from './components/RightPanel'
import Members from './components/Members'
import Plans from './components/Plans'
import Checkins from './components/Checkins'
import Settings from './components/Settings'
import Coach from './components/Coach'
import Users from './components/Users'
import ActivityLog from './components/ActivityLog'
import Reports from './components/Reports'
import { Member, TodayStats, Checkin, StaffUser } from './types/electron'
import GlobalSearch from './components/GlobalSearch'
import { setLogUser } from './lib/logger'
import { todayLocal } from './lib/dates'
import { setCurrencySymbol } from './lib/format'
import { useDataVersion, notifyDataChanged } from './lib/data'

type Screen = 'kiosk' | 'members' | 'coach' | 'plans' | 'checkins' | 'activitylog' | 'reports' | 'settings' | 'users'

// Check if we're running in kiosk mode (separate window on external monitor)
const isKioskMode = () => {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    return params.get('mode') === 'kiosk'
  }
  return false
}

function App() {
  const [activated, setActivated] = useState<boolean | null>(null)
  const [loggedInUser, setLoggedInUser] = useState<StaffUser | null>(null)
  const [activeScreen, setActiveScreen] = useState<Screen>('kiosk')
  const [appName, setAppName] = useState('REPCHECK')
  const [appLogo, setAppLogo] = useState('')
  const [stats, setStats] = useState<TodayStats>({
    totalCheckins: 0,
    activeMembers: 0,
    expiredMembers: 0,
    expiringThisWeek: 0,
  })
  const [recentCheckins, setRecentCheckins] = useState<Checkin[]>([])
  const [activeCheckins, setActiveCheckins] = useState<Checkin[]>([])
  const [expiringSoon, setExpiringSoon] = useState<Member[]>([])
  const [currentTime, setCurrentTime] = useState(new Date())
  const [showGlobalSearch, setShowGlobalSearch] = useState(false)
  const [membersSearchQuery, setMembersSearchQuery] = useState('')
  // P2 6.5: data-layer change events — bump so the dashboard stats auto-refresh
  const dataVersion = useDataVersion()

  // P2 6.5: cross-window refresh — when ANY window mutates data (e.g. a kiosk
  // check-in), the main process broadcasts 'data-changed'; bump the local bus
  // so the dashboard (and any data-version subscribers) re-fetch in real time.
  // The kiosk window renders no dashboard, so it doesn't need to subscribe.
  useEffect(() => {
    if (isKioskMode()) return
    return window.electronAPI?.onDataChanged?.(() => notifyDataChanged())
  }, [])

  // P2 5.7: apply the persisted theme (dark/light) to the document root
  useEffect(() => {
    (async () => {
      try {
        const theme = await window.electronAPI.getTheme()
        document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark'
      } catch {
        document.documentElement.dataset.theme = 'dark'
      }
    })()
  }, [])

  // P2 5.7: load the persisted currency symbol so every page formats money consistently
  useEffect(() => {
    (async () => {
      try {
        const currency = await window.electronAPI.getSetting('currency')
        setCurrencySymbol(currency)
      } catch {
        setCurrencySymbol('₱')
      }
    })()
  }, [])

  // Mount-only: activation check, branding, and the clock ticker
  useEffect(() => {
    checkActivation()
    loadAppName()
    loadAppLogo()
    // The kiosk window renders no clock, so a 1s ticker would just re-render the
    // whole Kiosk every second for nothing (extra churn on a 24/7 display).
    if (isKioskMode()) return
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogin = (user: StaffUser) => {
    setLoggedInUser(user)
    setLogUser(user.username)
    setActiveScreen('kiosk')
  }

  const handleLogout = () => {
    setLoggedInUser(null)
    setLogUser(null)
  }

  const checkActivation = async () => {
    try {
      const info = await window.electronAPI.getLicenseInfo()
      if (info.activated) {
        setActivated(true)
      } else {
        setActivated(false)
      }
    } catch {
      // If electronAPI not available, assume activated (e.g. in browser dev mode)
      setActivated(true)
    }
  }

  const loadAppName = async () => {
    try {
      const name = await window.electronAPI.getSetting('appName')
      if (name) setAppName(name)
    } catch (error) {
      console.error('Failed to load app name:', error)
    }
  }

  const loadAppLogo = async () => {
    try {
      const logo = await window.electronAPI.getSetting('appLogo')
      if (logo) setAppLogo(logo)
    } catch (error) {
      console.error('Failed to load app logo:', error)
    }
  }

  const loadData = useCallback(async () => {
    try {
      const today = todayLocal()
      const [todayStats, checkins, expiring] = await Promise.all([
        window.electronAPI.getTodayStats(),
        window.electronAPI.getCheckins(today),
        window.electronAPI.getExpiringSoon(),
      ])
      setStats(todayStats)
      setRecentCheckins(checkins.slice(0, 10))
      setExpiringSoon(expiring)

      // Also load active checkins for the right panel
      const active = await window.electronAPI.getActiveCheckins()
      setActiveCheckins(active)
    } catch (error) {
      console.error('Failed to load data:', error)
    }
  }, [])

  // P2 6.5: re-fetch dashboard data whenever the data layer bumps
  useEffect(() => {
    loadData()
  }, [dataVersion, loadData])

  const handleMinimize = () => window.electronAPI.minimizeWindow()
  const handleMaximize = () => window.electronAPI.maximizeWindow()
  const handleClose = () => window.electronAPI.closeWindow()

  // ── Global search (Ctrl+K) + keyboard shortcuts (P2 5.7) ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K opens global search (skip in kiosk mode)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (!isKioskMode() && loggedInUser) setShowGlobalSearch(true)
        return
      }
      // Ctrl+1..8 navigate pages (skip in kiosk mode)
      if (e.ctrlKey && e.key >= '1' && e.key <= '8' && !isKioskMode() && loggedInUser) {
        const screens: Screen[] = ['kiosk', 'members', 'coach', 'plans', 'checkins', 'reports', 'activitylog', 'settings']
        const idx = Number(e.key) - 1
        if (screens[idx]) setActiveScreen(screens[idx])
      }
      // Esc closes global search
      if (e.key === 'Escape' && showGlobalSearch) setShowGlobalSearch(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [loggedInUser, showGlobalSearch])

  const handleGlobalSelectMember = (member: Member) => {
    setShowGlobalSearch(false)
    setMembersSearchQuery(member.member_id)
    setActiveScreen('members')
  }

  const handleAppNameChange = (name: string) => {
    setAppName(name)
  }

  const handleAppLogoChange = (logo: string) => {
    setAppLogo(logo)
  }

  const renderScreen = () => {
    switch (activeScreen) {
      case 'kiosk':
        return (
          <Dashboard
            stats={stats}
            recentCheckins={activeCheckins}
            expiringSoon={expiringSoon}
            onRefresh={loadData}
          />
        )
      case 'members':
        return <Members currentUser={loggedInUser} initialSearch={membersSearchQuery} onSearchConsumed={() => setMembersSearchQuery('')} />
      case 'coach':
        return <Coach />
      case 'plans':
        return <Plans currentUser={loggedInUser} />
      case 'checkins':
        return <Checkins />
      case 'activitylog':
        return <ActivityLog />
      case 'reports':
        return <Reports appName={appName} />
      case 'users':
        return <Users />
      case 'settings':
        return <Settings currentUser={loggedInUser} onAppNameChange={handleAppNameChange} onAppLogoChange={handleAppLogoChange} />
      default:
        return <Kiosk onRefresh={loadData} />
    }
  }

  // Waiting for activation check
  if (activated === null) {
    return (
      <div className="app">
        <div className="activation-loading-screen">
          <div className="spinner" />
          <p>Checking license...</p>
        </div>
      </div>
    )
  }

  // Not activated — show activation screen
  if (!activated) {
    return (
      <div className="app">
        <Activation />
      </div>
    )
  }

  // Activated — show the normal app
  // If in kiosk mode (separate window on external monitor), render only the kiosk — no chrome
  if (isKioskMode()) {
    return (
      <div className="app app-kiosk-mode">
        <Kiosk onRefresh={() => {}} />
      </div>
    )
  }

  // Not logged in — show login screen
  if (!loggedInUser) {
    return (
      <div className="app">
        <Login onLogin={handleLogin} />
      </div>
    )
  }

  return (
    <div className="app">
      {showGlobalSearch && loggedInUser && (
        <GlobalSearch
          onClose={() => setShowGlobalSearch(false)}
          onSelectMember={handleGlobalSelectMember}
        />
      )}
      {!isKioskMode() && loggedInUser && !showGlobalSearch && (
        <div className="global-search-trigger">Ctrl+K — search members</div>
      )}
      {/* Custom titlebar */}
      <div className="titlebar">
        <div className="titlebar-left">
          {appLogo && (
            <img src={appLogo} alt="Logo" className="titlebar-logo" />
          )}
          <div className="titlebar-title display-text">{appName}</div>
        </div>
        <div className="titlebar-buttons">
          <button className="titlebar-btn minimize" onClick={handleMinimize} />
          <button className="titlebar-btn maximize" onClick={handleMaximize} />
          <button className="titlebar-btn close" onClick={handleClose} />
        </div>
      </div>

      <div className="app-content">
        {/* Left Rail */}
        <Sidebar
          activeScreen={activeScreen}
          onNavigate={setActiveScreen}
          appLogo={appLogo}
          appName={appName}
          currentUser={loggedInUser}
          onLogout={handleLogout}
        />

        {/* Main Content */}
        <main className="main-content">
          {renderScreen()}
        </main>

        {/* Right Panel */}
        {activeScreen === 'kiosk' && (
          <RightPanel
            stats={stats}
            recentCheckins={activeCheckins.length > 0 ? activeCheckins.slice(0, 8) : recentCheckins.slice(0, 8)}
            expiringSoon={expiringSoon}
            currentTime={currentTime}
          />
        )}
      </div>
    </div>
  )
}

export default App
