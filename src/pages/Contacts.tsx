import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Company, Contact, CompanyWithContacts, EmailThread } from '../types/database'
import AddCompanyModal from '../components/AddCompanyModal'
import AddRoleCategoryModal from '../components/AddRoleCategoryModal'
import DeleteContactModal from '../components/DeleteContactModal'
import DeleteCompanyModal from '../components/DeleteCompanyModal/DeleteCompanyModal'
import DeleteRoleCategoryModal from '../components/DeleteRoleCategoryModal'
import ColumnSettingsModal from '../components/ColumnSettingsModal/ColumnSettingsModal'
import { COLOR_NAMES, type ColorName } from '../lib/colors'
import CategoryTabs, { type CategoryFilter } from '../components/CategoryTabs/CategoryTabs'
import CategoryPicker from '../components/CategoryPicker/CategoryPicker'
import ContactsTable, {
  DEFAULT_CONTACT_COLUMNS,
  type ContactColKey,
  type ContactColumnConfig,
} from '../components/ContactsTable/ContactsTable'
import SendEmailModal from '../components/SendEmailModal/SendEmailModal'
import type { SortState } from '../components/Table/Table'
import { syncGmail, rescanContact } from '../lib/gmail/sync'
import styles from './Contacts.module.css'

const GMAIL_SYNC_INTERVAL_MS = 60_000

const COMPANY_ORDER_STORAGE_KEY = 'contacts:company-order'
const CATEGORY_FILTER_STORAGE_KEY = 'contacts:category-filter'
const VIEW_MODE_STORAGE_KEY = 'contacts:view-mode'

type ViewMode = 'company' | 'role'

function loadViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'role' ? 'role' : 'company'
  } catch {
    return 'company'
  }
}

function saveViewMode(mode: ViewMode) {
  try {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
  } catch {
    // ignore
  }
}

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

/**
 * The By Role view shows contacts across companies, so it swaps in a
 * synthetic "Company" column right after Name and hides Role Bucket (the
 * group itself already says which bucket you're looking at). This is a
 * display-only transform — it never gets persisted back to column configs.
 */
