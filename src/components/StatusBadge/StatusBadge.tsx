import type { DerivedStatus, DerivedAction } from '../../lib/status/engine'
import styles from './StatusBadge.module.css'

export function StatusBadge({ status }: { status: DerivedStatus }) {
  return (
    <span className={`${styles.badge} ${styles[status.tone]}`} title={status.label}>
      <span className={styles.dot} />
      {status.label}
    </span>
  )
}

interface ActionBadgeProps {
  action: DerivedAction
  onClick?: () => void
}

export function ActionBadge({ action, onClick }: ActionBadgeProps) {
  if (action.kind === 'none') return null
  const cls = `${styles.badge} ${styles[action.tone]} ${onClick ? styles.actionBadge : ''}`
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} title={action.label}>
        <span className={styles.dot} />
        {action.label}
      </button>
    )
  }
  return (
    <span className={cls} title={action.label}>
      <span className={styles.dot} />
      {action.label}
    </span>
  )
}
