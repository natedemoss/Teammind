#!/usr/bin/env node
// Suppress Node.js experimental warnings (node:sqlite is stable enough for production use)
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning') return
  console.error(w.name + ': ' + w.message)
})

import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import path from 'path'
import os from 'os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { spawn } from 'child_process'

// Read and parse the JSONL transcript provided by Claude Code's Stop hook.
// Each line is a conversation entry with structure: { type, message: { role, content } }
function readTranscriptFile(transcriptPath: string): string {
  try {
    const raw = readFileSync(transcriptPath, 'utf8')
    const lines = raw.split('\n').filter(l => l.trim())
    const parts: string[] = []

    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        // Only process user/assistant turns — skip system, file-history-snapshot, etc.
        if (entry.type !== 'user' && entry.type !== 'assistant') continue

        const msg = entry.message
        if (!msg) continue

        const role = (msg.role || entry.type).toUpperCase()

        // Extract only text content blocks — skip tool_use, tool_result, thinking
        let text = ''
        if (Array.isArray(msg.content)) {
          text = msg.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => String(c.text || ''))
            .join('\n')
        } else if (typeof msg.content === 'string') {
          text = msg.content
        }

        if (!text.trim()) continue
        parts.push(`[${role}]: ${text}`)
      } catch { /* skip malformed lines */ }
    }

    return parts.join('\n\n')
  } catch { return '' }
}

import { VERSION, TEAMMIND_DIR, HOOKS_DIR, DB_PATH } from './constants'
import { getDb, getMemories, getMemoryById, deleteMemory, deleteStaleMemories, deleteAllMemories, countMemories, saveSession, getSession, markSessionProcessed, saveMemory, saveMemoryFiles, pruneOldSessions, getTagStats, getMemoriesByTag } from './db'
import { getGitContext, hashFile, resolveFilePaths, normalizePath } from './git'
import { rankMemoriesForInjection, formatMemoriesForContext, searchMemories } from './search'
import { extractMemoriesFromTranscript, formatTranscript } from './extract'
import { embed, serializeVec, warmupModel } from './embed'
import { checkAndMarkStaleness } from './staleness'
import { exportMemories, importMemories, writeExportFile } from './sync'
import { startMcpServer } from './server'
import { loadConfig, saveConfig, coerceConfigValue, VALID_KEYS } from './config'
import { findDuplicate } from './search'
import { getPendingSessions, getAllSessions } from './db'
import { extractPreferencesFromTranscripts, readPersonaSection, writePersonaSection, clearPersonaSection, GLOBAL_CLAUDE_MD } from './persona'

const program = new Command()

program
  .name('teammind')
  .description('Git-aware persistent memory for Claude Code teams')
  .version(VERSION)

