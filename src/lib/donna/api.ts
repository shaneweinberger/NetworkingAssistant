import { supabase } from '../supabase'
import type {
  ActionItem,
  AssistantCategory,
  AssistantScopeRule,
} from '../../types/database'

const FUNCTIONS_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) + '/functions/v1'
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export async function loadOpenActionItems(): Promise<ActionItem[]> {
  const { data, error } = await supabase
    .from('assistant_action_items')
    .select('*')
    .in('status', ['open', 'snoozed'])
    .order('urgency', { ascending: false })
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(200)
  if (error) {
    console.warn('loadOpenActionItems:', error.message)
    return []
  }
  return (data as ActionItem[]) ?? []
}

export async function loadCategories(): Promise<AssistantCategory[]> {
  const { data, error } = await supabase
    .from('assistant_categories')
    .select('*')
    .order('name', { ascending: true })
  if (error) {
    console.warn('loadCategories:', error.message)
    return []
  }
  return (data as AssistantCategory[]) ?? []
}

export async function toggleCategory(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('assistant_categories').update({ enabled }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function loadScopeRules(): Promise<AssistantScopeRule[]> {
  const { data, error } = await supabase
    .from('assistant_scope_rules')
    .select('*')
    .order('rule_type', { ascending: true })
    .order('pattern', { ascending: true })
  if (error) {
    console.warn('loadScopeRules:', error.message)
    return []
  }
  return (data as AssistantScopeRule[]) ?? []
}

export async function addScopeRule(rule: Omit<AssistantScopeRule, 'id' | 'created_at' | 'source'> & { source?: 'user' | 'auto_learned' }): Promise<AssistantScopeRule> {
  const { data, error } = await supabase
    .from('assistant_scope_rules')
    .insert({ ...rule, source: rule.source ?? 'user' })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as AssistantScopeRule
}

export async function deleteScopeRule(id: string): Promise<void> {
  const { error } = await supabase.from('assistant_scope_rules').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

type ActionType = 'snooze' | 'dismiss' | 'done' | 'reopen'

interface ActionArgs {
  action: ActionType
  item_id: string
  snooze_days?: number
  dismissal_reason?: string
}

async function callAction(args: ActionArgs): Promise<void> {
  const res = await fetch(`${FUNCTIONS_URL}/donna-action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify(args),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`donna-action ${res.status}: ${text.slice(0, 200)}`)
  }
}

export async function markActionDone(id: string): Promise<void> {
  await callAction({ action: 'done', item_id: id })
}

export async function snoozeAction(id: string, days: number): Promise<void> {
  await callAction({ action: 'snooze', item_id: id, snooze_days: days })
}

export async function dismissAction(id: string, reason?: string): Promise<void> {
  await callAction({ action: 'dismiss', item_id: id, dismissal_reason: reason })
}

export interface DonnaStatus {
  connected: boolean
  hasRefreshToken: boolean
  lastSyncAt: string | null
  lastError: string | null
  digestRecipient: string | null
  digestTimezone: string | null
  email: string | null
  assistantStartedAt: string | null
}

export async function loadDonnaStatus(): Promise<DonnaStatus> {
  const { data, error } = await supabase
    .from('gmail_credentials')
    .select('email, refresh_token, last_sync_at, last_error, digest_recipient, digest_timezone, assistant_started_at, access_token')
    .eq('id', 1)
    .maybeSingle()
  if (error || !data) {
    return {
      connected: false,
      hasRefreshToken: false,
      lastSyncAt: null,
      lastError: null,
      digestRecipient: null,
      digestTimezone: null,
      email: null,
      assistantStartedAt: null,
    }
  }
  return {
    connected: Boolean((data as { access_token: string | null }).access_token),
    hasRefreshToken: Boolean((data as { refresh_token: string | null }).refresh_token),
    lastSyncAt: (data as { last_sync_at: string | null }).last_sync_at,
    lastError: (data as { last_error: string | null }).last_error,
    digestRecipient: (data as { digest_recipient: string | null }).digest_recipient,
    digestTimezone: (data as { digest_timezone: string | null }).digest_timezone,
    email: (data as { email: string | null }).email,
    assistantStartedAt: (data as { assistant_started_at: string | null }).assistant_started_at,
  }
}

export function buildOfflineOAuthUrl(returnUrl: string): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/gmail-oauth-offline'
  const params = new URLSearchParams({ action: 'start', return: returnUrl })
  return `${base}?${params.toString()}`
}
