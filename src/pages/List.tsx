import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Company, Contact, CompanyWithContacts, ContactStatus } from '../types/database'
import AddCompanyModal from '../components/AddCompanyModal'
import AddContactModal from '../components/AddContactModal'
import styles from './List.module.css'

const statusClass: Record<ContactStatus, string> = {
  'Replied': styles.statusReplied,
  'Sent': styles.statusSent,
  'No reply': styles.statusNoReply,
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function List() {
  const [companies, setCompanies] = useState<CompanyWithContacts[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showCompanyModal, setShowCompanyModal] = useState(false)
  const [addContactForCompany, setAddContactForCompany] = useState<CompanyWithContacts | null>(null)

  const handleCompanyAdded = (company: Company) => {
    setCompanies(prev =>
      [...prev, { ...company, contacts: [] }].sort((a, b) => a.name.localeCompare(b.name))
    )
    setShowCompanyModal(false)
  }

  const handleContactAdded = (contact: Contact) => {
    setCompanies(prev =>
      prev.map(c => c.id === contact.company_id ? { ...c, contacts: [...c.contacts, contact] } : c)
    )
    setAddContactForCompany(null)
  }

  useEffect(() => {
    async function fetchData() {
      const { data, error } = await supabase
        .from('companies')
        .select(`
          id, name, website, created_at,
          contacts ( id, name, role, email, last_contact, status, notes, created_at, company_id )
        `)
        .order('name')

      if (error) {
        setError(error.message)
      } else {
        setCompanies(data as CompanyWithContacts[])
      }
      setLoading(false)
    }

    fetchData()
  }, [])

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>List</h1>
          <p className={styles.subtitle}>Manage your contacts and connections.</p>
        </div>
        <button className={styles.addButton} type="button" onClick={() => setShowCompanyModal(true)}>
          Add entry
        </button>
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
                <button
                  className={styles.companyHeader}
                  onClick={() => toggle(group.id)}
                  type="button"
                >
                  <span className={styles.companyName}>{group.name}</span>
                  <div className={styles.companyMeta}>
                    <span className={styles.contactCount}>
                      {group.contacts.length} {group.contacts.length === 1 ? 'contact' : 'contacts'}
                    </span>
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
                </button>

                {isOpen && (
                  <div className={styles.contactsWrapper}>
                    {group.contacts.length > 0 && (
                      <table className={styles.contactsTable}>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Role</th>
                            <th>Company</th>
                            <th>Last contact</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.contacts.map(contact => (
                            <tr key={contact.id}>
                              <td className={styles.contactName}>{contact.name}</td>
                              <td className={styles.contactMuted}>{contact.role ?? '—'}</td>
                              <td className={styles.contactMuted}>{group.name}</td>
                              <td className={styles.contactMuted}>{formatDate(contact.last_contact)}</td>
                              <td>
                                <span className={`${styles.statusBadge} ${statusClass[contact.status]}`}>
                                  {contact.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div className={styles.contactsFooter}>
                      <button
                        type="button"
                        className={styles.addContactButton}
                        onClick={() => setAddContactForCompany(group)}
                      >
                        + Add contact
                      </button>
                    </div>
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
      {addContactForCompany && (
        <AddContactModal
          companyId={addContactForCompany.id}
          companyName={addContactForCompany.name}
          onClose={() => setAddContactForCompany(null)}
          onAdded={handleContactAdded}
        />
      )}
    </div>
  )
}
