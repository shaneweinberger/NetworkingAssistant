// Standalone script to validate the classifier prompt against the fixture set.
//
// Requires: deno installed locally + ANTHROPIC_API_KEY in env.
// Run:
//   deno run -A scripts/test_classifier.ts
//
// Outputs accuracy + per-fixture verdict so you can see which ones the model
// got wrong and iterate the prompt.
//
// Note: in CI / when deno isn't available, the fixture file alone is the
// machine-readable ground truth. The build run does NOT execute this script.

import { FIXTURES } from '../supabase/functions/sync-and-extract/fixtures.ts'
import {
  classifierSystemPrompt,
  classifierUserPrompt,
} from '../supabase/functions/sync-and-extract/prompts.ts'

interface Result {
  in_scope: boolean
  category: string | null
  confidence: number
  reasoning: string
}

const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
if (!apiKey) {
  console.error('Missing ANTHROPIC_API_KEY')
  Deno.exit(1)
}

const MODEL = 'claude-haiku-4-5-20251001'
const sys = classifierSystemPrompt([
  { name: 'networking', description: 'Networking, alumni outreach, professional relationship building, coffee chats, intros, mentorship' },
  { name: 'recruiting', description: 'Recruiter outreach, job opportunities, interviews, offers, hiring conversations, internship discussions' },
])

let correct = 0
let total = 0
const wrong: string[] = []

for (const f of FIXTURES) {
  total++
  const userPrompt = classifierUserPrompt({ from: f.from, to: f.to, subject: f.subject, snippet: f.snippet })
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      temperature: 0,
      system: sys,
      messages: [{ role: 'user', content: userPrompt + '\n\nRespond with valid JSON only, no preamble or trailing commentary.' }],
    }),
  })
  if (!res.ok) {
    console.error('API error', res.status, await res.text())
    Deno.exit(1)
  }
  const json = await res.json() as { content: Array<{ text: string }> }
  const text = json.content.map(c => c.text).join('').trim()
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```$/)
  const candidate = fence ? fence[1].trim() : text
  let r: Result
  try {
    r = JSON.parse(candidate)
  } catch {
    console.log(`${f.id}: PARSE_ERR ${text.slice(0, 100)}`)
    wrong.push(f.id)
    continue
  }
  const ok = r.in_scope === f.expected_in_scope
  if (ok) correct++
  else wrong.push(`${f.id} (expected ${f.expected_in_scope}, got ${r.in_scope}; reason: ${r.reasoning})`)
  console.log(`${ok ? 'OK ' : 'XX '} ${f.id} -> in_scope=${r.in_scope} cat=${r.category} (${r.reasoning})`)
}

const pct = (correct / total * 100).toFixed(1)
console.log(`\nAccuracy: ${correct}/${total} = ${pct}%`)
if (wrong.length > 0) {
  console.log('\nMissed:')
  for (const w of wrong) console.log('  ' + w)
}
Deno.exit(correct / total >= 0.9 ? 0 : 1)
