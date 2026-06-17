import { useEffect, useRef, useState } from 'react'
import TodoList from '../components/TodoList/TodoList'
import ThreadsBoard from '../components/ThreadsBoard/ThreadsBoard'
import RulesModal from '../components/RulesModal/RulesModal'
import SendEmailModal from '../components/SendEmailModal/SendEmailModal'
import { syncGmail } from '../lib/gmail/sync'
import { loadCredentials } from '../lib/gmail/oauth'
import { loadRules, DEFAULT_RULES, type ThreadRules } from '../lib/settings/rules'
import { loadBoardData, type BoardCard, type BoardData } from '../lib/threads/board'
import type { Company, Contact } from '../types/database'
import styles from './Home.module.css'

const GMAIL_SYNC_INTERVAL_MS = 30_000

const EMPTY_BOARD: BoardData = { draft: [], sent: [], follow_up: [], reply: [], reengage: [] }

export default function Home() {
  const [rules, setRules] = useState<ThreadRules>(DEFAULT_RULES)
  const [board, setBoard] = useState<BoardData>(EMPTY_BOARD)
  const [loading, setLoading] = useState(true)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailReconnectRequired, setGmailReconnectRequired] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [replyFor, setReplyFor] = useState<{
    contact: Contact
    company: Pick<Company, 'name'>
    replyToThread: { threadId: string; gmailThreadId: string; subject: string | null }
  } | null>(null)

  const rulesRef = useRef(rules)
  rulesRef.current = rules

  // Initial data fetch: rules + board snapshot + Gmail connection status.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [loadedRules, creds] = await Promise.all([
        loadRules(),
        loadCredentials(),
      ])
      if (cancelled) return
      setRules(loadedRules)
      setGmailConnected(Boolean(creds?.access_token))
      const data = await loadBoardData(loadedRules)
      if (cancelled) return
      setBoard(data)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  // Background Gmail sync + board refresh while Home is open and visible.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function runOnce() {
      const result = await syncGmail()
      if (cancelled) return
      if (result.reconnectRequired) setGmailReconnectRequired(true)
      const data = await loadBoardData(rulesRef.current)
      if (!cancelled) setBoard(data)
    }

    function schedule() {
      if (cancelled) return
      timer = setTimeout(async () => {
        if (document.visibilityState === 'visible') await runOnce()
        schedule()
      }, GMAIL_SYNC_INTERVAL_MS)
    }

    runOnce()
    schedule()

    const onVisibility = () => {
      if (document.visibilityState === 'visible') runOnce()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const handleCardClick = (card: BoardCard) => {
    setReplyFor({
      contact: card.contact,
      company: { name: card.company?.name ?? '' },
      replyToThread: {
        threadId: card.thread.id,
        gmailThreadId: card.thread.gmail_thread_id,
        subject: card.thread.subject,
      },
    })
  }

  const handleRulesSaved = async (next: ThreadRules) => {
    setRules(next)
    setShowRules(false)
    const data = await loadBoardData(next)
    setBoard(data)
  }

  const refreshBoard = async () => {
    const data = await loadBoardData(rulesRef.current)
    setBoard(data)
    // Also refresh Gmail connection in case it just became connected.
    const creds = await loadCredentials()
    setGmailConnected(Boolean(creds?.access_token))
  }

  const actionCount = board.reply.length + board.follow_up.length + board.reengage.length

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Home</h1>
      </header>

      <div className={styles.stats}>
        <div className={styles.statGrid}>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Awaiting Reply</div>
            <div className={`${styles.statCount} ${!loading && board.reply.length > 0 ? styles.statCountAction : !loading ? styles.statCountClear : ''}`}>
              {loading ? '—' : board.reply.length}
            </div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Follow-Up Due</div>
            <div className={`${styles.statCount} ${!loading && board.follow_up.length > 0 ? styles.statCountAction : !loading ? styles.statCountClear : ''}`}>
              {loading ? '—' : board.follow_up.length}
            </div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Re-Engage</div>
            <div className={`${styles.statCount} ${!loading && board.reengage.length > 0 ? styles.statCountAction : !loading ? styles.statCountClear : ''}`}>
              {loading ? '—' : board.reengage.length}
            </div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Sent</div>
            <div className={styles.statCount}>{loading ? '—' : board.sent.length}</div>
          </div>
        </div>
        {!loading && (
          <p className={styles.statMotivation}>
            {actionCount > 0
              ? `${actionCount} conversation${actionCount === 1 ? '' : 's'} need your attention — let's get that to zero.`
              : `You're all caught up — keep the momentum going!`}
          </p>
        )}
      </div>

      {gmailReconnectRequired && (
        <div className={styles.reconnectBanner}>
          Gmail session expired.{' '}
          <a className={styles.reconnectLink} href="/settings">Reconnect in Settings →</a>
        </div>
      )}

      <ThreadsBoard
        data={board}
        loading={loading}
        gmailConnected={gmailConnected}
        onOpenRules={() => setShowRules(true)}
        onCardClick={handleCardClick}
      />

      <div className={styles.todoSection}>
        <TodoList />
      </div>

      {showRules && (
        <RulesModal
          rules={rules}
          onClose={() => setShowRules(false)}
          onSaved={handleRulesSaved}
        />
      )}

      {replyFor && (
        <SendEmailModal
          contact={replyFor.contact}
          company={replyFor.company}
          replyToThread={replyFor.replyToThread}
          onClose={() => setReplyFor(null)}
          onSent={async () => { await refreshBoard() }}
          onThreadClosed={async () => {
            setReplyFor(null)
            await refreshBoard()
          }}
        />
      )}
    </div>
  )
}
