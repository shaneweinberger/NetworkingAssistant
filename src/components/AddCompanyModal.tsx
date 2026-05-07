import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Company } from '../types/database'
import styles from './AddCompanyModal.module.css'

interface Props {
  onClose: () => void
  onAdded: (company: Company) => void
}

export default function AddCompanyModal({ onClose, onAdded }: Props) {
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
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
      .from('companies')
      .insert({ name: name.trim(), website: website.trim() || null })
      .select()
      .single()

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      onAdded(data as Company)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 className={styles.title}>Add company</h2>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="company-name">
              Company name
            </label>
            <input
              id="company-name"
              className={styles.input}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Stripe"
              autoFocus
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="company-website">
              Website <span className={styles.optional}>(optional)</span>
            </label>
            <input
              id="company-website"
              className={styles.input}
              type="text"
              value={website}
              onChange={e => setWebsite(e.target.value)}
              placeholder="e.g. https://stripe.com"
            />
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.cancelButton} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Adding…' : 'Add company'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
