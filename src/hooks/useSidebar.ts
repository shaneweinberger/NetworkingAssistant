import { useState, useCallback } from 'react'

const STORAGE_KEY = 'sidebar-collapsed'

function getInitialState(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function useSidebar() {
  const [collapsed, setCollapsed] = useState<boolean>(getInitialState)

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, String(next))
      } catch {
        // storage unavailable — carry on
      }
      return next
    })
  }, [])

  return { collapsed, toggle }
}
