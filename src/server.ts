/* eslint-disable @typescript-eslint/no-require-imports */
// Use McpServer (high-level API from SDK v1.27+) with require() to bypass
// TypeScript's module resolution for packages using the exports map
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js') as any
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js') as any

import path from 'path'
import os from 'os'
import { z } from 'zod'
import { searchMemories } from './search'
import { saveMemory, saveMemoryFiles, getMemories, countMemories } from './db'
import { getGitContext, hashFile, resolveFilePaths, normalizePath } from './git'
import { embed, serializeVec } from './embed'
import { checkAndMarkStaleness } from './staleness'

export async function startMcpServer() {
  const cwd = normalizePath(process.cwd())

  const server = new McpServer({
    name: 'teammind',
    version: '0.1.0',
  })

  // ─── memory_search ──────────────────────────────────────────────────────────

  server.registerTool(
    'memory_search',
    {
      description: 'Search team memory for relevant context about code, bugs, decisions, or patterns. Call this proactively when you open a file or encounter a problem that might have prior context.',
      inputSchema: {
        query: z.string().describe('Natural language query, e.g. "auth middleware behavior" or "stripe webhook handling"'),
        file_path: z.string().optional().describe('Narrow results to memories about a specific file'),
        limit: z.number().optional().describe('Max results to return (default 5)'),
      },
    },
    async ({ query, file_path, limit }: { query: string; file_path?: string; limit?: number }) => {
      const gitCtx = await getGitContext(cwd)
      const repoPath = gitCtx?.root || cwd

      const results = await searchMemories(query, repoPath, {
        filePath: file_path,
        limit: limit || 5,
      })

      if (results.length === 0) {
        return text('No relevant memories found for this query.')
      }

      const formatted = results.map((m, i) => {
        const staleNote = m.stale ? ' [MAY BE OUTDATED]' : ''
        const files = m.file_paths.length > 0 ? `\n   Files: ${m.file_paths.join(', ')}` : ''
        const fns = m.functions.length > 0 ? `\n   Functions: ${m.functions.join(', ')}` : ''
        const tags = `[${m.tags.join(', ') || 'note'}]`
        return `${i + 1}. ${tags} ${m.summary}${staleNote}\n   ${m.content}${files}${fns}`
      }).join('\n\n')

      return text(formatted)
    }
  )

  // ─── memory_add ─────────────────────────────────────────────────────────────

  server.registerTool(
    'memory_add',
    {
      description: 'Save an important insight, decision, bug fix, or pattern to team memory so future sessions can benefit from it. Use this when you discover something non-obvious.',
      inputSchema: {
        content: z.string().describe('Full description (2-5 sentences with enough context to be useful later)'),
        summary: z.string().describe('One-line summary, max 80 chars'),
        tags: z.array(z.string()).optional().describe('Tags: bug, decision, gotcha, pattern, performance, security, config, api'),
        file_paths: z.array(z.string()).optional().describe('Relative file paths this memory relates to'),
        functions: z.array(z.string()).optional().describe('Function or method names, e.g. ["UserAuth.handleOAuth"]'),
      },
    },
    async ({ content, summary, tags, file_paths, functions }: {
      content: string; summary: string; tags?: string[];
      file_paths?: string[]; functions?: string[]
    }) => {
      const gitCtx = await getGitContext(cwd)
      const repoPath = gitCtx?.root || cwd

      let embedding = null
      try {
        const vec = await embed(content)
        embedding = serializeVec(vec)
      } catch { /* embedding optional */ }

      const id = saveMemory({
        content,
        summary,
        tags: tags || [],
        file_paths: file_paths || [],
        functions: functions || [],
        embedding,
        repo_path: repoPath,
        git_commit: gitCtx?.commit || null,
        git_branch: gitCtx?.branch || null,
        created_by: os.userInfo().username || 'local',
        source: 'manual',
        stale: 0,
      })

      if (file_paths && file_paths.length > 0) {
        const absFiles = resolveFilePaths(file_paths, repoPath)
        saveMemoryFiles(id, absFiles.map(fp => ({
          path: path.relative(repoPath, fp),
          hash: hashFile(fp),
        })))
      }

      const total = countMemories(repoPath)
      return text(`Memory saved. (${total} total memories for this project)`)
    }
  )

  // ─── memory_list ────────────────────────────────────────────────────────────

  server.registerTool(
    'memory_list',
    {
      description: 'List recent memories for the current project.',
      inputSchema: {
        limit: z.number().optional().describe('Number of memories to list (default 10)'),
      },
    },
    async ({ limit }: { limit?: number }) => {
      const gitCtx = await getGitContext(cwd)
      const repoPath = gitCtx?.root || cwd
      const memories = getMemories(repoPath, { limit: limit || 10 })

      if (memories.length === 0) {
        return text('No memories yet for this project. They will be captured automatically at session end, or use memory_add.')
      }

      const formatted = memories.map((m, i) => {
        const staleNote = m.stale ? ' ⚠ stale' : ''
        const tags = `[${m.tags.join(', ') || 'note'}]`
        const age = formatAge(m.created_at)
        return `${i + 1}. ${tags} ${m.summary}${staleNote} — ${age}`
      }).join('\n')

      const total = countMemories(repoPath)
      return text(`${formatted}\n\n(${total} total)`)
    }
  )

  // ─── memory_stale ───────────────────────────────────────────────────────────

  server.registerTool(
    'memory_stale',
    {
      description: 'Check which memories may be outdated because their referenced files changed. Run this periodically or when you suspect something is stale.',
      inputSchema: {},
    },
    async () => {
      const gitCtx = await getGitContext(cwd)
      const repoPath = gitCtx?.root || cwd
      const report = await checkAndMarkStaleness(repoPath)

      if (report.markedStale === 0) {
        return text(`All ${report.checked} tracked memories are fresh.`)
      }

      const details = report.staleMemories
        .map(m => `- ${m.summary}\n  Changed files: ${m.changedFiles.join(', ')}`)
        .join('\n')

      return text(
        `Marked ${report.markedStale} memories as stale (files changed since capture):\n${details}\n\n` +
        `These will still appear tagged [may be outdated] but are deprioritized in injection.`
      )
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] }
}

function formatAge(ts: number): string {
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
