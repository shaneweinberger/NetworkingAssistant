import styles from './CategoryTabs.module.css'

export type CategoryFilter =
  | { type: 'all' }
  | { type: 'starred' }
  | { type: 'category'; name: string }

interface Props {
  categories: string[]
  counts: { all: number; starred: number; byCategory: Record<string, number> }
  value: CategoryFilter
  onChange: (filter: CategoryFilter) => void
}

function isActive(value: CategoryFilter, target: CategoryFilter): boolean {
  if (value.type !== target.type) return false
  if (value.type === 'category' && target.type === 'category') {
    return value.name === target.name
  }
  return true
}

export default function CategoryTabs({ categories, counts, value, onChange }: Props) {
  const renderTab = (
    target: CategoryFilter,
    label: React.ReactNode,
    count: number,
  ) => {
    const active = isActive(value, target)
    return (
      <button
        key={label?.toString()}
        type="button"
        className={`${styles.tab} ${active ? styles.tabActive : ''}`}
        onClick={() => onChange(target)}
        aria-pressed={active}
      >
        <span className={styles.tabLabel}>{label}</span>
        <span className={styles.tabCount}>{count}</span>
      </button>
    )
  }

  return (
    <div className={styles.bar} role="tablist" aria-label="Filter companies by category">
      {renderTab({ type: 'all' }, 'All', counts.all)}
      {renderTab(
        { type: 'starred' },
        <span className={styles.starredLabel}>
          <StarIcon filled />
          Starred
        </span>,
        counts.starred,
      )}
      {categories.length > 0 && <span className={styles.divider} aria-hidden />}
      {categories.map(cat =>
        renderTab({ type: 'category', name: cat }, cat, counts.byCategory[cat] ?? 0),
      )}
    </div>
  )
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill={filled ? 'currentColor' : 'none'}>
      <path
        d="M8 1.5l1.96 4.36 4.79.45-3.6 3.2 1.05 4.69L8 11.79l-4.2 2.41 1.05-4.69-3.6-3.2 4.79-.45L8 1.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}
