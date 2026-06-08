// Hard allowlist + denylist evaluation. Runs before any LLM call.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

export interface ScopeRule {
  rule_type: 'allow' | 'deny'
  match_type: 'email' | 'domain' | 'subject_contains'
  pattern: string
}

export interface ScopeDecision {
  decided: boolean
  in_scope?: boolean
  source: 'rule_allow' | 'rule_deny' | 'undecided'
  matched_pattern?: string
}

export async function loadScopeRules(db: SupabaseClient): Promise<ScopeRule[]> {
  const { data, error } = await db.from('assistant_scope_rules').select('rule_type, match_type, pattern')
  if (error) {
    console.warn('Failed to load scope rules:', error.message)
    return []
  }
  return (data as ScopeRule[]) ?? []
}

export async function loadKnownContactEmails(db: SupabaseClient): Promise<Set<string>> {
  const out = new Set<string>()
  // From contacts
  const c = await db.from('contacts').select('email').not('email', 'is', null)
  for (const row of (c.data as Array<{ email: string }> | null) ?? []) {
    if (row.email) out.add(row.email.toLowerCase())
  }
  return out
}

export function evaluateScope(
  msg: { from: string | null; subject: string | null },
  rules: ScopeRule[],
  knownContactEmails: Set<string>,
): ScopeDecision {
  const fromLower = (msg.from ?? '').toLowerCase()
  const subjectLower = (msg.subject ?? '').toLowerCase()

  // Deny first — explicit user denylist beats everything except CRM contact emails.
  for (const r of rules) {
    if (r.rule_type !== 'deny') continue
    if (matches(r, fromLower, subjectLower)) {
      // Exception: if sender is a known CRM contact, allow even if there's a generic deny rule.
      const senderEmail = extractEmail(fromLower)
      if (senderEmail && knownContactEmails.has(senderEmail)) {
        return { decided: true, in_scope: true, source: 'rule_allow', matched_pattern: 'known_contact' }
      }
      return { decided: true, in_scope: false, source: 'rule_deny', matched_pattern: r.pattern }
    }
  }

  // Allow
  for (const r of rules) {
    if (r.rule_type !== 'allow') continue
    if (matches(r, fromLower, subjectLower)) {
      return { decided: true, in_scope: true, source: 'rule_allow', matched_pattern: r.pattern }
    }
  }

  // CRM contacts are auto-in-scope
  const senderEmail = extractEmail(fromLower)
  if (senderEmail && knownContactEmails.has(senderEmail)) {
    return { decided: true, in_scope: true, source: 'rule_allow', matched_pattern: 'known_contact' }
  }

  return { decided: false, source: 'undecided' }
}

function matches(rule: ScopeRule, fromLower: string, subjectLower: string): boolean {
  switch (rule.match_type) {
    case 'email':
      return fromLower.includes(rule.pattern.toLowerCase())
    case 'domain':
      return fromLower.includes('@' + rule.pattern.toLowerCase()) || fromLower.endsWith(rule.pattern.toLowerCase())
    case 'subject_contains':
      return subjectLower.includes(rule.pattern.toLowerCase())
  }
}

function extractEmail(from: string): string | null {
  const angle = from.match(/<([^>]+)>/)
  if (angle) return angle[1].toLowerCase()
  if (from.includes('@')) return from.toLowerCase().trim()
  return null
}
