import { useMemo } from 'react'
import type { BoardCard, BoardColumnKey, BoardData } from '../../lib/threads/board'
import { outreachLabel, relativeTime } from '../../lib/threads/board'
import styles from './ThreadsBoard.module.css'

interface Props {
  data: BoardData
  loading: boolean
  gmailConnected: boolean
  onOpenRules: () => void
  onCardClick: (card: BoardCard) => void
}

interface ColumnDef {
  key: BoardColumnKey
  label: string
  emptyText: string
  ctaLabel: string | null
}

const COLUMNS: ColumnDef[] = [
  { key: 'sent',       label: 'Sent',       emptyText: 'No active outreach',  ctaLabel: null },
  { key: 'follow_up',  label: 'Follow-up',  emptyText: 'No follow-ups due',   ctaLabel: 'Follow up' },
  { key: 'reply',      label: 'Reply',      emptyText: 'Nothing to reply to', ctaLabel: 'Reply' },
]

export default function ThreadsBoard({ data, loading, gmailConnected, onOpenRules, onCardClick }: Props) {
  const counts = useMemo(() => ({
    sent: data.sent.length,
    follow_up: data.follow_up.length,
    reply: data.reply.length,
  }), [data])

  return (
    <section className={styles.board}>
      <header className={styles.boardHeader}>
        <div className={styles.boardTitleRow}>
          <h2 className={styles.boardTitle}>Threads</h2>
          <button
            type="button"
            className={styles.rulesButton}
            onClick={onOpenRules}
            aria-label="Configure rules"
            title="Configure rules"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1.5l1.2 1.5h1.9l.7 1.7 1.5 1.2-.5 1.9.5 1.9-1.5 1.2-.7 1.7H9.2L8 14.5 6.8 13H4.9l-.7-1.7L2.7 10.1l.5-1.9-.5-1.9L4.2 5.1l.7-1.7h1.9L8 1.5z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
                fill="none"
              />
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          </button>
        </div>
      </header>

      {!gmailConnected && (
        <div className={styles.gmailBanner}>
          Gmail isn't connected. <a className={styles.bannerLink} href="/settings">Connect in Settings →</a>
        </div>
      )}

      <div className={styles.columns}>
        {COLUMNS.map(col => (
          <div key={col.key} className={styles.column}>
            <div className={styles.columnHeader}>
              <span className={styles.columnLabel}>{col.label}</span>
              <span className={styles.columnCount}>{counts[col.key]}</span>
            </div>
            <div className={styles.columnBody}>
              {loading && <div className={styles.placeholder}>Loading…</div>}
              {!loading && data[col.key].length === 0 && (
                <div className={styles.placeholder}>{col.emptyText}</div>
              )}
              {!loading && data[col.key].map(card => (
                <ThreadCard
                  key={card.thread.id}
                  card={card}
                  ctaLabel={col.ctaLabel}
                  onClick={() => onCardClick(card)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

interface ThreadCardProps {
  card: BoardCard
  ctaLabel: string | null
  onClick: () => void
}

function ThreadCard({ card, ctaLabel, onClick }: ThreadCardProps) {
  const subject = card.thread.subject?.trim() || '(no subject)'
  const showOutreachTag = card.outreachAttempt != null
  return (
    <button type="button" className={styles.card} onClick={onClick}>
      <div className={styles.cardTop}>
        <span className={styles.cardName}>{card.contact.name || 'Unknown contact'}</span>
        {showOutreachTag && (
          <span className={styles.outreachTag}>{outreachLabel(card.outreachAttempt!)}</span>
        )}
        {card.isReengage && !showOutreachTag && (
          <span className={styles.reengageTag}>Re-engage</span>
        )}
      </div>
      <div className={styles.cardMeta}>
        {card.company?.name && <span className={styles.cardCompany}>{card.company.name}</span>}
        {card.contact.role && card.company?.name && <span className={styles.cardMetaDot}>·</span>}
        {card.contact.role && <span className={styles.cardRole}>{card.contact.role}</span>}
      </div>
      <div className={styles.cardSubject} title={subject}>{subject}</div>
      <div className={styles.cardFooter}>
        <span className={styles.cardDate}>{relativeTime(card.sortAt)}</span>
        {ctaLabel && <span className={styles.cardCta}>{ctaLabel} →</span>}
      </div>
    </button>
  )
}
