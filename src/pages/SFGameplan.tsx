import { useEffect, useRef, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor,
  closestCenter, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, rectSortingStrategy, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '../lib/supabase'
import styles from './SFGameplan.module.css'

// ── Types ──────────────────────────────────────────────────────────────────

type Stage = { out: number; conv: number }
type ConsultingRole = { consultants: Stage; managers: Stage; principals: Stage }
type DayData = { out: number; conv: number }

type TierConfig = { companies: string[]; convTarget: number }
type GameplanConfig = {
  tier1: TierConfig
  tier2: TierConfig
  tier3: TierConfig
  consulting: { offices: string[] }
}

type GameplanState = {
  tier1: Record<string, Stage>
  tier2: Record<string, Stage>
  tier3: Record<string, Stage>
  consulting: Record<string, ConsultingRole>
  activityByDate: Record<string, DayData>
  loading: boolean
}

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: GameplanConfig = {
  tier1: { companies: ['Google', 'Stripe', 'Meta', 'Figma', 'Notion', 'Apple', 'Airbnb'], convTarget: 3 },
  tier2: { companies: ['Ambience', 'Intuitive', 'Abridge', 'Commure', 'OpenEvidence'], convTarget: 3 },
  tier3: { companies: ['OpenAI', 'Anthropic'], convTarget: 1 },
  consulting: { offices: ['Bain Toronto', 'BCG X', 'BCG SF', 'McKinsey Digital', 'McKinsey SF'] },
}

const C_ROLE_DEFS = [
  { key: 'consultants' as const, label: 'Consultants', convTarget: 5, convDoneAt: 3 },
  { key: 'managers'    as const, label: 'Manager',     convTarget: 1, convDoneAt: 1 },
  { key: 'principals'  as const, label: 'Principal',   convTarget: 1, convDoneAt: 1 },
]

const STRIP_DAYS = 28

const EMPTY_STAGE: Stage = { out: 0, conv: 0 }
const EMPTY_ROLE: ConsultingRole = {
  consultants: { ...EMPTY_STAGE }, managers: { ...EMPTY_STAGE }, principals: { ...EMPTY_STAGE },
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function todayStr() { const d = new Date(); d.setHours(12, 0, 0, 0); return fmtDate(d) }
function progressId(tier: string, company: string, role?: string) {
  return role ? `${tier}:${company}:${role}` : `${tier}:${company}`
}

// ── Supabase ───────────────────────────────────────────────────────────────

type ProgressRow = { id: string; out_count: number; conv_count: number }
type ActivityRow  = { date: string; type: 'out' | 'conv' }

async function fetchGameplan(): Promise<{
  tier1: Record<string, Stage>; tier2: Record<string, Stage>; tier3: Record<string, Stage>
  consulting: Record<string, ConsultingRole>; activityByDate: Record<string, DayData>
  config: GameplanConfig; fetchError: string | null
}> {
  const cutoff = fmtDate(new Date(Date.now() - STRIP_DAYS * 24 * 3600 * 1000))
  const [{ data: pRows, error: pErr }, { data: aRows, error: aErr }, { data: cfgRow, error: cfgErr }] = await Promise.all([
    supabase.from('gameplan_progress').select('id, out_count, conv_count'),
    supabase.from('gameplan_activity').select('date, type').gte('date', cutoff),
    supabase.from('gameplan_config').select('config').eq('id', 'main').maybeSingle(),
  ])

  const firstError = pErr ?? aErr ?? cfgErr
  if (firstError) {
    console.error('[SF Gameplan] Supabase fetch error:', firstError)
    return { tier1: {}, tier2: {}, tier3: {}, consulting: {}, activityByDate: {}, config: DEFAULT_CONFIG, fetchError: firstError.message }
  }

  const tier1: Record<string, Stage> = {}
  const tier2: Record<string, Stage> = {}
  const tier3: Record<string, Stage> = {}
  const consulting: Record<string, ConsultingRole> = {}
  for (const row of (pRows ?? []) as ProgressRow[]) {
    const [tier, company, role] = row.id.split(':')
    const stage: Stage = { out: row.out_count, conv: row.conv_count }
    if (tier === 'tier1') tier1[company] = stage
    else if (tier === 'tier2') tier2[company] = stage
    else if (tier === 'tier3') tier3[company] = stage
    else if (tier === 'consulting') {
      if (!consulting[company]) consulting[company] = { consultants: { ...EMPTY_STAGE }, managers: { ...EMPTY_STAGE }, principals: { ...EMPTY_STAGE } }
      consulting[company][role as keyof ConsultingRole] = stage
    }
  }

  const activityByDate: Record<string, DayData> = {}
  for (const row of (aRows ?? []) as ActivityRow[]) {
    const day = activityByDate[row.date] ?? { out: 0, conv: 0 }
    if (row.type === 'out') day.out++; else day.conv++
    activityByDate[row.date] = day
  }

  return { tier1, tier2, tier3, consulting, activityByDate, config: cfgRow?.config ?? DEFAULT_CONFIG, fetchError: null }
}

async function syncProgress(id: string, out: number, conv: number): Promise<string | null> {
  const { error } = await supabase.from('gameplan_progress').upsert({ id, out_count: out, conv_count: conv, updated_at: new Date().toISOString() })
  if (error) console.error('[SF Gameplan] syncProgress error:', error)
  return error?.message ?? null
}
async function insertActivity(type: 'out' | 'conv', company: string) {
  const { error } = await supabase.from('gameplan_activity').insert({ date: todayStr(), type, company })
  if (error) console.error('[SF Gameplan] insertActivity error:', error)
}
async function deleteLastActivity(type: 'out' | 'conv', company: string) {
  const { data, error } = await supabase.from('gameplan_activity').select('id').eq('type', type).eq('company', company).order('created_at', { ascending: false }).limit(1).single()
  if (error && error.code !== 'PGRST116') console.error('[SF Gameplan] deleteLastActivity select error:', error)
  if (data?.id) {
    const { error: delErr } = await supabase.from('gameplan_activity').delete().eq('id', data.id)
    if (delErr) console.error('[SF Gameplan] deleteLastActivity delete error:', delErr)
  }
}
async function saveConfig(config: GameplanConfig) {
  const { error } = await supabase.from('gameplan_config').upsert({ id: 'main', config, updated_at: new Date().toISOString() })
  if (error) console.error('[SF Gameplan] saveConfig error:', error)
}

// ── Visual helpers ─────────────────────────────────────────────────────────

type CardState = 'empty' | 'outreach' | 'progressing' | 'done'
function getCardState(s: Stage, doneAt: number): CardState {
  if (s.conv >= doneAt) return 'done'
  if (s.conv > 0) return 'progressing'
  if (s.out > 0) return 'outreach'
  return 'empty'
}
const CARD_CLS: Record<CardState, string> = { empty: '', outreach: 'cardOutreach', progressing: 'cardProgressing', done: 'cardDone' }
const BAR_CLS:  Record<CardState, string> = { empty: '', outreach: 'barFillOutreach', progressing: 'barFillProgressing', done: 'barFillDone' }

// ── Icons ──────────────────────────────────────────────────────────────────

const GearIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"
      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
)

// ── Shared UI primitives ───────────────────────────────────────────────────

function Btn({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
  return <button className={styles.cBtn} type="button" onClick={onClick} disabled={disabled} aria-label={label}>{label === 'decrease' ? '−' : '+'}</button>
}

function MiniCounter({ value, max, target, showTarget, onDec, onInc }: {
  value: number; max: number; target?: number; showTarget?: boolean; onDec: () => void; onInc: () => void
}) {
  return (
    <div className={styles.miniCounter}>
      <Btn onClick={onDec} disabled={value === 0} label="decrease" />
      <span className={styles.cValue}>{value}{showTarget && target !== undefined && <span className={styles.cTarget}>/{target}</span>}</span>
      <Btn onClick={onInc} disabled={value >= max} label="increase" />
    </div>
  )
}

function Bar({ stage, convTarget, convDoneAt }: { stage: Stage; convTarget: number; convDoneAt: number }) {
  const state = getCardState(stage, convDoneAt)
  const pct = state === 'outreach' ? Math.min(100, (stage.out / convTarget) * 100) : Math.min(100, (stage.conv / convTarget) * 100)
  return (
    <div className={styles.bar}>
      <div className={`${styles.barFill} ${styles[BAR_CLS[state] as keyof typeof styles] ?? ''}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ── Activity strip ─────────────────────────────────────────────────────────

function outColor(n: number) { return n >= 3 ? '#cc8000' : n >= 2 ? '#e8a030' : n > 0 ? '#fcd08a' : undefined }
function convColor(n: number) { return n >= 2 ? '#3da863' : n > 0 ? '#6dbe7e' : undefined }

function ActivityStrip({ activityByDate }: { activityByDate: Record<string, DayData> }) {
  const today = new Date(); today.setHours(12, 0, 0, 0)
  const todayDate = fmtDate(today)
  const days = Array.from({ length: STRIP_DAYS }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() - (STRIP_DAYS - 1 - i))
    return {
      date: fmtDate(d), dayNum: d.getDate(),
      showMonth: d.getDate() === 1 || i === 0 ? d.toLocaleDateString('en-US', { month: 'short' }) : null,
    }
  })
  const thisWeek = days.slice(-7)
  const weekOut = thisWeek.reduce((s, d) => s + (activityByDate[d.date]?.out ?? 0), 0)
  const weekConv = thisWeek.reduce((s, d) => s + (activityByDate[d.date]?.conv ?? 0), 0)
  return (
    <div className={styles.activityPanel}>
      <div className={styles.activityHeader}>
        <div><span className={styles.activityTitle}>Activity</span><span className={styles.activitySub}>last 4 weeks</span></div>
        <div className={styles.activityStats}>
          <span className={styles.activityStat}><span className={styles.activityStatDot} style={{ background: '#e8a030' }} />{weekOut} outreach this week</span>
          <span className={styles.activityStat}><span className={styles.activityStatDot} style={{ background: '#3da863' }} />{weekConv} conversations this week</span>
        </div>
      </div>
      <div className={styles.activityStrip}>
        {days.map(day => {
          const act = activityByDate[day.date] ?? { out: 0, conv: 0 }
          return (
            <div key={day.date} className={`${styles.activityDay} ${day.date === todayDate ? styles.activityDayToday : ''}`}>
              {day.showMonth && <span className={styles.activityMonth}>{day.showMonth}</span>}
              <div className={styles.activityCol} title={`${day.date}: ${act.out} outreach, ${act.conv} conversations`}>
                <div className={styles.activityBlockOut} style={{ background: outColor(act.out) }} />
                <div className={styles.activityBlockConv} style={{ background: convColor(act.conv) }} />
              </div>
              <span className={styles.activityDayNum}>{day.dayNum}</span>
            </div>
          )
        })}
      </div>
      <div className={styles.activityLegend}>
        <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#fcd08a' }} /><span className={styles.legendSwatchDark} style={{ background: '#cc8000' }} />Outreach (light = 1, dark = 3+)</span>
        <span className={styles.legendDivider} />
        <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#6dbe7e' }} /><span className={styles.legendSwatchDark} style={{ background: '#3da863' }} />Conversation (light = 1, dark = 2+)</span>
      </div>
    </div>
  )
}

// ── Pipeline card ──────────────────────────────────────────────────────────

function PipelineCard({ name, stage, convTarget, onAdjOut, onAdjConv }: {
  name: string; stage: Stage; convTarget: number; onAdjOut: (d: number) => void; onAdjConv: (d: number) => void
}) {
  const state = getCardState(stage, convTarget)
  return (
    <div className={`${styles.card} ${styles[CARD_CLS[state] as keyof typeof styles] ?? ''}`}>
      <span className={styles.cardName}>{name}</span>
      <Bar stage={stage} convTarget={convTarget} convDoneAt={convTarget} />
      <div className={styles.pipeline}>
        <div className={styles.pipeRow}>
          <span className={styles.pipeLabel}>Reached out</span>
          <MiniCounter value={stage.out} max={99} onDec={() => onAdjOut(-1)} onInc={() => onAdjOut(1)} />
        </div>
        <div className={styles.pipeRow}>
          <span className={`${styles.pipeLabel} ${styles.pipeLabelConv}`}>Conversations</span>
          <MiniCounter value={stage.conv} max={convTarget} target={convTarget} showTarget onDec={() => onAdjConv(-1)} onInc={() => onAdjConv(1)} />
        </div>
      </div>
    </div>
  )
}

// ── Add-company input card ─────────────────────────────────────────────────

function AddCard({ onAdd }: { onAdd: (name: string) => void }) {
  const [text, setText] = useState('')
  const [active, setActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function commit() {
    const v = text.trim()
    if (v) { onAdd(v); setText(''); setActive(false) }
  }

  if (!active) {
    return (
      <button type="button" className={`${styles.card} ${styles.addCard}`} onClick={() => { setActive(true); setTimeout(() => inputRef.current?.focus(), 0) }}>
        <span className={styles.addCardPlus}>+</span>
        <span className={styles.addCardLabel}>Add company</span>
      </button>
    )
  }

  return (
    <div className={`${styles.card} ${styles.addCardActive}`}>
      <input
        ref={inputRef}
        className={styles.addInput}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setText(''); setActive(false) }
        }}
        placeholder="Company name"
      />
      <div className={styles.addInputActions}>
        <button type="button" className={styles.addConfirmBtn} onClick={commit} disabled={!text.trim()}>Add</button>
        <button type="button" className={styles.addCancelBtn} onClick={() => { setText(''); setActive(false) }}>Cancel</button>
      </div>
    </div>
  )
}

// ── Sortable drag-and-drop ─────────────────────────────────────────────────

function SortableCardItem({
  id, isEditing, onRemove, children,
}: {
  id: string; isEditing: boolean; onRemove: (id: string) => void; children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1, position: 'relative' }}
      {...attributes}
      {...listeners}
    >
      {isEditing && (
        <button
          type="button"
          className={styles.deleteBadge}
          onPointerDown={e => e.stopPropagation()}
          onClick={() => onRemove(id)}
          aria-label={`Remove ${id}`}
        >×</button>
      )}
      {children}
    </div>
  )
}

function SortableTierGrid({
  items, renderItem, renderOverlayItem, isEditing, onRemove, onReorder, addSlot, gridClass,
}: {
  items: string[]
  renderItem: (id: string) => React.ReactNode
  renderOverlayItem: (id: string) => React.ReactNode
  isEditing: boolean
  onRemove: (id: string) => void
  onReorder: (newItems: string[]) => void
  addSlot?: React.ReactNode
  gridClass?: string
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }: DragStartEvent) => setActiveId(active.id as string)}
      onDragEnd={({ active, over }: DragEndEvent) => {
        setActiveId(null)
        if (!over || active.id === over.id) return
        const oi = items.indexOf(active.id as string)
        const ni = items.indexOf(over.id as string)
        if (oi !== -1 && ni !== -1) onReorder(arrayMove(items, oi, ni))
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={items} strategy={rectSortingStrategy}>
        <div className={`${styles.grid} ${gridClass ?? ''}`}>
          {items.map(id => (
            <SortableCardItem key={id} id={id} isEditing={isEditing} onRemove={onRemove}>
              {renderItem(id)}
            </SortableCardItem>
          ))}
          {isEditing && addSlot}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
        {activeId ? (
          <div className={styles.cardDragOverlay}>
            {renderOverlayItem(activeId)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SFGameplan() {
  const [gs, setGs] = useState<GameplanState>({
    tier1: {}, tier2: {}, tier3: {}, consulting: {}, activityByDate: {}, loading: true,
  })
  const [config, setConfig] = useState<GameplanConfig>(DEFAULT_CONFIG)
  const [editingTier, setEditingTier] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  useEffect(() => {
    fetchGameplan().then(({ config: cfg, fetchError, ...data }) => {
      setConfig(cfg)
      setSyncError(fetchError)
      setGs(prev => ({ ...prev, ...data, loading: false }))
    })
  }, [])

  // ── Config mutations ────────────────────────────────────────────────────

  function mutateConfig(updater: (c: GameplanConfig) => GameplanConfig) {
    setConfig(prev => {
      const next = updater(prev)
      saveConfig(next)
      return next
    })
  }

  function addCompany(tier: 'tier1' | 'tier2' | 'tier3', name: string) {
    mutateConfig(c => ({ ...c, [tier]: { ...c[tier], companies: [...c[tier].companies, name] } }))
  }
  function removeCompany(tier: 'tier1' | 'tier2' | 'tier3', name: string) {
    mutateConfig(c => ({ ...c, [tier]: { ...c[tier], companies: c[tier].companies.filter(x => x !== name) } }))
  }
  function updateConvTarget(tier: 'tier1' | 'tier2' | 'tier3', val: number) {
    if (val < 1) return
    mutateConfig(c => ({ ...c, [tier]: { ...c[tier], convTarget: val } }))
  }
  function addOffice(name: string) {
    mutateConfig(c => ({ ...c, consulting: { offices: [...c.consulting.offices, name] } }))
  }
  function removeOffice(name: string) {
    mutateConfig(c => ({ ...c, consulting: { offices: c.consulting.offices.filter(x => x !== name) } }))
  }
  function reorderTier(tier: 'tier1' | 'tier2' | 'tier3', companies: string[]) {
    mutateConfig(c => ({ ...c, [tier]: { ...c[tier], companies } }))
  }
  function reorderOffices(offices: string[]) {
    mutateConfig(c => ({ ...c, consulting: { offices } }))
  }

  // ── Progress mutations ──────────────────────────────────────────────────

  function adjStage(tier: 'tier1' | 'tier2' | 'tier3', company: string, field: keyof Stage, d: number, max: number) {
    setGs(prev => {
      const cur = prev[tier][company] ?? { ...EMPTY_STAGE }
      const newVal = Math.max(0, Math.min(max, cur[field] + d))
      if (newVal === cur[field]) return prev
      const newStage = { ...cur, [field]: newVal }
      const newActivity = { ...prev.activityByDate }
      const today = todayStr()
      const dayData = { ...(newActivity[today] ?? { out: 0, conv: 0 }) }
      if (field === 'out') dayData.out = Math.max(0, dayData.out + d)
      else dayData.conv = Math.max(0, dayData.conv + d)
      newActivity[today] = dayData
      syncProgress(progressId(tier, company), newStage.out, newStage.conv)
        .then(err => { if (err) setSyncError(err) })
      if (d > 0) insertActivity(field, company)
      else deleteLastActivity(field, company)
      return { ...prev, [tier]: { ...prev[tier], [company]: newStage }, activityByDate: newActivity }
    })
  }

  function adjConsulting(office: string, role: keyof ConsultingRole, field: keyof Stage, d: number, max: number) {
    setGs(prev => {
      const cur = prev.consulting[office] ?? { ...EMPTY_ROLE }
      const roleStage = cur[role] ?? { ...EMPTY_STAGE }
      const newVal = Math.max(0, Math.min(max, roleStage[field] + d))
      if (newVal === roleStage[field]) return prev
      const newStage = { ...roleStage, [field]: newVal }
      const newActivity = { ...prev.activityByDate }
      const today = todayStr()
      const dayData = { ...(newActivity[today] ?? { out: 0, conv: 0 }) }
      if (field === 'out') dayData.out = Math.max(0, dayData.out + d)
      else dayData.conv = Math.max(0, dayData.conv + d)
      newActivity[today] = dayData
      syncProgress(progressId('consulting', office, role), newStage.out, newStage.conv)
        .then(err => { if (err) setSyncError(err) })
      if (d > 0) insertActivity(field, office)
      else deleteLastActivity(field, office)
      return { ...prev, consulting: { ...prev.consulting, [office]: { ...cur, [role]: newStage } }, activityByDate: newActivity }
    })
  }

  // ── Derived counts ──────────────────────────────────────────────────────

  const { tier1, tier2, tier3, consulting, activityByDate, loading } = gs

  const t1Done = config.tier1.companies.filter(c => (tier1[c]?.conv ?? 0) >= config.tier1.convTarget).length
  const t2Done = config.tier2.companies.filter(c => (tier2[c]?.conv ?? 0) >= config.tier2.convTarget).length
  const t3Done = config.tier3.companies.filter(c => (tier3[c]?.conv ?? 0) >= config.tier3.convTarget).length
  const cDone = config.consulting.offices.filter(o => {
    const e = consulting[o] ?? { ...EMPTY_ROLE }
    return e.consultants.conv >= 3 && e.managers.conv >= 1 && e.principals.conv >= 1
  }).length

  const totalItems = config.tier1.companies.length + config.tier2.companies.length + config.tier3.companies.length + config.consulting.offices.length
  const doneItems = t1Done + t2Done + t3Done + cDone
  const overallPct = totalItems === 0 ? 0 : Math.round((doneItems / totalItems) * 100)

  if (loading) return <div className={styles.page}><div className={styles.loadingText}>Loading…</div></div>

  // ── Render helpers ──────────────────────────────────────────────────────

  function SectionHead({
    tier, badgeClass, title, note, doneCount, totalCount,
  }: {
    tier: string; badgeClass: string; title: string; note: string; doneCount: number; totalCount: number
  }) {
    const isEditing = editingTier === tier
    return (
      <div className={styles.sectionHead}>
        <div className={styles.sectionLeft}>
          <span className={`${styles.badge} ${badgeClass}`}>{tier === 'tier1' ? 'Tier 1' : tier === 'tier2' ? 'Tier 2' : tier === 'tier3' ? 'Tier 3' : 'Consulting'}</span>
          <div>
            <h2 className={styles.sectionTitle}>{title}</h2>
            <p className={styles.sectionNote}>{note}</p>
          </div>
        </div>
        <div className={styles.sectionRight}>
          <span className={styles.sectionProg}>{doneCount}/{totalCount} complete</span>
          <button
            type="button"
            className={`${styles.gearBtn} ${isEditing ? styles.gearBtnActive : ''}`}
            onClick={() => setEditingTier(isEditing ? null : tier)}
            aria-label={isEditing ? 'Done editing' : 'Edit section'}
          >
            {isEditing ? <span className={styles.gearDoneLabel}>Done</span> : <GearIcon />}
          </button>
        </div>
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>SF Gameplan</h1>
          <p className={styles.subtitle}>Track progress toward landing in SF.</p>
        </div>
        <div className={styles.overall}>
          <div className={styles.overallStats}>
            <span className={styles.overallCount}>{doneItems}<span className={styles.overallTotal}>/{totalItems}</span></span>
            <span className={styles.overallLabel}>targets met</span>
          </div>
          <div className={styles.overallBarWrap}>
            <div className={styles.overallBar}><div className={styles.overallFill} style={{ width: `${overallPct}%` }} /></div>
            <span className={styles.overallPct}>{overallPct}%</span>
          </div>
        </div>
      </header>

      {syncError && (
        <div className={styles.syncErrorBanner}>
          <strong>Supabase not connected.</strong> Changes won't save until the database tables are created.{' '}
          <span className={styles.syncErrorDetail}>{syncError}</span>
          <button type="button" className={styles.syncErrorDismiss} onClick={() => setSyncError(null)}>✕</button>
        </div>
      )}

      <ActivityStrip activityByDate={activityByDate} />

      <div className={styles.sections}>

        {/* Tier 1 */}
        {(() => {
          const tier = 'tier1'
          const isEditing = editingTier === tier
          return (
            <section className={styles.section}>
              <SectionHead tier={tier} badgeClass={styles.badge1} title="Elite Tech PM"
                note="Speak to 2–3 PMs at each · quality over quantity"
                doneCount={t1Done} totalCount={config.tier1.companies.length} />
              {isEditing && (
                <div className={styles.editGoalRow}>
                  <span className={styles.editGoalLabel}>Conversation goal:</span>
                  <input type="number" min={1} max={20} className={styles.goalInput}
                    value={config.tier1.convTarget}
                    onChange={e => updateConvTarget('tier1', parseInt(e.target.value) || 1)} />
                  <span className={styles.editGoalLabel}>per company</span>
                </div>
              )}
              <SortableTierGrid
                items={config.tier1.companies}
                renderItem={c => (
                  <PipelineCard name={c} stage={tier1[c] ?? EMPTY_STAGE}
                    convTarget={config.tier1.convTarget}
                    onAdjOut={d => adjStage('tier1', c, 'out', d, 99)}
                    onAdjConv={d => adjStage('tier1', c, 'conv', d, config.tier1.convTarget)} />
                )}
                renderOverlayItem={c => (
                  <PipelineCard name={c} stage={tier1[c] ?? EMPTY_STAGE}
                    convTarget={config.tier1.convTarget} onAdjOut={() => {}} onAdjConv={() => {}} />
                )}
                isEditing={isEditing}
                onRemove={c => removeCompany('tier1', c)}
                onReorder={companies => reorderTier('tier1', companies)}
                addSlot={<AddCard onAdd={name => addCompany('tier1', name)} />}
              />
            </section>
          )
        })()}

        {/* Tier 2 */}
        {(() => {
          const tier = 'tier2'
          const isEditing = editingTier === tier
          return (
            <section className={styles.section}>
              <SectionHead tier={tier} badgeClass={styles.badge2} title="Health-tech"
                note="Target founders · founding PMs · early employees · engineering leaders"
                doneCount={t2Done} totalCount={config.tier2.companies.length} />
              {isEditing && (
                <div className={styles.editGoalRow}>
                  <span className={styles.editGoalLabel}>Conversation goal:</span>
                  <input type="number" min={1} max={20} className={styles.goalInput}
                    value={config.tier2.convTarget}
                    onChange={e => updateConvTarget('tier2', parseInt(e.target.value) || 1)} />
                  <span className={styles.editGoalLabel}>per company</span>
                </div>
              )}
              <SortableTierGrid
                items={config.tier2.companies}
                renderItem={c => (
                  <PipelineCard name={c} stage={tier2[c] ?? EMPTY_STAGE}
                    convTarget={config.tier2.convTarget}
                    onAdjOut={d => adjStage('tier2', c, 'out', d, 99)}
                    onAdjConv={d => adjStage('tier2', c, 'conv', d, config.tier2.convTarget)} />
                )}
                renderOverlayItem={c => (
                  <PipelineCard name={c} stage={tier2[c] ?? EMPTY_STAGE}
                    convTarget={config.tier2.convTarget} onAdjOut={() => {}} onAdjConv={() => {}} />
                )}
                isEditing={isEditing}
                onRemove={c => removeCompany('tier2', c)}
                onReorder={companies => reorderTier('tier2', companies)}
                addSlot={<AddCard onAdd={name => addCompany('tier2', name)} />}
              />
            </section>
          )
        })()}

        {/* Tier 3 */}
        {(() => {
          const tier = 'tier3'
          const isEditing = editingTier === tier
          return (
            <section className={styles.section}>
              <SectionHead tier={tier} badgeClass={styles.badge3} title="Reach"
                note="One great conversation at each"
                doneCount={t3Done} totalCount={config.tier3.companies.length} />
              {isEditing && (
                <div className={styles.editGoalRow}>
                  <span className={styles.editGoalLabel}>Conversation goal:</span>
                  <input type="number" min={1} max={20} className={styles.goalInput}
                    value={config.tier3.convTarget}
                    onChange={e => updateConvTarget('tier3', parseInt(e.target.value) || 1)} />
                  <span className={styles.editGoalLabel}>per company</span>
                </div>
              )}
              <SortableTierGrid
                items={config.tier3.companies}
                renderItem={c => (
                  <PipelineCard name={c} stage={tier3[c] ?? EMPTY_STAGE}
                    convTarget={config.tier3.convTarget}
                    onAdjOut={d => adjStage('tier3', c, 'out', d, 99)}
                    onAdjConv={d => adjStage('tier3', c, 'conv', d, config.tier3.convTarget)} />
                )}
                renderOverlayItem={c => (
                  <PipelineCard name={c} stage={tier3[c] ?? EMPTY_STAGE}
                    convTarget={config.tier3.convTarget} onAdjOut={() => {}} onAdjConv={() => {}} />
                )}
                isEditing={isEditing}
                onRemove={c => removeCompany('tier3', c)}
                onReorder={companies => reorderTier('tier3', companies)}
                addSlot={<AddCard onAdd={name => addCompany('tier3', name)} />}
              />
            </section>
          )
        })()}

        {/* Consulting */}
        {(() => {
          const tier = 'consulting'
          const isEditing = editingTier === tier
          return (
            <section className={styles.section}>
              <SectionHead tier={tier} badgeClass={styles.badgeC} title="Management Consulting"
                note="3–5 consultants · 1 manager · 1 principal/partner per office"
                doneCount={cDone} totalCount={config.consulting.offices.length} />
              {(() => {
                  function renderOfficeCard(office: string, interactive: boolean) {
                    const e = consulting[office] ?? { ...EMPTY_ROLE }
                    const allDone = e.consultants.conv >= 3 && e.managers.conv >= 1 && e.principals.conv >= 1
                    const officeState = getCardState(
                      { out: e.consultants.out + e.managers.out + e.principals.out, conv: e.consultants.conv + e.managers.conv + e.principals.conv }, 5,
                    )
                    const officeCardClass = styles[CARD_CLS[allDone ? 'done' : officeState] as keyof typeof styles] ?? ''
                    return (
                      <div className={`${styles.card} ${officeCardClass}`}>
                        <span className={styles.cardName}>{office}</span>
                        <div className={styles.cRoles}>
                          {C_ROLE_DEFS.map(r => {
                            const stage = e[r.key] ?? EMPTY_STAGE
                            const rowDone = stage.conv >= r.convDoneAt
                            return (
                              <div key={r.key} className={styles.cRoleBlock}>
                                <div className={styles.cRoleHead}>
                                  <span className={`${styles.cRoleLabel} ${rowDone ? styles.cRoleDone : ''}`}>{r.label}</span>
                                  <Bar stage={stage} convTarget={r.convTarget} convDoneAt={r.convDoneAt} />
                                </div>
                                <div className={styles.cRolePipe}>
                                  <div className={styles.cRolePipeItem}>
                                    <span className={styles.cRolePipeTag}>out</span>
                                    <MiniCounter value={stage.out} max={99}
                                      onDec={interactive ? () => adjConsulting(office, r.key, 'out', -1, 99) : () => {}}
                                      onInc={interactive ? () => adjConsulting(office, r.key, 'out', 1, 99) : () => {}} />
                                  </div>
                                  <span className={styles.cRoleArrow}>→</span>
                                  <div className={styles.cRolePipeItem}>
                                    <span className={`${styles.cRolePipeTag} ${styles.cRolePipeTagConv}`}>conv</span>
                                    <MiniCounter value={stage.conv} max={r.convTarget} target={r.convTarget} showTarget
                                      onDec={interactive ? () => adjConsulting(office, r.key, 'conv', -1, r.convTarget) : () => {}}
                                      onInc={interactive ? () => adjConsulting(office, r.key, 'conv', 1, r.convTarget) : () => {}} />
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  }
                  return (
                    <SortableTierGrid
                      items={config.consulting.offices}
                      renderItem={office => renderOfficeCard(office, true)}
                      renderOverlayItem={office => renderOfficeCard(office, false)}
                      isEditing={isEditing}
                      onRemove={office => removeOffice(office)}
                      onReorder={offices => reorderOffices(offices)}
                      addSlot={<AddCard onAdd={name => addOffice(name)} />}
                      gridClass={styles.gridWide}
                    />
                  )
                })()}
            </section>
          )
        })()}

      </div>
    </div>
  )
}
