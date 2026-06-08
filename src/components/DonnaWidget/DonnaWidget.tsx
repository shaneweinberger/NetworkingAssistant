import { useEffect, useState } from 'react'
import type { ActionItem } from '../../types/database'
import {
  loadOpenActionItems,
  markActionDone,
  snoozeAction,
  dismissAction,
  loadDonnaStatus,
  type DonnaStatus,
} from '../../lib/donna/api'
import { bucketize, kindLabel } from '../../lib/donna/buckets'
import styles from './DonnaWidget.module.css'

export default function DonnaWidget() {
  const [items, setItems] = useState<ActionItem[]>([])
  const [status, setStatus] = useState<DonnaStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)

  async function refresh() {
    setError(null)
    const [next, s] = await Promise.all([loadOpenActionItems(), loadDonnaStatus()])
    setItems(next)
    setStatus(s)
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    const id = window.setInterval(refresh, 60_000)
    return () => window.clearInterval(id)
  }, [])

  const buckets = bucketize(items)
  const totalOpen = items.filter((i) => i.status === 'open').length
  const todayCount = buckets.find((b) => b.label === 'Today')?.items.length ?? 0

  async function withAction(itemId: string, fn: () => Promise<void>) {
    setActing(itemId)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setActing(null)
    }
  }

  if (loading) {
    return <div className={styles.widget}><div className={styles.loadingRow}>Loading Donna…</div></div>
  }

  const notConnected = !status?.connected || !status.hasRefreshToken

  return (
    <div className={styles.widget}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Donna</h2>
          <p className={styles.subtitle}>
            {notConnected
              ? 'Not connected yet'
              : totalOpen === 0
                ? 'Nothing to do right now'
                : `${todayCount} for today · ${totalOpen} total`}
          </p>
        </div>
        <span className={`${styles.dot} ${notConnected ? styles.dotOff : status?.lastError ? styles.dotWarn : styles.dotOn}`} />
      </header>

      {notConnected && (
        <div className={styles.empty}>
          <p>Donna is offline. Connect Gmail with offline access from Settings to wake her up.</p>
        </div>
      )}

      {status?.lastError && (
        <div className={styles.errorRow}>Last sync error: {status.lastError}</div>
      )}
      {error && <div className={styles.errorRow}>{error}</div>}

      {!notConnected && totalOpen === 0 && !status?.lastError && (
        <div className={styles.empty}>
          <p>Inbox is quiet. Donna will surface anything that needs your attention here.</p>
          {status?.lastSyncAt && (
            <p className={styles.dim}>Last sync: {relativeTime(status.lastSyncAt)}</p>
          )}
        </div>
      )}

      {!notConnected && totalOpen > 0 && (
        <div className={styles.buckets}>
          {buckets.map((b) => b.items.length > 0 && (
            <section key={b.label} className={styles.bucket}>
              <h3 className={styles.bucketLabel}>{b.label} · {b.items.length}</h3>
              {b.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  busy={acting === item.id}
                  onDone={() => withAction(item.id, () => markActionDone(item.id))}
                  onSnooze={(days) => withAction(item.id, () => snoozeAction(item.id, days))}
                  onDismiss={(reason) => withAction(item.id, () => dismissAction(item.id, reason))}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function ItemRow({
  item,
  busy,
  onDone,
  onSnooze,
  onDismiss,
}: {
  item: ActionItem
  busy: boolean
  onDone: () => void
  onSnooze: (days: number) => void
  onDismiss: (reason?: string) => void
}) {
  const [showDismiss, setShowDismiss] = useState(false)
  return (
    <div className={`${styles.item} ${busy ? styles.itemBusy : ''}`}>
      <div className={styles.itemMain}>
        <div className={styles.itemTags}>
          <span className={`${styles.tag} ${styles[`tag_${item.urgency}`]}`}>{item.urgency}</span>
          <span className={styles.kind}>{kindLabel(item.kind)}</span>
          {item.category && <span className={styles.category}>{item.category}</span>}
        </div>
        <p className={styles.summary}>{item.summary}</p>
        {item.detail && <p className={styles.detail}>{item.detail}</p>}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.actBtn} onClick={onDone} disabled={busy} title="Mark done">Done</button>
        <button type="button" className={styles.actBtn} onClick={() => onSnooze(1)} disabled={busy} title="Snooze 1 day">+1d</button>
        <button type="button" className={styles.actBtn} onClick={() => onSnooze(3)} disabled={busy} title="Snooze 3 days">+3d</button>
        <button type="button" className={styles.actBtnDismiss} onClick={() => setShowDismiss(!showDismiss)} disabled={busy} title="Dismiss">×</button>
      </div>
      {showDismiss && (
        <div className={styles.dismissBar}>
          <span>Why?</span>
          <button type="button" onClick={() => onDismiss('out_of_scope')} disabled={busy}>Out of scope</button>
          <button type="button" onClick={() => onDismiss('handled')} disabled={busy}>Handled</button>
          <button type="button" onClick={() => onDismiss('not_urgent')} disabled={busy}>Not urgent</button>
          <button type="button" onClick={() => onDismiss()} disabled={busy}>No reason</button>
        </div>
      )}
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
