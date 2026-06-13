import type { EmailThread } from '../../types/database'
import { DEFAULT_RULES, type ThreadRules } from '../settings/rules'

// Legacy exports kept so any external references continue to compile. The
// authoritative numbers now live on the ThreadRules object loaded at runtime
// from app_settings; these are only the fallback defaults.
export const FOLLOW_UP_AFTER_DAYS = DEFAULT_RULES.followUpAfterDays
export const REENGAGE_AFTER_DAYS = DEFAULT_RULES.reengageAfterDays

export type StatusKind =
  | 'not_contacted'
  | 'sent'
  | 'no_reply'
  | 'replied'
  | 'active'
  | 'stale'

export interface DerivedStatus {
  kind: StatusKind
  label: string
  tone: 'gray' | 'blue' | 'green' | 'orange' | 'red' | 'yellow'
}

export type ActionKind =
  | 'send_first'
  | 'send_follow_up'
  | 'reply'
  | 'reengage'
  | 'wait'
  | 'none'

export interface DerivedAction {
  kind: ActionKind
  label: string
  tone: 'gray' | 'blue' | 'green' | 'orange' | 'red' | 'yellow'
}

function daysBetween(then: number, now: number): number {
  return Math.floor((now - then) / (1000 * 60 * 60 * 24))
}

function hoursBetween(then: number, now: number): number {
  return Math.floor((now - then) / (1000 * 60 * 60))
}

function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const days = daysBetween(then, now)
  if (days === 0) {
    const hours = hoursBetween(then, now)
    if (hours <= 0) return 'just now'
    if (hours === 1) return '1 hour ago'
    return `${hours} hours ago`
  }
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) {
    const weeks = Math.floor(days / 7)
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`
  }
  const months = Math.floor(days / 30)
  return months === 1 ? '1 month ago' : `${months} months ago`
}

export function deriveStatus(
  thread: EmailThread | null,
  rules: ThreadRules = DEFAULT_RULES,
  now: number = Date.now(),
): DerivedStatus {
  if (!thread) {
    return { kind: 'not_contacted', label: 'Not contacted', tone: 'gray' }
  }

  const lastSent = thread.last_sent_at ? new Date(thread.last_sent_at).getTime() : null
  const lastRecv = thread.last_received_at ? new Date(thread.last_received_at).getTime() : null

  if (lastRecv && (!lastSent || lastRecv > lastSent)) {
    return { kind: 'replied', label: `Responded ${relativeTime(thread.last_received_at, now)}`, tone: 'green' }
  }

  if (lastSent) {
    const sentDaysAgo = daysBetween(lastSent, now)
    const everReceived = Boolean(lastRecv)

    if (everReceived && thread.message_count > 2) {
      if (sentDaysAgo >= rules.reengageAfterDays) {
        return { kind: 'stale', label: `Stale (${relativeTime(thread.last_message_at, now)})`, tone: 'orange' }
      }
      return { kind: 'active', label: `Active conversation`, tone: 'blue' }
    }

    if (sentDaysAgo >= rules.followUpAfterDays) {
      return { kind: 'no_reply', label: `No reply (${relativeTime(thread.last_sent_at, now)})`, tone: 'orange' }
    }
    return { kind: 'sent', label: `Sent ${relativeTime(thread.last_sent_at, now)}`, tone: 'blue' }
  }

  return { kind: 'not_contacted', label: 'Not contacted', tone: 'gray' }
}

export function deriveAction(
  thread: EmailThread | null,
  rules: ThreadRules = DEFAULT_RULES,
  now: number = Date.now(),
): DerivedAction {
  if (!thread) {
    return { kind: 'send_first', label: 'Send first email', tone: 'blue' }
  }

  const lastSent = thread.last_sent_at ? new Date(thread.last_sent_at).getTime() : null
  const lastRecv = thread.last_received_at ? new Date(thread.last_received_at).getTime() : null

  if (lastRecv && (!lastSent || lastRecv > lastSent)) {
    if (daysBetween(lastRecv, now) >= rules.reengageAfterDays) {
      return { kind: 'reengage', label: 'Re-engage', tone: 'orange' }
    }
    return { kind: 'reply', label: 'Reply to message', tone: 'green' }
  }

  if (lastSent) {
    const sentDaysAgo = daysBetween(lastSent, now)
    if (sentDaysAgo >= rules.reengageAfterDays) {
      return { kind: 'reengage', label: 'Re-engage', tone: 'orange' }
    }
    if (sentDaysAgo >= rules.followUpAfterDays) {
      return { kind: 'send_follow_up', label: 'Send follow-up', tone: 'orange' }
    }
    return { kind: 'wait', label: 'Waiting for reply', tone: 'gray' }
  }

  return { kind: 'send_first', label: 'Send first email', tone: 'blue' }
}

export function deriveForThread(
  thread: EmailThread | null,
  rules: ThreadRules = DEFAULT_RULES,
  now: number = Date.now(),
) {
  return {
    status: deriveStatus(thread, rules, now),
    action: deriveAction(thread, rules, now),
  }
}
