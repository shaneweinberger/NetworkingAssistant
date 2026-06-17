import { useEffect, useState } from 'react'
import styles from './AddRoleCategoryModal.module.css'

interface Props {
  existingNames: string[]
  onClose: () => void
  onAdd: (name: string) => void
}

export default function AddRoleCategoryModal({ existingNames, onClose, onAdd }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    if (existingNames.some(n => n.toLowerCase() === trimmed.toLowerCase())) {
      setError('A role category with this name already exists.')
      return
    }
    onAdd(trimmed)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 className={styles.title}>Add role category</h2>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="role-category-name">
              Category name
            </label>
            <input
              id="role-category-name"
              className={styles.input}
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setError(null) }}
              placeholder="e.g. Recruiter"
              autoFocus
              required
            />
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.cancelButton} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.submitButton}>
              Add category
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
