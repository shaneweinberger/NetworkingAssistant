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

const TemplatesIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
    <path d="M2.5 6.5H13.5M5.5 6.5V13.5" stroke="currentColor" strokeWidth="1.25" />
  </svg>
)

const AlumniIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M8 2L1.5 5L8 8L14.5 5L8 2Z"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
    />
    <path
      d="M4 6.75V10.5C4 10.5 5.5 12 8 12C10.5 12 12 10.5 12 10.5V6.75"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
    />
    <path d="M14.5 5V8.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
  </svg>
)

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.25" />
    <path
      d="M8 1.5v1.5M8 13v1.5M14.5 8h-1.5M3 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    />
  </svg>
)

const NAV_ITEMS: NavItem[] = [
  { label: 'Home', path: '/home', icon: <HomeIcon /> },
  { label: 'Contacts', path: '/contacts', icon: <ListIcon /> },
  { label: 'Ivey Alumni', path: '/alumni', icon: <AlumniIcon /> },
  { label: 'Templates', path: '/templates', icon: <TemplatesIcon /> },
  { label: 'Settings', path: '/settings', icon: <SettingsIcon /> },
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
