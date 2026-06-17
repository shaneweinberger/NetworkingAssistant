import { useState, useMemo } from 'react'
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
  { key: 'reply',      label: 'Awaiting Reply',  emptyText: 'Nothing to reply to',    ctaLabel: 'Reply' },
  { key: 'follow_up',  label: 'Follow-Up Due',   emptyText: 'No follow-ups due',       ctaLabel: 'Follow up' },
  { key: 'sent',       label: 'Sent',            emptyText: 'No active outreach',      ctaLabel: null },
  { key: 'draft',      label: 'Drafts',          emptyText: 'No drafts waiting',       ctaLabel: 'Finish draft' },
  { key: 'reengage',   label: 'Re-Engage',       emptyText: 'No re-engagements needed', ctaLabel: 'Re-engage' },
]

export default function ThreadsBoard({ data, loading, gmailConnected, onOpenRules, onCardClick }: Props) {
  const counts = useMemo(() => ({
    draft: data.draft.length,
    sent: data.sent.length,
    follow_up: data.follow_up.length,
    reply: data.reply.length,
    reengage: data.reengage.length,
  }), [data])

  const [collapsed, setCollapsed] = useState<Record<BoardColumnKey, boolean>>(() => {
    const defaults = { draft: false, reply: false, follow_up: false, sent: false, reengage: false }
    try {
      const saved = localStorage.getItem('threads-board-collapsed')
      if (saved) return { ...defaults, ...JSON.parse(saved) }
    } catch {}
    return defaults
  })

  const toggle = (key: BoardColumnKey) =>
    setCollapsed(prev => {
      const next = { ...prev, [key]: !prev[key] }
      try { localStorage.setItem('threads-board-collapsed', JSON.stringify(next)) } catch {}
      return next
    })

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

      <div className={styles.sections}>
        {COLUMNS.map(col => {
          const isCollapsed = collapsed[col.key]
          return (
            <div key={col.key} className={styles.section}>
              <button
                type="button"
                className={styles.sectionHeader}
                onClick={() => toggle(col.key)}
                aria-expanded={!isCollapsed}
              >
                <div className={styles.sectionLabelRow}>
                  <span className={styles.sectionLabel}>{col.label}</span>
                  <span className={styles.sectionCount}>{counts[col.key]}</span>
                </div>
                <svg
                  className={`${styles.chevron} ${isCollapsed ? styles.chevronCollapsed : ''}`}
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                >
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {!isCollapsed && (
                <div className={styles.sectionBody}>
                  {loading && <div className={styles.placeholder}>Loading…</div>}
                  {!loading && data[col.key].length === 0 && (
                    <div className={styles.placeholder}>{col.emptyText}</div>
                  )}
                  {!loading && data[col.key].map(card => (
                    <ThreadCard
                      key={card.thread.id}
                      card={card}
                      onClick={() => onCardClick(card)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

interface ThreadCardProps {
  card: BoardCard
  onClick: () => void
}

function ThreadCard({ card, onClick }: ThreadCardProps) {
  const subject = card.thread.subject?.trim() || '(no subject)'
  const showOutreachTag = card.outreachAttempt != null
  return (
    <button type="button" className={styles.card} onClick={onClick}>
      <div className={styles.cardTop}>
        <span className={styles.cardName}>{card.contact.name || 'Unknown contact'}</span>
        <span className={styles.cardDate}>{relativeTime(card.sortAt)}</span>
      </div>
      {card.company?.name && (
        <div className={styles.cardCompanyRow}>
          <span className={styles.cardCompany}>{card.company.name}</span>
          {showOutreachTag && (
            <span className={styles.outreachTag}>{outreachLabel(card.outreachAttempt!)}</span>
          )}
        </div>
      )}
      {card.contact.role && (
        <span className={styles.cardRole}>{card.contact.role}</span>
      )}
      <div className={styles.cardSubject} title={subject}>{subject}</div>
    </button>
  )
}
