import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Contact, Company, EmailTemplate } from '../../types/database'
import {
  autoFillFromContact,
  extractPlaceholders,
  hasUnfilledPlaceholders,
  substitute,
} from '../../lib/templates/placeholders'
import { createDraft, sendMessage, getThreadReplyHeaders, getThreadMessages, GmailAuthError, type FullThreadMessage } from '../../lib/gmail/api'
import { upsertThreadForContact } from '../../lib/gmail/sync'
import { connectGmail, loadCredentials } from '../../lib/gmail/oauth'
import styles from './SendEmailModal.module.css'

interface Props {
  contact: Contact
  company: Pick<Company, 'name'>
  onClose: () => void
  onSent?: () => void
  onThreadClosed?: () => void
  replyToThread?: { threadId: string; gmailThreadId: string; subject: string | null } | null
}

function parseSenderName(from: string | null): string {
  if (!from) return 'Unknown'
  const match = from.match(/^"?([^"<]+?)"?\s*</)
  return match ? match[1].trim() : from.replace(/<[^>]+>/, '').trim() || from
}

// First name + last initial, e.g. "Shane Weinberger" → "Shane W."
function shortName(full: string): string {
  if (full.includes('@')) return full.split('@')[0]
  const parts = full.trim().split(/\s+/)
  if (parts.length < 2) return full
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

function formatMsgDate(internalDate: string): string {
  const d = new Date(Number(internalDate))
  const now = new Date()
  const isThisYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(!isThisYear ? { year: 'numeric' } : {}),
  })
}

// Collapse email soft-wrapping (single \n → space) while preserving paragraph breaks.
function renderEmailBody(raw: string | null): React.ReactNode {
  if (!raw?.trim()) return <em>No content</em>
  const normalized = raw
    .replace(/\r\n/g, '\n')
    .replace(/([^\n])\n([^\n])/g, '$1 $2')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return normalized.split('\n\n').map((para, i) => (
    <p key={i} className={styles.msgBodyPara}>{para}</p>
  ))
}

type ActiveTab = 'conversation' | 'message'

