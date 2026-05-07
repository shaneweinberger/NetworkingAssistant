import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Contact, ContactStatus } from '../types/database'
import styles from './AddContactModal.module.css'

interface Props {
  companyId: string
  companyName: string
  onClose: () => void
  onAdded: (contact: Contact) => void
}

export default function AddContactModal({ companyId, companyName, onClose, onAdded }: Props) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [lastContact, setLastContact] = useState('')
  const [status, setStatus] = useState<ContactStatus>('Sent')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('contacts')
      .insert({
        company_id: companyId,
        name: name.trim(),
        role: role.trim() || null,
        email: email.trim() || null,
        last_contact: lastContact || null,
        status,
      })
      .select()
      .single()

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      onAdded(data as Contact)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>Add contact</h2>
          <span className={styles.companyTag}>{companyName}</span>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="contact-name">Name</label>
            <input
              id="contact-name"
              className={styles.input}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Alice Chen"
              autoFocus
              required
            />
          </div>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="contact-role">
                Role <span className={styles.optional}>(optional)</span>
              </label>
              <input
                id="contact-role"
                className={styles.input}
                type="text"
                value={role}
                onChange={e => setRole(e.target.value)}
                placeholder="e.g. Engineering Manager"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="contact-email">
                Email <span className={styles.optional}>(optional)</span>
              </label>
              <input
                id="contact-email"
                className={styles.input}
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="e.g. alice@stripe.com"
              />
            </div>
          </div>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="contact-date">
                Last contact <span className={styles.optional}>(optional)</span>
              </label>
              <input
                id="contact-date"
                className={styles.input}
                type="date"
                value={lastContact}
                onChange={e => setLastContact(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="contact-status">Status</label>
              <select
                id="contact-status"
                className={styles.input}
                value={status}
                onChange={e => setStatus(e.target.value as ContactStatus)}
              >
                <option value="Sent">Sent</option>
                <option value="Replied">Replied</option>
                <option value="No reply">No reply</option>
              </select>
            </div>
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.cancelButton} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Adding…' : 'Add contact'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
