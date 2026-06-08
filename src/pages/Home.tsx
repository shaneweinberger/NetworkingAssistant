import TodoList from '../components/TodoList/TodoList'
import DonnaWidget from '../components/DonnaWidget/DonnaWidget'
import styles from './Home.module.css'

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Home</h1>
        <p className={styles.subtitle}>Welcome to your networking assistant.</p>
      </header>

      <div className={styles.donnaSection}>
        <DonnaWidget />
      </div>

      <div className={styles.todoSection}>
        <TodoList />
      </div>
    </div>
  )
}
