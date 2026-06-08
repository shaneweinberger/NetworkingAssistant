import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Todo } from '../../types/database'
import styles from './TodoList.module.css'

const POSITION_STEP = 1000

type ColKey = 'today' | 'week' | 'other'

function getDateStr(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function getBucket(dueDate: string | null, today: string, weekEnd: string): ColKey {
  if (!dueDate) return 'other'
  if (dueDate === today) return 'today'
  if (dueDate > today && dueDate <= weekEnd) return 'week'
  return 'other'
}

function positionBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return POSITION_STEP
  if (before === undefined) return (after as number) - POSITION_STEP
  if (after === undefined) return (before as number) + POSITION_STEP
  return (before + after) / 2
}

interface DragState {
  id: string
  fromCol: ColKey
  toCol: ColKey
  dropIndex: number
}

interface ColProps {
  colKey: ColKey
  title: string
  todos: Todo[]
  defaultDueDate: string | null
  drag: DragState | null
  collapsed: boolean
  onToggleCollapse: () => void
  onContentChange: (id: string, content: string) => void
  onToggle: (id: string, currentDone: boolean) => void
  onFlush: (id: string, patch: Partial<Todo>) => Promise<void>
  onInsert: (columnTodos: Todo[], index: number, dueDate: string | null) => Promise<string | null>
  onDelete: (id: string) => void
  onDeleteClick: (id: string) => void
  onDragStart: (e: React.MouseEvent, id: string, fromCol: ColKey) => void
  setContainerRef: (el: HTMLDivElement | null) => void
  setListRef: (el: HTMLDivElement | null) => void
}

