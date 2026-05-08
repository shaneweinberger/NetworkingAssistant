import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  COLOR_NAMES,
  COLOR_PALETTE,
  colorStyleFor,
  type ColorName,
  type DropdownOption,
} from '../../lib/colors'
import {
  TYPE_TOGGLEABLE,
  type ContactColumnConfig,
  type ColumnType,
} from '../ContactsTable/ContactsTable'
import styles from './ColumnSettingsModal.module.css'

interface Props {
  columns: ContactColumnConfig[]
  onChange: (cols: ContactColumnConfig[]) => void
  onClose: () => void
}

export default function ColumnSettingsModal({ columns, onChange, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const updateColumn = (key: string, patch: Partial<ContactColumnConfig>) => {
    onChange(columns.map(c => (c.key === key ? { ...c, ...patch } as ContactColumnConfig : c)))
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <header className={styles.header}>
          <h2 className={styles.title}>Column settings</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className={styles.list}>
          {columns.map(col => (
            <ColumnRow
              key={col.key}
              column={col}
              onUpdate={patch => updateColumn(col.key, patch)}
            />
          ))}
        </div>

        <footer className={styles.footer}>
          <button type="button" className={styles.doneButton} onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}

function ColumnRow({
  column,
  onUpdate,
}: {
  column: ContactColumnConfig
  onUpdate: (patch: Partial<ContactColumnConfig>) => void
}) {
  const canToggleType = TYPE_TOGGLEABLE.includes(column.key)
  const isDropdown = column.type === 'dropdown'

  const updateOption = (idx: number, patch: Partial<DropdownOption>) => {
    const next = column.options.map((o, i) => (i === idx ? { ...o, ...patch } : o))
    onUpdate({ options: next })
  }
  const removeOption = (idx: number) => {
    onUpdate({ options: column.options.filter((_, i) => i !== idx) })
  }
  const addOption = () => {
    const usedColors = column.options.map(o => o.color)
    const nextColor = (COLOR_NAMES.find(c => !usedColors.includes(c)) ?? 'gray') as ColorName
    onUpdate({ options: [...column.options, { value: 'New option', color: nextColor }] })
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <label className={styles.visibility}>
          <input
            type="checkbox"
            checked={column.visible}
            onChange={e => onUpdate({ visible: e.target.checked })}
          />
        </label>

        <input
          type="text"
          className={styles.labelInput}
          value={column.label}
          onChange={e => onUpdate({ label: e.target.value })}
        />

        <select
          className={styles.typeSelect}
          value={column.type}
          disabled={!canToggleType}
          onChange={e => onUpdate({ type: e.target.value as ColumnType })}
        >
          <option value="text">Text</option>
          <option value="dropdown">Dropdown</option>
        </select>
      </div>

      {isDropdown && (
        <div className={styles.options}>
          {column.options.map((opt, i) => (
            <div key={i} className={styles.option}>
              <ColorPicker
                color={opt.color}
                onChange={c => updateOption(i, { color: c })}
              />
              <input
                type="text"
                className={styles.optionInput}
                value={opt.value}
                onChange={e => updateOption(i, { value: e.target.value })}
              />
              <span className={styles.optionPreview} style={colorStyleFor(opt.color)}>
                {opt.value || '—'}
              </span>
              <button
                type="button"
                className={styles.optionRemove}
                onClick={() => removeOption(i)}
                aria-label="Remove option"
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className={styles.addOption} onClick={addOption}>
            + Add option
          </button>
        </div>
      )}
    </div>
  )
}

function ColorPicker({
  color,
  onChange,
}: {
  color: ColorName
  onChange: (c: ColorName) => void
}) {
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setMenuPos({ top: rect.bottom + 4, left: rect.left })
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
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [menuPos])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.colorSwatch}
        style={{ backgroundColor: COLOR_PALETTE[color].swatch }}
        onClick={open}
        aria-label="Pick color"
      />
      {menuPos && createPortal(
        <div
          ref={menuRef}
          className={styles.colorMenu}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {COLOR_NAMES.map(c => (
            <button
              key={c}
              type="button"
              className={`${styles.colorOption} ${c === color ? styles.colorOptionActive : ''}`}
              onClick={() => { onChange(c); close() }}
            >
              <span
                className={styles.colorOptionSwatch}
                style={{ backgroundColor: COLOR_PALETTE[c].swatch }}
              />
              <span className={styles.colorOptionName}>{c}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
