import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Contact, Company, EmailTemplate } from '../../types/database'
import {
  autoFillFromContact,
  extractPlaceholders,
  hasUnfilledPlaceholders,
  substitute,
} from '../../lib/templates/placeholders'
import { createDraft, sendMessage, getThreadReplyHeaders, GmailAuthError } from '../../lib/gmail/api'
import { upsertThreadForContact } from '../../lib/gmail/sync'
import { connectGmail, loadCredentials } from '../../lib/gmail/oauth'
import styles from './SendEmailModal.module.css'

interface Props {
  contact: Contact
  company: Pick<Company, 'name'>
  onClose: () => void
  onSent?: () => void
  // When set, the message will be sent inside this Gmail thread (reply mode):
  // adds In-Reply-To / References headers, prefills "Re: …" subject, and
  // pins threadId so Gmail keeps it in the same conversation.
  replyToThread?: { gmailThreadId: string; subject: string | null } | null
}

export default function SendEmailModal({ contact, company, onClose, onSent, replyToThread }: Props) {
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
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

  // In reply mode, fetch the headers for the latest message in the thread so
  // we can build In-Reply-To / References when sending. Also prefill the
  // subject as "Re: <original>" if the user hasn't picked a template.
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
        // best-effort: a missing reply header just means the message goes out
        // un-threaded. Gmail will still associate it via threadId.
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
    // Seed values with autofill; clear any prior custom inputs
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

  // Templates grouped by category for the sidebar list.
  const grouped = useMemo(() => {
    const m = new Map<string, EmailTemplate[]>()
    for (const t of filteredTemplates) {
      const c = t.category?.trim() || 'Uncategorized'
      if (!m.has(c)) m.set(c, [])
      m.get(c)!.push(t)
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredTemplates])

  // Live preview computed by substituting current values into raw template strings.
  const renderedSubject = useMemo(() => substitute(subject, values), [subject, values])
  const renderedBody = useMemo(() => substitute(body, values), [body, values])

  const detectedPlaceholders = useMemo(
    () => extractPlaceholders(subject, body),
    [subject, body],
  )

  const unfilled = useMemo(() => {
    return detectedPlaceholders.filter(k => !values[k] || values[k].trim() === '')
  }, [detectedPlaceholders, values])

  const updateValue = (key: string, v: string) => {
    setValues(prev => ({ ...prev, [key]: v }))
  }

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
      const proceed = window.confirm('There are still placeholders that haven\'t been filled in. Send anyway?')
      if (!proceed) return
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

      // Persist the thread + audit event so the status engine has data immediately.
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

      // For real sends, bump the contact's last_contact and status.
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
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.title}>
              {replyToThread ? 'Reply to' : 'Email'} {contact.name || 'contact'}
            </span>
            <span className={styles.subtitle}>
              {company.name}{contact.role ? ` · ${contact.role}` : ''}
            </span>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">×</button>
        </header>

        {banner && (
          <div
            className={`${styles.banner} ${
              banner.kind === 'error' ? styles.bannerError
                : banner.kind === 'warn' ? styles.bannerWarn
                  : styles.bannerInfo
            }`}
          >
            {banner.text}
            {banner.cta && (
              <>
                {' '}
                <button type="button" className={styles.linkButton} onClick={banner.cta.onClick}>
                  {banner.cta.label}
                </button>
              </>
            )}
          </div>
        )}

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
                  <div style={{
                    padding: 'var(--spacing-2) var(--spacing-3) 4px',
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 600,
                    color: 'var(--color-text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}>{category}</div>
                  {items.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      className={`${styles.templateItem} ${selectedId === t.id ? styles.templateItemActive : ''}`}
                      onClick={() => selectTemplate(t)}
                    >
                      <span className={styles.templateItemName}>{t.name}</span>
                      <span className={styles.templateItemMeta}>
                        {t.subject || <em>No subject</em>}
                      </span>
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
                  onChange={e => {
                    // Allow direct editing of the rendered subject by syncing
                    // back into the raw subject (placeholders become literal).
                    setSubject(e.target.value)
                  }}
                  placeholder="Pick a template or write a subject"
                />
              </div>
            </div>

            <div className={styles.composerBody}>
              <textarea
                className={styles.bodyTextarea}
                value={renderedBody}
                onChange={e => setBody(e.target.value)}
                placeholder="Pick a template on the left, or write a message here."
              />
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
                        placeholder={autoFilled[k] ? `(autofilled empty)` : 'Fill in…'}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className={styles.footer}>
          <span className={styles.footerLeft}>
            {gmailConnected === false
              ? 'Connect Gmail on first send to authorize the integration.'
              : 'Send goes through Gmail. Draft puts it in your Drafts folder.'}
          </span>
          <div className={styles.footerRight}>
            <button type="button" className={styles.cancelButton} onClick={onClose} disabled={busy != null}>
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
      </div>
    </div>
  )
}
