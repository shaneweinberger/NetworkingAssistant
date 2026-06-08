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
  assistant_start_history_id: string | null
  assistant_started_at: string | null
  last_sync_at: string | null
  last_error: string | null
  last_error_at: string | null
  digest_recipient: string | null
  digest_timezone: string | null
}

export type ActionItemKind = 'reply_needed' | 'follow_up_due' | 'promise_kept' | 'chase_response' | 'review'
export type ActionItemStatus = 'open' | 'snoozed' | 'done' | 'dismissed'
export type Urgency = 'low' | 'med' | 'high'

export interface ActionItem {
  id: string
  kind: ActionItemKind
  status: ActionItemStatus
  urgency: Urgency
  contact_id: string | null
  gmail_thread_id: string | null
  gmail_message_id: string | null
  category: string | null
  summary: string
  detail: string | null
  due_at: string | null
  snooze_until: string | null
  auto_resolved: boolean
  dismissal_reason: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export interface AssistantCategory {
  id: string
  name: string
  description: string
  enabled: boolean
  created_at: string
}

export interface AssistantScopeRule {
  id: string
  rule_type: 'allow' | 'deny'
  match_type: 'email' | 'domain' | 'subject_contains'
  pattern: string
  source: 'user' | 'auto_learned'
  notes: string | null
  created_at: string
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
