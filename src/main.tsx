import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import Login from './components/Login'
import { isAuthenticated } from './lib/auth'

function Root() {
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setAuthenticated(isAuthenticated())
    setLoading(false)
  }, [])

  if (loading) return null

  // OAuth popup lands here — skip the password gate so the callback can run.
  if (window.location.pathname === '/auth/gmail/callback') return <App />

  return authenticated ? <App /> : <Login onSuccess={() => setAuthenticated(true)} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>,
)
