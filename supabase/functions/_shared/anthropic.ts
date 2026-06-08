// Minimal Anthropic Messages API wrapper for Donna.
// Logs each call to assistant_runs so cost/error patterns are visible.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

// Pricing per million tokens, in USD. Update as Anthropic publishes new tiers.
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-opus-4-7': { input: 15.00, output: 75.00 },
}

export const HAIKU = 'claude-haiku-4-5-20251001'

interface AnthropicResponse {
  id: string
  content: Array<{ type: 'text'; text: string }>
  model: string
  usage: { input_tokens: number; output_tokens: number }
  stop_reason: string
}

export interface CallOptions {
  model?: string
  system?: string
  user: string
  maxTokens?: number
  temperature?: number
  jsonMode?: boolean
  runType: string
  metadata?: Record<string, unknown>
}

export async function callClaude(
  db: SupabaseClient,
  opts: CallOptions,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY')
  const model = opts.model ?? HAIKU
  const started = Date.now()
  const userMessage = opts.jsonMode
    ? opts.user + '\n\nRespond with valid JSON only, no preamble or trailing commentary.'
    : opts.user

  const payload: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 1024,
    messages: [{ role: 'user', content: userMessage }],
  }
  if (opts.system) payload.system = opts.system
  if (opts.temperature !== undefined) payload.temperature = opts.temperature

  let response: AnthropicResponse | null = null
  let errorMessage: string | null = null
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const text = await res.text()
      errorMessage = `Anthropic ${res.status}: ${text.slice(0, 500)}`
      throw new Error(errorMessage)
    }
    response = await res.json() as AnthropicResponse
  } catch (err) {
    errorMessage ??= (err as Error).message
    await logRun(db, opts.runType, model, 0, 0, Date.now() - started, false, errorMessage, opts.metadata)
    throw err
  }

  const { input_tokens, output_tokens } = response.usage
  const cost = priceFor(model, input_tokens, output_tokens)
  await logRun(db, opts.runType, model, input_tokens, output_tokens, Date.now() - started, true, null, opts.metadata, cost)

  const text = response.content.map((c) => c.text).join('')
  return { text, inputTokens: input_tokens, outputTokens: output_tokens }
}

function priceFor(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model]
  if (!p) return 0
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output
}

async function logRun(
  db: SupabaseClient,
  runType: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  durationMs: number,
  ok: boolean,
  error: string | null,
  metadata?: Record<string, unknown>,
  costUsd?: number,
) {
  try {
    await db.from('assistant_runs').insert({
      run_type: runType,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd ?? 0,
      duration_ms: durationMs,
      ok,
      error,
      metadata: metadata ?? null,
    })
  } catch {
    // best-effort logging
  }
}

/**
 * Extract a JSON object from Claude's response. Handles cases where the model
 * wraps the JSON in code fences despite our instructions.
 */
export function parseJson<T>(text: string): T {
  const trimmed = text.trim()
  // Strip code fences
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/)
  const candidate = fence ? fence[1].trim() : trimmed
  return JSON.parse(candidate) as T
}
