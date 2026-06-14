import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { configurePerfLogging, perfLog } from '@budget-app/api-client'
import './index.css'
import App from './App.tsx'

const perfOn =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_PERF_LOGS === 'true'

configurePerfLogging(perfOn)
if (perfOn) {
  perfLog('[PERF] browser performance logging active')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
