import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import path from 'path'
import os from 'os'

const GLOBAL_CLAUDE_MD = path.join(os.homedir(), '.claude', 'CLAUDE.md')
const SECTION_START = '<!-- teammind-persona:start -->'
const SECTION_END = '<!-- teammind-persona:end -->'

// Signals detected in USER messages → normalized preference strings.
// These are strictly about communication/interaction style — never coding style.
const PREFERENCE_SIGNALS: Array<[RegExp, string]> = [
  [
    /\b(too long|too verbose|too wordy|be (?:more )?(?:brief|concise|short)|keep it (?:short|brief|concise)|shorter (?:please)?)\b/gi,
    'Keep responses concise — avoid lengthy explanations',
  ],
  [
    /\b(stop (?:explaining|summariz\w*)|don'?t explain|skip (?:the )?explanations?|no explanations?)\b/gi,
    'Skip explanations unless explicitly asked',
  ],
  [
    /\b(don'?t summarize|no summary|skip (?:the )?summary|stop summariz\w*|don'?t add a summary)\b/gi,
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

function getUserMessages(transcript: string): string[] {
  const messages: string[] = []
  const rx = /\[USER\]:\s*/gi
  let m: RegExpExecArray | null

  while ((m = rx.exec(transcript)) !== null) {
    const start = m.index + m[0].length
    const rest = transcript.slice(start)
    const cutoff = rest.search(/\n\[(?:USER|HUMAN|ASSISTANT)\]:/i)
    const body = (cutoff > 0 ? rest.slice(0, cutoff) : rest).trim()
    if (body.length > 5) messages.push(body)
  }

  return messages
}

export function extractPreferencesFromTranscripts(transcripts: string[]): string[] {
  // Count how many sessions each preference appeared in
  const prefCounts = new Map<string, number>()

  for (const transcript of transcripts) {
    const userMessages = getUserMessages(transcript)
    const seenInSession = new Set<string>()

    for (const msg of userMessages) {
      for (const [rx, pref] of PREFERENCE_SIGNALS) {
        rx.lastIndex = 0
        if (rx.test(msg) && !seenInSession.has(pref)) {
          seenInSession.add(pref)
          prefCounts.set(pref, (prefCounts.get(pref) || 0) + 1)
        }
      }
    }
  }

  return [...prefCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([pref]) => pref)
}

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
    // Append our section, preserving everything else
    writeFileSync(GLOBAL_CLAUDE_MD, content.trimEnd() + '\n\n' + section + '\n')
  } else {
    // Replace only our section — never touch anything outside the markers
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