// ─── init ────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Set up TeamMind for this machine')
  .option('--silent', 'No output (for postinstall)')
  .action(async (opts) => {
    const log = opts.silent ? () => {} : console.log
    const spinner = opts.silent ? null : ora()

    log(chalk.bold('\nTeamMind setup\n'))

    // 1. Create ~/.teammind directories
    mkdirSync(TEAMMIND_DIR, { recursive: true })
    mkdirSync(HOOKS_DIR, { recursive: true })
    log(chalk.green('✓') + ' Created ~/.teammind directory')

    // 2. Initialize database
    getDb()
    log(chalk.green('✓') + ' Database ready at ~/.teammind/db.sqlite')

    // 3. Write hook scripts
    const nodeExec = process.execPath
    const cliPath = process.argv[1]

    const sessionStartHook = `#!/usr/bin/env node
'use strict'
const { execFileSync } = require('child_process')
try {
  const out = execFileSync(
    ${JSON.stringify(nodeExec)},
    ['--no-warnings', ${JSON.stringify(cliPath)}, 'inject'],
    { encoding: 'utf8', timeout: 8000, env: process.env, cwd: process.cwd() }
  )
  process.stdout.write(out)
} catch (e) { /* silent fail — never break Claude Code */ }
`

    const sessionStopHook = `#!/usr/bin/env node
'use strict'
const { execFileSync } = require('child_process')
const chunks = []
process.stdin.on('data', c => chunks.push(c))
process.stdin.on('end', () => {
  try {
    const input = Buffer.concat(chunks).toString('utf8')
    if (!input.trim()) return
    execFileSync(
      ${JSON.stringify(nodeExec)},
      ['--no-warnings', ${JSON.stringify(cliPath)}, 'capture'],
      { input, timeout: 5000, env: process.env, cwd: process.cwd(), stdio: ['pipe','ignore','ignore'] }
    )
  } catch (e) { /* silent fail */ }
})
`

    const startHookPath = path.join(HOOKS_DIR, 'session-start.js')
    const stopHookPath = path.join(HOOKS_DIR, 'session-stop.js')
    writeFileSync(startHookPath, sessionStartHook)
    writeFileSync(stopHookPath, sessionStopHook)
    log(chalk.green('✓') + ' Hook scripts written')

    // 4. Patch ~/.claude/settings.json
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
    patchClaudeSettings(settingsPath, startHookPath, stopHookPath, nodeExec, cliPath)
    log(chalk.green('✓') + ' Claude Code settings updated')

    // 5. Pre-warm embedding model
    if (!opts.silent) {
      spinner!.start('Downloading embedding model (~38MB, one time only)...')
    }
    try {
      await warmupModel()
      spinner?.succeed('Embedding model ready')
    } catch {
      spinner?.warn('Embedding model download failed (will retry on first use)')
    }



    log(chalk.bold.green('\nTeamMind is active.') + ' Just use Claude Code normally.')
    log('Run ' + chalk.cyan('teammind status') + ' to see captured memories.')
    log('Run ' + chalk.cyan('teammind team') + ' to share with your team.\n')
  })

// ─── status ──────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show memory stats for the current project')
  .action(async () => {
    const gitCtx = await getGitContext(process.cwd())
    const repoPath = gitCtx?.root || normalizePath(process.cwd())
    const projectName = path.basename(repoPath)

    // Run staleness check in background (non-blocking)
    checkAndMarkStaleness(repoPath).catch(() => {})

    const allMemories = getMemories(repoPath, { limit: 500, includeStale: true })
    const fresh = allMemories.filter(m => !m.stale)
    const stale = allMemories.filter(m => m.stale)
    const recent = fresh.slice(0, 5)
    const lastCapture = fresh[0] ? formatAge(fresh[0].created_at) : 'never'

    console.log(chalk.bold(`\nTeamMind — ${projectName}`))
    console.log('─'.repeat(40))

    if (allMemories.length === 0) {
      console.log(chalk.dim('  No memories yet. Use Claude Code normally and memories will be captured automatically.'))
    } else {
      console.log(`  ${chalk.green(fresh.length)} fresh memories  •  ${stale.length > 0 ? chalk.yellow(stale.length + ' stale') : '0 stale'}  •  last captured ${lastCapture}`)

      // Tag breakdown
      const tagStats = getTagStats(repoPath)
      const tagEntries = Object.entries(tagStats).sort((a, b) => b[1] - a[1])
      if (tagEntries.length > 0) {
        const maxCount = tagEntries[0][1]
        console.log('\n' + chalk.dim('  By type:'))
        for (const [tag, count] of tagEntries) {
          const bar = '█'.repeat(Math.round((count / maxCount) * 10))
          console.log(`    ${chalk.cyan(tag.padEnd(12))} ${chalk.dim(bar)} ${count}`)
        }
      }

      if (recent.length > 0) {
        console.log('\n' + chalk.dim('  Recent:'))
        for (const m of recent) {
          const tag = chalk.cyan(`[${m.tags[0] || 'note'}]`)
          const age = chalk.dim(`— ${formatAge(m.created_at)}`)
          console.log(`  • ${tag} ${m.summary.slice(0, 60)} ${age}`)
        }
      }
    }

    console.log()
    console.log(`Run ${chalk.cyan('teammind memories')} to browse all.`)
    if (stale.length > 0) console.log(`Run ${chalk.cyan('teammind forget --stale')} to clear ${stale.length} stale memories.`)
    console.log(`Run ${chalk.cyan('teammind team')} to share with your team.\n`)
  })

