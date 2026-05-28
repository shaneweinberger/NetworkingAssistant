import { useCallback, useRef, useState, type ReactNode } from 'react'
import styles from './Table.module.css'

export type Column<K extends string = string> = {
  key: K
  label: string
  width: number
  minWidth?: number
  sortable?: boolean
  filterable?: boolean
}

export type SortState<K extends string = string> = { key: K; dir: 'asc' | 'desc' } | null

interface Props<K extends string> {
  columns: Column<K>[]
  onColumnsChange: (cols: Column<K>[]) => void
  sort?: SortState<K>
  onSortChange?: (sort: SortState<K>) => void
  filters?: Partial<Record<K, string>>
  onFilterChange?: (key: K, value: string) => void
  trailingWidth?: number
  children: ReactNode
}

const DEFAULT_MIN_WIDTH = 60

export default function Table<K extends string>({
  columns,
  onColumnsChange,
  sort = null,
  onSortChange,
  filters,
  onFilterChange,
  trailingWidth = 0,
  children,
}: Props<K>) {
  const tableRef = useRef<HTMLTableElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  const [resizingCol, setResizingCol] = useState<number | null>(null)
  const [dragState, setDragState] = useState<{ from: number; dropIndex: number; ghostX: number; ghostY: number } | null>(null)
  const dragRef = useRef(dragState)
  dragRef.current = dragState
  const [openFilterFor, setOpenFilterFor] = useState<K | null>(null)

  const startResize = useCallback((e: React.MouseEvent, colIndex: number) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = columnsRef.current[colIndex].width
    const minWidth = columnsRef.current[colIndex].minWidth ?? DEFAULT_MIN_WIDTH

    setResizingCol(colIndex)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(minWidth, startWidth + (ev.clientX - startX))
      onColumnsChange(columnsRef.current.map((c, i) => (i === colIndex ? { ...c, width: newWidth } : c)))
    }

    const onMouseUp = () => {
      setResizingCol(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [onColumnsChange])

  const startDrag = useCallback((e: React.MouseEvent, colIndex: number) => {
    const target = e.target as HTMLElement
    if (target.closest(`.${styles.resizeHandle}`)) return
    if (target.closest('input')) return
    if (target.closest(`.${styles.filterIcon}`)) return

    e.preventDefault()
    const startX = e.clientX
    let dragging = false

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging && Math.abs(ev.clientX - startX) < 5) return
      if (!dragging) {
        dragging = true
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
      }
      const tableRect = tableRef.current?.getBoundingClientRect()
      if (!tableRect) return
      const scrollLeft = containerRef.current?.scrollLeft ?? 0
      const relX = ev.clientX - tableRect.left + scrollLeft
      const cols = columnsRef.current
      let cumulative = 0
      let dropIndex = cols.length
      for (let i = 0; i < cols.length; i++) {
        if (relX < cumulative + cols[i].width / 2) {
          dropIndex = i
          break
        }
        cumulative += cols[i].width
      }
      setDragState({ from: colIndex, dropIndex, ghostX: ev.clientX, ghostY: ev.clientY })
    }

    const onMouseUp = () => {
      const ds = dragRef.current
      if (ds && ds.dropIndex !== ds.from && ds.dropIndex !== ds.from + 1) {
        const cols = columnsRef.current
        const next = [...cols]
        const [moved] = next.splice(ds.from, 1)
        next.splice(ds.dropIndex > ds.from ? ds.dropIndex - 1 : ds.dropIndex, 0, moved)
        onColumnsChange(next)
      }
      setDragState(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [onColumnsChange])

  const toggleSort = (key: K) => {
    if (!onSortChange) return
    if (!sort || sort.key !== key) onSortChange({ key, dir: 'asc' })
    else if (sort.dir === 'asc') onSortChange({ key, dir: 'desc' })
    else onSortChange(null)
  }

  const totalWidth = columns.reduce((a, c) => a + c.width, 0) + trailingWidth

  return (
    <div className={styles.container} ref={containerRef}>
      <table ref={tableRef} className={styles.table} style={{ minWidth: totalWidth }}>
        <thead>
          <tr>
            {columns.map((col, i) => {
              const ds = dragState
              const isDragging = ds?.from === i
              const isDropLeft =
                ds !== null && ds.dropIndex === i && ds.from !== i && ds.from !== i - 1
              const isDropRight =
                ds !== null && ds.dropIndex === columns.length && i === columns.length - 1 && ds.from !== i
              const isSorted = sort?.key === col.key
              const filterValue = filters?.[col.key] ?? ''
              const showFilter = openFilterFor === col.key || filterValue.length > 0

              return (
                <th
                  key={col.key}
                  style={{ width: col.width }}
                  className={[
                    styles.th,
                    isDragging ? styles.thDragging : '',
                    isDropLeft ? styles.thDropLeft : '',
                    isDropRight ? styles.thDropRight : '',
                  ].filter(Boolean).join(' ')}
                  onMouseDown={e => startDrag(e, i)}
                >
                  <div className={styles.thHeader}>
                    <button
                      type="button"
                      className={styles.thLabel}
                      onClick={() => col.sortable && toggleSort(col.key)}
                      disabled={!col.sortable}
                    >
                      <span className={styles.thLabelText}>{col.label}</span>
                      {isSorted && (
                        <span className={styles.sortIcon} aria-hidden>
                          {sort?.dir === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </button>
                    {col.filterable && (
                      <button
                        type="button"
                        className={`${styles.filterIcon} ${showFilter ? styles.filterIconActive : ''}`}
                        aria-label={`Filter by ${col.label}`}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => {
                          e.stopPropagation()
                          setOpenFilterFor(openFilterFor === col.key ? null : col.key)
                        }}
                      >
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                          <path d="M1 2h9M2.5 5h6M4 8h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {showFilter && col.filterable && (
                    <input
                      autoFocus={openFilterFor === col.key}
                      type="text"
                      className={styles.filterInput}
                      placeholder="Filter…"
                      value={filterValue}
                      onChange={e => onFilterChange?.(col.key, e.target.value)}
                      onMouseDown={e => e.stopPropagation()}
                      onKeyDown={e => {
                        if (e.key === 'Escape') {
                          onFilterChange?.(col.key, '')
                          setOpenFilterFor(null)
                          ;(e.target as HTMLInputElement).blur()
                        }
                      }}
                    />
                  )}
                  <div
                    className={`${styles.resizeHandle} ${resizingCol === i ? styles.resizeHandleActive : ''}`}
                    onMouseDown={e => startResize(e, i)}
                  />
                </th>
              )
            })}
            <th className={styles.spacerTh} aria-hidden />
            {trailingWidth > 0 && <th style={{ width: trailingWidth }} className={styles.trailingTh} />}
          </tr>
        </thead>
        {children}
      </table>
      {dragState && (
        <div
          className={styles.dragGhost}
          style={{ left: dragState.ghostX + 12, top: dragState.ghostY - 16 }}
        >
          {columns[dragState.from]?.label}
        </div>
      )}
    </div>
  )
}
