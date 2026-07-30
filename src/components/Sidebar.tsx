import React, { useState } from 'react'
import './Sidebar.css'
import ConfirmModal from './ConfirmModal'

interface SidebarProps {
  activeScreen: string
  onNavigate: (screen: any) => void
  appLogo?: string
  appName?: string
  currentUser?: { id: number; username: string; role: string; photo?: string; display_name?: string }
  onLogout?: () => void
}

const navItems = [
  { id: 'kiosk', label: 'Dashboard', icon: '◉' },
  { id: 'members', label: 'Members', icon: '👥' },
  { id: 'coach', label: 'Coach', icon: '🏋️' },
  { id: 'plans', label: 'Plans', icon: '📋' },
  { id: 'checkins', label: 'Check-ins', icon: '📊' },
  { id: 'activitylog', label: 'Activity Log', icon: '📜' },
  { id: 'reports', label: 'Reports', icon: '📈' },
  { id: 'users', label: 'Users', icon: '👤' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

function Sidebar({ activeScreen, onNavigate, appLogo, appName, currentUser, onLogout }: SidebarProps) {
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const brandLetter = appName ? appName.charAt(0).toUpperCase() : 'R'

  // Only show Users tab for admin role
  const visibleItems = navItems.filter(item => item.id !== 'users' || currentUser?.role === 'admin')

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
        {visibleItems.map((item) => (
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

      {/* User info & Logout at bottom */}
      {currentUser && (
        <div className="sidebar-user">
          <div className="sidebar-user-display">
            <div className="user-avatar-mini">
              {currentUser.photo ? (
                <img src={currentUser.photo} alt="" />
              ) : (
                (currentUser.display_name || currentUser.username).charAt(0).toUpperCase()
              )}
            </div>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{currentUser.display_name || currentUser.username}</span>
              <span className={`sidebar-user-role role-${currentUser.role}`}>{currentUser.role}</span>
            </div>
          </div>
          <button className="sidebar-logout-btn" onClick={() => setShowLogoutConfirm(true)} title="Log out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span className="sidebar-logout-label">Log out</span>
          </button>
        </div>
      )}
      {/* Custom logout confirmation modal */}
      <ConfirmModal
        open={showLogoutConfirm}
        title="Log out"
        message="Are you sure you want to log out?"
        confirmLabel="Log out"
        cancelLabel="Cancel"
        confirmVariant="danger"
        icon="🚪"
        onConfirm={() => {
          setShowLogoutConfirm(false)
          onLogout?.()
        }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </aside>
  )
}

export default Sidebar