// ─── memories ────────────────────────────────────────────────────────────────

program
  .command('memories [query]')
  .description('Browse or search memories for the current project')
  .option('-n, --limit <n>', 'Number of results', '20')
  .option('-t, --tag <tag>', 'Filter by tag (bug, decision, gotcha, security, performance, config, api, pattern)')
  .option('--stale', 'Include stale memories')
  .action(async (query, opts) => {
    const gitCtx = await getGitContext(process.cwd())
    const repoPath = gitCtx?.root || normalizePath(process.cwd())
    const limit = parseInt(opts.limit) || 20

    let memories

    if (opts.tag) {
      memories = getMemoriesByTag(repoPath, opts.tag, limit)
      if (memories.length === 0) {
        console.log(chalk.dim(`\nNo [${opts.tag}] memories found.\n`))
        return
      }
    } else if (query) {
      const spinner = ora(`Searching for "${query}"...`).start()
      try {
        memories = await searchMemories(query, repoPath, { limit })
        spinner.stop()
      } catch {
        spinner.stop()
        memories = getMemories(repoPath, { limit, includeStale: opts.stale })
      }
    } else {
      memories = getMemories(repoPath, { limit, includeStale: opts.stale })
    }

    if (memories.length === 0) {
      console.log(chalk.dim('\nNo memories found.\n'))
      return
    }

    console.log()
    for (let i = 0; i < memories.length; i++) {
      const m = memories[i]
      const tags = chalk.cyan(`[${m.tags.join(', ') || 'note'}]`)
      const staleNote = m.stale ? chalk.yellow(' ⚠ STALE') : ''
      const age = chalk.dim(formatAge(m.created_at))
      const files = m.file_paths.length > 0
        ? chalk.dim(`\n     ${m.file_paths.join(', ')}`)
        : ''

      console.log(`${chalk.bold(String(i + 1).padStart(2))}. ${tags} ${chalk.white(m.summary)}${staleNote}  ${age}`)
      console.log(`    ${chalk.dim(m.content.slice(0, 200) + (m.content.length > 200 ? '...' : ''))}${files}`)
      console.log(`    ${chalk.dim('id: ' + m.id)}`)
      console.log()
    }
  })

// ─── memory (single) ──────────────────────────────────────────────────────────

program
  .command('memory <id>')
  .description('View the full content of a specific memory')
  .action((id: string) => {
    const mem = getMemoryById(id)
    if (!mem) {
      console.log(chalk.red(`\nMemory not found: ${id}\n`))
      return
    }
    const tags = mem.tags.length > 0 ? `[${mem.tags.join(', ')}]` : '[note]'
    const staleNote = mem.stale ? chalk.yellow('  ⚠ STALE') : ''
    console.log()
    console.log(chalk.bold(chalk.cyan(tags) + '  ' + mem.summary) + staleNote)
    console.log(chalk.dim('─'.repeat(60)))
    console.log(mem.content)
    console.log()
    if (mem.file_paths.length > 0) console.log(chalk.dim('Files:   ') + mem.file_paths.join(', '))
    if (mem.functions.length > 0) console.log(chalk.dim('Symbols: ') + mem.functions.join(', '))
    console.log(chalk.dim(`Branch:  ${mem.git_branch || '?'}  |  By: ${mem.created_by}  |  ${formatAge(mem.created_at)}`))
    console.log(chalk.dim(`id: ${mem.id}`))
    console.log()
  })

// ─── forget ───────────────────────────────────────────────────────────────────

