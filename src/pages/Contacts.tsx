import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Company, Contact, CompanyWithContacts } from '../types/database'
import AddCompanyModal from '../components/AddCompanyModal'
import DeleteContactModal from '../components/DeleteContactModal'
import DeleteCompanyModal from '../components/DeleteCompanyModal/DeleteCompanyModal'
import ColumnSettingsModal from '../components/ColumnSettingsModal/ColumnSettingsModal'
import ContactsTable, {
  DEFAULT_CONTACT_COLUMNS,
  type ContactColKey,
  type ContactColumnConfig,
} from '../components/ContactsTable/ContactsTable'
import type { SortState } from '../components/Table/Table'
import styles from './Contacts.module.css'

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

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    async function fetchData() {
      const [{ data: cData, error: cErr }, configResult] = await Promise.all([
        supabase
          .from('companies')
          .select(`id, name, website, created_at,
            contacts ( id, name, role, email, last_contact, status, location, education, linkedin, notes, created_at, company_id )`)
          .order('name'),
        supabase
          .from('contact_column_configs')
          .select('*')
          .order('position'),
      ])

      if (cErr) setError(cErr.message)
      else setCompanies(cData as CompanyWithContacts[])

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

      setLoading(false)
    }
    fetchData()
  }, [])

  const persistColumns = async (cols: ContactColumnConfig[]) => {
    const rows = cols.map((c, i) => configToRow(c, i))
    const { error } = await supabase.from('contact_column_configs').upsert(rows, { onConflict: 'column_key' })
    if (error) console.warn('Failed to save column configs:', error.message)
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

  const handleCompanyAdded = (company: Company) => {
    setCompanies(prev => [...prev, { ...company, contacts: [] }].sort((a, b) => a.name.localeCompare(b.name)))
    setShowCompanyModal(false)
  }

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
      setCompanies(prev => prev.filter(c => c.id !== deleteCompanyTarget.id))
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
        <div className={styles.companyList}>
          {companies.length === 0 && (
            <p className={styles.stateText}>No companies yet. Add one to get started.</p>
          )}

          {companies.map(group => {
            const isOpen = expanded.has(group.id)
            return (
              <div key={group.id} className={styles.companyGroup}>
                <div
                  className={styles.companyHeader}
                  onClick={() => toggle(group.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toggle(group.id) }}
                >
                  <span className={styles.companyName}>{group.name}</span>
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
                      newContactId={newContactId}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showCompanyModal && (
        <AddCompanyModal onClose={() => setShowCompanyModal(false)} onAdded={handleCompanyAdded} />
      )}
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
    </div>
  )
}
