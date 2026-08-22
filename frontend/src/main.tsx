import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initSentry, SentryErrorBoundary } from './lib/sentry'

initSentry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SentryErrorBoundary fallback={<div style={{ padding: 24, fontFamily: 'Inter, sans-serif' }}>Something went wrong. Reload the page.</div>}>
      <App />
    </SentryErrorBoundary>
  </StrictMode>,
)
