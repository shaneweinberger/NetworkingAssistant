import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Company, Contact, IveyAlumnus } from '../types/database'
import styles from './IveyAlumni.module.css'

type SortKey =
  | 'full_name'
  | 'connection_degree'
  | 'headline'
  | 'location'
  | 'company'
  | 'industry'
  | 'job_title'
  | 'job_date_range'

type SortState = { key: SortKey; dir: 'asc' | 'desc' } | null

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'full_name', label: 'Name' },
  { key: 'connection_degree', label: 'Degree' },
  { key: 'headline', label: 'Headline' },
  { key: 'company', label: 'Company' },
  { key: 'job_title', label: 'Title' },
  { key: 'industry', label: 'Industry' },
  { key: 'location', label: 'Location' },
  { key: 'job_date_range', label: 'Tenure' },
]

function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase()
}

const PAGE_SIZES = [25, 50, 100]
const ALL = '__all__'

function csvEscape(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function buildCsv(rows: IveyAlumnus[]): string {
  const headers = [
    'linkedin_url',
    'full_name',
    'connection_degree',
    'headline',
    'location',
    'company',
    'industry',
    'job_title',
    'job_date_range',
  ] as const
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push(headers.map(h => csvEscape(String(r[h] ?? ''))).join(','))
  }
  return lines.join('\n')
}

