import styles from './List.module.css'

export default function List() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>List</h1>
          <p className={styles.subtitle}>Manage your contacts and connections.</p>
        </div>
        <button className={styles.addButton} type="button">
          Add entry
        </button>
      </header>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Company</th>
              <th>Last contact</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr className={styles.emptyRow}>
              <td colSpan={5}>
                <span className={styles.emptyText}>No entries yet.</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
