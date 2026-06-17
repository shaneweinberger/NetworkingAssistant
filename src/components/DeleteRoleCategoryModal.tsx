import { useEffect } from 'react'
import styles from './DeleteRoleCategoryModal.module.css'

interface Props {
  name: string
  contactCount: number
  onClose: () => void
  onConfirm: () => void
}

export default function DeleteRoleCategoryModal({ name, contactCount, onClose, onConfirm }: Props) {
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
        <h2 className={styles.title}>Delete role category</h2>
        <p className={styles.body}>
          Are you sure you want to delete <strong>{name}</strong>?
          {contactCount > 0 && (
            <> {contactCount} {contactCount === 1 ? 'contact' : 'contacts'} will become Unassigned.</>
          )}{' '}
          This cannot be undone.
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
