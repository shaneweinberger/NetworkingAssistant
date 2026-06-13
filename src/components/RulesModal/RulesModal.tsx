import { useEffect, useState } from 'react'
import type { ThreadRules } from '../../lib/settings/rules'
import { saveRules } from '../../lib/settings/rules'
import styles from './RulesModal.module.css'

interface Props {
  rules: ThreadRules
  onClose: () => void
  onSaved: (next: ThreadRules) => void
}

export default function RulesModal({ rules, onClose, onSaved }: Props) {
  const [followUp, setFollowUp] = useState<string>(String(rules.followUpAfterDays))
  const [reengage, setReengage] = useState<string>(String(rules.reengageAfterDays))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const followUpDays = parseInt(followUp, 10)
    const reengageDays = parseInt(reengage, 10)
    if (!Number.isFinite(followUpDays) || followUpDays < 1) {
      setError('Follow-up days must be at least 1.')
      return
    }
    if (!Number.isFinite(reengageDays) || reengageDays < followUpDays) {
      setError('Re-engage days must be greater than or equal to follow-up days.')
      return
    }
    setBusy(true)
    const next: ThreadRules = {
      followUpAfterDays: followUpDays,
      reengageAfterDays: reengageDays,
    }
    await saveRules(next)
    setBusy(false)
    onSaved(next)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 className={styles.title}>Rules</h2>
        <p className={styles.subtitle}>
          Configure when an email moves between the Sent, Follow-Up, Reply, and Re-Engage columns.
        </p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="rules-follow-up">
              Move to Follow-up after
            </label>
            <div className={styles.inputRow}>
              <input
                id="rules-follow-up"
                className={styles.input}
                type="number"
                min={1}
                value={followUp}
                onChange={e => setFollowUp(e.target.value)}
                autoFocus
              />
              <span className={styles.suffix}>days with no reply</span>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="rules-reengage">
              Move to Re-Engage after
            </label>
            <div className={styles.inputRow}>
              <input
                id="rules-reengage"
                className={styles.input}
                type="number"
                min={1}
                value={reengage}
                onChange={e => setReengage(e.target.value)}
              />
              <span className={styles.suffix}>days with no reply</span>
            </div>
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.cancelButton} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
