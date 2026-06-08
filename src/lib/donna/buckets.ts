import type { ActionItem } from '../../types/database'

export interface Bucket {
  label: 'Today' | 'Tomorrow' | 'This week' | 'Upcoming'
  items: ActionItem[]
}

export function bucketize(items: ActionItem[]): Bucket[] {
  const now = new Date()
  const startToday = startOfDay(now)
  const startTomorrow = addDays(startToday, 1)
  const startDayAfter = addDays(startToday, 2)
  const startWeekEnd = addDays(startToday, 7)

  const today: ActionItem[] = []
  const tomorrow: ActionItem[] = []
  const thisWeek: ActionItem[] = []
  const upcoming: ActionItem[] = []

  for (const it of items) {
    if (it.status === 'snoozed' && it.snooze_until && new Date(it.snooze_until).getTime() > Date.now()) {
      upcoming.push(it)
      continue
    }
    const due = it.due_at ? new Date(it.due_at) : new Date(it.created_at)
    const ts = due.getTime()
    if (it.urgency === 'high' || ts < startTomorrow.getTime()) today.push(it)
    else if (ts < startDayAfter.getTime()) tomorrow.push(it)
    else if (ts < startWeekEnd.getTime()) thisWeek.push(it)
    else upcoming.push(it)
  }
  return [
    { label: 'Today', items: today },
    { label: 'Tomorrow', items: tomorrow },
    { label: 'This week', items: thisWeek },
    { label: 'Upcoming', items: upcoming },
  ]
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000)
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case 'reply_needed': return 'Reply'
    case 'follow_up_due': return 'Follow up'
    case 'chase_response': return 'Re-engage'
    case 'promise_kept': return 'Deliver'
    case 'review': return 'Review'
    default: return kind
  }
}
