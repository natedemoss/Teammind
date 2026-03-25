import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'
import { TEAMMIND_DIR } from './constants'

const CONFIG_PATH = path.join(TEAMMIND_DIR, 'config.json')

export interface TeamMindConfig {
  anthropic_api_key?: string
  max_inject: number
  extraction_enabled: boolean
  similarity_threshold: number  // cosine threshold for dedup (0.0–1.0)
}

const DEFAULTS: TeamMindConfig = {
  max_inject: 10,
  extraction_enabled: true,
  similarity_threshold: 0.88,
}

export function loadConfig(): TeamMindConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveConfig(config: Partial<TeamMindConfig>) {
  const current = loadConfig()
  const updated = { ...current, ...config }
  writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2))
}

export function getApiKey(): string | undefined {
  return loadConfig().anthropic_api_key || process.env.ANTHROPIC_API_KEY
}

// Type-coerce string values from CLI to correct types
export function coerceConfigValue(key: string, value: string): any {
  if (key === 'max_inject') return parseInt(value)
  if (key === 'extraction_enabled') return value === 'true' || value === '1'
  if (key === 'similarity_threshold') return parseFloat(value)
  return value
}

export const VALID_KEYS = [
  'ANTHROPIC_API_KEY',
  'max_inject',
  'extraction_enabled',
  'similarity_threshold',
] as const