program
  .command('forget [id]')
  .description('Delete a memory, clear stale memories, or wipe all memories for this project')
  .option('--stale', 'Delete all stale memories for this project')
  .option('--all', 'Delete ALL memories for this project')
  .action(async (id, opts) => {
    const gitCtx = await getGitContext(process.cwd())
    const repoPath = gitCtx?.root || normalizePath(process.cwd())
    const projectName = path.basename(repoPath)

    if (opts.all) {
      const count = deleteAllMemories(repoPath)
      console.log(chalk.green(`✓ Deleted all ${count} memories for ${projectName}`))
      return
    }

    if (opts.stale) {
      const count = deleteStaleMemories(repoPath)
      console.log(chalk.green(`✓ Deleted ${count} stale memories`))
      return
    }

    if (!id) {
      console.log(chalk.red('Provide a memory id, or use --stale / --all'))
      console.log('Run ' + chalk.cyan('teammind memories') + ' to see ids')
      return
    }

    deleteMemory(id)
    console.log(chalk.green(`✓ Deleted memory ${id}`))
  })

// ─── team ─────────────────────────────────────────────────────────────────────

program
  .command('team')
  .description('Set up team memory sharing')
  .option('--export <path>', 'Export memories to a file')
  .option('--import <path>', 'Import memories from a file')
  .action(async (opts) => {
    const gitCtx = await getGitContext(process.cwd())
    const repoPath = gitCtx?.root || normalizePath(process.cwd())

    if (opts.export) {
      const spinner = ora('Exporting memories...').start()
      const data = exportMemories(repoPath)
      writeExportFile(data, opts.export)
      spinner.succeed(`Exported ${data.memories.length} memories to ${opts.export}`)
      console.log(chalk.dim('\nCommit this file and tell teammates to run:'))
      console.log(chalk.cyan(`  teammind team --import ${opts.export}\n`))
      return
    }

    if (opts.import) {
      const spinner = ora('Importing memories...').start()
      try {
        const result = await importMemories(opts.import, repoPath)
        spinner.succeed(`Imported ${result.imported} memories (${result.skipped} skipped)`)
      } catch (err: any) {
        spinner.fail(`Import failed: ${err?.message}`)
      }
      return
    }

    // Interactive team setup
    const exportPath = path.join(repoPath, '.claude', 'team-memories.json')
    const relPath = path.relative(process.cwd(), exportPath)

    console.log(chalk.bold('\nTeam Memory Setup\n'))
    console.log('This exports your memories to a file you can commit to your repo.')
    console.log('Teammates import it and their Claude Code sessions get your team\'s context.\n')

    const spinner = ora('Exporting memories...').start()
    mkdirSync(path.dirname(exportPath), { recursive: true })
    const data = exportMemories(repoPath)
    writeExportFile(data, exportPath)
    spinner.succeed(`Exported ${data.memories.length} memories to ${chalk.cyan(relPath)}`)

    console.log('\n' + chalk.bold('Next steps:'))
    console.log(`  1. ${chalk.cyan(`git add ${relPath}`)}`)
    console.log(`  2. ${chalk.cyan('git commit -m "feat: add team memories"')}`)
    console.log(`  3. ${chalk.cyan('git push')}`)
    console.log()
    console.log('Tell teammates to run after pulling:')
    console.log(chalk.cyan(`  teammind team --import ${relPath}`))
    console.log()
    console.log(chalk.dim('Tip: add to .git/hooks/post-merge to auto-import on git pull:'))
    console.log(chalk.dim(`  echo 'teammind team --import ${relPath}' >> .git/hooks/post-merge`))
    console.log(chalk.dim('  chmod +x .git/hooks/post-merge\n'))
  })

// ─── inject (called by SessionStart hook) ────────────────────────────────────

program
  .command('inject')
  .description('Print relevant memories to stdout (used by SessionStart hook)')
  .action(async () => {
    try {
      const cwd = process.cwd()
      const gitCtx = await getGitContext(cwd)
      if (!gitCtx) return // Not a git repo, nothing to inject

      const repoPath = gitCtx.root
      const projectName = path.basename(repoPath)

      // Run staleness check in background
      checkAndMarkStaleness(repoPath).catch(() => {})

      const config = loadConfig()
      const memories = rankMemoriesForInjection(repoPath, gitCtx.branch, config.max_inject)
      if (memories.length === 0) return

      const total = countMemories(repoPath)
      const context = formatMemoriesForContext(memories, projectName, gitCtx.branch)
      process.stdout.write(context + '\n')
    } catch {
      // Never fail — silent exit
    }
  })

