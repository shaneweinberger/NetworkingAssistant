import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Company, Contact, CompanyWithContacts, EmailThread } from '../types/database'
import AddCompanyModal from '../components/AddCompanyModal'
import DeleteContactModal from '../components/DeleteContactModal'
import DeleteCompanyModal from '../components/DeleteCompanyModal/DeleteCompanyModal'
import ColumnSettingsModal from '../components/ColumnSettingsModal/ColumnSettingsModal'
import CategoryTabs, { type CategoryFilter } from '../components/CategoryTabs/CategoryTabs'
import CategoryPicker from '../components/CategoryPicker/CategoryPicker'
import ContactsTable, {
  DEFAULT_CONTACT_COLUMNS,
  type ContactColKey,
  type ContactColumnConfig,
} from '../components/ContactsTable/ContactsTable'
import SendEmailModal from '../components/SendEmailModal/SendEmailModal'
import type { SortState } from '../components/Table/Table'
import { syncGmail } from '../lib/gmail/sync'
import styles from './Contacts.module.css'

const GMAIL_SYNC_INTERVAL_MS = 60_000

const COMPANY_ORDER_STORAGE_KEY = 'contacts:company-order'
const CATEGORY_FILTER_STORAGE_KEY = 'contacts:category-filter'

function loadCategoryFilter(): CategoryFilter {
  try {
    const raw = localStorage.getItem(CATEGORY_FILTER_STORAGE_KEY)
    if (!raw) return { type: 'all' }
    const parsed = JSON.parse(raw) as CategoryFilter
    if (parsed?.type === 'all' || parsed?.type === 'starred') return parsed
    if (parsed?.type === 'category' && typeof parsed.name === 'string') return parsed
    return { type: 'all' }
  } catch {
    return { type: 'all' }
  }
}

function saveCategoryFilter(filter: CategoryFilter) {
  try {
    localStorage.setItem(CATEGORY_FILTER_STORAGE_KEY, JSON.stringify(filter))
  } catch {
    // ignore
  }
}

