import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'
import { getMemories, saveMemory, saveMemoryFiles, Memory } from './db'
import { embed, serializeVec } from './embed'

export interface TeamMemoryExport {
  version: '1.0'
  exported_at: string
  memories: Array<{
    id: string
    content: string
    summary: string
    tags: string[]
    file_paths: string[]
    functions: string[]
    git_commit: string | null
    git_branch: string | null
    created_by: string
    created_at: string
  }>
}

// Strip anything that looks like a secret
const SECRET_PATTERNS = [
  /\b[A-Za-z0-9_-]{20,}\b/g,          // Long random tokens
  /(?:api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*\S+/gi,
  /sk-[A-Za-z0-9]{32,}/g,             // OpenAI-style keys
  /ghp_[A-Za-z0-9]{36}/g,             // GitHub tokens
  /Bearer\s+[A-Za-z0-9._-]+/gi,
]

function scrubSecrets(text: string): string {
  let out = text
  // Only scrub if the token looks suspicious (in a key=value context)
  out = out.replace(/(?:api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*\S+/gi, '[REDACTED]')
  out = out.replace(/sk-[A-Za-z0-9]{32,}/g, '[REDACTED]')
  out = out.replace(/ghp_[A-Za-z0-9]{36}/g, '[REDACTED]')
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [REDACTED]')
  return out
}

export function exportMemories(repoPath: string): TeamMemoryExport {
  const memories = getMemories(repoPath, { limit: 1000, includeStale: false })

  return {
    version: '1.0',
    exported_at: new Date().toISOString(),
    memories: memories.map(m => ({
      id: m.id,
      content: scrubSecrets(m.content),
      summary: scrubSecrets(m.summary),
      tags: m.tags,
      file_paths: m.file_paths,
      functions: m.functions,
      git_commit: m.git_commit,
      git_branch: m.git_branch,
      created_by: m.created_by,
      created_at: new Date(m.created_at).toISOString(),
    }))
  }
}

export async function importMemories(
  filePath: string,
  repoPath: string,
  createdBy = 'teammate'
): Promise<{ imported: number; skipped: number }> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as TeamMemoryExport

  if (raw.version !== '1.0' || !Array.isArray(raw.memories)) {
    throw new Error('Invalid team memory file format')
  }

  let imported = 0
  let skipped = 0

  for (const m of raw.memories) {
    if (!m.content || !m.summary) { skipped++; continue }

    // Embed and save
    let embedding: Buffer | null = null
    try {
      const vec = await embed(m.content)
      embedding = serializeVec(vec)
    } catch { /* embedding optional */ }

    const id = saveMemory({
      content: m.content,
      summary: m.summary,
      tags: m.tags || [],
      file_paths: m.file_paths || [],
      functions: m.functions || [],
      embedding,
      repo_path: repoPath,
      git_commit: m.git_commit,
      git_branch: m.git_branch,
      created_by: m.created_by || createdBy,
      source: 'auto',
      stale: 0,
    })

    // Save file refs without hashes (can't recompute historical hashes)
    if (m.file_paths.length > 0) {
      saveMemoryFiles(id, m.file_paths.map(fp => ({ path: fp, hash: '' })))
    }

    imported++
  }

  return { imported, skipped }
}

export function writeExportFile(exportData: TeamMemoryExport, outputPath: string) {
  writeFileSync(outputPath, JSON.stringify(exportData, null, 2))
}
