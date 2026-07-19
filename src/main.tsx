import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Deliberately styled inline, not via App.css classes: this is the fallback
// shown when the app itself has crashed, so it must not depend on anything
// that crash could plausibly have broken.
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    console.error('FlightLog crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    const backupUrl = `${import.meta.env.BASE_URL}#/backup`
    return (
      <main style={{ maxWidth: 560, margin: '4rem auto', padding: '0 1.5rem', fontFamily: 'system-ui, sans-serif', textAlign: 'center', color: '#0f172a' }}>
        <h1 style={{ fontSize: '1.5rem' }}>Something went wrong</h1>
        <p>FlightLog hit an unexpected error and can&apos;t continue. Your data is still saved in this browser&apos;s storage.</p>
        <p>
          <a href={backupUrl} onClick={() => window.location.reload()}>Reload and open Backup Center</a> to check your data or restore from a backup.
        </p>
      </main>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined)
  })
}
