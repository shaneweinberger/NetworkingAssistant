import type { Contact, Company } from '../../types/database'

// Built-in placeholder keys that we know how to auto-fill from contact/company data.
// Anything not in this set is treated as a custom placeholder the user must fill.
export const BUILTIN_KEYS = ['name', 'first_name', 'company', 'role', 'school', 'email'] as const
export type BuiltinKey = typeof BUILTIN_KEYS[number]

const PLACEHOLDER_RE = /\[([a-z_][a-z0-9_]*)\]/gi

export interface ContactContext {
  contact: Pick<Contact, 'name' | 'role' | 'email' | 'education'>
  company: Pick<Company, 'name'>
}

export function autoFillFromContact(ctx: ContactContext): Record<string, string> {
  const fullName = ctx.contact.name?.trim() ?? ''
  const firstName = fullName.split(/\s+/)[0] ?? ''
  return {
    name: firstName || fullName,
    first_name: firstName,
    company: ctx.company.name ?? '',
    role: ctx.contact.role ?? '',
    school: ctx.contact.education ?? '',
    email: ctx.contact.email ?? '',
  }
}

/**
 * Finds all unique placeholders in a string, preserving order of first appearance.
 */
export function extractPlaceholders(...texts: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const text of texts) {
    const matches = text.matchAll(PLACEHOLDER_RE)
    for (const m of matches) {
      const key = m[1].toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        out.push(key)
      }
    }
  }
  return out
}

export function isBuiltin(key: string): key is BuiltinKey {
  return (BUILTIN_KEYS as readonly string[]).includes(key)
}

/**
 * Replaces [placeholder] tokens with values from `values`. Unknown or empty
 * placeholders are left untouched so the user can see what's still missing
 * in the preview.
 */
export function substitute(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (full, key: string) => {
    const v = values[key.toLowerCase()]
    return v && v.length > 0 ? v : full
  })
}

export function hasUnfilledPlaceholders(text: string): boolean {
  PLACEHOLDER_RE.lastIndex = 0
  return PLACEHOLDER_RE.test(text)
}