function buildRoleViewColumns(cols: ContactColumnConfig[]): ContactColumnConfig[] {
  const withoutBucket = cols.filter(c => c.key !== 'role_category')
  const nameIdx = withoutBucket.findIndex(c => c.key === 'name')
  const companyCol: ContactColumnConfig = {
    key: 'company', label: 'Company', width: 140, sortable: true, filterable: true, type: 'text', options: [], visible: true,
  }
  const next = [...withoutBucket]
  next.splice(nameIdx + 1, 0, companyCol)
  return next
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

  // Column layout for the By Role table only — derived from `columns` but
  // never persisted, so resizing/reordering here doesn't touch the saved
  // (By Company) column config. Resynced (during render, not an effect —
  // see https://react.dev/learn/you-might-not-need-an-effect) whenever the
  // saved columns change.
  const [roleViewColumns, setRoleViewColumns] = useState<ContactColumnConfig[]>(() => buildRoleViewColumns(DEFAULT_CONTACT_COLUMNS))
  const [roleViewColumnsSource, setRoleViewColumnsSource] = useState(columns)
  if (columns !== roleViewColumnsSource) {
    setRoleViewColumnsSource(columns)
    setRoleViewColumns(buildRoleViewColumns(columns))
  }

  const [deleteContactTarget, setDeleteContactTarget] = useState<Contact | null>(null)
  const [deleteCompanyTarget, setDeleteCompanyTarget] = useState<Company | null>(null)
  const [newContactId, setNewContactId] = useState<string | null>(null)

  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode)
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set())
  const [showAddRoleModal, setShowAddRoleModal] = useState(false)
  const [deleteRoleTarget, setDeleteRoleTarget] = useState<string | null>(null)

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(loadCategoryFilter)
  const [categoryPickerFor, setCategoryPickerFor] = useState<
    { companyId: string; anchor: HTMLElement } | null
  >(null)

  const [searchQuery, setSearchQuery] = useState('')

  const [threadsByContactId, setThreadsByContactId] = useState<Record<string, EmailThread>>({})
  const [sendEmailFor, setSendEmailFor] = useState<{
    contact: Contact
    company: { name: string }
    replyToThread?: { threadId: string; gmailThreadId: string; subject: string | null } | null
  } | null>(null)

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
            contacts ( id, name, role, role_category, email, last_contact, status, location, education, linkedin, notes, created_at, company_id )`)
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

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode)
    saveViewMode(mode)
  }

  const toggleRole = (name: string) => setExpandedRoles(prev => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  const UNASSIGNED_ROLE_BUCKET = 'Unassigned'

  type RoleGroup = {
    name: string
    contacts: Contact[]
  }

  const companyNameByContactId = useMemo(() => {
    const map: Record<string, string> = {}
    for (const company of companies) {
      for (const contact of company.contacts) map[contact.id] = company.name
    }
    return map
  }, [companies])

  const trimmedSearch = searchQuery.trim().toLowerCase()

  // A company "matches" the search if its own name does, or if any of its
  // contacts' names do — so searching a person's name surfaces the company
  // they're filed under, even in the By Company view.
  const companyMatchesSearch = (company: CompanyWithContacts): boolean => {
    if (!trimmedSearch) return true
    if (company.name.toLowerCase().includes(trimmedSearch)) return true
    return company.contacts.some(c => c.name.toLowerCase().includes(trimmedSearch))
  }

  // When a company matched by its own name, show all of its contacts;
  // when it only matched via a contact's name, narrow down to just those.
  const contactsForSearch = (company: CompanyWithContacts): Contact[] => {
    if (!trimmedSearch || company.name.toLowerCase().includes(trimmedSearch)) return company.contacts
    return company.contacts.filter(c => c.name.toLowerCase().includes(trimmedSearch))
  }

  const roleGroups = useMemo<RoleGroup[]>(() => {
    // Pinned buckets come from the "Role Bucket" column's dropdown options
    // (edit them in Column Settings) so they always show up here, even
    // before any contact has been assigned to them.
    const pinnedBuckets = columns.find(c => c.key === 'role_category')?.options.map(o => o.value) ?? []
    const byBucket = new Map<string, Contact[]>()
    for (const name of pinnedBuckets) byBucket.set(name, [])
    for (const company of companies) {
      for (const contact of company.contacts) {
        const bucket = contact.role_category?.trim() || UNASSIGNED_ROLE_BUCKET
        if (!byBucket.has(bucket)) byBucket.set(bucket, [])
        byBucket.get(bucket)!.push(contact)
      }
    }
    const pinnedOrder = new Map(pinnedBuckets.map((name, i) => [name, i]))
    return Array.from(byBucket.entries())
      .map(([name, contacts]) => ({ name, contacts }))
      .sort((a, b) => {
        if (a.name === UNASSIGNED_ROLE_BUCKET) return 1
        if (b.name === UNASSIGNED_ROLE_BUCKET) return -1
        const ai = pinnedOrder.get(a.name) ?? Infinity
        const bi = pinnedOrder.get(b.name) ?? Infinity
        if (ai !== bi) return ai - bi
        return a.name.localeCompare(b.name)
      })
  }, [companies, columns])

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
    let result = companies
    if (categoryFilter.type === 'starred') result = result.filter(c => c.starred)
    else if (categoryFilter.type === 'category') result = result.filter(c => c.category === categoryFilter.name)
    if (trimmedSearch) result = result.filter(companyMatchesSearch)
    return result
  }, [companies, categoryFilter, trimmedSearch])

  // Search-filtered role groups: a contact stays in its group only if its
  // name matches, and a group with no matches drops out entirely.
  const filteredRoleGroups = useMemo<RoleGroup[]>(() => {
    if (!trimmedSearch) return roleGroups
    return roleGroups
      .map(g => ({ name: g.name, contacts: g.contacts.filter(c => c.name.toLowerCase().includes(trimmedSearch)) }))
      .filter(g => g.contacts.length > 0)
  }, [roleGroups, trimmedSearch])

  const newCompanyDefaultCategory =
    categoryFilter.type === 'category' ? categoryFilter.name : null

  const updateContact = async (id: string, field: keyof Contact, value: string | null) => {
    setCompanies(prev => prev.map(c => ({
      ...c,
      contacts: c.contacts.map(ct => ct.id === id ? { ...ct, [field]: value } : ct),
    })))
    if (newContactId === id) setNewContactId(null)
    await supabase.from('contacts').update({ [field]: value }).eq('id', id)
    // If the email field changed (and is non-empty), rescan Gmail for any
    // pre-existing outreach to this address so it appears on the Threads
    // Board. Best-effort, runs in the background.
    if (field === 'email' && value) {
      const refreshed = await supabase.from('contacts').select('*').eq('id', id).maybeSingle()
      const contact = refreshed.data as Contact | null
      if (contact) {
        const added = await rescanContact(contact)
        if (added > 0) {
          const { data: threadData } = await supabase.from('email_threads').select('*')
          if (threadData) setThreadsByContactId(buildThreadMap(threadData as EmailThread[]))
        }
      }
    }
  }

  const addContact = async (companyId: string, defaultRoleCategory: string | null = null) => {
    const { data, error } = await supabase.from('contacts').insert({
      company_id: companyId,
      name: '',
      role: null,
      role_category: defaultRoleCategory,
      email: null,
      status: null,
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

  // Role categories aren't a separate table — they're just the dropdown
  // options on the "role_category" column config, so adding/removing one is
  // an options-array edit (same mechanism as the Columns settings modal).
  const addRoleCategory = (name: string) => {
    const roleCategoryCol = columns.find(c => c.key === 'role_category')
    if (!roleCategoryCol) return
    const usedColors = roleCategoryCol.options.map(o => o.color)
    const nextColor = (COLOR_NAMES.find(c => !usedColors.includes(c)) ?? 'gray') as ColorName
    const nextOptions = [...roleCategoryCol.options, { value: name, color: nextColor }]
    handleColumnsConfigChange(columns.map(c => (c.key === 'role_category' ? { ...c, options: nextOptions } : c)))
    setShowAddRoleModal(false)
  }

  const confirmDeleteRoleCategory = async () => {
    if (!deleteRoleTarget) return
    const name = deleteRoleTarget
    setCompanies(prev => prev.map(c => ({
      ...c,
      contacts: c.contacts.map(ct => (ct.role_category === name ? { ...ct, role_category: null } : ct)),
    })))
    const roleCategoryCol = columns.find(c => c.key === 'role_category')
    if (roleCategoryCol) {
      const nextOptions = roleCategoryCol.options.filter(o => o.value !== name)
      handleColumnsConfigChange(columns.map(c => (c.key === 'role_category' ? { ...c, options: nextOptions } : c)))
    }
    setDeleteRoleTarget(null)
    await supabase.from('contacts').update({ role_category: null }).eq('role_category', name)
  }

  const handleFilterChange = (key: ContactColKey, value: string) => {
    setFilters(prev => {
      const next = { ...prev }
      if (value) next[key] = value
      else delete next[key]
      return next
    })
  }

  // "company" isn't a real Contact field — it's synthetic, injected only by
  // the By Role view's column set, so filter/sort read it from the
  // company-name lookup instead of the contact object.
  const fieldValue = (contact: Contact, key: ContactColKey): string => {
    if (key === 'company') return companyNameByContactId[contact.id] ?? ''
    return String((contact as unknown as Record<string, unknown>)[key] ?? '')
  }

  const visibleContacts = (contacts: Contact[]) => {
    let result = contacts
    for (const k of Object.keys(filters) as ContactColKey[]) {
      const v = filters[k]?.toLowerCase()
      if (!v) continue
      result = result.filter(c => fieldValue(c, k).toLowerCase().includes(v))
    }
    if (sort) {
      result = [...result].sort((a, b) => {
        const av = fieldValue(a, sort.key).toLowerCase()
        const bv = fieldValue(b, sort.key).toLowerCase()
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
          <input
            type="search"
            className={styles.searchInput}
            placeholder={viewMode === 'company' ? 'Search companies or contacts…' : 'Search contacts…'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <div className={styles.viewToggle} role="tablist" aria-label="Group contacts by">
            <button
              type="button"
              className={`${styles.viewToggleBtn} ${viewMode === 'company' ? styles.viewToggleBtnActive : ''}`}
              aria-pressed={viewMode === 'company'}
              onClick={() => changeViewMode('company')}
            >
              By Company
            </button>
            <button
              type="button"
              className={`${styles.viewToggleBtn} ${viewMode === 'role' ? styles.viewToggleBtnActive : ''}`}
              aria-pressed={viewMode === 'role'}
              onClick={() => changeViewMode('role')}
            >
              By Role
            </button>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => setShowColumnSettings(true)}
          >
            Columns
          </button>
          {viewMode === 'company' ? (
            <button className={styles.addButton} type="button" onClick={() => setShowCompanyModal(true)}>
              Add Company
            </button>
          ) : (
            <button className={styles.addButton} type="button" onClick={() => setShowAddRoleModal(true)}>
              Add Role
            </button>
          )}
        </div>
      </header>

      {loading && <p className={styles.stateText}>Loading…</p>}
      {error && <p className={styles.stateText}>Error: {error}</p>}

      {!loading && !error && viewMode === 'role' && (
        <div className={styles.companyList}>
          {roleGroups.length === 0 && (
            <p className={styles.stateText}>No contacts yet. Add a company and some contacts to get started.</p>
          )}
          {roleGroups.length > 0 && filteredRoleGroups.length === 0 && (
            <p className={styles.stateText}>No contacts match “{searchQuery}”.</p>
          )}
          {filteredRoleGroups.map(group => {
            const isOpen = trimmedSearch ? true : expandedRoles.has(group.name)
            return (
              <div key={group.name} className={styles.companyGroup}>
                <div
                  className={styles.companyHeader}
                  onClick={() => toggleRole(group.name)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toggleRole(group.name) }}
                >
                  <div className={styles.companyHeaderLeft}>
                    <span className={styles.companyName}>{group.name}</span>
                  </div>
                  <div className={styles.companyMeta}>
                    <span className={styles.contactCount}>
                      {group.contacts.length} {group.contacts.length === 1 ? 'contact' : 'contacts'}
                    </span>
                    {group.name !== UNASSIGNED_ROLE_BUCKET && (
                      <button
                        type="button"
                        className={styles.companyDeleteBtn}
                        aria-label={`Delete ${group.name}`}
                        onClick={e => { e.stopPropagation(); setDeleteRoleTarget(group.name) }}
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
                    )}
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
                    {group.contacts.length === 0 ? (
                      <p className={`${styles.stateText} ${styles.roleEmptyState}`}>
                        No contacts in “{group.name}” yet. Set a contact’s Role Bucket to move it here.
                      </p>
                    ) : (
                      <ContactsTable
                        contacts={visibleContacts(group.contacts)}
                        columns={roleViewColumns}
                        onColumnsChange={setRoleViewColumns}
                        sort={sort}
                        onSortChange={setSort}
                        filters={filters}
                        onFilterChange={handleFilterChange}
                        onUpdate={updateContact}
                        onDelete={setDeleteContactTarget}
                        onSendEmail={(ct) => {
                          const thread = threadsByContactId[ct.id]
                          setSendEmailFor({
                            contact: ct,
                            company: { name: companyNameByContactId[ct.id] ?? '' },
                            replyToThread: thread
                              ? { threadId: thread.id, gmailThreadId: thread.gmail_thread_id, subject: thread.subject }
                              : null,
                          })
                        }}
                        threadsByContactId={threadsByContactId}
                        newContactId={newContactId}
                        companyByContactId={companyNameByContactId}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!loading && !error && viewMode === 'company' && (
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
                {trimmedSearch
                  ? `No companies or contacts match “${searchQuery}”.`
                  : categoryFilter.type === 'starred'
                    ? 'No starred companies yet. Star a company to see it here.'
                    : categoryFilter.type === 'category'
                      ? `No companies in “${categoryFilter.name}” yet.`
                      : 'No companies match.'}
              </p>
            )}

            {filteredCompanies.map(group => {
              const index = companies.findIndex(c => c.id === group.id)
            const isOpen = trimmedSearch ? true : expanded.has(group.id)
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
                      contacts={visibleContacts(contactsForSearch(group))}
                      columns={columns}
                      onColumnsChange={handleColumnsChange}
                      sort={sort}
                      onSortChange={setSort}
                      filters={filters}
                      onFilterChange={handleFilterChange}
                      onUpdate={updateContact}
                      onDelete={setDeleteContactTarget}
                      onAdd={() => addContact(group.id)}
                      onSendEmail={(c) => {
                        const thread = threadsByContactId[c.id]
                        setSendEmailFor({
                          contact: c,
                          company: { name: group.name },
                          replyToThread: thread
                            ? { threadId: thread.id, gmailThreadId: thread.gmail_thread_id, subject: thread.subject }
                            : null,
                        })
                      }}
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
      {showAddRoleModal && (
        <AddRoleCategoryModal
          existingNames={roleGroups.map(g => g.name).filter(n => n !== UNASSIGNED_ROLE_BUCKET)}
          onClose={() => setShowAddRoleModal(false)}
          onAdd={addRoleCategory}
        />
      )}
      {deleteRoleTarget && (
        <DeleteRoleCategoryModal
          name={deleteRoleTarget}
          contactCount={roleGroups.find(g => g.name === deleteRoleTarget)?.contacts.length ?? 0}
          onClose={() => setDeleteRoleTarget(null)}
          onConfirm={confirmDeleteRoleCategory}
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
          replyToThread={sendEmailFor.replyToThread}
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
          onThreadClosed={async () => {
            setSendEmailFor(null)
            const { data } = await supabase.from('email_threads').select('*')
            if (data) setThreadsByContactId(buildThreadMap(data as EmailThread[]))
          }}
        />
      )}
    </div>
  )
}
