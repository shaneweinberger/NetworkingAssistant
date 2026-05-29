import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { EmailTemplate } from '../types/database'
import { extractPlaceholders } from '../lib/templates/placeholders'
import TemplateEditor from '../components/TemplateEditor/TemplateEditor'
import styles from './Templates.module.css'

const ALL = '__all__'

export default function Templates() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<EmailTemplate | null>(null)
  const [creating, setCreating] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string>(ALL)
  const [query, setQuery] = useState('')

  useEffect(() => {
    async function fetchTemplates() {
      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .order('updated_at', { ascending: false })
      if (error) setError(error.message)
      else setTemplates((data as EmailTemplate[]) ?? [])
      setLoading(false)
    }
    fetchTemplates()
  }, [])

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of templates) {
      const c = t.category?.trim() || 'Uncategorized'
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [templates])

  const existingCategoryNames = useMemo(
    () => Array.from(new Set(templates.map(t => t.category).filter(Boolean) as string[])).sort(),
    [templates],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return templates.filter(t => {
      if (activeCategory !== ALL) {
        const c = t.category?.trim() || 'Uncategorized'
        if (c !== activeCategory) return false
      }
      if (!q) return true
      return (
        t.name.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        (t.category ?? '').toLowerCase().includes(q)
      )
    })
  }, [templates, activeCategory, query])

  const handleSaved = (t: EmailTemplate) => {
    setTemplates(prev => {
      const next = prev.filter(x => x.id !== t.id)
      return [t, ...next]
    })
    setEditing(null)
    setCreating(false)
  }

  const handleDeleted = (id: string) => {
    setTemplates(prev => prev.filter(t => t.id !== id))
    setEditing(null)
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Templates</h1>
          <p className={styles.subtitle}>Reusable outreach and follow-up emails.</p>
        </div>
        <button className={styles.addButton} type="button" onClick={() => setCreating(true)}>
          New Template
        </button>
      </header>

      {loading && <p className={styles.stateText}>Loading…</p>}
      {error && (
        <p className={styles.stateText}>
          Error: {error} — did you run <code>migrations/2026-05-28_create_email_features.sql</code>?
        </p>
      )}

      {!loading && !error && (
        <>
          <div className={styles.toolbar}>
            <button
              type="button"
              className={`${styles.categoryChip} ${activeCategory === ALL ? styles.categoryChipActive : ''}`}
              onClick={() => setActiveCategory(ALL)}
            >
              All <span className={styles.chipCount}>{templates.length}</span>
            </button>
            {categories.map(([name, count]) => (
              <button
                key={name}
                type="button"
                className={`${styles.categoryChip} ${activeCategory === name ? styles.categoryChipActive : ''}`}
                onClick={() => setActiveCategory(name)}
              >
                {name} <span className={styles.chipCount}>{count}</span>
              </button>
            ))}
            <input
              type="search"
              className={styles.search}
              placeholder="Search templates…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>

          <div className={styles.grid}>
            {filtered.length === 0 && (
              <div className={styles.emptyState}>
                <p className={styles.emptyTitle}>
                  {templates.length === 0 ? 'No templates yet' : 'No matching templates'}
                </p>
                <p className={styles.emptyText}>
                  {templates.length === 0
                    ? 'Create your first template to start sending faster.'
                    : 'Try a different category or search term.'}
                </p>
                {templates.length === 0 && (
                  <button className={styles.addButton} type="button" onClick={() => setCreating(true)}>
                    New Template
                  </button>
                )}
              </div>
            )}

            {filtered.map(t => {
              const tags = extractPlaceholders(t.subject, t.body).slice(0, 6)
              return (
                <button
                  key={t.id}
                  type="button"
                  className={styles.card}
                  onClick={() => setEditing(t)}
                >
                  <div className={styles.cardHeader}>
                    <span className={styles.cardName}>{t.name}</span>
                    {t.category && <span className={styles.cardCategory}>{t.category}</span>}
                  </div>
                  <div className={styles.cardSubject}>{t.subject || <em style={{ color: 'var(--color-text-tertiary)' }}>No subject</em>}</div>
                  <div className={styles.cardBody}>
                    {t.body || <span style={{ color: 'var(--color-text-tertiary)' }}>No body</span>}
                  </div>
                  <div className={styles.cardMeta}>
                    <div className={styles.placeholderTags}>
                      {tags.map(tag => <span key={tag} className={styles.placeholderTag}>[{tag}]</span>)}
                    </div>
                    <span>Updated {formatDate(t.updated_at)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}

      {(editing || creating) && (
        <TemplateEditor
          template={editing}
          existingCategories={existingCategoryNames}
          onClose={() => { setEditing(null); setCreating(false) }}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}