// ─── capture (called by Stop hook) ───────────────────────────────────────────

program
  .command('capture')
  .description('Save session transcript (used by Stop hook)')
  .action(async () => {
    try {
      const chunks: Buffer[] = []
      await new Promise<void>((resolve) => {
        process.stdin.on('data', c => chunks.push(c))
        process.stdin.on('end', resolve)
        process.stdin.on('error', resolve)
        // Timeout: don't wait forever
        setTimeout(resolve, 10000)
      })

      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return

      const hookPayload = JSON.parse(raw)

      // Claude Code Stop hook provides transcript_path (a JSONL file), not inline transcript
      let transcript = ''
      if (hookPayload.transcript_path && existsSync(hookPayload.transcript_path)) {
        transcript = readTranscriptFile(hookPayload.transcript_path)
      } else {
        // Fallback: try to format whatever is in the payload (older format or direct test)
        transcript = formatTranscript(hookPayload)
      }

      if (!transcript || transcript.length < 100) return

      const cwd = normalizePath(hookPayload.cwd || process.cwd())
      const gitCtx = await getGitContext(cwd)
      const repoPath = gitCtx?.root || cwd

      const sessionId = saveSession({
        repo_path: repoPath,
        branch: gitCtx?.branch || null,
        commit: gitCtx?.commit || null,
        transcript,
      })

      // Spawn extraction in background (fully detached — user feels nothing)
      const child = spawn(process.execPath, [process.argv[1], 'extract', sessionId], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      })
      child.unref()
    } catch {
      // Never fail
    }
  })

// ─── extract (background worker) ─────────────────────────────────────────────

