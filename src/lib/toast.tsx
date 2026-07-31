import React, { createContext, useCallback, useContext, useState, ReactNode } from 'react'

export interface Toast {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
}

interface ToastContextValue {
  toasts: Toast[]
  showToast: (type: Toast['type'], message: string) => void
  dismissToast: (id: number) => void
}

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  showToast: () => {},
  dismissToast: () => {},
})

export const useToast = () => useContext(ToastContext)

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const showToast = useCallback((type: Toast['type'], message: string) => {
    const id = nextId++
    setToasts(prev => [...prev.slice(-4), { id, type, message }])
    // Auto-dismiss after 4s
    setTimeout(() => dismissToast(id), 4000)
  }, [dismissToast])

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`} onClick={() => dismissToast(toast.id)}>
            <span className="toast-icon">
              {toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'}
            </span>
            <span className="toast-message">{toast.message}</span>
            <span className="toast-dismiss">✕</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
