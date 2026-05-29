import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { EmailTemplate } from '../../types/database'
import { BUILTIN_KEYS, extractPlaceholders, isBuiltin } from '../../lib/templates/placeholders'
import styles from './TemplateEditor.module.css'

interface Props {
  template: EmailTemplate | null  // null = create
  existingCategories: string[]
  onClose: () => void
  onSaved: (template: EmailTemplate) => void
  onDeleted?: (id: string) => void
}

export default function TemplateEditor({ template, existingCategories, onClose, onSaved, onDeleted }: Props) {
  const [name, setName] = useState(template?.name ?? '')
  const [category, setCategory] = useState(template?.category ?? '')
  const [subject, setSubject] = useState(template?.subject ?? '')
  const [body, setBody] = useState(template?.body ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  const lastFocusedRef = useRef<'subject' | 'body'>('body')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const detected = useMemo(() => extractPlaceholders(subject, body), [subject, body])

  const insertPlaceholder = (key: string) => {
    const token = `[${key}]`
    const target = lastFocusedRef.current === 'subject' ? subjectRef.current : bodyRef.current
    if (!target) return
    const start = target.selectionStart ?? target.value.length
    const end = target.selectionEnd ?? start
    const before = target.value.slice(0, start)
    const after = target.value.slice(end)
    const next = before + token + after
    if (lastFocusedRef.current === 'subject') setSubject(next)
    else setBody(next)
    requestAnimationFrame(() => {
      target.focus()
      const pos = before.length + token.length
      target.setSelectionRange(pos, pos)
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setSaving(true)
    setError(null)

    const row = {
      name: name.trim(),
      category: category.trim() || null,
      subject,
      body,
      updated_at: new Date().toISOString(),
    }

    if (template) {
      const { data, error } = await supabase
        .from('email_templates')
        .update(row)
        .eq('id', template.id)
        .select()
        .single()
      if (error) {
        setError(error.message)
        setSaving(false)
        return
      }
      onSaved(data as EmailTemplate)
    } else {
      const { data, error } = await supabase
        .from('email_templates')
        .insert(row)
        .select()
        .single()
      if (error) {
        setError(error.message)
        setSaving(false)
        return
      }
      onSaved(data as EmailTemplate)
    }
  }

  async function handleDelete() {
    if (!template) return
    if (!window.confirm(`Delete template “${template.name}”? This can't be undone.`)) return
    setSaving(true)
    const { error } = await supabase.from('email_templates').delete().eq('id', template.id)
    if (error) {
      setError(error.message)
      setSaving(false)
      return
    }
    onDeleted?.(template.id)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <header className={styles.header}>
          <h2 className={styles.title}>{template ? 'Edit template' : 'New template'}</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">×</button>
        </header>

        <form onSubmit={handleSubmit} className={styles.body}>
          <div className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="tpl-name">Template name</label>
              <input
                id="tpl-name"
                className={styles.input}
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Cold outreach"
                autoFocus
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="tpl-category">Category</label>
              <input
                id="tpl-category"
                className={styles.input}
                type="text"
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="e.g. Cold email"
                list="tpl-category-options"
              />
              <datalist id="tpl-category-options">
                {existingCategories.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="tpl-subject">Subject</label>
              <input
                id="tpl-subject"
                ref={subjectRef}
                className={styles.input}
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                onFocus={() => { lastFocusedRef.current = 'subject' }}
                placeholder="Quick question about [company]"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="tpl-body">Body</label>
              <textarea
                id="tpl-body"
                ref={bodyRef}
                className={styles.textarea}
                value={body}
                onChange={e => setBody(e.target.value)}
                onFocus={() => { lastFocusedRef.current = 'body' }}
                placeholder={`Hi [name],\n\nI hope you're doing well…`}
              />
            </div>

            {error && <p className={styles.error}>{error}</p>}
          </div>

          <aside className={styles.sidebar}>
            <div>
              <p className={styles.sidebarTitle}>Insert placeholder</p>
              <div className={styles.placeholderList} style={{ marginTop: 'var(--spacing-2)' }}>
                {BUILTIN_KEYS.map(k => (
                  <button
                    key={k}
                    type="button"
                    className={styles.placeholderItem}
                    onClick={() => insertPlaceholder(k)}
                  >
                    [{k}]
                  </button>
                ))}
                <button
                  type="button"
                  className={styles.placeholderItem}
                  onClick={() => insertPlaceholder('custom')}
                >
                  [custom]
                </button>
              </div>
              <p className={styles.placeholderHint} style={{ marginTop: 'var(--spacing-3)' }}>
                Click to insert at cursor. Built-ins fill from contact data;
                anything else (like [custom]) you'll fill in when sending.
              </p>
            </div>

            <div>
              <p className={styles.sidebarTitle}>Detected in this template</p>
              <div className={styles.detected} style={{ marginTop: 'var(--spacing-2)' }}>
                {detected.length === 0 && (
                  <span className={styles.placeholderHint}>None yet</span>
                )}
                {detected.map(k => (
                  <span
                    key={k}
                    className={`${styles.detectedTag} ${!isBuiltin(k) ? styles.detectedTagCustom : ''}`}
                  >
                    [{k}]
                  </span>
                ))}
              </div>
            </div>
          </aside>
        </form>

        <footer className={styles.footer}>
          <div className={styles.footerLeft}>
            {template && (
              <button
                type="button"
                className={styles.deleteButton}
                onClick={handleDelete}
                disabled={saving}
              >
                Delete
              </button>
            )}
          </div>
          <div className={styles.footerRight}>
            <button type="button" className={styles.cancelButton} onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={saving}
              onClick={handleSubmit}
            >
              {saving ? 'Saving…' : template ? 'Save changes' : 'Create template'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
