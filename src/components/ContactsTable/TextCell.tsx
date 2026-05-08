import { useEffect, useRef, useState } from 'react'
import styles from './ContactsTable.module.css'

interface Props {
  value: string
  placeholder?: string
  autoFocus?: boolean
  bold?: boolean
  muted?: boolean
  onCommit: (v: string) => void
}

export default function TextCell({ value, placeholder, autoFocus, bold, muted, onCommit }: Props) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  const commit = () => {
    if (draft !== value) onCommit(draft)
  }

  return (
    <input
      ref={ref}
      type="text"
      className={[
        styles.cellInput,
        bold ? styles.cellInputBold : '',
        muted ? styles.cellInputMuted : '',
      ].filter(Boolean).join(' ')}
      placeholder={placeholder}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.currentTarget).blur()
        if (e.key === 'Escape') {
          setDraft(value)
          ;(e.currentTarget).blur()
        }
      }}
    />
  )
}
