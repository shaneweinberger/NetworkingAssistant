import { useEffect, useState } from 'react'
import {
  loadCategories,
  loadScopeRules,
  loadDonnaStatus,
  toggleCategory,
  addScopeRule,
  deleteScopeRule,
  buildOfflineOAuthUrl,
  type DonnaStatus,
} from '../../lib/donna/api'
import type { AssistantCategory, AssistantScopeRule } from '../../types/database'
import styles from './DonnaSettings.module.css'

const MATCH_TYPES: Array<AssistantScopeRule['match_type']> = ['email', 'domain', 'subject_contains']

export default function DonnaSettings() {
  const [status, setStatus] = useState<DonnaStatus | null>(null)
  const [categories, setCategories] = useState<AssistantCategory[]>([])
  const [rules, setRules] = useState<AssistantScopeRule[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [newType, setNewType] = useState<'allow' | 'deny'>('deny')
  const [newMatch, setNewMatch] = useState<AssistantScopeRule['match_type']>('domain')
  const [newPattern, setNewPattern] = useState('')

  async function refresh() {
    setError(null)
    const [s, c, r] = await Promise.all([loadDonnaStatus(), loadCategories(), loadScopeRules()])
    setStatus(s)
    setCategories(c)
    setRules(r)
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  function startOfflineOAuth() {
    const url = buildOfflineOAuthUrl(window.location.href)
    window.location.href = url
  }

  async function onToggleCategory(c: AssistantCategory) {
    setBusy(true)
    try {
      await toggleCategory(c.id, !c.enabled)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onAddRule(e: React.FormEvent) {
    e.preventDefault()
    if (!newPattern.trim()) return
    setBusy(true)
    setError(null)
    try {
      await addScopeRule({
        rule_type: newType,
        match_type: newMatch,
        pattern: newPattern.trim(),
        notes: null,
      })
      setNewPattern('')
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onDeleteRule(id: string) {
    setBusy(true)
    try {
      await deleteScopeRule(id)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const connectedLabel =
    !status?.connected ? 'Not connected'
      : !status.hasRefreshToken ? 'Connected (browser-only — Donna needs offline reconnect)'
        : 'Connected with offline access'

  return (
    <div>
      <div className={styles.statusRow}>
        <div>
          <p className={styles.statusLabel}>
            <span className={`${styles.dot} ${status?.hasRefreshToken ? styles.dotOn : styles.dotOff}`} />
            {connectedLabel}
          </p>
          {status?.email && <p className={styles.statusSub}>{status.email}</p>}
          {status?.lastSyncAt && (
            <p className={styles.statusSub}>Last sync: {relativeTime(status.lastSyncAt)}</p>
          )}
          {status?.assistantStartedAt && (
            <p className={styles.statusSub}>Watching since: {new Date(status.assistantStartedAt).toLocaleString()}</p>
          )}
        </div>
        <button type="button" className={styles.primaryButton} onClick={startOfflineOAuth}>
          {status?.hasRefreshToken ? 'Re-authorize Donna' : 'Connect Donna (offline access)'}
        </button>
      </div>

      {status?.lastError && (
        <div className={styles.errorBox}>
          Last error: {status.lastError}
        </div>
      )}

      {loading ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <>
          <section className={styles.subsection}>
            <h3 className={styles.subTitle}>Scope categories</h3>
            <p className={styles.help}>Donna only acts on emails that fall into one of these categories.</p>
            <div className={styles.categoryList}>
              {categories.map((c) => (
                <label key={c.id} className={styles.categoryRow}>
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    onChange={() => onToggleCategory(c)}
                    disabled={busy}
                  />
                  <span>
                    <strong>{c.name}</strong>
                    <span className={styles.categoryDesc}>{c.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className={styles.subsection}>
            <h3 className={styles.subTitle}>Scope rules</h3>
            <p className={styles.help}>Hard allow/deny rules. Evaluated before any LLM call.</p>
            <form className={styles.ruleForm} onSubmit={onAddRule}>
              <select value={newType} onChange={(e) => setNewType(e.target.value as 'allow' | 'deny')}>
                <option value="deny">Deny</option>
                <option value="allow">Allow</option>
              </select>
              <select value={newMatch} onChange={(e) => setNewMatch(e.target.value as AssistantScopeRule['match_type'])}>
                {MATCH_TYPES.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
              </select>
              <input
                type="text"
                placeholder={newMatch === 'email' ? 'user@example.com' : newMatch === 'domain' ? 'example.com' : 'partial subject text'}
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                disabled={busy}
              />
              <button type="submit" disabled={busy || !newPattern.trim()}>Add rule</button>
            </form>
            <div className={styles.ruleList}>
              {rules.length === 0 && <p className={styles.dim}>No rules yet.</p>}
              {rules.map((r) => (
                <div key={r.id} className={styles.ruleRow}>
                  <span className={`${styles.ruleType} ${r.rule_type === 'allow' ? styles.ruleAllow : styles.ruleDeny}`}>
                    {r.rule_type}
                  </span>
                  <span className={styles.ruleMatch}>{r.match_type.replace('_', ' ')}</span>
                  <code className={styles.rulePattern}>{r.pattern}</code>
                  <span className={styles.ruleSource}>{r.source === 'auto_learned' ? 'auto' : 'user'}</span>
                  <button
                    type="button"
                    className={styles.ruleDelete}
                    onClick={() => onDeleteRule(r.id)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {error && <div className={styles.errorBox}>{error}</div>}
    </div>
  )
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}
