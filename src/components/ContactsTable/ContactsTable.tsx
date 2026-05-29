import type { Contact, EmailThread } from '../../types/database'
import type { DropdownOption } from '../../lib/colors'
import { deriveForThread } from '../../lib/status/engine'
import Table, { type Column, type SortState } from '../Table/Table'
import { StatusBadge, ActionBadge } from '../StatusBadge/StatusBadge'
import DropdownCell from './DropdownCell'
import TextCell from './TextCell'
import LinkedInCell from './LinkedInCell'
import styles from './ContactsTable.module.css'

export type ContactColKey =
  | 'name' | 'role' | 'status' | 'location' | 'education' | 'linkedin' | 'email'

export type ColumnType = 'text' | 'dropdown'

export type ContactColumnConfig = Column<ContactColKey> & {
  type: ColumnType
  options: DropdownOption[]
  visible: boolean
}

/** Columns whose type can be toggled between text/dropdown in the settings modal. */
export const TYPE_TOGGLEABLE: ContactColKey[] = ['role', 'status', 'location', 'education']

export const DEFAULT_CONTACT_COLUMNS: ContactColumnConfig[] = [
  { key: 'name',      label: 'Name',      width: 200, sortable: true, filterable: true, type: 'text', options: [], visible: true },
  { key: 'role',      label: 'Role',      width: 160, sortable: true, filterable: true, type: 'text', options: [], visible: true },
  { key: 'status',    label: 'Status',    width: 180, sortable: true, filterable: true, type: 'dropdown', options: [
    { value: 'Sent', color: 'gray' },
    { value: 'Replied', color: 'green' },
    { value: 'No reply', color: 'orange' },
  ], visible: true },
  { key: 'location',  label: 'Location',  width: 140, sortable: true, filterable: true, type: 'text', options: [], visible: true },
  { key: 'education', label: 'Education', width: 160, sortable: true, filterable: true, type: 'text', options: [], visible: true },
  { key: 'linkedin',  label: 'LinkedIn',  width: 120, sortable: false, filterable: true, type: 'text', options: [], visible: true },
  { key: 'email',     label: 'Email',     width: 200, sortable: true, filterable: true, type: 'text', options: [], visible: true },
]

interface Props {
  contacts: Contact[]
  columns: ContactColumnConfig[]
  onColumnsChange: (cols: ContactColumnConfig[]) => void
  sort: SortState<ContactColKey>
  onSortChange: (sort: SortState<ContactColKey>) => void
  filters: Partial<Record<ContactColKey, string>>
  onFilterChange: (key: ContactColKey, value: string) => void
  onUpdate: (id: string, field: keyof Contact, value: string | null) => void
  onDelete: (contact: Contact) => void
  onAdd: () => void
  onSendEmail: (contact: Contact) => void
  threadsByContactId: Record<string, EmailThread>
  newContactId: string | null
}

export default function ContactsTable({
  contacts, columns, onColumnsChange,
  sort, onSortChange, filters, onFilterChange,
  onUpdate, onDelete, onAdd, onSendEmail, threadsByContactId, newContactId,
}: Props) {
  const visibleColumns = columns.filter(c => c.visible)
  const hiddenColumns = columns.filter(c => !c.visible)

  const handleVisibleColumnsChange = (newVisible: Column<ContactColKey>[]) => {
    onColumnsChange([...(newVisible as ContactColumnConfig[]), ...hiddenColumns])
  }

  return (
    <div className={styles.wrapper}>
      <Table
        columns={visibleColumns}
        onColumnsChange={handleVisibleColumnsChange}
        sort={sort}
        onSortChange={onSortChange}
        filters={filters}
        onFilterChange={onFilterChange}
        trailingWidth={72}
      >
        <tbody>
          {contacts.length === 0 && (
            <tr>
              <td colSpan={visibleColumns.length + 2} className={styles.emptyRow}>
                No contacts
              </td>
            </tr>
          )}
          {contacts.map(contact => {
            const thread = threadsByContactId[contact.id] ?? null
            const derived = deriveForThread(thread)
            return (
              <tr key={contact.id} className={styles.row}>
                {visibleColumns.map(col => (
                  <td key={col.key} className={styles.cell}>
                    {renderCell(col, contact, onUpdate, contact.id === newContactId && col.key === 'name', derived)}
                  </td>
                ))}
                <td className={styles.spacerCell} aria-hidden />
                <td className={styles.actionCell}>
                  <div className={styles.actionCellInner}>
                    <button
                      type="button"
                      className={styles.sendBtn}
                      onClick={() => onSendEmail(contact)}
                      aria-label="Send email"
                      title={derived.action.label}
                    >
                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                        <path
                          d="M1.5 2L12.5 7L1.5 12L3 7L1.5 2Z"
                          stroke="currentColor"
                          strokeWidth="1.25"
                          strokeLinejoin="round"
                          fill="none"
                        />
                        <path d="M3 7L8 7" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      onClick={() => onDelete(contact)}
                      aria-label="Delete contact"
                    >
                      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
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
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <div className={styles.footer}>
        <button type="button" className={styles.addButton} onClick={onAdd}>
          + Add contact
        </button>
      </div>
    </div>
  )
}

function renderCell(
  col: ContactColumnConfig,
  contact: Contact,
  onUpdate: (id: string, field: keyof Contact, value: string | null) => void,
  autoFocus: boolean,
  derived: ReturnType<typeof deriveForThread>,
) {
  const raw = contact[col.key]
  const value = typeof raw === 'string' ? raw : ''

  // The status column is the hub for outreach state. When we have a tracked
  // email thread, the Gmail-derived status replaces the manual dropdown.
  // Either way, we surface the derived action item directly beneath so the
  // user always sees what to do next.
  if (col.key === 'status') {
    const showDerivedStatus = derived.status.kind !== 'not_contacted'
    const showAction = derived.action.kind !== 'wait' && derived.action.kind !== 'none'

    if (showDerivedStatus) {
      // Both status + action stacked, with our own padding (no inner controls)
      return (
        <div className={styles.derivedStatusCell}>
          <StatusBadge status={derived.status} />
          {showAction && <ActionBadge action={derived.action} />}
        </div>
      )
    }

    // No thread yet — keep the manual dropdown/text and append the
    // suggested action beneath without disturbing the existing layout.
    const baseCtl = col.type === 'dropdown'
      ? <DropdownCell value={value} options={col.options} onChange={v => onUpdate(contact.id, 'status', v || null)} />
      : <TextCell value={value} placeholder={col.label} muted onCommit={v => onUpdate(contact.id, 'status', v || null)} />

    if (!showAction) return baseCtl

    return (
      <div className={styles.statusWithActionCell}>
        {baseCtl}
        <div className={styles.statusWithActionAction}>
          <ActionBadge action={derived.action} />
        </div>
      </div>
    )
  }

  if (col.key === 'linkedin') {
    return <LinkedInCell value={value} onCommit={v => onUpdate(contact.id, 'linkedin', v || null)} />
  }
  if (col.key === 'name') {
    return (
      <TextCell
        value={value}
        placeholder={col.label}
        autoFocus={autoFocus}
        bold
        onCommit={v => onUpdate(contact.id, 'name', v)}
      />
    )
  }

  if (col.type === 'dropdown') {
    return (
      <DropdownCell
        value={value}
        options={col.options}
        onChange={v => onUpdate(contact.id, col.key, v || null)}
      />
    )
  }

  return (
    <TextCell
      value={value}
      placeholder={col.label}
      muted
      onCommit={v => onUpdate(contact.id, col.key, v || null)}
    />
  )
}
