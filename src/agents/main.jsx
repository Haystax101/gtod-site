import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App'
import { SessionProvider } from './lib/session'
import './styles/agents.css'

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <BrowserRouter basename="/agents">
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </ConvexProvider>
  </StrictMode>,
)
