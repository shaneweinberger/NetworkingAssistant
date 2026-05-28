import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './CategoryPicker.module.css'

interface Props {
  current: string | null
  allCategories: string[]
  anchor: HTMLElement
  onSelect: (category: string | null) => void
  onClose: () => void
}

export default function CategoryPicker({
  current,
  allCategories,
  anchor,
  onSelect,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const rect = anchor.getBoundingClientRect()
  const style = {
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
  }

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const trimmed = query.trim()
  const filtered = useMemo(
    () =>
      allCategories.filter(c =>
        trimmed ? c.toLowerCase().includes(trimmed.toLowerCase()) : true,
      ),
    [allCategories, trimmed],
  )
  const exactMatch = filtered.some(c => c.toLowerCase() === trimmed.toLowerCase())
  const canCreate = trimmed.length > 0 && !exactMatch

  const commit = (value: string | null) => {
    onSelect(value)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (canCreate) commit(trimmed)
      else if (filtered.length === 1) commit(filtered[0])
    }
  }

  return (
    <div className={styles.popover} style={style} ref={ref} role="dialog">
      <input
        className={styles.input}
        type="text"
        placeholder="Find or create category…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      <div className={styles.list}>
        {filtered.map(cat => (
          <button
            key={cat}
            type="button"
            className={`${styles.item} ${cat === current ? styles.itemActive : ''}`}
            onClick={() => commit(cat)}
          >
            <span>{cat}</span>
            {cat === current && <CheckIcon />}
          </button>
        ))}
        {filtered.length === 0 && !canCreate && (
          <p className={styles.empty}>No categories yet</p>
        )}
        {canCreate && (
          <button
            type="button"
            className={`${styles.item} ${styles.itemCreate}`}
            onClick={() => commit(trimmed)}
          >
            Create &ldquo;{trimmed}&rdquo;
          </button>
        )}
        {current && (
          <button
            type="button"
            className={`${styles.item} ${styles.itemClear}`}
            onClick={() => commit(null)}
          >
            Clear category
          </button>
        )}
      </div>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M2.5 6.5L5 9l4.5-6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
