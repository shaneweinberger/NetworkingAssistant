import { useEffect } from 'react'
import type { Contact } from '../types/database'
import styles from './DeleteContactModal.module.css'

interface Props {
  contact: Contact
  onClose: () => void
  onConfirm: () => void
}

export default function DeleteContactModal({ contact, onClose, onConfirm }: Props) {
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
        <h2 className={styles.title}>Delete contact</h2>
        <p className={styles.body}>
          Are you sure you want to delete <strong>{contact.name}</strong>? This cannot be undone.
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
