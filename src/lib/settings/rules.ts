import { supabase } from '../supabase'
import type { AppSettings } from '../../types/database'

// Defaults match the values the status engine used historically, so behavior
// is unchanged if the app_settings row hasn't been seeded yet.
export const DEFAULT_FOLLOW_UP_AFTER_DAYS = 5
export const DEFAULT_REENGAGE_AFTER_DAYS = 14

export interface ThreadRules {
  followUpAfterDays: number
  reengageAfterDays: number
}

export const DEFAULT_RULES: ThreadRules = {
  followUpAfterDays: DEFAULT_FOLLOW_UP_AFTER_DAYS,
  reengageAfterDays: DEFAULT_REENGAGE_AFTER_DAYS,
}

export async function loadRules(): Promise<ThreadRules> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error || !data) return DEFAULT_RULES
  const row = data as AppSettings
  return {
    followUpAfterDays: row.follow_up_after_days,
    reengageAfterDays: row.reengage_after_days,
  }
}

export async function saveRules(rules: ThreadRules): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({
      id: 1,
      follow_up_after_days: rules.followUpAfterDays,
      reengage_after_days: rules.reengageAfterDays,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
  if (error) console.warn('Failed to save app settings:', error.message)
}
