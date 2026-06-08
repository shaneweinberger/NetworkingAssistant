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

const EMPTY_BOARD: BoardData = { sent: [], follow_up: [], reply: [] }

export default function Home() {
  const [rules, setRules] = useState<ThreadRules>(DEFAULT_RULES)
  const [board, setBoard] = useState<BoardData>(EMPTY_BOARD)
  const [loading, setLoading] = useState(true)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [replyFor, setReplyFor] = useState<{
    contact: Contact
    company: Pick<Company, 'name'>
    replyToThread: { gmailThreadId: string; subject: string | null }
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
      await syncGmail()
      if (cancelled) return
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

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Home</h1>
        <p className={styles.subtitle}>Welcome to your networking assistant.</p>
      </header>

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
          onSent={async () => {
            await refreshBoard()
          }}
        />
      )}
    </div>
  )
}