function TodoColumn({
  colKey,
  title,
  todos,
  defaultDueDate,
  drag,
  collapsed,
  onToggleCollapse,
  onContentChange,
  onToggle,
  onFlush,
  onInsert,
  onDelete,
  onDeleteClick,
  onDragStart,
  setContainerRef,
  setListRef,
}: ColProps) {
  const inputRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map())
  const focusRef = useRef<string | null>(null)

  useEffect(() => {
    const id = focusRef.current
    if (!id) return
    const el = inputRefs.current.get(id)
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
    focusRef.current = null
  })

  const insertAt = async (index: number) => {
    const newId = await onInsert(todos, index, defaultDueDate)
    if (newId) focusRef.current = newId
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, todo: Todo, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onFlush(todo.id, { content: todo.content })
      insertAt(index + 1)
      return
    }
    if (e.key === 'Backspace' && todo.content === '') {
      e.preventDefault()
      const prevId = index > 0 ? todos[index - 1].id : null
      if (prevId) focusRef.current = prevId
      onDelete(todo.id)
      return
    }
    if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault()
      const el = inputRefs.current.get(todos[index - 1].id)
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
      return
    }
    if (e.key === 'ArrowDown' && index < todos.length - 1) {
      e.preventDefault()
      const el = inputRefs.current.get(todos[index + 1].id)
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
    }
  }

  const isCurrentTarget = drag?.toCol === colKey

  return (
    <div className={styles.section} ref={setContainerRef}>
      <button
        type="button"
        className={styles.sectionHeader}
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
      >
        <div className={styles.sectionLabelRow}>
          <span className={styles.sectionLabel}>{title}</span>
          <span className={styles.sectionCount}>{todos.length}</span>
        </div>
        <svg
          className={`${styles.chevron} ${collapsed ? styles.chevronCollapsed : ''}`}
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {!collapsed && (
        <div className={styles.sectionBody}>
          <div className={styles.list} ref={setListRef}>
            {todos.map((todo, index) => {
              const isDragging = drag?.id === todo.id
              const isDropAbove = isCurrentTarget && drag!.dropIndex === index
              const isDropBelow =
                isCurrentTarget &&
                drag!.dropIndex === todos.length &&
                index === todos.length - 1

              return (
                <div
                  key={todo.id}
                  className={[
                    styles.row,
                    todo.done ? styles.rowDone : '',
                    isDragging ? styles.rowDragging : '',
                    isDropAbove ? styles.rowDropAbove : '',
                    isDropBelow ? styles.rowDropBelow : '',
                  ].filter(Boolean).join(' ')}
                >
                  <button
                    type="button"
                    className={styles.grip}
                    aria-label="Drag to reorder"
                    onMouseDown={e => onDragStart(e, todo.id, colKey)}
                  >
                    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                      <circle cx="2.5" cy="3" r="1" />
                      <circle cx="7.5" cy="3" r="1" />
                      <circle cx="2.5" cy="7" r="1" />
                      <circle cx="7.5" cy="7" r="1" />
                      <circle cx="2.5" cy="11" r="1" />
                      <circle cx="7.5" cy="11" r="1" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    className={`${styles.checkbox} ${todo.done ? styles.checkboxChecked : ''}`}
                    onClick={() => onToggle(todo.id, todo.done)}
                    aria-pressed={todo.done}
                    aria-label={todo.done ? 'Mark not done' : 'Mark done'}
                  >
                    {todo.done && (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path
                          d="M2.5 6.5L5 9l4.5-6"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>

                  <textarea
                    ref={el => {
                      if (el) {
                        inputRefs.current.set(todo.id, el)
                        el.style.height = 'auto'
                        el.style.height = `${el.scrollHeight}px`
                      } else {
                        inputRefs.current.delete(todo.id)
                      }
                    }}
                    className={styles.input}
                    value={todo.content}
                    placeholder="To-do"
                    rows={1}
                    onChange={e => {
                      onContentChange(todo.id, e.target.value)
                      e.target.style.height = 'auto'
                      e.target.style.height = `${e.target.scrollHeight}px`
                    }}
                    onKeyDown={e => onKeyDown(e, todo, index)}
                    onBlur={() => onFlush(todo.id, { content: todo.content })}
                  />

                  <button
                    type="button"
                    className={styles.deleteBtn}
                    aria-label="Delete to-do"
                    onClick={() => onDeleteClick(todo.id)}
                  >
                    <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                      <path
                        d="M1.5 3h10M4.5 3V2a.5.5 0 01.5-.5h3a.5.5 0 01.5.5v1M3 3l.75 8h6.5L11 3"
                        stroke="currentColor"
                        strokeWidth="1.25"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>

          <button type="button" className={styles.addBtn} onClick={() => insertAt(todos.length)}>
            + New to-do
          </button>
        </div>
      )}
    </div>
  )
}

export default function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<ColKey, boolean>>({
    today: false, week: false, other: false,
  })
  const toggleCollapse = (key: ColKey) =>
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  const saveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const dragRef = useRef<DragState | null>(null)
  const todosRef = useRef<Todo[]>([])
  todosRef.current = todos
  dragRef.current = drag

  const colContainerRefs = useRef<Record<ColKey, HTMLDivElement | null>>({
    today: null, week: null, other: null,
  })
  const colListRefs = useRef<Record<ColKey, HTMLDivElement | null>>({
    today: null, week: null, other: null,
  })

  const today = useMemo(() => getDateStr(0), [])
  const weekEnd = useMemo(() => getDateStr(6), [])
  const tomorrow = useMemo(() => getDateStr(1), [])

  useEffect(() => {
    async function fetchTodos() {
      const { data, error } = await supabase
        .from('todos')
        .select('*')
        .order('position', { ascending: true })
      if (error) setError(error.message)
      else setTodos((data as Todo[]) ?? [])
      setLoading(false)
    }
    fetchTodos()
  }, [])

  const scheduleSave = useCallback((id: string, patch: Partial<Todo>) => {
    const timers = saveTimersRef.current
    const existing = timers.get(id)
    if (existing) clearTimeout(existing)
    const t = setTimeout(async () => {
      timers.delete(id)
      const { error } = await supabase.from('todos').update(patch).eq('id', id)
      if (error) console.warn('Failed to save todo:', error.message)
    }, 350)
    timers.set(id, t)
  }, [])

  const flushSave = useCallback(async (id: string, patch: Partial<Todo>) => {
    const timers = saveTimersRef.current
    const existing = timers.get(id)
    if (existing) { clearTimeout(existing); timers.delete(id) }
    const { error } = await supabase.from('todos').update(patch).eq('id', id)
    if (error) console.warn('Failed to save todo:', error.message)
  }, [])

  const updateContent = useCallback((id: string, content: string) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, content } : t))
    scheduleSave(id, { content })
  }, [scheduleSave])

  const toggleDone = useCallback((id: string, currentDone: boolean) => {
    const done = !currentDone
    setTodos(prev => prev.map(t => t.id === id ? { ...t, done } : t))
    flushSave(id, { done })
  }, [flushSave])

  const insertTodo = useCallback(async (
    columnTodos: Todo[],
    index: number,
    dueDate: string | null,
  ): Promise<string | null> => {
    const position = positionBetween(columnTodos[index - 1]?.position, columnTodos[index]?.position)
    const { data, error } = await supabase
      .from('todos')
      .insert({ content: '', done: false, position, due_date: dueDate })
      .select()
      .single()
    if (error || !data) { console.warn('Failed to create todo:', error?.message); return null }
    const newTodo = data as Todo
    setTodos(prev => {
      const next = [...prev, newTodo]
      next.sort((a, b) => a.position - b.position)
      return next
    })
    return newTodo.id
  }, [])

  const deleteTodo = useCallback((id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id))
    supabase.from('todos').delete().eq('id', id).then(({ error }) => {
      if (error) console.warn('Failed to delete todo:', error.message)
    })
  }, [])

  const startDrag = useCallback((e: React.MouseEvent, id: string, fromCol: ColKey) => {
    e.preventDefault()
    e.stopPropagation()

    const allTodos = todosRef.current
    const fromColTodos = allTodos.filter(t => getBucket(t.due_date, today, weekEnd) === fromCol)
    const fromIndex = fromColTodos.findIndex(t => t.id === id)

    const initial: DragState = { id, fromCol, toCol: fromCol, dropIndex: fromIndex }
    setDrag(initial)
    dragRef.current = initial

    function colForX(x: number): ColKey {
      const keys: ColKey[] = ['today', 'week', 'other']
      for (const k of keys) {
        const el = colContainerRefs.current[k]
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (x >= r.left && x <= r.right) return k
      }
      // fall back to closest by horizontal distance
      let closest = fromCol
      let minDist = Infinity
      for (const k of keys) {
        const el = colContainerRefs.current[k]
        if (!el) continue
        const r = el.getBoundingClientRect()
        const dist = Math.abs(x - (r.left + r.right) / 2)
        if (dist < minDist) { minDist = dist; closest = k }
      }
      return closest
    }

    function dropIndexForY(y: number, col: ColKey): number {
      const listEl = colListRefs.current[col]
      if (!listEl) return 0
      const children = Array.from(listEl.children) as HTMLElement[]
      for (let i = 0; i < children.length; i++) {
        const r = children[i].getBoundingClientRect()
        if (y < r.top + r.height / 2) return i
      }
      return children.length
    }

    const onMouseMove = (ev: MouseEvent) => {
      const toCol = colForX(ev.clientX)
      const dropIndex = dropIndexForY(ev.clientY, toCol)
      const next: DragState = { id, fromCol, toCol, dropIndex }
      setDrag(next)
      dragRef.current = next
    }

    const onMouseUp = () => {
      const ds = dragRef.current
      if (ds) {
        const all = todosRef.current
        const toColTodos = all.filter(t => getBucket(t.due_date, today, weekEnd) === ds.toCol)
        const fromColTodos2 = ds.fromCol === ds.toCol
          ? toColTodos
          : all.filter(t => getBucket(t.due_date, today, weekEnd) === ds.fromCol)
        const fromIdx = fromColTodos2.findIndex(t => t.id === ds.id)

        const isSameCol = ds.fromCol === ds.toCol
        const isNoOp = isSameCol && (ds.dropIndex === fromIdx || ds.dropIndex === fromIdx + 1)

        if (!isNoOp) {
          let newPos: number
          if (isSameCol) {
            const next = [...toColTodos]
            next.splice(fromIdx, 1)
            const insertIdx = ds.dropIndex > fromIdx ? ds.dropIndex - 1 : ds.dropIndex
            newPos = positionBetween(next[insertIdx - 1]?.position, next[insertIdx]?.position)
          } else {
            newPos = positionBetween(
              toColTodos[ds.dropIndex - 1]?.position,
              toColTodos[ds.dropIndex]?.position,
            )
          }

          const newDueDate = ds.toCol === 'today' ? today : ds.toCol === 'week' ? tomorrow : null
          const patch: Partial<Todo> = isSameCol ? { position: newPos } : { position: newPos, due_date: newDueDate }

          setTodos(prev => {
            const next = prev.map(t => t.id === ds.id ? { ...t, ...patch } : t)
            next.sort((a, b) => a.position - b.position)
            return next
          })
          flushSave(ds.id, patch)
        }
      }

      setDrag(null)
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [today, weekEnd, tomorrow, flushSave])

  const todayTodos = useMemo(
    () => todos.filter(t => getBucket(t.due_date, today, weekEnd) === 'today'),
    [todos, today, weekEnd],
  )
  const weekTodos = useMemo(
    () => todos.filter(t => getBucket(t.due_date, today, weekEnd) === 'week'),
    [todos, today, weekEnd],
  )
  const otherTodos = useMemo(
    () => todos.filter(t => getBucket(t.due_date, today, weekEnd) === 'other'),
    [todos, today, weekEnd],
  )

  const sharedProps = {
    drag,
    onContentChange: updateContent,
    onToggle: toggleDone,
    onFlush: flushSave,
    onInsert: insertTodo,
    onDelete: deleteTodo,
    onDeleteClick: setPendingDeleteId,
    onDragStart: startDrag,
  }

  return (
    <section className={styles.todoBoard}>
      <header className={styles.boardHeader}>
        <h2 className={styles.boardTitle}>To-do</h2>
        {todos.length > 0 && (
          <span className={styles.boardMeta}>
            {todos.filter(t => t.done).length} / {todos.length} done
          </span>
        )}
      </header>

      {loading && <p className={styles.stateText}>Loading…</p>}
      {error && (
        <p className={styles.errorText}>
          {error} — did you run <code>migrations/2026-05-27_create_todos.sql</code> and{' '}
          <code>migrations/2026-06-07_add_due_date_to_todos.sql</code> in Supabase?
        </p>
      )}

      {!loading && (
        <div className={styles.sections}>
          <TodoColumn
            colKey="today"
            title="Due Today"
            todos={todayTodos}
            defaultDueDate={today}
            collapsed={collapsed.today}
            onToggleCollapse={() => toggleCollapse('today')}
            setContainerRef={el => { colContainerRefs.current.today = el }}
            setListRef={el => { colListRefs.current.today = el }}
            {...sharedProps}
          />
          <TodoColumn
            colKey="week"
            title="Due This Week"
            todos={weekTodos}
            defaultDueDate={tomorrow}
            collapsed={collapsed.week}
            onToggleCollapse={() => toggleCollapse('week')}
            setContainerRef={el => { colContainerRefs.current.week = el }}
            setListRef={el => { colListRefs.current.week = el }}
            {...sharedProps}
          />
          <TodoColumn
            colKey="other"
            title="Other"
            todos={otherTodos}
            defaultDueDate={null}
            collapsed={collapsed.other}
            onToggleCollapse={() => toggleCollapse('other')}
            setContainerRef={el => { colContainerRefs.current.other = el }}
            setListRef={el => { colListRefs.current.other = el }}
            {...sharedProps}
          />
        </div>
      )}
      {pendingDeleteId && (
        <DeleteConfirmModal
          onClose={() => setPendingDeleteId(null)}
          onConfirm={() => {
            deleteTodo(pendingDeleteId)
            setPendingDeleteId(null)
          }}
        />
      )}
    </section>
  )
}

function DeleteConfirmModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
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
        <h2 className={styles.modalTitle}>Delete to-do</h2>
        <p className={styles.modalBody}>Are you sure you want to delete this to-do? This cannot be undone.</p>
        <div className={styles.modalActions}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.deleteButton} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  )
}