program
  .command('extract [sessionId]')
  .description('Extract memories: provide a session ID (background worker) or use --pending for all')
  .option('--pending', 'Process all pending sessions interactively')
  .option('--verbose', 'Show extraction details')
  .action(async (sessionId: string | undefined, opts) => {
    // ── --pending mode: interactive extraction of all queued sessions ──────
    if (opts.pending || !sessionId) {
      const pending = getPendingSessions()
      if (pending.length === 0) {
        console.log(chalk.green('✓ No pending sessions — everything is up to date.'))
        return
      }

      console.log(chalk.bold(`\nProcessing ${pending.length} pending session${pending.length > 1 ? 's' : ''}...\n`))

      let totalSaved = 0, totalDeduped = 0
      const config = loadConfig()
      const username = os.userInfo().username || 'local'

      for (const session of pending) {
        const spinner = ora(`${path.basename(session.repo_path)}/${session.branch || '?'} — ${formatAge(session.created_at)}`).start()
        try {
          const extracted = await extractMemoriesFromTranscript(session.transcript)
          if (extracted.length === 0) {
            markSessionProcessed(session.id)
            spinner.succeed(chalk.dim('No memories worth capturing'))
            continue
          }

          let saved = 0, deduped = 0
          for (const m of extracted) {
            let embedding: Buffer | null = null
            try { const v = await embed(m.content); embedding = serializeVec(v) } catch {}
            if (embedding) {
              const dupId = await findDuplicate(m.content, session.repo_path, config.similarity_threshold)
              if (dupId) { deduped++; continue }
            }
            const id = saveMemory({
              content: m.content, summary: m.summary, tags: m.tags,
              file_paths: m.file_paths, functions: m.functions, embedding,
              repo_path: session.repo_path, git_commit: session.commit,
              git_branch: session.branch, created_by: username, source: 'auto', stale: 0,
            })
            saved++
            if (m.file_paths.length > 0) {
              const absFiles = resolveFilePaths(m.file_paths, session.repo_path)
              saveMemoryFiles(id, absFiles.map(fp => ({ path: path.relative(session.repo_path, fp), hash: hashFile(fp) })))
            }
            if (opts.verbose) console.log(`   ${chalk.cyan(`[${m.tags[0]||'note'}]`)} ${m.summary}`)
          }
          markSessionProcessed(session.id)
          totalSaved += saved; totalDeduped += deduped
          spinner.succeed(`${chalk.green(saved + ' saved')}${deduped > 0 ? chalk.dim(` · ${deduped} dupes skipped`) : ''}`)
        } catch (e: any) {
          spinner.fail(chalk.red(e?.message || 'failed'))
        }
      }
      console.log(chalk.bold(`\nDone. ${totalSaved} new memories` + (totalDeduped > 0 ? `, ${totalDeduped} duplicates skipped.` : '.') + '\n'))
      return
    }

    // ── session ID mode: background worker (called by Stop hook) ──────────
    try {
      const session = getSession(sessionId)
      if (!session || session.processed) return

      pruneOldSessions(7)

      const memories = await extractMemoriesFromTranscript(session.transcript)
      if (memories.length === 0) {
        markSessionProcessed(sessionId)
        return
      }

      const username = os.userInfo().username || 'local'
      const config = loadConfig()
      let saved = 0, deduped = 0

      for (const m of memories) {
        // Embed the memory
        let embedding: Buffer | null = null
        try {
          const vec = await embed(m.content)
          embedding = serializeVec(vec)
        } catch { /* embedding optional */ }

        // Deduplication: skip if a very similar memory already exists
        if (embedding) {
          const dupId = await findDuplicate(m.content, session.repo_path, config.similarity_threshold)
          if (dupId) {
            deduped++
            if (opts?.verbose) console.error(`[teammind] Deduped: "${m.summary}"`)
            continue
          }
        }

        const id = saveMemory({
          content: m.content,
          summary: m.summary,
          tags: m.tags,
          file_paths: m.file_paths,
          functions: m.functions,
          embedding,
          repo_path: session.repo_path,
          git_commit: session.commit,
          git_branch: session.branch,
          created_by: username,
          source: 'auto',
          stale: 0,
        })
        saved++

        // Save file refs with current hashes
        if (m.file_paths.length > 0) {
          const absFiles = resolveFilePaths(m.file_paths, session.repo_path)
          saveMemoryFiles(id, absFiles.map(fp => ({
            path: path.relative(session.repo_path, fp),
            hash: hashFile(fp)
          })))
        }
      }

      if (opts?.verbose) {
        console.error(`[teammind] Extracted ${saved} new memories (${deduped} duplicates skipped)`)
      }

      markSessionProcessed(sessionId)
    } catch {
      // Background worker — silent failure is fine
    }
  })

// ─── server (MCP server, called by Claude Code) ───────────────────────────────

program
  .command('server')
  .description('Start the MCP server (called by Claude Code)')
  .action(async () => {
    await startMcpServer()
  })

// ─── Helpers ──────────────────────────────────────────────────────────────────

function patchClaudeSettings(
  settingsPath: string,
  startHookPath: string,
  stopHookPath: string,
  nodeExec: string,
  cliPath: string
) {
  let settings: any = {}

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    } catch { settings = {} }
  }

  settings.hooks = settings.hooks || {}

  // SessionStart
  settings.hooks.SessionStart = (settings.hooks.SessionStart || [])
    .filter((h: any) => !JSON.stringify(h).includes('teammind'))
  settings.hooks.SessionStart.push({
    matcher: '',
    hooks: [{ type: 'command', command: `${JSON.stringify(nodeExec)} ${JSON.stringify(startHookPath)}` }]
  })

  // Stop
  settings.hooks.Stop = (settings.hooks.Stop || [])
    .filter((h: any) => !JSON.stringify(h).includes('teammind'))
  settings.hooks.Stop.push({
    matcher: '',
    hooks: [{ type: 'command', command: `${JSON.stringify(nodeExec)} ${JSON.stringify(stopHookPath)}` }]
  })

  // MCP server
  settings.mcpServers = settings.mcpServers || {}
  settings.mcpServers.teammind = {
    type: 'stdio',
    command: nodeExec,
    args: ['--no-warnings', cliPath, 'server']
  }

  mkdirSync(path.dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
}

