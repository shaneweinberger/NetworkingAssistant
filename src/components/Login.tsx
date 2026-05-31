import { useState } from 'react'
import { authenticate } from '../lib/auth'
import styles from './Login.module.css'

interface LoginProps {
  onSuccess: () => void
}

export default function Login({ onSuccess }: LoginProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (authenticate(password)) {
      onSuccess()
    } else {
      setError('Incorrect password')
      setPassword('')
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1>Networking Assistant</h1>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <button type="submit">Sign In</button>
          {error && <p className={styles.error}>{error}</p>}
        </form>
      </div>
    </div>
  )
}
