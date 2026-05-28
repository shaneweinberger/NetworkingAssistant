import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Todo } from '../../types/database'
import styles from './TodoList.module.css'

const POSITION_STEP = 1000

export default function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const focusAfterRenderRef = useRef<string | null>(null)
  const saveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const [drag, setDrag] = useState<{ from: number; dropIndex: number } | null>(null)
  const dragRef = useRef(drag)
  dragRef.current = drag
  const justDraggedRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

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

  // Focus newly created/jumped-to row after render.
  useEffect(() => {
    const id = focusAfterRenderRef.current
    if (!id) return
    const el = inputRefs.current.get(id)
    if (el) {
      el.focus()
      const len = el.value.length
      el.setSelectionRange(len, len)
    }
    focusAfterRenderRef.current = null
  })

  const scheduleSave = (id: string, patch: Partial<Todo>) => {
    const timers = saveTimersRef.current
    const existing = timers.get(id)
    if (existing) clearTimeout(existing)
    const t = setTimeout(async () => {
      timers.delete(id)
      const { error } = await supabase.from('todos').update(patch).eq('id', id)
      if (error) console.warn('Failed to save todo:', error.message)
    }, 350)
    timers.set(id, t)
  }

  const flushSave = async (id: string, patch: Partial<Todo>) => {
    const timers = saveTimersRef.current
    const existing = timers.get(id)
    if (existing) {
      clearTimeout(existing)
      timers.delete(id)
    }
    const { error } = await supabase.from('todos').update(patch).eq('id', id)
    if (error) console.warn('Failed to save todo:', error.message)
  }

  const updateContent = (id: string, content: string) => {
    setTodos(prev => prev.map(t => (t.id === id ? { ...t, content } : t)))
    scheduleSave(id, { content })
  }

  const toggleDone = async (id: string) => {
    const todo = todos.find(t => t.id === id)
    if (!todo) return
    const done = !todo.done
    setTodos(prev => prev.map(t => (t.id === id ? { ...t, done } : t)))
    await flushSave(id, { done })
  }

  const positionForIndex = (index: number): number => {
    const before = todos[index - 1]?.position
    const after = todos[index]?.position
    if (before === undefined && after === undefined) return POSITION_STEP
    if (before === undefined) return (after as number) - POSITION_STEP
    if (after === undefined) return before + POSITION_STEP
    return (before + after) / 2
  }

  const insertAt = async (index: number) => {
    const position = positionForIndex(index)
    const { data, error } = await supabase
      .from('todos')
      .insert({ content: '', done: false, position })
      .select()
      .single()
    if (error || !data) {
      setError(error?.message ?? 'Failed to create to-do (no row returned)')
      return
    }
    const newTodo = data as Todo
    setTodos(prev => {
      const next = [...prev]
      next.splice(index, 0, newTodo)
      return next
    })
    focusAfterRenderRef.current = newTodo.id
  }

  const removeTodo = async (id: string, focusPreviousIfEmpty = false) => {
    const idx = todos.findIndex(t => t.id === id)
    if (idx < 0) return
    const prevId = idx > 0 ? todos[idx - 1].id : null
    setTodos(prev => prev.filter(t => t.id !== id))
    inputRefs.current.delete(id)
    if (focusPreviousIfEmpty && prevId) focusAfterRenderRef.current = prevId
    const { error } = await supabase.from('todos').delete().eq('id', id)
    if (error) console.warn('Failed to delete todo:', error.message)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, todo: Todo, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      // Flush the current value before inserting so it doesn't get clobbered by a late save.
      flushSave(todo.id, { content: todo.content })
      insertAt(index + 1)
      return
    }
    if (e.key === 'Backspace' && todo.content === '') {
      // Only delete if there's something to focus on after, or it's the last leftover row.
      e.preventDefault()
      removeTodo(todo.id, true)
      return
    }
    if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault()
      const prev = todos[index - 1]
      const el = inputRefs.current.get(prev.id)
      if (el) {
        el.focus()
        const len = el.value.length
        el.setSelectionRange(len, len)
      }
      return
    }
    if (e.key === 'ArrowDown' && index < todos.length - 1) {
      e.preventDefault()
      const next = todos[index + 1]
      const el = inputRefs.current.get(next.id)
      if (el) {
        el.focus()
        const len = el.value.length
        el.setSelectionRange(len, len)
      }
    }
  }

  const startDrag = (e: React.MouseEvent, fromIndex: number) => {
    e.preventDefault()
    e.stopPropagation()
    justDraggedRef.current = false
    const startY = e.clientY
    let dragging = false

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging && Math.abs(ev.clientY - startY) < 5) return
      if (!dragging) {
        dragging = true
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
      }

      const listEl = listRef.current
      if (!listEl) return
      const children = Array.from(listEl.children) as HTMLElement[]
      let dropIndex = children.length
      for (let i = 0; i < children.length; i++) {
        const rect = children[i].getBoundingClientRect()
        if (ev.clientY < rect.top + rect.height / 2) {
          dropIndex = i
          break
        }
      }
      setDrag({ from: fromIndex, dropIndex })
    }

    const onMouseUp = () => {
      if (dragging) justDraggedRef.current = true
      const ds = dragRef.current
      if (ds && ds.dropIndex !== ds.from && ds.dropIndex !== ds.from + 1) {
        setTodos(prev => {
          const next = [...prev]
          const [moved] = next.splice(ds.from, 1)
          const insertionIdx = ds.dropIndex > ds.from ? ds.dropIndex - 1 : ds.dropIndex
          next.splice(insertionIdx, 0, moved)

          // Recompute position for the moved item using neighbors.
          const before = next[insertionIdx - 1]?.position
          const after = next[insertionIdx + 1]?.position
          let newPos: number
          if (before === undefined && after === undefined) newPos = POSITION_STEP
          else if (before === undefined) newPos = (after as number) - POSITION_STEP
          else if (after === undefined) newPos = before + POSITION_STEP
          else newPos = (before + after) / 2

          next[insertionIdx] = { ...moved, position: newPos }
          flushSave(moved.id, { position: newPos })
          return next
        })
      }
      setDrag(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const addAtEnd = () => insertAt(todos.length)

  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>To-do</h2>
        {todos.length > 0 && (
          <span className={styles.sectionMeta}>
            {todos.filter(t => t.done).length} / {todos.length} done
          </span>
        )}
      </header>

      {loading && <p className={styles.stateText}>Loading…</p>}
      {error && (
        <p className={styles.errorText}>
          {error} — did you run <code>migrations/2026-05-27_create_todos.sql</code> in Supabase?
        </p>
      )}

      {!loading && (
        <>
          <div className={styles.list} ref={listRef}>
            {todos.map((todo, index) => {
              const ds = drag
              const isDragging = ds?.from === index
              const isDropAbove =
                ds !== null && ds.dropIndex === index && ds.from !== index && ds.from !== index - 1
              const isDropBelow =
                ds !== null &&
                ds.dropIndex === todos.length &&
                index === todos.length - 1 &&
                ds.from !== index
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
                    onMouseDown={e => startDrag(e, index)}
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
                    onClick={() => toggleDone(todo.id)}
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

                  <input
                    ref={el => {
                      if (el) inputRefs.current.set(todo.id, el)
                      else inputRefs.current.delete(todo.id)
                    }}
                    className={styles.input}
                    type="text"
                    value={todo.content}
                    placeholder="To-do"
                    onChange={e => updateContent(todo.id, e.target.value)}
                    onKeyDown={e => onKeyDown(e, todo, index)}
                    onBlur={() => flushSave(todo.id, { content: todo.content })}
                  />

                  <button
                    type="button"
                    className={styles.deleteBtn}
                    aria-label="Delete to-do"
                    onClick={() => removeTodo(todo.id)}
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

          <button type="button" className={styles.addBtn} onClick={addAtEnd}>
            + New to-do
          </button>
        </>
      )}
    </section>
  )
}
