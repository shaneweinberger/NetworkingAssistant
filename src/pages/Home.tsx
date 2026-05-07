import styles from './Home.module.css'

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Home</h1>
        <p className={styles.subtitle}>Welcome to your networking assistant.</p>
      </header>

      <div className={styles.grid}>
        <div className={styles.card}>
          <p className={styles.cardLabel}>Connections</p>
          <p className={styles.cardValue}>—</p>
        </div>
        <div className={styles.card}>
          <p className={styles.cardLabel}>Recent activity</p>
          <p className={styles.cardValue}>—</p>
        </div>
        <div className={styles.card}>
          <p className={styles.cardLabel}>Follow-ups due</p>
          <p className={styles.cardValue}>—</p>
        </div>
      </div>
    </div>
  )
}
