#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Suppress Node.js experimental warnings (node:sqlite is stable enough for production use)
process.on('warning', (w) => {
    if (w.name === 'ExperimentalWarning')
        return;
    console.error(w.name + ': ' + w.message);
});
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = require("fs");
const child_process_1 = require("child_process");
// Read the full JSONL transcript from the path provided by the Stop hook
function readTranscriptFile(transcriptPath) {
    try {
        const raw = (0, fs_1.readFileSync)(transcriptPath, 'utf8');
        const lines = raw.split('\n').filter(l => l.trim());
        return lines.map(line => {
            try {
                const entry = JSON.parse(line);
                const role = (entry.role || 'unknown').toUpperCase();
                const content = Array.isArray(entry.content)
                    ? entry.content.map((c) => (typeof c === 'string' ? c : c?.text || JSON.stringify(c))).join('\n')
                    : String(entry.content || '');
                return `[${role}]: ${content}`;
            }
            catch {
                return line;
            }
        }).join('\n\n');
    }
    catch {
        return '';
    }
}
const constants_1 = require("./constants");
const db_1 = require("./db");
const git_1 = require("./git");
const search_1 = require("./search");
const extract_1 = require("./extract");
const embed_1 = require("./embed");
const staleness_1 = require("./staleness");
const sync_1 = require("./sync");
const server_1 = require("./server");
const config_1 = require("./config");
const search_2 = require("./search");
const db_2 = require("./db");
const program = new commander_1.Command();
program
    .name('teammind')
    .description('Git-aware persistent memory for Claude Code teams')
    .version(constants_1.VERSION);