export default function SendEmailModal({ contact, company, onClose, onSent, onThreadClosed, replyToThread }: Props) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [to, setTo] = useState(contact.email ?? '')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<null | 'send' | 'draft'>(null)
  const [banner, setBanner] = useState<{ kind: 'error' | 'warn' | 'info'; text: string; cta?: { label: string; onClick: () => void } } | null>(null)
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null)
  const [replyHeaders, setReplyHeaders] = useState<{ messageId: string | null; references: string | null } | null>(null)
  const [textareaHeight, setTextareaHeight] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const resizingRef = useRef(false)
  const bodyRef = useRef(body)
  bodyRef.current = body

  const [activeTab, setActiveTab] = useState<ActiveTab>(replyToThread ? 'conversation' : 'message')
  const [threadMessages, setThreadMessages] = useState<FullThreadMessage[] | null>(null)
  const [loadingThread, setLoadingThread] = useState(false)
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null)
  const msgRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const msgPaneRef = useRef<HTMLDivElement>(null)

  // Load thread messages eagerly on mount — conversation is the default tab for replies.
  useEffect(() => {
    if (!replyToThread) return
    let cancelled = false
    setLoadingThread(true)
    getThreadMessages(replyToThread.gmailThreadId)
      .then(msgs => {
        if (cancelled) return
        const sorted = [...msgs].sort((a, b) => Number(b.internalDate) - Number(a.internalDate))
        setThreadMessages(sorted)
        if (sorted.length > 0) setSelectedMsgId(sorted[0].id)
      })
      .catch(() => { if (!cancelled) setThreadMessages([]) })
      .finally(() => { if (!cancelled) setLoadingThread(false) })
    return () => { cancelled = true }
  }, [replyToThread])

  // Sync left-pane selection to whichever message block is nearest the top of the reading pane.
  useEffect(() => {
    const pane = msgPaneRef.current
    if (!pane || !threadMessages?.length) return

    function onScroll() {
      const paneTop = pane!.getBoundingClientRect().top + 80
      let bestId: string | null = null
      let bestDist = Infinity
      for (const [id, el] of Object.entries(msgRefs.current)) {
        if (!el) continue
        const dist = Math.abs(el.getBoundingClientRect().top - paneTop)
        if (dist < bestDist) { bestDist = dist; bestId = id }
      }
      if (bestId) setSelectedMsgId(prev => prev === bestId ? prev : bestId)
    }

    pane.addEventListener('scroll', onScroll, { passive: true })
    return () => pane.removeEventListener('scroll', onScroll)
  }, [threadMessages])

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    resizingRef.current = true
    const startY = e.clientY
    const startHeight = textareaRef.current?.offsetHeight ?? 240

    function onMouseMove(ev: MouseEvent) {
      setTextareaHeight(Math.max(120, startHeight + ev.clientY - startY))
    }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      setTimeout(() => { resizingRef.current = false }, 0)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function handleClose() {
    if (bodyRef.current.trim()) {
      if (!window.confirm('You have unsaved message content. Discard and close?')) return
    }
    onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (bodyRef.current.trim()) {
        if (!window.confirm('You have unsaved message content. Discard and close?')) return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    (async () => {
      const [{ data: tplData, error }, creds] = await Promise.all([
        supabase.from('email_templates').select('*').order('updated_at', { ascending: false }),
        loadCredentials(),
      ])
      if (error) setBanner({ kind: 'error', text: error.message })
      else setTemplates((tplData as EmailTemplate[]) ?? [])
      setGmailConnected(Boolean(creds?.access_token))
      setLoadingTemplates(false)
    })()
  }, [])

  useEffect(() => {
    if (!replyToThread || !gmailConnected) return
    let cancelled = false
    ;(async () => {
      try {
        const headers = await getThreadReplyHeaders(replyToThread.gmailThreadId)
        if (cancelled || !headers) return
        setReplyHeaders({ messageId: headers.messageId, references: headers.references })
        if (!subject) {
          const base = replyToThread.subject ?? headers.subject ?? ''
          const prefix = base.toLowerCase().startsWith('re:') ? '' : 'Re: '
          setSubject(`${prefix}${base}`)
        }
      } catch {
        // best-effort: missing reply headers just means the message goes out un-threaded
      }
    })()
    return () => { cancelled = true }
  }, [replyToThread, gmailConnected, subject])

  const autoFilled = useMemo(
    () => autoFillFromContact({
      contact: { name: contact.name, role: contact.role, email: contact.email, education: contact.education },
      company,
    }),
    [contact, company],
  )

  const selectTemplate = (t: EmailTemplate) => {
    setSelectedId(t.id)
    setSubject(t.subject)
    setBody(t.body)
    setValues({ ...autoFilled })
  }

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.category ?? '').toLowerCase().includes(q),
    )
  }, [templates, search])

  const grouped = useMemo(() => {
    const m = new Map<string, EmailTemplate[]>()
    for (const t of filteredTemplates) {
      const c = t.category?.trim() || 'Uncategorized'
      if (!m.has(c)) m.set(c, [])
      m.get(c)!.push(t)
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredTemplates])

  const renderedSubject = useMemo(() => substitute(subject, values), [subject, values])
  const renderedBody = useMemo(() => substitute(body, values), [body, values])
  const detectedPlaceholders = useMemo(() => extractPlaceholders(subject, body), [subject, body])
  const unfilled = useMemo(
    () => detectedPlaceholders.filter(k => !values[k] || values[k].trim() === ''),
    [detectedPlaceholders, values],
  )

  const updateValue = (key: string, v: string) => setValues(prev => ({ ...prev, [key]: v }))

  async function maybeConnect(): Promise<boolean> {
    if (gmailConnected) return true
    try {
      await connectGmail()
      setGmailConnected(true)
      return true
    } catch (err) {
      setBanner({ kind: 'error', text: `Couldn't connect Gmail: ${(err as Error).message}` })
      return false
    }
  }

  async function handleCloseThread() {
    if (!replyToThread) return
    const confirmed = window.confirm(
      `Close this thread with ${contact.name || 'this contact'}? It will be removed from the board. You can still find it in Gmail.`
    )
    if (!confirmed) return
    const { error } = await supabase
      .from('email_threads')
      .update({ closed_at: new Date().toISOString() })
      .eq('id', replyToThread.threadId)
    if (error) {
      setBanner({ kind: 'error', text: `Couldn't close thread: ${error.message}` })
      return
    }
    onThreadClosed?.()
  }

  async function handleSend(asDraft: boolean) {
    setBanner(null)
    if (!to.trim()) {
      setBanner({ kind: 'error', text: 'Recipient email is required.' })
      return
    }
    if (!subject && !body) {
      setBanner({ kind: 'error', text: 'Pick a template or write a message first.' })
      return
    }
    if (hasUnfilledPlaceholders(renderedSubject) || hasUnfilledPlaceholders(renderedBody)) {
      if (!window.confirm('There are still placeholders that haven\'t been filled in. Send anyway?')) return
    }
    if (!asDraft) {
      if (!window.confirm(`Send this email to ${contact.name || to}?`)) return
    }
    if (!await maybeConnect()) return

    setBusy(asDraft ? 'draft' : 'send')
    try {
      const fromCreds = await loadCredentials()
      const sendArgs = {
        to: to.trim(),
        subject: renderedSubject,
        body: renderedBody,
        fromEmail: fromCreds?.email ?? null,
        threadId: replyToThread?.gmailThreadId ?? null,
        inReplyToMessageId: replyHeaders?.messageId ?? null,
      }
      const result = asDraft ? await createDraft(sendArgs) : await sendMessage(sendArgs)

      const thread = await upsertThreadForContact({
        contactId: contact.id,
        gmailThreadId: result.threadId,
        ownEmail: fromCreds?.email ?? null,
      })

      const isFollowUp = thread != null && thread.message_count > 1
      await supabase.from('email_events').insert({
        contact_id: contact.id,
        thread_id: thread?.id ?? null,
        gmail_message_id: result.id,
        event_type: asDraft ? 'draft_created' : isFollowUp ? 'follow_up_sent' : 'sent',
        template_id: selectedId,
        subject: renderedSubject,
      })

      if (!asDraft) {
        await supabase
          .from('contacts')
          .update({
            last_contact: new Date().toISOString(),
            status: isFollowUp ? 'Following up' : 'Sent',
          })
          .eq('id', contact.id)
      }

      onSent?.()
      onClose()
    } catch (err) {
      if (err instanceof GmailAuthError) {
        setBanner({
          kind: 'warn',
          text: 'Gmail authorization needed. Reconnect to continue.',
          cta: {
            label: 'Reconnect',
            onClick: async () => {
              try {
                await connectGmail()
                setGmailConnected(true)
                setBanner(null)
              } catch (e) {
                setBanner({ kind: 'error', text: (e as Error).message })
              }
            },
          },
        })
      } else {
        setBanner({ kind: 'error', text: (err as Error).message })
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.overlay} onClick={() => { if (!resizingRef.current) handleClose() }}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>

        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.title}>
              {replyToThread ? 'Thread with' : 'Email'} {contact.name || 'contact'}
            </span>
            <span className={styles.subtitle}>
              {company.name}{contact.role ? ` · ${contact.role}` : ''}
            </span>
          </div>

          {replyToThread && (
            <div className={styles.tabBar}>
              <button
                type="button"
                className={`${styles.tabBtn} ${activeTab === 'conversation' ? styles.tabBtnActive : ''}`}
                onClick={() => setActiveTab('conversation')}
              >
                Conversation
              </button>
              <button
                type="button"
                className={`${styles.tabBtn} ${activeTab === 'message' ? styles.tabBtnActive : ''}`}
                onClick={() => setActiveTab('message')}
              >
                Message
              </button>
            </div>
          )}

          <button type="button" className={styles.closeButton} onClick={handleClose} aria-label="Close">×</button>
        </header>

        {banner && (
          <div className={`${styles.banner} ${
            banner.kind === 'error' ? styles.bannerError
              : banner.kind === 'warn' ? styles.bannerWarn
                : styles.bannerInfo
          }`}>
            {banner.text}
            {banner.cta && (
              <>{' '}<button type="button" className={styles.linkButton} onClick={banner.cta.onClick}>{banner.cta.label}</button></>
            )}
          </div>
        )}

        {/* ── Conversation tab ──────────────────────────────────────── */}
        {activeTab === 'conversation' && replyToThread && (
          <div className={styles.conversationBody}>
            <div className={styles.msgList}>
              {loadingThread && <p className={styles.msgListEmpty}>Loading…</p>}
              {!loadingThread && threadMessages?.length === 0 && (
                <p className={styles.msgListEmpty}>No messages found.</p>
              )}
              {!loadingThread && threadMessages?.map(msg => {
                const isSent = msg.labelIds.includes('SENT')
                const name = shortName(parseSenderName(msg.from))
                const isSelected = msg.id === selectedMsgId
                return (
                  <button
                    key={msg.id}
                    type="button"
                    className={`${styles.msgRow} ${isSelected ? styles.msgRowSelected : ''} ${isSent ? styles.msgRowSent : ''}`}
                    onClick={() => {
                      setSelectedMsgId(msg.id)
                      msgRefs.current[msg.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                  >
                    <span className={styles.msgRowName}>{name}</span>
                    <span className={styles.msgRowDate}>{formatMsgDate(msg.internalDate)}</span>
                  </button>
                )
              })}
            </div>

            <div className={styles.msgPane} ref={msgPaneRef}>
              {loadingThread && <p className={styles.msgPaneEmpty}>Loading…</p>}
              {!loadingThread && threadMessages?.length === 0 && (
                <p className={styles.msgPaneEmpty}>No messages found.</p>
              )}
              {!loadingThread && threadMessages?.map((msg, i) => {
                const isSent = msg.labelIds.includes('SENT')
                const senderName = parseSenderName(msg.from)
                return (
                  <div
                    key={msg.id}
                    ref={el => { msgRefs.current[msg.id] = el }}
                    className={styles.msgBlock}
                  >
                    {i > 0 && <div className={styles.msgDivider} />}
                    <div className={styles.msgBlockHeader}>
                      <span className={`${styles.msgBlockSender} ${isSent ? styles.msgBlockSenderSent : ''}`}>
                        {senderName}
                      </span>
                      <span className={styles.msgBlockDate}>{formatMsgDate(msg.internalDate)}</span>
                    </div>
                    {msg.subject && (
                      <div className={styles.msgBlockSubject}>{msg.subject}</div>
                    )}
                    <div className={styles.msgBlockBody}>
                      {renderEmailBody(msg.bodyText)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Message tab ───────────────────────────────────────────── */}
        {activeTab === 'message' && (
          <>
            <div className={styles.body}>
              <div className={styles.templateColumn}>
                <input
                  className={styles.templateSearch}
                  type="search"
                  placeholder="Search templates…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <div className={styles.templateList}>
                  {loadingTemplates && <p className={styles.templateEmpty}>Loading…</p>}
                  {!loadingTemplates && templates.length === 0 && (
                    <p className={styles.templateEmpty}>
                      No templates yet. Create one from the Templates page.
                    </p>
                  )}
                  {grouped.map(([category, items]) => (
                    <div key={category}>
                      <div className={styles.templateCategory}>{category}</div>
                      {items.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          className={`${styles.templateItem} ${selectedId === t.id ? styles.templateItemActive : ''}`}
                          onClick={() => selectTemplate(t)}
                        >
                          <span className={styles.templateItemName}>{t.name}</span>
                          <span className={styles.templateItemMeta}>{t.subject || <em>No subject</em>}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.composer}>
                <div className={styles.composerHeader}>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>To</span>
                    <input
                      className={styles.fieldInput}
                      type="email"
                      value={to}
                      onChange={e => setTo(e.target.value)}
                      placeholder="contact@example.com"
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Subject</span>
                    <input
                      className={styles.fieldInput}
                      type="text"
                      value={renderedSubject}
                      onChange={e => setSubject(e.target.value)}
                      placeholder="Pick a template or write a subject"
                    />
                  </div>
                </div>

                <div className={styles.composerBody}>
                  <textarea
                    ref={textareaRef}
                    className={styles.bodyTextarea}
                    style={textareaHeight !== null ? { height: textareaHeight, flex: 'none' } : undefined}
                    value={renderedBody}
                    onChange={e => setBody(e.target.value)}
                    placeholder="Pick a template on the left, or write a message here."
                  />
                  <div className={styles.resizeHandle} onMouseDown={startResize} />
                </div>

                {detectedPlaceholders.length > 0 && (
                  <div className={styles.placeholderPanel}>
                    <div className={styles.placeholderPanelTitle}>
                      <span>Placeholders</span>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: unfilled.length > 0 ? '#9e6c00' : 'var(--color-text-tertiary)', textTransform: 'none', letterSpacing: 0 }}>
                        {unfilled.length > 0 ? `${unfilled.length} unfilled` : 'all filled'}
                      </span>
                    </div>
                    <div className={styles.placeholderGrid}>
                      {detectedPlaceholders.map(k => (
                        <label key={k} className={styles.placeholderField}>
                          <span className={styles.placeholderLabel}>[{k}]</span>
                          <input
                            type="text"
                            className={`${styles.placeholderInput} ${(!values[k] || values[k].trim() === '') ? styles.placeholderInputUnfilled : ''}`}
                            value={values[k] ?? ''}
                            onChange={e => updateValue(k, e.target.value)}
                            placeholder={autoFilled[k] ? '(autofilled empty)' : 'Fill in…'}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <footer className={styles.footer}>
              <div className={styles.footerLeft}>
                {replyToThread ? (
                  <button
                    type="button"
                    className={styles.closeThreadButton}
                    onClick={handleCloseThread}
                    disabled={busy != null}
                  >
                    Close thread
                  </button>
                ) : (
                  <span className={styles.footerHint}>
                    {gmailConnected === false
                      ? 'Connect Gmail on first send to authorize the integration.'
                      : 'Send goes through Gmail. Draft puts it in your Drafts folder.'}
                  </span>
                )}
              </div>
              <div className={styles.footerRight}>
                <button type="button" className={styles.cancelButton} onClick={handleClose} disabled={busy != null}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.draftButton}
                  onClick={() => handleSend(true)}
                  disabled={busy != null}
                >
                  {busy === 'draft' ? 'Drafting…' : 'Save as draft'}
                </button>
                <button
                  type="button"
                  className={styles.sendButton}
                  onClick={() => handleSend(false)}
                  disabled={busy != null}
                >
                  {busy === 'send' ? 'Sending…' : 'Send'}
                </button>
              </div>
            </footer>
          </>
        )}

      </div>
    </div>
  )
}