function formatAge(ts: number): string {
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

// ─── sessions ────────────────────────────────────────────────────────────────

program
  .command('sessions')
  .description('List captured sessions (processed and pending extraction)')
  .option('-n, --limit <n>', 'Number of sessions to show', '15')
  .action(async (opts) => {
    const limit = parseInt(opts.limit) || 15
    const sessions = getAllSessions(limit)

    if (sessions.length === 0) {
      console.log(chalk.dim('\nNo sessions captured yet.\n'))
      return
    }

    const pending = sessions.filter(s => !s.processed)
    const done = sessions.filter(s => s.processed)

    console.log()

    if (pending.length > 0) {
      console.log(chalk.yellow.bold(`⏳ Pending extraction (${pending.length})`))
      console.log(chalk.dim('   Run `teammind extract --pending` to process these now\n'))
      for (const s of pending) {
        const age = formatAge(s.created_at)
        const kb = Math.round(s.transcript_len / 1024)
        const repo = path.basename(s.repo_path)
        console.log(`   ${chalk.white(s.id.slice(0, 8))}  ${repo}/${s.branch || '?'}  ${kb}KB  ${chalk.dim(age)}`)
      }
      console.log()
    }

    if (done.length > 0) {
      console.log(chalk.green.bold(`✓ Processed (${done.length})`))
      console.log()
      for (const s of done.slice(0, 8)) {
        const age = formatAge(s.created_at)
        const kb = Math.round(s.transcript_len / 1024)
        const repo = path.basename(s.repo_path)
        console.log(`   ${chalk.dim(s.id.slice(0, 8))}  ${repo}/${s.branch || '?'}  ${kb}KB  ${chalk.dim(age)}`)
      }
    }

    console.log()
  })


// ─── config ───────────────────────────────────────────────────────────────────

program
  .command('config')
  .description('View or update TeamMind configuration')
  .addCommand(
    new (require('commander').Command)('set')
      .description('Set a config value')
      .argument('<key>', `Config key (${VALID_KEYS.join(', ')})`)
      .argument('<value>', 'Value to set')
      .action((key: string, value: string) => {
        const coerced = coerceConfigValue(key, value)
        saveConfig({ [key]: coerced })
        console.log(chalk.green(`✓ ${key} = ${coerced}`))
      })
  )
  .addCommand(
    new (require('commander').Command)('get')
      .description('Get a config value')
      .argument('<key>', 'Config key')
      .action((key: string) => {
        const config = loadConfig()
        const value = (config as any)[key]
        if (value === undefined) {
          console.log(chalk.red(`Unknown key: ${key}`))
        } else {
          console.log(String(value))
        }
      })
  )
  .addCommand(
    new (require('commander').Command)('list')
      .description('Show all config values')
      .action(() => {
        const config = loadConfig()
        console.log()
        console.log(chalk.bold('TeamMind Configuration'))
        console.log(chalk.dim('  ~/.teammind/config.json\n'))
        console.log(`  ${'max_inject'.padEnd(25)} ${config.max_inject}`)
        console.log(`  ${'extraction_enabled'.padEnd(25)} ${config.extraction_enabled}`)
        console.log(`  ${'similarity_threshold'.padEnd(25)} ${config.similarity_threshold} (dedup threshold)`)
        console.log()
      })
  )
  .action(() => {
    const config = loadConfig()
    console.log()
    console.log(chalk.bold('TeamMind Configuration'))
    console.log(chalk.dim('  Use `teammind config set <key> <value>` to change\n'))
    console.log(`  ${'max_inject'.padEnd(25)} ${config.max_inject}`)
    console.log(`  ${'extraction_enabled'.padEnd(25)} ${config.extraction_enabled}`)
    console.log(`  ${'similarity_threshold'.padEnd(25)} ${config.similarity_threshold}`)
    console.log()
  })

// ─── remember ────────────────────────────────────────────────────────────────

program
  .command('remember <text>')
  .description('Manually save a memory for the current project')
  .option('-t, --tag <tag>', 'Memory type (bug, decision, gotcha, security, performance, config, api, pattern)', 'note')
  .action(async (text: string, opts) => {
    const gitCtx = await getGitContext(process.cwd())
    const repoPath = gitCtx?.root || normalizePath(process.cwd())
    const username = os.userInfo().username || 'local'
    const config = loadConfig()

    const spinner = ora('Saving memory...').start()

    let embedding: Buffer | null = null
    try {
      const vec = await embed(text)
      embedding = serializeVec(vec)
    } catch { /* embedding optional */ }

    if (embedding) {
      const dupId = await findDuplicate(text, repoPath, config.similarity_threshold)
      if (dupId) {
        spinner.warn('A very similar memory already exists — skipped')
        console.log(chalk.dim(`  Run ${chalk.cyan('teammind memory ' + dupId)} to view it`))
        return
      }
    }

    const summary = text.match(/^.{10,}?[.!?](?:\s|$)/)?.[0]?.trim().slice(0, 80) || text.slice(0, 80)

    const id = saveMemory({
      content: text,
      summary,
      tags: [opts.tag],
      file_paths: [],
      functions: [],
      embedding,
      repo_path: repoPath,
      git_commit: gitCtx?.commit || null,
      git_branch: gitCtx?.branch || null,
      created_by: username,
      source: 'manual',
      stale: 0,
    })

    spinner.succeed(`Memory saved  ${chalk.dim('id: ' + id)}`)
    console.log(chalk.dim(`\n  [${opts.tag}] ${summary}\n`))
  })

// ─── persona ──────────────────────────────────────────────────────────────────

program
  .command('persona')
  .description('Build your interaction preferences and write them to CLAUDE.md')
  .option('--update', 'Analyze sessions and update preferences in CLAUDE.md')
  .option('--reset', 'Remove persona section from CLAUDE.md')
  .action(async (opts) => {
    if (opts.reset) {
      clearPersonaSection()
      console.log(chalk.green('✓ Persona section removed from ~/.claude/CLAUDE.md'))
      return
    }

    // Default: show current persona
    if (!opts.update) {
      const current = readPersonaSection()
      if (!current) {
        console.log(chalk.dim('\nNo persona set yet.'))
        console.log('Run ' + chalk.cyan('teammind persona --update') + ' to build one from your sessions.\n')
      } else {
        console.log(chalk.bold('\nYour interaction preferences (in ~/.claude/CLAUDE.md):\n'))
        for (const line of current.split('\n').filter(l => l.startsWith('-'))) {
          console.log('  ' + chalk.cyan('•') + ' ' + line.slice(2))
        }
        console.log()
        console.log('Run ' + chalk.cyan('teammind persona --update') + ' to refresh.')
        console.log('Run ' + chalk.cyan('teammind persona --reset') + ' to remove.\n')
      }
      return
    }

    // --update: analyze sessions and write to CLAUDE.md
    const spinner = ora('Analyzing your sessions for preferences...').start()

    const sessionMeta = getAllSessions(50).filter(s => s.processed && s.transcript_len > 200)
    if (sessionMeta.length === 0) {
      spinner.fail('No sessions to analyze yet — use Claude Code normally first')
      return
    }

    const transcripts: string[] = []
    for (const s of sessionMeta.slice(0, 30)) {
      const full = getSession(s.id)
      if (full?.transcript) transcripts.push(full.transcript)
    }

    const prefs = extractPreferencesFromTranscripts(transcripts)

    if (prefs.length === 0) {
      spinner.warn('No strong preferences detected yet — use Claude Code more and try again')
      return
    }

    writePersonaSection(prefs)
    spinner.succeed(`Updated ${GLOBAL_CLAUDE_MD}`)

    console.log(chalk.bold('\nAdded to ~/.claude/CLAUDE.md:\n'))
    for (const p of prefs) {
      console.log('  ' + chalk.green('+') + ' ' + p)
    }
    console.log()
  })

program.parse()
