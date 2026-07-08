import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SIPProvider } from './context/SIPContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SIPProvider>
      <App />
    </SIPProvider>
  </StrictMode>,
)