function downloadCsv(rows: IveyAlumnus[]) {
  const csv = buildCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  link.href = url
  link.download = `ivey-alumni-${date}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function degreeClass(degree: string | null): string {
  if (degree === '1st') return `${styles.degreeBadge} ${styles.degree1}`
  if (degree === '2nd') return `${styles.degreeBadge} ${styles.degree2}`
  if (degree === '3rd') return `${styles.degreeBadge} ${styles.degree3}`
  return styles.degreeBadge
}

// Sort 1st < 2nd < 3rd numerically rather than lexicographically.
function degreeRank(degree: string | null): number {
  if (!degree) return 99
  const n = parseInt(degree, 10)
  return Number.isNaN(n) ? 99 : n
}

export default function IveyAlumni() {
  const [rows, setRows] = useState<IveyAlumnus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [industryFilter, setIndustryFilter] = useState<string>(ALL)
  const [degreeFilter, setDegreeFilter] = useState<string>(ALL)
  const [sort, setSort] = useState<SortState>({ key: 'full_name', dir: 'asc' })
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(0)

  // linkedin_urls of alumni that already exist as contacts (used to render
  // the star filled and prevent duplicate adds).
  const [addedLinkedinUrls, setAddedLinkedinUrls] = useState<Set<string>>(new Set())
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<IveyAlumnus | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchAll() {
      const [alumniRes, contactsRes] = await Promise.all([
        supabase.from('ivey_alumni').select('*').order('full_name'),
        supabase.from('contacts').select('linkedin').not('linkedin', 'is', null),
      ])
      if (alumniRes.error) setError(alumniRes.error.message)
      else setRows((alumniRes.data as IveyAlumnus[]) ?? [])

      if (!contactsRes.error && contactsRes.data) {
        const urls = new Set<string>()
        for (const c of contactsRes.data as { linkedin: string | null }[]) {
          if (c.linkedin) urls.add(c.linkedin)
        }
        setAddedLinkedinUrls(urls)
      }
      setLoading(false)
    }
    fetchAll()
  }, [])

  const addToContacts = async (alumnus: IveyAlumnus) => {
    if (!alumnus.company || !alumnus.company.trim()) return
    if (addedLinkedinUrls.has(alumnus.linkedin_url)) return
    setAddingId(alumnus.id)
    setAddError(null)

    // Find an existing company by case-insensitive name. We pull just the
    // candidates rather than fetching every company, then dedupe locally to
    // handle whitespace/case differences (`Stripe ` vs `stripe`).
    const target = normalizeCompanyName(alumnus.company)
    const { data: candidates, error: companyFetchErr } = await supabase
      .from('companies')
      .select('id, name')
      .ilike('name', alumnus.company.trim())

    if (companyFetchErr) {
      setAddError(`Could not check companies: ${companyFetchErr.message}`)
      setAddingId(null)
      return
    }

    let companyId: string | null = null
    const match = (candidates as Pick<Company, 'id' | 'name'>[] | null)?.find(
      c => normalizeCompanyName(c.name) === target,
    )
    if (match) {
      companyId = match.id
    } else {
      const { data: newCompany, error: insertCompanyErr } = await supabase
        .from('companies')
        .insert({ name: alumnus.company.trim(), website: null, category: null })
        .select('id')
        .single()
      if (insertCompanyErr || !newCompany) {
        setAddError(`Could not create company: ${insertCompanyErr?.message ?? 'unknown'}`)
        setAddingId(null)
        return
      }
      companyId = newCompany.id
    }

    const { error: insertContactErr } = await supabase.from('contacts').insert({
      company_id: companyId!,
      name: alumnus.full_name,
      role: alumnus.job_title,
      email: null,
      status: 'Sent',
      location: alumnus.location,
      education: 'Ivey',
      linkedin: alumnus.linkedin_url,
      last_contact: null,
    } satisfies Omit<Contact, 'id' | 'created_at' | 'notes'> & { notes?: string | null })

    if (insertContactErr) {
      setAddError(`Could not add contact: ${insertContactErr.message}`)
      setAddingId(null)
      return
    }

    setAddedLinkedinUrls(prev => {
      const next = new Set(prev)
      next.add(alumnus.linkedin_url)
      return next
    })
    setAddingId(null)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    const { error } = await supabase.from('ivey_alumni').delete().eq('id', deleteTarget.id)
    if (error) {
      setDeleteError(error.message)
      setDeleting(false)
      return
    }
    setRows(prev => prev.filter(r => r.id !== deleteTarget.id))
    setDeleteTarget(null)
    setDeleting(false)
  }

  const industries = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) {
      if (r.industry && r.industry.trim()) set.add(r.industry)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [rows])

  const degrees = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) {
      if (r.connection_degree && r.connection_degree.trim()) set.add(r.connection_degree)
    }
    return Array.from(set).sort((a, b) => degreeRank(a) - degreeRank(b))
  }, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(r => {
      if (industryFilter !== ALL && (r.industry ?? '') !== industryFilter) return false
      if (degreeFilter !== ALL && (r.connection_degree ?? '') !== degreeFilter) return false
      if (!q) return true
      return (
        r.full_name.toLowerCase().includes(q) ||
        (r.company ?? '').toLowerCase().includes(q) ||
        (r.headline ?? '').toLowerCase().includes(q) ||
        (r.location ?? '').toLowerCase().includes(q)
      )
    })
  }, [rows, query, industryFilter, degreeFilter])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const { key, dir } = sort
    const mult = dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (key === 'connection_degree') {
        return (degreeRank(a.connection_degree) - degreeRank(b.connection_degree)) * mult
      }
      const av = (a[key] ?? '').toString().toLowerCase()
      const bv = (b[key] ?? '').toString().toLowerCase()
      return av.localeCompare(bv) * mult
    })
  }, [filtered, sort])

  // Reset to first page whenever filters / sort / page size shrink the result set.
  useEffect(() => {
    setPage(0)
  }, [query, industryFilter, degreeFilter, pageSize])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, totalPages - 1)
  const start = currentPage * pageSize
  const visible = sorted.slice(start, start + pageSize)

  const toggleSort = (key: SortKey) => {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return null
    })
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Ivey Alumni</h1>
          <p className={styles.subtitle}>SF Bay Area alumni — search, filter, and export.</p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.exportButton}
            onClick={() => downloadCsv(sorted)}
            disabled={sorted.length === 0}
          >
            Export CSV
          </button>
        </div>
      </header>

      {loading && <p className={styles.stateText}>Loading…</p>}
      {error && (
        <p className={styles.stateText}>
          Error: {error} — did you run <code>migrations/2026-05-28_create_ivey_alumni.sql</code>?
        </p>
      )}

      {!loading && !error && (
        <>
          <div className={styles.toolbar}>
            <input
              type="search"
              className={styles.search}
              placeholder="Search name, company, headline, location…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            <select
              className={styles.select}
              value={industryFilter}
              onChange={e => setIndustryFilter(e.target.value)}
            >
              <option value={ALL}>All industries</option>
              {industries.map(i => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              value={degreeFilter}
              onChange={e => setDegreeFilter(e.target.value)}
            >
              <option value={ALL}>All degrees</option>
              {degrees.map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <div className={styles.spacer} />
            <span className={styles.count}>
              {sorted.length} {sorted.length === 1 ? 'result' : 'results'}
            </span>
          </div>

          {addError && <p className={styles.stateText}>{addError}</p>}

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th} aria-label="Add to contacts" />
                  {COLUMNS.map(col => {
                    const isSorted = sort?.key === col.key
                    return (
                      <th
                        key={col.key}
                        className={`${styles.th} ${styles.thSortable}`}
                        onClick={() => toggleSort(col.key)}
                      >
                        <span className={styles.thInner}>
                          {col.label}
                          {isSorted && (
                            <span className={styles.sortIcon} aria-hidden>
                              {sort?.dir === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </span>
                      </th>
                    )
                  })}
                  <th className={styles.th} aria-label="Delete" />
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length + 2} className={styles.emptyRow}>
                      No matching alumni.
                    </td>
                  </tr>
                )}
                {visible.map(r => {
                  const isAdded = addedLinkedinUrls.has(r.linkedin_url)
                  const isAdding = addingId === r.id
                  const canAdd = !!(r.company && r.company.trim()) && !isAdded && !isAdding
                  return (
                  <tr key={r.id} className={styles.row}>
                    <td className={`${styles.td} ${styles.starCell}`}>
                      <button
                        type="button"
                        className={`${styles.starBtn} ${isAdded ? styles.starBtnActive : ''}`}
                        onClick={() => canAdd && addToContacts(r)}
                        disabled={!canAdd && !isAdded}
                        aria-label={
                          isAdded
                            ? `${r.full_name} already in contacts`
                            : !r.company
                              ? 'No company set'
                              : `Add ${r.full_name} to contacts`
                        }
                        title={
                          isAdded
                            ? 'Already in contacts'
                            : !r.company
                              ? 'No company set'
                              : `Add to ${r.company}`
                        }
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill={isAdded ? 'currentColor' : 'none'}>
                          <path
                            d="M8 1.5l1.96 4.36 4.79.45-3.6 3.2 1.05 4.69L8 11.79l-4.2 2.41 1.05-4.69-3.6-3.2 4.79-.45L8 1.5z"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </td>
                    <td className={styles.td}>
                      <a
                        href={r.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.nameLink}
                      >
                        {r.full_name}
                      </a>
                    </td>
                    <td className={styles.td}>
                      {r.connection_degree ? (
                        <span className={degreeClass(r.connection_degree)}>
                          {r.connection_degree}
                        </span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={styles.td} title={r.headline ?? ''}>
                      {r.headline || <span className={styles.muted}>—</span>}
                    </td>
                    <td className={styles.td}>{r.company || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.td} title={r.job_title ?? ''}>
                      {r.job_title || <span className={styles.muted}>—</span>}
                    </td>
                    <td className={styles.td}>{r.industry || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.td}>{r.location || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.td}>
                      {r.job_date_range || <span className={styles.muted}>—</span>}
                    </td>
                    <td className={`${styles.td} ${styles.starCell}`}>
                      <button
                        type="button"
                        className={styles.deleteBtn}
                        onClick={() => setDeleteTarget(r)}
                        aria-label={`Delete ${r.full_name}`}
                        title="Delete from database"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M2 3.5h10M5.5 3.5V2.5h3v1M5.5 6v4.5M8.5 6v4.5M3 3.5l.75 8h6.5l.75-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.footer}>
            <div className={styles.footerLeft}>
              <span>Rows per page</span>
              <select
                className={styles.select}
                value={pageSize}
                onChange={e => setPageSize(Number(e.target.value))}
              >
                {PAGE_SIZES.map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.footerRight}>
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={currentPage === 0}
              >
                Prev
              </button>
              <span className={styles.pageInfo}>
                Page {currentPage + 1} of {totalPages}
              </span>
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {deleteTarget && (
        <div className={styles.modalOverlay} onClick={() => { if (!deleting) setDeleteTarget(null) }}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <p className={styles.modalTitle}>Delete alumnus?</p>
            <p className={styles.modalBody}>
              <strong>{deleteTarget.full_name}</strong> will be permanently removed from the database.
            </p>
            {deleteError && <p className={styles.modalError}>{deleteError}</p>}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.deleteConfirmButton}
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
