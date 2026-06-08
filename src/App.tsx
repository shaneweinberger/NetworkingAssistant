import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Home from './pages/Home'
import Contacts from './pages/Contacts'
import IveyAlumni from './pages/IveyAlumni'
import Templates from './pages/Templates'
import Settings from './pages/Settings'
import GmailCallback from './pages/GmailCallback'

export default function App() {
  return (
    <Routes>
      {/* Rendered inside the OAuth popup — no layout or auth gate needed */}
      <Route path="/auth/gmail/callback" element={<GmailCallback />} />
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Home />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/alumni" element={<IveyAlumni />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
