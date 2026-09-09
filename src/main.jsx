import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { Providers } from './lib/backend.jsx'
import { initAnalytics } from './lib/analytics.js'
import './styles/global.css'

initAnalytics()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Providers>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <App />
      </BrowserRouter>
    </Providers>
  </StrictMode>,
)
