import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import path from 'path'
import os from 'os'

const GLOBAL_CLAUDE_MD = path.join(os.homedir(), '.claude', 'CLAUDE.md')
const SECTION_START = '<!-- teammind-persona:start -->'
const SECTION_END = '<!-- teammind-persona:end -->'

// ─── Explicit feedback signals ────────────────────────────────────────────────
// Things users directly say about how they want Claude to behave.

const EXPLICIT_SIGNALS: Array<[RegExp, string]> = [
  [
    /\b(too long|too verbose|too wordy|be (?:more )?(?:brief|concise|short)|keep it (?:short|brief|concise)|shorter)\b/gi,
    'Keep responses concise — avoid lengthy explanations',
  ],
  [
    /\b(stop (?:explaining|summariz\w*)|don'?t explain|skip (?:the )?explanation|no explanation)\b/gi,
    'Skip explanations unless explicitly asked',
  ],
  [
    /\b(don'?t summarize|no summary|skip (?:the )?summary|stop summariz\w*)\b/gi,
    'Do not add a summary at the end of responses',
  ],
  [
    /\b(just (?:show|write|give)(?: me)?(?: the)? code|show(?: the)? code (?:first|directly)|code first)\b/gi,
    'Show code directly rather than describing it first',
  ],
  [
    /\bjust do it\b|don'?t ask(?: me)?\b|without asking\b|stop asking\b/gi,
    'Take action directly — do not ask for confirmation on straightforward tasks',
  ],
  [
    /\buse bullet points?\b|format (?:it |this )?(?:as |with )?(?:bullets?|bullet points?)\b/gi,
    'Use bullet points for multi-item responses',
  ],
  [
    /\bdon'?t (?:add|use|put) (?:any )?emojis?\b|no emojis?\b/gi,
    'Do not use emojis',
  ],
  [
    /\bmore (?:detail|context|depth)\b|explain (?:more|further|in (?:more )?detail)\b/gi,
    'Provide more detail and context when explaining things',
  ],
]

// ─── Behavioral pattern analysis ─────────────────────────────────────────────
// Inferred from how the user naturally writes — no explicit feedback needed.

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

function analyzeBehavior(messages: string[]): string[] {
  if (messages.length < 3) return []

  const prefs: string[] = []

  // 1. Message length → response length preference
  const lengths = messages.map(wordCount)
  const median = lengths.slice().sort((a, b) => a - b)[Math.floor(lengths.length / 2)]
  if (median < 12) {
    prefs.push('User sends short, direct messages — keep responses concise and to the point')
  }

  // 2. Direct command style (messages that start with a verb or are imperative)
  const imperativeRx = /^(find|add|fix|make|show|write|build|change|update|remove|delete|get|run|check|use|go|create|give|just|do|push|test|read|try|look|tell|explain|help|stop|start|move|set|put|take|let|keep|turn|open|close|clean|refactor|rename|edit|search|fetch|deploy|install|enable|disable)\b/i
  const imperativeCount = messages.filter(m => imperativeRx.test(m.trim())).length
  if (imperativeCount / messages.length > 0.4) {
    prefs.push('User is action-oriented — lead with action, not discussion')
  }

  // 3. Correction/redirect pattern ("no", "actually", "wait", "i dont want", "not that")
  const correctionRx = /^(no\b|nope|not that|actually|wait|wrong|i don'?t want|i didn'?t|that'?s not|not what)/i
  const correctionCount = messages.filter(m => correctionRx.test(m.trim())).length
  if (correctionCount >= 2) {
    prefs.push('Pivot quickly when corrected — do not over-explain the mistake')
  }

  // 4. Casual/lowercase style (no capitalization, no punctuation)
  const lowercaseCount = messages.filter(m => m.length > 3 && m === m.toLowerCase()).length
  if (lowercaseCount / messages.length > 0.6) {
    prefs.push('User writes casually — match with a direct, informal tone')
  }

  // 5. "find more" / "more" as standalone → user scans quickly, wants more options not deeper dives
  const moreRx = /^(find more|more|give me more|show more|keep going|continue|next)\b/i
  const moreCount = messages.filter(m => moreRx.test(m.trim())).length
  if (moreCount >= 2) {
    prefs.push('User prefers breadth — when asked for more, provide new options rather than elaborating')
  }

  return prefs
}

// ─── Extraction ───────────────────────────────────────────────────────────────

function getUserMessages(transcript: string): string[] {
  const messages: string[] = []
  const rx = /\[USER\]:\s*/gi
  let m: RegExpExecArray | null

  while ((m = rx.exec(transcript)) !== null) {
    const start = m.index + m[0].length
    const rest = transcript.slice(start)
    const cutoff = rest.search(/\n\[(?:USER|HUMAN|ASSISTANT)\]:/i)
    const body = (cutoff > 0 ? rest.slice(0, cutoff) : rest).trim()
    // Skip tool output injections and very long messages (not real user turns)
    if (body.length > 5 && body.length < 500) messages.push(body)
  }

  return messages
}

export function extractPreferencesFromTranscripts(transcripts: string[]): string[] {
  const explicitCounts = new Map<string, number>()
  const allMessages: string[] = []

  for (const transcript of transcripts) {
    const userMessages = getUserMessages(transcript)
    allMessages.push(...userMessages)

    const seenInSession = new Set<string>()
    for (const msg of userMessages) {
      for (const [rx, pref] of EXPLICIT_SIGNALS) {
        rx.lastIndex = 0
        if (rx.test(msg) && !seenInSession.has(pref)) {
          seenInSession.add(pref)
          explicitCounts.set(pref, (explicitCounts.get(pref) || 0) + 1)
        }
      }
    }
  }

  const explicit = [...explicitCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([pref]) => pref)

  const behavioral = analyzeBehavior(allMessages)

  // Merge: explicit signals take priority, behavioral fills the rest up to 6 total
  const combined = [...explicit]
  for (const b of behavioral) {
    if (combined.length >= 6) break
    combined.push(b)
  }

  return combined
}

// ─── CLAUDE.md read / write / clear ──────────────────────────────────────────

export function readPersonaSection(): string | null {
  if (!existsSync(GLOBAL_CLAUDE_MD)) return null
  const content = readFileSync(GLOBAL_CLAUDE_MD, 'utf8')
  const start = content.indexOf(SECTION_START)
  const end = content.indexOf(SECTION_END)
  if (start === -1 || end === -1) return null
  return content.slice(start + SECTION_START.length, end).trim()
}

export function writePersonaSection(prefs: string[]): void {
  const section = [
    SECTION_START,
    '',
    '## User Interaction Preferences',
    '',
    ...prefs.map(p => `- ${p}`),
    '',
    SECTION_END,
  ].join('\n')

  mkdirSync(path.dirname(GLOBAL_CLAUDE_MD), { recursive: true })

  if (!existsSync(GLOBAL_CLAUDE_MD)) {
    writeFileSync(GLOBAL_CLAUDE_MD, section + '\n')
    return
  }

  const content = readFileSync(GLOBAL_CLAUDE_MD, 'utf8')
  const start = content.indexOf(SECTION_START)
  const end = content.indexOf(SECTION_END)

  if (start === -1 || end === -1) {
    writeFileSync(GLOBAL_CLAUDE_MD, content.trimEnd() + '\n\n' + section + '\n')
  } else {
    const before = content.slice(0, start)
    const after = content.slice(end + SECTION_END.length)
    writeFileSync(GLOBAL_CLAUDE_MD, before + section + after)
  }
}

export function clearPersonaSection(): void {
  if (!existsSync(GLOBAL_CLAUDE_MD)) return

  const content = readFileSync(GLOBAL_CLAUDE_MD, 'utf8')
  const start = content.indexOf(SECTION_START)
  const end = content.indexOf(SECTION_END)

  if (start === -1 || end === -1) return

  const before = content.slice(0, start).trimEnd()
  const after = content.slice(end + SECTION_END.length).trimStart()
  const result = [before, after].filter(Boolean).join('\n\n')
  writeFileSync(GLOBAL_CLAUDE_MD, result ? result + '\n' : '')
}

export { GLOBAL_CLAUDE_MD }
