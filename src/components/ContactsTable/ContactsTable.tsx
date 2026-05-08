import type { Contact } from '../../types/database'
import type { DropdownOption } from '../../lib/colors'
import Table, { type Column, type SortState } from '../Table/Table'
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
  { key: 'status',    label: 'Status',    width: 120, sortable: true, filterable: true, type: 'dropdown', options: [
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
  newContactId: string | null
}

export default function ContactsTable({
  contacts, columns, onColumnsChange,
  sort, onSortChange, filters, onFilterChange,
  onUpdate, onDelete, onAdd, newContactId,
}: Props) {
  const visibleColumns = columns.filter(c => c.visible)
  const hiddenColumns = columns.filter(c => !c.visible)

  const handleVisibleColumnsChange = (newVisible: Column<ContactColKey>[]) => {
    // Table only sees visible columns; merge their new order/widths back with hidden ones at the end.
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
        trailingWidth={36}
      >
        <tbody>
          {contacts.length === 0 && (
            <tr>
              <td colSpan={visibleColumns.length + 1} className={styles.emptyRow}>
                No contacts
              </td>
            </tr>
          )}
          {contacts.map(contact => (
            <tr key={contact.id} className={styles.row}>
              {visibleColumns.map(col => (
                <td key={col.key} className={styles.cell}>
                  {renderCell(col, contact, onUpdate, contact.id === newContactId && col.key === 'name')}
                </td>
              ))}
              <td className={styles.actionCell}>
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
              </td>
            </tr>
          ))}
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
) {
  const raw = contact[col.key]
  const value = typeof raw === 'string' ? raw : ''

  // Special-case columns that have unique rendering regardless of type.
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
