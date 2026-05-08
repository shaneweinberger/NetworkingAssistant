import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DropdownOption } from '../../lib/colors'
import { colorStyleFor } from '../../lib/colors'
import styles from './ContactsTable.module.css'

interface Props {
  value: string
  options: DropdownOption[]
  onChange: (v: string) => void
}

export default function DropdownCell({ value, options, onChange }: Props) {
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const matched = options.find(o => o.value === value)

  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setMenuPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
  }
  const close = () => setMenuPos(null)

  useEffect(() => {
    if (!menuPos) return
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (buttonRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      close()
    }
    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menuPos])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.statusButton}
        onClick={open}
      >
        {value ? (
          <span className={styles.statusBadge} style={colorStyleFor(matched?.color)}>
            {value}
          </span>
        ) : (
          <span className={styles.statusEmpty}>—</span>
        )}
      </button>
      {menuPos && createPortal(
        <div
          ref={menuRef}
          className={styles.statusMenu}
          style={{ top: menuPos.top, left: menuPos.left, minWidth: Math.max(menuPos.width, 160) }}
        >
          {options.length === 0 && (
            <div className={styles.statusMenuEmpty}>No options yet</div>
          )}
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={styles.statusMenuItem}
              onClick={() => { onChange(opt.value); close() }}
            >
              <span className={styles.statusBadge} style={colorStyleFor(opt.color)}>
                {opt.value}
              </span>
            </button>
          ))}
          {value && (
            <button
              type="button"
              className={`${styles.statusMenuItem} ${styles.statusMenuItemClear}`}
              onClick={() => { onChange(''); close() }}
            >
              <span className={styles.statusEmpty}>Clear</span>
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