// ─── init ────────────────────────────────────────────────────────────────────
program
    .command('init')
    .description('Set up TeamMind for this machine')
    .option('--silent', 'No output (for postinstall)')
    .action(async (opts) => {
    const log = opts.silent ? () => { } : console.log;
    const spinner = opts.silent ? null : (0, ora_1.default)();
    log(chalk_1.default.bold('\nTeamMind setup\n'));
    // 1. Create ~/.teammind directories
    (0, fs_1.mkdirSync)(constants_1.TEAMMIND_DIR, { recursive: true });
    (0, fs_1.mkdirSync)(constants_1.HOOKS_DIR, { recursive: true });
    log(chalk_1.default.green('✓') + ' Created ~/.teammind directory');
    // 2. Initialize database
    (0, db_1.getDb)();
    log(chalk_1.default.green('✓') + ' Database ready at ~/.teammind/db.sqlite');
    // 3. Write hook scripts
    const nodeExec = process.execPath;
    const cliPath = process.argv[1];
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
`;
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
`;
    const startHookPath = path_1.default.join(constants_1.HOOKS_DIR, 'session-start.js');
    const stopHookPath = path_1.default.join(constants_1.HOOKS_DIR, 'session-stop.js');
    (0, fs_1.writeFileSync)(startHookPath, sessionStartHook);
    (0, fs_1.writeFileSync)(stopHookPath, sessionStopHook);
    log(chalk_1.default.green('✓') + ' Hook scripts written');
    // 4. Patch ~/.claude/settings.json
    const settingsPath = path_1.default.join(os_1.default.homedir(), '.claude', 'settings.json');
    patchClaudeSettings(settingsPath, startHookPath, stopHookPath, nodeExec, cliPath);
    log(chalk_1.default.green('✓') + ' Claude Code settings updated');
    // 5. Pre-warm embedding model
    if (!opts.silent) {
        spinner.start('Downloading embedding model (~38MB, one time only)...');
    }
    try {
        await (0, embed_1.warmupModel)();
        spinner?.succeed('Embedding model ready');
    }
    catch {
        spinner?.warn('Embedding model download failed (will retry on first use)');
    }
    log(chalk_1.default.bold.green('\nTeamMind is active.') + ' Just use Claude Code normally.');
    log('Run ' + chalk_1.default.cyan('teammind status') + ' to see captured memories.');
    log('Run ' + chalk_1.default.cyan('teammind team') + ' to share with your team.\n');
});
// ─── status ──────────────────────────────────────────────────────────────────
program
    .command('status')
    .description('Show memory stats for the current project')
    .action(async () => {
    const gitCtx = await (0, git_1.getGitContext)(process.cwd());
    const repoPath = gitCtx?.root || (0, git_1.normalizePath)(process.cwd());
    const projectName = path_1.default.basename(repoPath);
    const allMemories = (0, db_1.getMemories)(repoPath, { limit: 200, includeStale: true });
    const fresh = allMemories.filter(m => !m.stale);
    const stale = allMemories.filter(m => m.stale);
    const recent = fresh.slice(0, 5);
    const lastCapture = fresh[0]
        ? formatAge(fresh[0].created_at)
        : 'never';
    console.log(chalk_1.default.bold(`\nTeamMind — ${projectName}`));
    console.log('─'.repeat(40));
    if (allMemories.length === 0) {
        console.log(chalk_1.default.dim('  No memories yet. Use Claude Code normally and memories will be captured automatically.'));
    }
    else {
        console.log(`  ${chalk_1.default.green(fresh.length)} fresh memories  •  ${stale.length > 0 ? chalk_1.default.yellow(stale.length + ' stale') : '0 stale'}  •  last captured ${lastCapture}`);
        if (recent.length > 0) {
            console.log('\n' + chalk_1.default.dim('Recent captures:'));
            for (const m of recent) {
                const tag = chalk_1.default.cyan(`[${m.tags[0] || 'note'}]`);
                const age = chalk_1.default.dim(`— ${formatAge(m.created_at)}`);
                console.log(`  • ${tag} ${m.summary} ${age}`);
            }
        }
    }
    console.log();
    console.log(`Run ${chalk_1.default.cyan('teammind memories')} to browse all.`);
    console.log(`Run ${chalk_1.default.cyan('teammind team')} to share with your team.\n`);
});
// ─── memories ────────────────────────────────────────────────────────────────
program
    .command('memories [query]')
    .description('Browse or search memories for the current project')
    .option('-n, --limit <n>', 'Number of results', '20')
    .option('--stale', 'Include stale memories')
    .action(async (query, opts) => {
    const gitCtx = await (0, git_1.getGitContext)(process.cwd());
    const repoPath = gitCtx?.root || (0, git_1.normalizePath)(process.cwd());
    const limit = parseInt(opts.limit) || 20;
    let memories;
    if (query) {
        const spinner = (0, ora_1.default)(`Searching for "${query}"...`).start();
        try {
            const results = await (0, search_1.searchMemories)(query, repoPath, { limit });
            spinner.stop();
            memories = results;
        }
        catch {
            spinner.stop();
            memories = (0, db_1.getMemories)(repoPath, { limit, includeStale: opts.stale });
        }
    }
    else {
        memories = (0, db_1.getMemories)(repoPath, { limit, includeStale: opts.stale });
    }
    if (memories.length === 0) {
        console.log(chalk_1.default.dim('\nNo memories found.\n'));
        return;
    }
    console.log();
    for (let i = 0; i < memories.length; i++) {
        const m = memories[i];
        const tags = chalk_1.default.cyan(`[${m.tags.join(', ') || 'note'}]`);
        const staleNote = m.stale ? chalk_1.default.yellow(' ⚠ STALE') : '';
        const age = chalk_1.default.dim(formatAge(m.created_at));
        const files = m.file_paths.length > 0
            ? chalk_1.default.dim(`\n     ${m.file_paths.join(', ')}`)
            : '';
        console.log(`${chalk_1.default.bold(String(i + 1).padStart(2))}. ${tags} ${chalk_1.default.white(m.summary)}${staleNote} ${age}`);
        console.log(`    ${chalk_1.default.dim(m.content.slice(0, 200) + (m.content.length > 200 ? '...' : ''))}${files}`);
        console.log(`    ${chalk_1.default.dim('id: ' + m.id)}`);
        console.log();
    }
});
// ─── forget ───────────────────────────────────────────────────────────────────
program
    .command('forget [id]')
    .description('Delete a memory or clear all stale memories')
    .option('--stale', 'Delete all stale memories for this project')
    .action(async (id, opts) => {
    const gitCtx = await (0, git_1.getGitContext)(process.cwd());
    const repoPath = gitCtx?.root || (0, git_1.normalizePath)(process.cwd());
    if (opts.stale) {
        const count = (0, db_1.deleteStaleMemories)(repoPath);
        console.log(chalk_1.default.green(`✓ Deleted ${count} stale memories`));
        return;
    }
    if (!id) {
        console.log(chalk_1.default.red('Provide a memory id or use --stale to clear stale memories'));
        console.log('Run ' + chalk_1.default.cyan('teammind memories') + ' to see ids');
        return;
    }
    (0, db_1.deleteMemory)(id);
    console.log(chalk_1.default.green(`✓ Deleted memory ${id}`));
});
// ─── team ─────────────────────────────────────────────────────────────────────
program
    .command('team')
    .description('Set up team memory sharing')
    .option('--export <path>', 'Export memories to a file')
    .option('--import <path>', 'Import memories from a file')
    .action(async (opts) => {
    const gitCtx = await (0, git_1.getGitContext)(process.cwd());
    const repoPath = gitCtx?.root || (0, git_1.normalizePath)(process.cwd());
    if (opts.export) {
        const spinner = (0, ora_1.default)('Exporting memories...').start();
        const data = (0, sync_1.exportMemories)(repoPath);
        (0, sync_1.writeExportFile)(data, opts.export);
        spinner.succeed(`Exported ${data.memories.length} memories to ${opts.export}`);
        console.log(chalk_1.default.dim('\nCommit this file and tell teammates to run:'));
        console.log(chalk_1.default.cyan(`  teammind team --import ${opts.export}\n`));
        return;
    }
    if (opts.import) {
        const spinner = (0, ora_1.default)('Importing memories...').start();
        try {
            const result = await (0, sync_1.importMemories)(opts.import, repoPath);
            spinner.succeed(`Imported ${result.imported} memories (${result.skipped} skipped)`);
        }
        catch (err) {
            spinner.fail(`Import failed: ${err?.message}`);
        }
        return;
    }
    // Interactive team setup
    const exportPath = path_1.default.join(repoPath, '.claude', 'team-memories.json');
    const relPath = path_1.default.relative(process.cwd(), exportPath);
    console.log(chalk_1.default.bold('\nTeam Memory Setup\n'));
    console.log('This exports your memories to a file you can commit to your repo.');
    console.log('Teammates import it and their Claude Code sessions get your team\'s context.\n');
    const spinner = (0, ora_1.default)('Exporting memories...').start();
    (0, fs_1.mkdirSync)(path_1.default.dirname(exportPath), { recursive: true });
    const data = (0, sync_1.exportMemories)(repoPath);
    (0, sync_1.writeExportFile)(data, exportPath);
    spinner.succeed(`Exported ${data.memories.length} memories to ${chalk_1.default.cyan(relPath)}`);
    console.log('\n' + chalk_1.default.bold('Next steps:'));
    console.log(`  1. ${chalk_1.default.cyan(`git add ${relPath}`)}`);
    console.log(`  2. ${chalk_1.default.cyan('git commit -m "feat: add team memories"')}`);
    console.log(`  3. ${chalk_1.default.cyan('git push')}`);
    console.log();
    console.log('Tell teammates to run after pulling:');
    console.log(chalk_1.default.cyan(`  teammind team --import ${relPath}`));
    console.log();
    console.log(chalk_1.default.dim('Tip: add to .git/hooks/post-merge to auto-import on git pull:'));
    console.log(chalk_1.default.dim(`  echo 'teammind team --import ${relPath}' >> .git/hooks/post-merge`));
    console.log(chalk_1.default.dim('  chmod +x .git/hooks/post-merge\n'));
});
// ─── inject (called by SessionStart hook) ────────────────────────────────────
program
    .command('inject')
    .description('Print relevant memories to stdout (used by SessionStart hook)')
    .action(async () => {
    try {
        const cwd = process.cwd();
        const gitCtx = await (0, git_1.getGitContext)(cwd);
        if (!gitCtx)
            return; // Not a git repo, nothing to inject
        const repoPath = gitCtx.root;
        const projectName = path_1.default.basename(repoPath);
        // Run staleness check in background
        (0, staleness_1.checkAndMarkStaleness)(repoPath).catch(() => { });
        const config = (0, config_1.loadConfig)();
        const memories = (0, search_1.rankMemoriesForInjection)(repoPath, gitCtx.branch, config.max_inject);
        if (memories.length === 0)
            return;
        const total = (0, db_1.countMemories)(repoPath);
        const context = (0, search_1.formatMemoriesForContext)(memories, projectName, gitCtx.branch);
        process.stdout.write(context + '\n');
    }
    catch {
        // Never fail — silent exit
    }
});
// ─── capture (called by Stop hook) ───────────────────────────────────────────
program
    .command('capture')
    .description('Save session transcript (used by Stop hook)')
    .action(async () => {
    try {
        const chunks = [];
        await new Promise((resolve) => {
            process.stdin.on('data', c => chunks.push(c));
            process.stdin.on('end', resolve);
            process.stdin.on('error', resolve);
            // Timeout: don't wait forever
            setTimeout(resolve, 10000);
        });
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw)
            return;
        const hookPayload = JSON.parse(raw);
        // Claude Code Stop hook provides transcript_path (a JSONL file), not inline transcript
        let transcript = '';
        if (hookPayload.transcript_path && (0, fs_1.existsSync)(hookPayload.transcript_path)) {
            transcript = readTranscriptFile(hookPayload.transcript_path);
        }
        else {
            // Fallback: try to format whatever is in the payload (older format or direct test)
            transcript = (0, extract_1.formatTranscript)(hookPayload);
        }
        if (!transcript || transcript.length < 100)
            return;
        const cwd = (0, git_1.normalizePath)(hookPayload.cwd || process.cwd());
        const gitCtx = await (0, git_1.getGitContext)(cwd);
        const repoPath = gitCtx?.root || cwd;
        const sessionId = (0, db_1.saveSession)({
            repo_path: repoPath,
            branch: gitCtx?.branch || null,
            commit: gitCtx?.commit || null,
            transcript,
        });
        // Spawn extraction in background (fully detached — user feels nothing)
        const child = (0, child_process_1.spawn)(process.execPath, [process.argv[1], 'extract', sessionId], {
            detached: true,
            stdio: 'ignore',
            env: process.env,
        });
        child.unref();
    }
    catch {
        // Never fail
    }
});
// ─── extract (background worker) ─────────────────────────────────────────────
program
    .command('extract [sessionId]')
    .description('Extract memories: provide a session ID (background worker) or use --pending for all')
    .option('--pending', 'Process all pending sessions interactively')
    .option('--verbose', 'Show extraction details')
    .action(async (sessionId, opts) => {
    // ── --pending mode: interactive extraction of all queued sessions ──────
    if (opts.pending || !sessionId) {
        const pending = (0, db_2.getPendingSessions)();
        if (pending.length === 0) {
            console.log(chalk_1.default.green('✓ No pending sessions — everything is up to date.'));
            return;
        }
        console.log(chalk_1.default.bold(`\nProcessing ${pending.length} pending session${pending.length > 1 ? 's' : ''}...\n`));
        let totalSaved = 0, totalDeduped = 0;
        const config = (0, config_1.loadConfig)();
        const username = os_1.default.userInfo().username || 'local';
        for (const session of pending) {
            const spinner = (0, ora_1.default)(`${path_1.default.basename(session.repo_path)}/${session.branch || '?'} — ${formatAge(session.created_at)}`).start();
            try {
                const extracted = await (0, extract_1.extractMemoriesFromTranscript)(session.transcript);
                if (extracted.length === 0) {
                    (0, db_1.markSessionProcessed)(session.id);
                    spinner.succeed(chalk_1.default.dim('No memories worth capturing'));
                    continue;
                }
                let saved = 0, deduped = 0;
                for (const m of extracted) {
                    let embedding = null;
                    try {
                        const v = await (0, embed_1.embed)(m.content);
                        embedding = (0, embed_1.serializeVec)(v);
                    }
                    catch { }
                    if (embedding) {
                        const dupId = await (0, search_2.findDuplicate)(m.content, session.repo_path, config.similarity_threshold);
                        if (dupId) {
                            deduped++;
                            continue;
                        }
                    }
                    const id = (0, db_1.saveMemory)({
                        content: m.content, summary: m.summary, tags: m.tags,
                        file_paths: m.file_paths, functions: m.functions, embedding,
                        repo_path: session.repo_path, git_commit: session.commit,
                        git_branch: session.branch, created_by: username, source: 'auto', stale: 0,
                    });
                    saved++;
                    if (m.file_paths.length > 0) {
                        const absFiles = (0, git_1.resolveFilePaths)(m.file_paths, session.repo_path);
                        (0, db_1.saveMemoryFiles)(id, absFiles.map(fp => ({ path: path_1.default.relative(session.repo_path, fp), hash: (0, git_1.hashFile)(fp) })));
                    }
                    if (opts.verbose)
                        console.log(`   ${chalk_1.default.cyan(`[${m.tags[0] || 'note'}]`)} ${m.summary}`);
                }
                (0, db_1.markSessionProcessed)(session.id);
                totalSaved += saved;
                totalDeduped += deduped;
                spinner.succeed(`${chalk_1.default.green(saved + ' saved')}${deduped > 0 ? chalk_1.default.dim(` · ${deduped} dupes skipped`) : ''}`);
            }
            catch (e) {
                spinner.fail(chalk_1.default.red(e?.message || 'failed'));
            }
        }
        console.log(chalk_1.default.bold(`\nDone. ${totalSaved} new memories` + (totalDeduped > 0 ? `, ${totalDeduped} duplicates skipped.` : '.') + '\n'));
        return;
    }
    // ── session ID mode: background worker (called by Stop hook) ──────────
    try {
        const session = (0, db_1.getSession)(sessionId);
        if (!session || session.processed)
            return;
        (0, db_1.pruneOldSessions)(7);
        const memories = await (0, extract_1.extractMemoriesFromTranscript)(session.transcript);
        if (memories.length === 0) {
            (0, db_1.markSessionProcessed)(sessionId);
            return;
        }
        const username = os_1.default.userInfo().username || 'local';
        const config = (0, config_1.loadConfig)();
        let saved = 0, deduped = 0;
        for (const m of memories) {
            // Embed the memory
            let embedding = null;
            try {
                const vec = await (0, embed_1.embed)(m.content);
                embedding = (0, embed_1.serializeVec)(vec);
            }
            catch { /* embedding optional */ }
            // Deduplication: skip if a very similar memory already exists
            if (embedding) {
                const dupId = await (0, search_2.findDuplicate)(m.content, session.repo_path, config.similarity_threshold);
                if (dupId) {
                    deduped++;
                    if (opts?.verbose)
                        console.error(`[teammind] Deduped: "${m.summary}"`);
                    continue;
                }
            }
            const id = (0, db_1.saveMemory)({
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
            });
            saved++;
            // Save file refs with current hashes
            if (m.file_paths.length > 0) {
                const absFiles = (0, git_1.resolveFilePaths)(m.file_paths, session.repo_path);
                (0, db_1.saveMemoryFiles)(id, absFiles.map(fp => ({
                    path: path_1.default.relative(session.repo_path, fp),
                    hash: (0, git_1.hashFile)(fp)
                })));
            }
        }
        if (opts?.verbose) {
            console.error(`[teammind] Extracted ${saved} new memories (${deduped} duplicates skipped)`);
        }
        (0, db_1.markSessionProcessed)(sessionId);
    }
    catch {
        // Background worker — silent failure is fine
    }
});
// ─── server (MCP server, called by Claude Code) ───────────────────────────────
program
    .command('server')
    .description('Start the MCP server (called by Claude Code)')
    .action(async () => {
    await (0, server_1.startMcpServer)();
});
// ─── Helpers ──────────────────────────────────────────────────────────────────
function patchClaudeSettings(settingsPath, startHookPath, stopHookPath, nodeExec, cliPath) {
    let settings = {};
    if ((0, fs_1.existsSync)(settingsPath)) {
        try {
            settings = JSON.parse((0, fs_1.readFileSync)(settingsPath, 'utf8'));
        }
        catch {
            settings = {};
        }
    }
    settings.hooks = settings.hooks || {};
    // SessionStart
    settings.hooks.SessionStart = (settings.hooks.SessionStart || [])
        .filter((h) => !JSON.stringify(h).includes('teammind'));
    settings.hooks.SessionStart.push({
        matcher: '',
        hooks: [{ type: 'command', command: `${JSON.stringify(nodeExec)} ${JSON.stringify(startHookPath)}` }]
    });
    // Stop
    settings.hooks.Stop = (settings.hooks.Stop || [])
        .filter((h) => !JSON.stringify(h).includes('teammind'));
    settings.hooks.Stop.push({
        matcher: '',
        hooks: [{ type: 'command', command: `${JSON.stringify(nodeExec)} ${JSON.stringify(stopHookPath)}` }]
    });
    // MCP server
    settings.mcpServers = settings.mcpServers || {};
    settings.mcpServers.teammind = {
        type: 'stdio',
        command: nodeExec,
        args: ['--no-warnings', cliPath, 'server']
    };
    (0, fs_1.mkdirSync)(path_1.default.dirname(settingsPath), { recursive: true });
    (0, fs_1.writeFileSync)(settingsPath, JSON.stringify(settings, null, 2));
}
function formatAge(ts) {
    const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
    if (days === 0)
        return 'today';
    if (days === 1)
        return 'yesterday';
    if (days < 30)
        return `${days}d ago`;
    if (days < 365)
        return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
}
// ─── sessions ────────────────────────────────────────────────────────────────
program
    .command('sessions')
    .description('List captured sessions (processed and pending extraction)')
    .option('-n, --limit <n>', 'Number of sessions to show', '15')
    .action(async (opts) => {
    const limit = parseInt(opts.limit) || 15;
    const sessions = (0, db_2.getAllSessions)(limit);
    if (sessions.length === 0) {
        console.log(chalk_1.default.dim('\nNo sessions captured yet.\n'));
        return;
    }
    const pending = sessions.filter(s => !s.processed);
    const done = sessions.filter(s => s.processed);
    console.log();
    if (pending.length > 0) {
        console.log(chalk_1.default.yellow.bold(`⏳ Pending extraction (${pending.length})`));
        console.log(chalk_1.default.dim('   Run `teammind extract --pending` to process these now\n'));
        for (const s of pending) {
            const age = formatAge(s.created_at);
            const kb = Math.round(s.transcript_len / 1024);
            const repo = path_1.default.basename(s.repo_path);
            console.log(`   ${chalk_1.default.white(s.id.slice(0, 8))}  ${repo}/${s.branch || '?'}  ${kb}KB  ${chalk_1.default.dim(age)}`);
        }
        console.log();
    }
    if (done.length > 0) {
        console.log(chalk_1.default.green.bold(`✓ Processed (${done.length})`));
        console.log();
        for (const s of done.slice(0, 8)) {
            const age = formatAge(s.created_at);
            const kb = Math.round(s.transcript_len / 1024);
            const repo = path_1.default.basename(s.repo_path);
            console.log(`   ${chalk_1.default.dim(s.id.slice(0, 8))}  ${repo}/${s.branch || '?'}  ${kb}KB  ${chalk_1.default.dim(age)}`);
        }
    }
    console.log();
});
// ─── config ───────────────────────────────────────────────────────────────────
program
    .command('config')
    .description('View or update TeamMind configuration')
    .addCommand(new (require('commander').Command)('set')
    .description('Set a config value')
    .argument('<key>', `Config key (${config_1.VALID_KEYS.join(', ')})`)
    .argument('<value>', 'Value to set')
    .action((key, value) => {
    const coerced = (0, config_1.coerceConfigValue)(key, value);
    (0, config_1.saveConfig)({ [key]: coerced });
    console.log(chalk_1.default.green(`✓ ${key} = ${coerced}`));
}))
    .addCommand(new (require('commander').Command)('get')
    .description('Get a config value')
    .argument('<key>', 'Config key')
    .action((key) => {
    const config = (0, config_1.loadConfig)();
    const value = config[key];
    if (value === undefined) {
        console.log(chalk_1.default.red(`Unknown key: ${key}`));
    }
    else {
        console.log(String(value));
    }
}))
    .addCommand(new (require('commander').Command)('list')
    .description('Show all config values')
    .action(() => {
    const config = (0, config_1.loadConfig)();
    console.log();
    console.log(chalk_1.default.bold('TeamMind Configuration'));
    console.log(chalk_1.default.dim('  ~/.teammind/config.json\n'));
    console.log(`  ${'max_inject'.padEnd(25)} ${config.max_inject}`);
    console.log(`  ${'extraction_enabled'.padEnd(25)} ${config.extraction_enabled}`);
    console.log(`  ${'similarity_threshold'.padEnd(25)} ${config.similarity_threshold} (dedup threshold)`);
    console.log();
}))
    .action(() => {
    const config = (0, config_1.loadConfig)();
    console.log();
    console.log(chalk_1.default.bold('TeamMind Configuration'));
    console.log(chalk_1.default.dim('  Use `teammind config set <key> <value>` to change\n'));
    console.log(`  ${'max_inject'.padEnd(25)} ${config.max_inject}`);
    console.log(`  ${'extraction_enabled'.padEnd(25)} ${config.extraction_enabled}`);
    console.log(`  ${'similarity_threshold'.padEnd(25)} ${config.similarity_threshold}`);
    console.log();
});
program.parse();
//# sourceMappingURL=cli.js.map