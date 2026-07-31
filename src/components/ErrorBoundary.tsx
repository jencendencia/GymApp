import React, { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

/** Global error boundary — catches renderer crashes so the app never goes blank (P1 4.7). */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Unknown error' }
  }

  componentDidCatch(error: Error) {
    console.error('Error boundary caught:', error)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            background: 'var(--bg)',
            color: 'var(--text)',
            fontFamily: 'var(--font-body)',
            textAlign: 'center',
            padding: 24,
          }}
        >
          <div style={{ fontSize: 44 }}>⚠️</div>
          <h1 className="display-text" style={{ fontSize: 22 }}>Something went wrong</h1>
          <p style={{ color: 'var(--text-muted)', maxWidth: 420, fontSize: 13 }}>
            An unexpected error occurred. Your data is safe — reload to continue.
          </p>
          <p style={{ color: 'var(--danger)', fontSize: 12, maxWidth: 420 }}>{this.state.message}</p>
          <button className="btn btn-primary" onClick={this.handleReload} style={{ marginTop: 8 }}>
            Reload App
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