function loadCompanyOrder(): string[] {
  try {
    const stored = localStorage.getItem(COMPANY_ORDER_STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveCompanyOrder(ids: string[]) {
  try {
    localStorage.setItem(COMPANY_ORDER_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // ignore quota / unavailable storage
  }
}

function applySavedOrder<T extends { id: string; name: string }>(items: T[]): T[] {
  const order = loadCompanyOrder()
  if (order.length === 0) return items
  const orderMap = new Map(order.map((id, i) => [id, i]))
  return [...items].sort((a, b) => {
    const aIdx = orderMap.get(a.id) ?? Infinity
    const bIdx = orderMap.get(b.id) ?? Infinity
    if (aIdx !== bIdx) return aIdx - bIdx
    return a.name.localeCompare(b.name)
  })
}

type ColumnConfigRow = {
  column_key: ContactColKey
  label: string
  type: 'text' | 'dropdown'
  visible: boolean
  width: number
  position: number
  options: ContactColumnConfig['options']
  sortable: boolean
  filterable: boolean
}

function rowToConfig(row: ColumnConfigRow): ContactColumnConfig {
  return {
    key: row.column_key,
    label: row.label,
    type: row.type,
    visible: row.visible,
    width: row.width,
    options: row.options ?? [],
    sortable: row.sortable,
    filterable: row.filterable,
  }
}

function buildThreadMap(threads: EmailThread[]): Record<string, EmailThread> {
  const map: Record<string, EmailThread> = {}
  for (const t of threads) {
    const existing = map[t.contact_id]
    const newer = !existing
      || (t.last_message_at && (!existing.last_message_at || new Date(t.last_message_at) > new Date(existing.last_message_at)))
    if (newer) map[t.contact_id] = t
  }
  return map
}

function configToRow(config: ContactColumnConfig, position: number): ColumnConfigRow {
  return {
    column_key: config.key,
    label: config.label,
    type: config.type,
    visible: config.visible,
    width: config.width,
    position,
    options: config.options,
    sortable: config.sortable ?? true,
    filterable: config.filterable ?? true,
  }
}

export default function Contacts() {
  const [companies, setCompanies] = useState<CompanyWithContacts[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showCompanyModal, setShowCompanyModal] = useState(false)
  const [showColumnSettings, setShowColumnSettings] = useState(false)

  const [columns, setColumns] = useState<ContactColumnConfig[]>(DEFAULT_CONTACT_COLUMNS)
  const [sort, setSort] = useState<SortState<ContactColKey>>(null)
  const [filters, setFilters] = useState<Partial<Record<ContactColKey, string>>>({})

  const [deleteContactTarget, setDeleteContactTarget] = useState<Contact | null>(null)
  const [deleteCompanyTarget, setDeleteCompanyTarget] = useState<Company | null>(null)
  const [newContactId, setNewContactId] = useState<string | null>(null)

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(loadCategoryFilter)
  const [categoryPickerFor, setCategoryPickerFor] = useState<
    { companyId: string; anchor: HTMLElement } | null
  >(null)

  const [threadsByContactId, setThreadsByContactId] = useState<Record<string, EmailThread>>({})
  const [sendEmailFor, setSendEmailFor] = useState<{ contact: Contact; company: { name: string } } | null>(null)

  const [companyDrag, setCompanyDrag] = useState<{ from: number; dropIndex: number } | null>(null)
  const companyDragRef = useRef(companyDrag)
  companyDragRef.current = companyDrag
  const justDraggedCompanyRef = useRef(false)
  const companyListRef = useRef<HTMLDivElement>(null)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    async function fetchData() {
      const [{ data: cData, error: cErr }, configResult, { data: threadData, error: threadErr }] = await Promise.all([
        supabase
          .from('companies')
          .select(`id, name, website, category, starred, created_at,
            contacts ( id, name, role, email, last_contact, status, location, education, linkedin, notes, created_at, company_id )`)
          .order('name'),
        supabase
          .from('contact_column_configs')
          .select('*')
          .order('position'),
        supabase.from('email_threads').select('*'),
      ])

      if (cErr) setError(cErr.message)
      else setCompanies(applySavedOrder(cData as CompanyWithContacts[]))

      // Load column configs (gracefully fall back if table missing or empty)
      if (configResult.error) {
        console.warn('Column config fetch failed; using defaults:', configResult.error.message)
      } else if (!configResult.data || configResult.data.length === 0) {
        // Seed defaults
        const seedRows = DEFAULT_CONTACT_COLUMNS.map((c, i) => configToRow(c, i))
        const { error: seedErr } = await supabase.from('contact_column_configs').insert(seedRows)
        if (seedErr) console.warn('Could not seed column configs:', seedErr.message)
      } else {
        setColumns((configResult.data as ColumnConfigRow[]).map(rowToConfig))
      }

      if (threadErr) {
        console.warn('Could not load email_threads (run the email migration?):', threadErr.message)
      } else {
        setThreadsByContactId(buildThreadMap(threadData as EmailThread[]))
      }

      setLoading(false)
    }
    fetchData()
  }, [])

  // Background Gmail sync: kick off once on mount and poll periodically while
  // the tab is visible. Pulls thread state from our DB after each pass so the
  // status badges reflect any newly-detected replies.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function runOnce() {
      const result = await syncGmail()
      if (cancelled) return
      if (result.mode !== 'skipped') {
        const { data, error } = await supabase.from('email_threads').select('*')
        if (!error && data) setThreadsByContactId(buildThreadMap(data as EmailThread[]))
      }
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

  const persistColumns = async (cols: ContactColumnConfig[]) => {
    const results = await Promise.all(
      cols.map((c, i) =>
        supabase
          .from('contact_column_configs')
          .update(configToRow(c, i))
          .eq('column_key', c.key),
      ),
    )
    for (const { error } of results) {
      if (error) console.warn('Failed to save column config:', error.message)
    }
  }

  // Used by Table for resize/reorder — debounced because resize fires per-pixel.
  const handleColumnsChange = (cols: ContactColumnConfig[]) => {
    setColumns(cols)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => persistColumns(cols), 400)
  }

  // Used by the settings modal — save immediately so the user sees it stick.
  const handleColumnsConfigChange = (cols: ContactColumnConfig[]) => {
    setColumns(cols)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => persistColumns(cols), 200)
  }

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const handleHeaderClick = (id: string) => {
    if (justDraggedCompanyRef.current) {
      justDraggedCompanyRef.current = false
      return
    }
    toggle(id)
  }

  const startCompanyDrag = (e: React.MouseEvent, fromIndex: number) => {
    const target = e.target as HTMLElement
    if (target.closest('button')) return

    justDraggedCompanyRef.current = false
    const startY = e.clientY
    let dragging = false

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging && Math.abs(ev.clientY - startY) < 5) return
      if (!dragging) {
        dragging = true
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
      }

      const listEl = companyListRef.current
      if (!listEl) return

      const children = Array.from(listEl.children) as HTMLElement[]
      let dropIndex = children.length
      for (let i = 0; i < children.length; i++) {
        const rect = children[i].getBoundingClientRect()
        if (ev.clientY < rect.top + rect.height / 2) {
          dropIndex = i
          break
        }
      }

      setCompanyDrag({ from: fromIndex, dropIndex })
    }

    const onMouseUp = () => {
      if (dragging) justDraggedCompanyRef.current = true
      const ds = companyDragRef.current
      if (ds && ds.dropIndex !== ds.from && ds.dropIndex !== ds.from + 1) {
        setCompanies(prev => {
          const next = [...prev]
          const [moved] = next.splice(ds.from, 1)
          next.splice(ds.dropIndex > ds.from ? ds.dropIndex - 1 : ds.dropIndex, 0, moved)
          saveCompanyOrder(next.map(c => c.id))
          return next
        })
      }
      setCompanyDrag(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const handleCompanyAdded = (company: Company) => {
    setCompanies(prev => {
      const next = [...prev, { ...company, contacts: [] }]
      saveCompanyOrder(next.map(c => c.id))
      return next
    })
    setShowCompanyModal(false)
  }

  const updateCompany = async (
    id: string,
    patch: Partial<Pick<Company, 'category' | 'starred'>>,
  ) => {
    setCompanies(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)))
    const { error } = await supabase.from('companies').update(patch).eq('id', id)
    if (error) console.warn('Failed to update company:', error.message)
  }

  const changeCategoryFilter = (filter: CategoryFilter) => {
    setCategoryFilter(filter)
    saveCategoryFilter(filter)
  }

  const allCategories = useMemo(() => {
    const set = new Set<string>()
    for (const c of companies) {
      if (c.category && c.category.trim()) set.add(c.category)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [companies])

  const counts = useMemo(() => {
    const byCategory: Record<string, number> = {}
    let starred = 0
    for (const c of companies) {
      if (c.starred) starred++
      if (c.category) byCategory[c.category] = (byCategory[c.category] ?? 0) + 1
    }
    return { all: companies.length, starred, byCategory }
  }, [companies])

  const filteredCompanies = useMemo(() => {
    if (categoryFilter.type === 'all') return companies
    if (categoryFilter.type === 'starred') return companies.filter(c => c.starred)
    return companies.filter(c => c.category === categoryFilter.name)
  }, [companies, categoryFilter])

  const newCompanyDefaultCategory =
    categoryFilter.type === 'category' ? categoryFilter.name : null

  const updateContact = async (id: string, field: keyof Contact, value: string | null) => {
    setCompanies(prev => prev.map(c => ({
      ...c,
      contacts: c.contacts.map(ct => ct.id === id ? { ...ct, [field]: value } : ct),
    })))
    if (newContactId === id) setNewContactId(null)
    await supabase.from('contacts').update({ [field]: value }).eq('id', id)
  }

  const addContact = async (companyId: string) => {
    const { data, error } = await supabase.from('contacts').insert({
      company_id: companyId,
      name: '',
      role: null,
      email: null,
      status: 'Sent',
      location: null,
      education: null,
      linkedin: null,
      last_contact: null,
    }).select().single()
    if (!error && data) {
      setCompanies(prev => prev.map(c =>
        c.id === companyId ? { ...c, contacts: [...c.contacts, data as Contact] } : c
      ))
      setNewContactId(data.id)
      setExpanded(prev => new Set([...prev, companyId]))
    }
  }

  const confirmDeleteContact = async () => {
    if (!deleteContactTarget) return
    const { error } = await supabase.from('contacts').delete().eq('id', deleteContactTarget.id)
    if (!error) {
      setCompanies(prev => prev.map(c => ({
        ...c,
        contacts: c.contacts.filter(ct => ct.id !== deleteContactTarget.id),
      })))
      setDeleteContactTarget(null)
    }
  }

  const confirmDeleteCompany = async () => {
    if (!deleteCompanyTarget) return
    // Delete contacts first in case the FK doesn't cascade
    await supabase.from('contacts').delete().eq('company_id', deleteCompanyTarget.id)
    const { error } = await supabase.from('companies').delete().eq('id', deleteCompanyTarget.id)
    if (!error) {
      setCompanies(prev => {
        const next = prev.filter(c => c.id !== deleteCompanyTarget.id)
        saveCompanyOrder(next.map(c => c.id))
        return next
      })
      setExpanded(prev => {
        const next = new Set(prev)
        next.delete(deleteCompanyTarget.id)
        return next
      })
      setDeleteCompanyTarget(null)
    }
  }

  const handleFilterChange = (key: ContactColKey, value: string) => {
    setFilters(prev => {
      const next = { ...prev }
      if (value) next[key] = value
      else delete next[key]
      return next
    })
  }

  const visibleContacts = (contacts: Contact[]) => {
    let result = contacts
    for (const k of Object.keys(filters) as ContactColKey[]) {
      const v = filters[k]?.toLowerCase()
      if (!v) continue
      result = result.filter(c => String((c as unknown as Record<string, unknown>)[k] ?? '').toLowerCase().includes(v))
    }
    if (sort) {
      result = [...result].sort((a, b) => {
        const av = String((a as unknown as Record<string, unknown>)[sort.key] ?? '').toLowerCase()
        const bv = String((b as unknown as Record<string, unknown>)[sort.key] ?? '').toLowerCase()
        return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      })
    }
    return result
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Contacts</h1>
          <p className={styles.subtitle}>Manage your contacts and connections.</p>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => setShowColumnSettings(true)}
          >
            Columns
          </button>
          <button className={styles.addButton} type="button" onClick={() => setShowCompanyModal(true)}>
            Add Company
          </button>
        </div>
      </header>

      {loading && <p className={styles.stateText}>Loading…</p>}
      {error && <p className={styles.stateText}>Error: {error}</p>}

      {!loading && !error && (
        <>
          <CategoryTabs
            categories={allCategories}
            counts={counts}
            value={categoryFilter}
            onChange={changeCategoryFilter}
          />
          <div className={styles.companyList} ref={companyListRef}>
            {companies.length === 0 && (
              <p className={styles.stateText}>No companies yet. Add one to get started.</p>
            )}
            {companies.length > 0 && filteredCompanies.length === 0 && (
              <p className={styles.stateText}>
                {categoryFilter.type === 'starred'
                  ? 'No starred companies yet. Star a company to see it here.'
                  : categoryFilter.type === 'category'
                    ? `No companies in “${categoryFilter.name}” yet.`
                    : 'No companies match.'}
              </p>
            )}

            {filteredCompanies.map(group => {
              const index = companies.findIndex(c => c.id === group.id)
            const isOpen = expanded.has(group.id)
            const ds = companyDrag
            const isDragging = ds?.from === index
            const isDropAbove =
              ds !== null && ds.dropIndex === index && ds.from !== index && ds.from !== index - 1
            const isDropBelow =
              ds !== null && ds.dropIndex === companies.length && index === companies.length - 1 && ds.from !== index
            return (
              <div
                key={group.id}
                className={[
                  styles.companyGroup,
                  isDragging ? styles.companyGroupDragging : '',
                  isDropAbove ? styles.companyGroupDropAbove : '',
                  isDropBelow ? styles.companyGroupDropBelow : '',
                ].filter(Boolean).join(' ')}
              >
                <div
                  className={styles.companyHeader}
                  onClick={() => handleHeaderClick(group.id)}
                  onMouseDown={e => startCompanyDrag(e, index)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toggle(group.id) }}
                >
                  <div className={styles.companyHeaderLeft}>
                    <button
                      type="button"
                      className={`${styles.starBtn} ${group.starred ? styles.starBtnActive : ''}`}
                      aria-label={group.starred ? `Unstar ${group.name}` : `Star ${group.name}`}
                      aria-pressed={group.starred}
                      onClick={e => {
                        e.stopPropagation()
                        updateCompany(group.id, { starred: !group.starred })
                      }}
                      onMouseDown={e => e.stopPropagation()}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill={group.starred ? 'currentColor' : 'none'}>
                        <path
                          d="M8 1.5l1.96 4.36 4.79.45-3.6 3.2 1.05 4.69L8 11.79l-4.2 2.41 1.05-4.69-3.6-3.2 4.79-.45L8 1.5z"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <span className={styles.companyName}>{group.name}</span>
                    <button
                      type="button"
                      className={`${styles.categoryBadge} ${group.category ? '' : styles.categoryBadgeEmpty}`}
                      onClick={e => {
                        e.stopPropagation()
                        setCategoryPickerFor({ companyId: group.id, anchor: e.currentTarget })
                      }}
                      onMouseDown={e => e.stopPropagation()}
                    >
                      {group.category ?? '+ Category'}
                    </button>
                  </div>
                  <div className={styles.companyMeta}>
                    <span className={styles.contactCount}>
                      {group.contacts.length} {group.contacts.length === 1 ? 'contact' : 'contacts'}
                    </span>
                    <button
                      type="button"
                      className={styles.companyDeleteBtn}
                      aria-label={`Delete ${group.name}`}
                      onClick={e => { e.stopPropagation(); setDeleteCompanyTarget(group) }}
                    >
                      <svg width="14" height="14" viewBox="0 0 13 13" fill="none">
                        <path
                          d="M1.5 3h10M4.5 3V2a.5.5 0 01.5-.5h3a.5.5 0 01.5.5v1M3 3l.75 8h6.5L11 3"
                          stroke="currentColor"
                          strokeWidth="1.25"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <svg
                      className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                    >
                      <path
                        d="M3 5l4 4 4-4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>

                {isOpen && (
                  <div className={styles.contactsWrapper}>
                    <ContactsTable
                      contacts={visibleContacts(group.contacts)}
                      columns={columns}
                      onColumnsChange={handleColumnsChange}
                      sort={sort}
                      onSortChange={setSort}
                      filters={filters}
                      onFilterChange={handleFilterChange}
                      onUpdate={updateContact}
                      onDelete={setDeleteContactTarget}
                      onAdd={() => addContact(group.id)}
                      onSendEmail={(c) => setSendEmailFor({ contact: c, company: { name: group.name } })}
                      threadsByContactId={threadsByContactId}
                      newContactId={newContactId}
                    />
                  </div>
                )}
              </div>
            )
          })}
          </div>
        </>
      )}

      {showCompanyModal && (
        <AddCompanyModal
          defaultCategory={newCompanyDefaultCategory}
          onClose={() => setShowCompanyModal(false)}
          onAdded={handleCompanyAdded}
        />
      )}
      {categoryPickerFor && (() => {
        const company = companies.find(c => c.id === categoryPickerFor.companyId)
        if (!company) return null
        return (
          <CategoryPicker
            current={company.category}
            allCategories={allCategories}
            anchor={categoryPickerFor.anchor}
            onSelect={value => updateCompany(company.id, { category: value })}
            onClose={() => setCategoryPickerFor(null)}
          />
        )
      })()}
      {showColumnSettings && (
        <ColumnSettingsModal
          columns={columns}
          onChange={handleColumnsConfigChange}
          onClose={() => setShowColumnSettings(false)}
        />
      )}
      {deleteContactTarget && (
        <DeleteContactModal
          contact={deleteContactTarget}
          onClose={() => setDeleteContactTarget(null)}
          onConfirm={confirmDeleteContact}
        />
      )}
      {deleteCompanyTarget && (
        <DeleteCompanyModal
          company={deleteCompanyTarget}
          contactCount={companies.find(c => c.id === deleteCompanyTarget.id)?.contacts.length ?? 0}
          onClose={() => setDeleteCompanyTarget(null)}
          onConfirm={confirmDeleteCompany}
        />
      )}
      {sendEmailFor && (
        <SendEmailModal
          contact={sendEmailFor.contact}
          company={sendEmailFor.company}
          onClose={() => setSendEmailFor(null)}
          onSent={async () => {
            const { data } = await supabase.from('email_threads').select('*')
            if (data) setThreadsByContactId(buildThreadMap(data as EmailThread[]))
            // Also refresh contact rows in case status/last_contact changed.
            const refreshed = sendEmailFor.contact.id
            const { data: c } = await supabase.from('contacts').select('*').eq('id', refreshed).maybeSingle()
            if (c) {
              setCompanies(prev => prev.map(group => ({
                ...group,
                contacts: group.contacts.map(ct => ct.id === refreshed ? (c as Contact) : ct),
              })))
            }
          }}
        />
      )}
    </div>
  )
}
