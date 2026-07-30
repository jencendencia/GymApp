import React, { useState, useEffect, useCallback } from 'react'
import './App.css'
import Sidebar from './components/Sidebar'
import Kiosk from './components/Kiosk'
import RightPanel from './components/RightPanel'
import Members from './components/Members'
import Plans from './components/Plans'
import Checkins from './components/Checkins'
import Settings from './components/Settings'
import Coach from './components/Coach'
import ActivityLog from './components/ActivityLog'
import Reports from './components/Reports'
import { Member, TodayStats, Checkin } from './types/electron'

type Screen = 'kiosk' | 'members' | 'coach' | 'plans' | 'checkins' | 'activitylog' | 'reports' | 'settings'

function App() {
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
  const [expiringSoon, setExpiringSoon] = useState<Member[]>([])
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    loadAppName()
    loadAppLogo()
    loadData()
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

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
      const [todayStats, checkins, expiring] = await Promise.all([
        window.electronAPI.getTodayStats(),
        window.electronAPI.getCheckins(),
        window.electronAPI.getExpiringSoon(),
      ])
      setStats(todayStats)
      setRecentCheckins(checkins.slice(0, 10))
      setExpiringSoon(expiring)
    } catch (error) {
      console.error('Failed to load data:', error)
    }
  }, [])

  const handleMinimize = () => window.electronAPI.minimizeWindow()
  const handleMaximize = () => window.electronAPI.maximizeWindow()
  const handleClose = () => window.electronAPI.closeWindow()

  const handleAppNameChange = (name: string) => {
    setAppName(name)
  }

  const handleAppLogoChange = (logo: string) => {
    setAppLogo(logo)
  }

  const renderScreen = () => {
    switch (activeScreen) {
      case 'kiosk':
        return <Kiosk onRefresh={loadData} />
      case 'members':
        return <Members />
      case 'coach':
        return <Coach />
      case 'plans':
        return <Plans />
      case 'checkins':
        return <Checkins />
      case 'activitylog':
        return <ActivityLog />
      case 'reports':
        return <Reports />
      case 'settings':
        return <Settings onAppNameChange={handleAppNameChange} onAppLogoChange={handleAppLogoChange} />
      default:
        return <Kiosk onRefresh={loadData} />
    }
  }

  return (
    <div className="app">
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
        />

        {/* Main Content */}
        <main className="main-content">
          {renderScreen()}
        </main>

        {/* Right Panel */}
        {activeScreen === 'kiosk' && (
          <RightPanel
            stats={stats}
            recentCheckins={recentCheckins}
            expiringSoon={expiringSoon}
            currentTime={currentTime}
          />
        )}
      </div>
    </div>
  )
}

export default App
