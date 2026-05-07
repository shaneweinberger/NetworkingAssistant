import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useSidebar } from '../../hooks/useSidebar'
import type { NavItem } from '../../types/nav'
import styles from './Layout.module.css'

const HomeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M2 6.5L8 2L14 6.5V14H10V10H6V14H2V6.5Z"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
    />
  </svg>
)

const ListIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M3 4H13M3 8H13M3 12H9"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    />
  </svg>
)

const NAV_ITEMS: NavItem[] = [
  { label: 'Home', path: '/home', icon: <HomeIcon /> },
  { label: 'List', path: '/list', icon: <ListIcon /> },
]

export default function Layout() {
  const { collapsed, toggle } = useSidebar()

  return (
    <div className={styles.shell}>
      <Sidebar collapsed={collapsed} onToggle={toggle} navItems={NAV_ITEMS} />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
