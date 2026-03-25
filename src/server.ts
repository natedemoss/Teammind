/* eslint-disable @typescript-eslint/no-require-imports */
const { Server } = require('@modelcontextprotocol/sdk/server') as any
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js') as any
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js') as any
import path from 'path'
import os from 'os'
import { searchMemories } from './search'
import { saveMemory, saveMemoryFiles, getMemories, countMemories, markMemoryStale, getMemoriesWithFiles } from './db'
import { getGitContext, hashFile, resolveFilePaths } from './git'
import { embed, serializeVec } from './embed'
import { checkAndMarkStaleness } from './staleness'

const TOOLS = [
  {
    name: 'memory_search',
    description: 'Search team memory for relevant context about code, bugs, decisions, or patterns. Call this when you encounter a file or problem that might have prior context.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query, e.g. "auth middleware behavior" or "stripe webhook handling"'
        },
        file_path: {
          type: 'string',
          description: 'Optional: narrow results to memories about a specific file'
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 5)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'memory_add',
    description: 'Save an important insight, decision, bug fix, or pattern to team memory so future sessions can benefit from it.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'Full description of the memory (2-5 sentences with enough context to be useful later)'
        },
        summary: {
          type: 'string',
          description: 'One-line summary, max 80 chars'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags: bug, decision, gotcha, pattern, performance, security, config, api'
        },
        file_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Relative file paths this memory relates to'
        },
        functions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Function or method names, e.g. ["UserAuth.handleOAuth"]'
        }
      },
      required: ['content', 'summary']
    }
  },
  {
    name: 'memory_list',
    description: 'List recent memories for the current project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Number of memories to list (default 10)'
        }
      },
      required: []
    }
  },
  {
    name: 'memory_stale',
    description: 'Check which memories may be outdated because the files they reference have changed. Run this periodically or when you suspect something is stale.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  }
]

export async function startMcpServer() {
  const cwd = process.cwd()

  const server = new Server(
    { name: 'teammind', version: '0.1.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params
    const a = (args || {}) as Record<string, any>

    // Resolve the current project repo
    const gitCtx = await getGitContext(cwd)
    const repoPath = gitCtx?.root || cwd

    try {
      switch (name) {
        case 'memory_search': {
          const results = await searchMemories(a.query, repoPath, {
            filePath: a.file_path,
            limit: a.limit || 5
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

        case 'memory_add': {
          if (!a.content || !a.summary) {
            return text('Error: content and summary are required')
          }

          // Embed asynchronously
          let embedding: Buffer | null = null
          try {
            const vec = await embed(a.content)
            embedding = serializeVec(vec)
          } catch { /* embedding is optional */ }

          const id = saveMemory({
            content: a.content,
            summary: a.summary,
            tags: a.tags || [],
            file_paths: a.file_paths || [],
            functions: a.functions || [],
            embedding,
            repo_path: repoPath,
            git_commit: gitCtx?.commit || null,
            git_branch: gitCtx?.branch || null,
            created_by: os.userInfo().username || 'local',
            source: 'manual',
            stale: 0,
          })

          // Save file refs with current hashes for staleness detection
          if (a.file_paths?.length > 0) {
            const files = resolveFilePaths(a.file_paths, repoPath)
            saveMemoryFiles(id, files.map(fp => ({
              path: path.relative(repoPath, fp),
              hash: hashFile(fp)
            })))
          }

          return text(`Memory saved. (${await countMemories(repoPath)} total for this project)`)
        }

        case 'memory_list': {
          const memories = getMemories(repoPath, { limit: a.limit || 10 })
          if (memories.length === 0) {
            return text('No memories yet for this project. They will be captured automatically at session end, or you can use memory_add.')
          }

          const formatted = memories.map((m, i) => {
            const staleNote = m.stale ? ' ⚠ stale' : ''
            const tags = `[${m.tags.join(', ') || 'note'}]`
            const age = formatAge(m.created_at)
            return `${i + 1}. ${tags} ${m.summary}${staleNote} — ${age}`
          }).join('\n')

          const total = await countMemories(repoPath)
          return text(`${formatted}\n\n(${total} total memories for this project)`)
        }

        case 'memory_stale': {
          const report = await checkAndMarkStaleness(repoPath)

          if (report.markedStale === 0) {
            return text(`All ${report.checked} tracked memories are fresh.`)
          }

          const details = report.staleMemories
            .map(m => `- ${m.summary}\n  Changed: ${m.changedFiles.join(', ')}`)
            .join('\n')

          return text(
            `Marked ${report.markedStale} memories as stale (files changed):\n${details}\n\n` +
            `These will still appear with [may be outdated] tag but won't be auto-injected.`
          )
        }

        default:
          return text(`Unknown tool: ${name}`)
      }
    } catch (err: any) {
      return text(`Error: ${err?.message || String(err)}`)
    }
  })

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
