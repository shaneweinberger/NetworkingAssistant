import { useEffect } from 'react'
import type { Company } from '../../types/database'
import styles from './DeleteCompanyModal.module.css'

interface Props {
  company: Company
  contactCount: number
  onClose: () => void
  onConfirm: () => void
}

export default function DeleteCompanyModal({ company, contactCount, onClose, onConfirm }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onConfirm])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 className={styles.title}>Delete company</h2>
        <p className={styles.body}>
          Are you sure you want to delete <strong>{company.name}</strong>
          {contactCount > 0 && (
            <> and <strong>{contactCount} {contactCount === 1 ? 'contact' : 'contacts'}</strong></>
          )}
          ? This cannot be undone.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.deleteButton} onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
