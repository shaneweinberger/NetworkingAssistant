import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Contact, GmailCredentials } from '../types/database'
import {
  clearCredentials,
  connectGmail,
  isGmailConfigured,
  loadCredentials,
  tokenStatus,
} from '../lib/gmail/oauth'
import { syncGmail, rescanContact, type SyncResult } from '../lib/gmail/sync'
import { supabase } from '../lib/supabase'
import { logout } from '../lib/auth'
import styles from './Settings.module.css'

export default function Settings() {
  const navigate = useNavigate()
  const [creds, setCreds] = useState<GmailCredentials | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [rescanning, setRescanning] = useState(false)
  const [rescanResult, setRescanResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<SyncResult | null>(null)

  useEffect(() => {
    (async () => {
      setCreds(await loadCredentials())
      setLoading(false)
    })()
  }, [])

  const status = tokenStatus(creds)
  const configured = isGmailConfigured()

  async function handleConnect() {
    setError(null)
    setConnecting(true)
    try {
      const next = await connectGmail()
      setCreds(next)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect Gmail? You can reconnect anytime.')) return
    await clearCredentials()
    setCreds(null)
  }

  async function handleSync() {
    setSyncing(true)
    setError(null)
    try {
      const r = await syncGmail()
      setLastSync(r)
      // Refresh creds so the user sees the new last_history_id if they care.
      setCreds(await loadCredentials())
      if (r.reconnectRequired) {
        setError('Gmail authorization expired. Please reconnect.')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  async function handleRescanContacts() {
    setRescanning(true)
    setRescanResult(null)
    setError(null)
    try {
      const { data, error: dbError } = await supabase
        .from('contacts')
        .select('*')
        .not('email', 'is', null)
      if (dbError) throw new Error(dbError.message)
      const contacts = (data as Contact[]) ?? []
      let totalAdded = 0
      // Use a 365-day window to catch older threads a 90-day scan would miss.
      for (const contact of contacts) {
        const added = await rescanContact(contact, 365)
        totalAdded += added
      }
      setRescanResult(
        totalAdded > 0
          ? `Found ${totalAdded} new thread${totalAdded === 1 ? '' : 's'} across ${contacts.length} contacts.`
          : `Scanned ${contacts.length} contacts — no new threads found.`,
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRescanning(false)
    }
  }

  function handleLogout() {
    if (window.confirm('Sign out? You\'ll need to re-enter the password to access the app.')) {
      logout()
      navigate('/', { replace: true })
      window.location.reload()
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>Manage Gmail integration and sync.</p>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>
              <span
                className={`${styles.statusDot} ${
                  status === 'connected' ? styles.statusDotConnected
                    : status === 'expired' ? styles.statusDotExpired
                      : styles.statusDotDisconnected
                }`}
              />
              Gmail
            </h2>
            <p className={styles.sectionDescription}>
              Send templated outreach, track responses, and surface action items
              by connecting your Gmail account.
            </p>
          </div>
        </div>

        {!configured && (
          <div className={styles.warning}>
            <strong>Setup required.</strong> Add{' '}
            <code>VITE_GOOGLE_CLIENT_ID</code> to your <code>.env.local</code>{' '}
            and restart the dev server. See <code>SUMMARY.md</code> for
            step-by-step Google Cloud setup.
          </div>
        )}

        {configured && (
          <>
            {loading ? (
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)' }}>Loading…</p>
            ) : (
              <>
                <div className={styles.statusRow}>
                  <div className={styles.statusInfo}>
                    <span className={styles.statusLabel}>
                      {status === 'connected' ? 'Connected'
                        : status === 'expired' ? 'Session expired — please reconnect'
                          : 'Not connected'}
                    </span>
                    {creds?.email && (
                      <span className={styles.statusEmail}>{creds.email}</span>
                    )}
                  </div>
                  <div className={styles.actions}>
                    {creds ? (
                      <>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={handleSync}
                          disabled={syncing}
                        >
                          {syncing ? 'Syncing…' : 'Sync now'}
                        </button>
                        <button
                          type="button"
                          className={styles.dangerButton}
                          onClick={handleDisconnect}
                        >
                          Disconnect
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={handleConnect}
                        disabled={connecting}
                      >
                        {connecting ? 'Waiting for Google…' : 'Connect Gmail'}
                      </button>
                    )}
                  </div>
                </div>

                {!creds && (
                  <div className={styles.scopeList}>
                    <div className={styles.scope}>
                      <CheckIcon /> Create drafts and send emails from templates
                    </div>
                    <div className={styles.scope}>
                      <CheckIcon /> Read message metadata to detect replies
                    </div>
                    <div className={styles.scope}>
                      <CheckIcon /> Match your email address to your sent threads
                    </div>
                  </div>
                )}

                {lastSync && (
                  <div className={styles.syncStat}>
                    <span>Mode: <strong>{lastSync.mode}</strong></span>
                    <span>Scanned: <strong>{lastSync.scanned}</strong></span>
                    <span>Updated: <strong>{lastSync.updatedThreads}</strong></span>
                  </div>
                )}

                {creds && (
                  <div className={styles.rescanRow}>
                    <div>
                      <p className={styles.rescanLabel}>Missing threads?</p>
                      <p className={styles.rescanDescription}>
                        Searches your Gmail sent folder for conversations with each contact that
                        may not have been picked up automatically.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={handleRescanContacts}
                      disabled={rescanning}
                    >
                      {rescanning ? 'Scanning…' : 'Rescan contacts'}
                    </button>
                  </div>
                )}
                {rescanResult && <div className={styles.rescanResult}>{rescanResult}</div>}
              </>
            )}
          </>
        )}

        {error && <div className={styles.error}>{error}</div>}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Account</h2>
          </div>
        </div>
        <button
          type="button"
          className={styles.dangerButton}
          onClick={handleLogout}
        >
          Sign Out
        </button>
      </section>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg className={styles.scopeIcon} width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 7.5L6 10.5L11.5 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
