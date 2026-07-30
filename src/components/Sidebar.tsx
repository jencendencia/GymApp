import React from 'react'
import './Sidebar.css'

interface SidebarProps {
  activeScreen: string
  onNavigate: (screen: any) => void
  appLogo?: string
  appName?: string
}

const navItems = [
  { id: 'kiosk', label: 'Dashboard', icon: '◉' },
  { id: 'members', label: 'Members', icon: '👥' },
  { id: 'coach', label: 'Coach', icon: '🏋️' },
  { id: 'plans', label: 'Plans', icon: '📋' },
  { id: 'checkins', label: 'Check-ins', icon: '📊' },
  { id: 'activitylog', label: 'Activity Log', icon: '📜' },
  { id: 'reports', label: 'Reports', icon: '📈' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

function Sidebar({ activeScreen, onNavigate, appLogo, appName }: SidebarProps) {
  const brandLetter = appName ? appName.charAt(0).toUpperCase() : 'R'

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-icon">
          {appLogo ? (
            <img src={appLogo} alt="Logo" className="sidebar-logo" />
          ) : (
            brandLetter
          )}
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${activeScreen === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            title={item.label}
          >
            {activeScreen === item.id && <div className="nav-indicator" />}
            <span className="nav-icon">{item.icon}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}

export default Sidebar
