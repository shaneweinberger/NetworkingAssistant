export interface Company {
  id: string
  name: string
  website: string | null
  category: string | null
  starred: boolean
  created_at: string
}

export interface Contact {
  id: string
  company_id: string
  name: string
  role: string | null
  email: string | null
  last_contact: string | null
  status: string
  location: string | null
  education: string | null
  linkedin: string | null
  notes: string | null
  created_at: string
}

export interface CompanyWithContacts extends Company {
  contacts: Contact[]
}

export interface Todo {
  id: string
  content: string
  done: boolean
  position: number
  created_at: string
}
