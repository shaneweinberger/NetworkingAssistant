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
  role_category: string | null
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
  due_date: string | null
  created_at: string
}

export interface EmailTemplate {
  id: string
  name: string
  category: string | null
  subject: string
  body: string
  created_at: string
  updated_at: string
}

export interface GmailCredentials {
  id: number
  email: string | null
  access_token: string | null
  refresh_token: string | null
  scope: string | null
  expires_at: string | null
  last_history_id: string | null
  connected_at: string
  updated_at: string
}

export interface EmailThread {
  id: string
  contact_id: string
  gmail_thread_id: string
  subject: string | null
  message_count: number
  last_message_at: string | null
  last_sent_at: string | null
  last_received_at: string | null
  last_draft_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
}

export interface IveyAlumnus {
  id: string
  linkedin_url: string
  full_name: string
  connection_degree: string | null
  headline: string | null
  location: string | null
  company: string | null
  industry: string | null
  job_title: string | null
  job_date_range: string | null
  created_at: string
}

export type EmailEventType = 'sent' | 'received' | 'draft_created' | 'follow_up_sent'

export interface EmailEvent {
  id: string
  contact_id: string
  thread_id: string | null
  gmail_message_id: string | null
  event_type: EmailEventType
  template_id: string | null
  subject: string | null
  occurred_at: string
}

export interface AppSettings {
  id: number
  follow_up_after_days: number
  reengage_after_days: number
  updated_at: string
}

export interface GmailIgnoredThread {
  gmail_thread_id: string
  seen_at: string
}
