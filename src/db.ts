import { mkdirSync, existsSync } from 'fs'
import { nanoid } from 'nanoid'
import { DB_PATH, TEAMMIND_DIR } from './constants'

function normPath(p: string): string {
  return p.replace(/\\/g, '/')
}

// node:sqlite is built into Node 22+ — zero native deps, no compilation needed
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite')

export interface Memory {
  id: string
  content: string
  summary: string
  tags: string[]
  file_paths: string[]
  functions: string[]
  embedding: Buffer | null
  repo_path: string
  git_commit: string | null
  git_branch: string | null
  created_at: number
  updated_at: number
  created_by: string
  source: 'auto' | 'manual'
  stale: 0 | 1
}

export interface Session {
  id: string
  repo_path: string
  branch: string | null
  commit: string | null
  transcript: string
  processed: 0 | 1
  created_at: number
}

let _db: any = null

export function getDb(): any {
  if (_db) return _db

  if (!existsSync(TEAMMIND_DIR)) {
    mkdirSync(TEAMMIND_DIR, { recursive: true })
  }

  _db = new DatabaseSync(DB_PATH)
  _db.exec("PRAGMA journal_mode=WAL")
  _db.exec("PRAGMA foreign_keys=ON")
  _db.exec("PRAGMA synchronous=NORMAL")

  runMigrations(_db)
  return _db
}

function runMigrations(db: any) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id          TEXT PRIMARY KEY,
      content     TEXT NOT NULL,
      summary     TEXT NOT NULL DEFAULT '',
      tags        TEXT NOT NULL DEFAULT '[]',
      file_paths  TEXT NOT NULL DEFAULT '[]',
      functions   TEXT NOT NULL DEFAULT '[]',
      embedding   BLOB,
      repo_path   TEXT NOT NULL,
      git_commit  TEXT,
      git_branch  TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      created_by  TEXT NOT NULL DEFAULT 'local',
      source      TEXT NOT NULL DEFAULT 'auto',
      stale       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS memory_files (
      memory_id   TEXT NOT NULL,
      file_path   TEXT NOT NULL,
      file_hash   TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (memory_id, file_path),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      repo_path   TEXT NOT NULL,
      branch      TEXT,
      commit_hash TEXT,
      transcript  TEXT NOT NULL,
      processed   INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memories_repo    ON memories(repo_path);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_proc    ON sessions(processed);
  `)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rowToMemory(row: Record<string, any>): Memory {
  return {
    id: row.id,
    content: row.content,
    summary: row.summary,
    tags: JSON.parse(row.tags || '[]'),
    file_paths: JSON.parse(row.file_paths || '[]'),
    functions: JSON.parse(row.functions || '[]'),
    embedding: row.embedding as Buffer | null,
    repo_path: row.repo_path,
    git_commit: row.git_commit,
    git_branch: row.git_branch,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    source: row.source as 'auto' | 'manual',
    stale: row.stale as 0 | 1,
  }
}

// ─── Memory operations ───────────────────────────────────────────────────────

export function saveMemory(m: Omit<Memory, 'id' | 'created_at' | 'updated_at'>): string {
  const db = getDb()
  const id = nanoid()
  const now = Date.now()

  db.prepare(`
    INSERT INTO memories
      (id, content, summary, tags, file_paths, functions, embedding,
       repo_path, git_commit, git_branch, created_at, updated_at,
       created_by, source, stale)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, m.content, m.summary,
    JSON.stringify(m.tags),
    JSON.stringify(m.file_paths),
    JSON.stringify(m.functions),
    m.embedding,
    normPath(m.repo_path), m.git_commit, m.git_branch,
    now, now, m.created_by, m.source, m.stale
  )

  return id
}

export function saveMemoryFiles(memoryId: string, files: Array<{ path: string; hash: string }>) {
  if (files.length === 0) return
  const db = getDb()
  db.exec('BEGIN')
  try {
    const insert = db.prepare(
      'INSERT OR REPLACE INTO memory_files (memory_id, file_path, file_hash) VALUES (?, ?, ?)'
    )
    for (const f of files) {
      insert.run(memoryId, f.path, f.hash)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function getMemories(
  repoPath: string,
  opts: { limit?: number; includeStale?: boolean } = {}
): Memory[] {
  const db = getDb()
  const { limit = 50, includeStale = false } = opts
  const sql = includeStale
    ? 'SELECT * FROM memories WHERE repo_path = ? ORDER BY created_at DESC LIMIT ?'
    : 'SELECT * FROM memories WHERE repo_path = ? AND stale = 0 ORDER BY created_at DESC LIMIT ?'
  const rows = db.prepare(sql).all(normPath(repoPath), limit) as Record<string, any>[]
  return rows.map(rowToMemory)
}

export function getAllMemoriesWithEmbeddings(repoPath: string): Memory[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE repo_path = ? AND stale = 0 AND embedding IS NOT NULL
    ORDER BY created_at DESC LIMIT 500
  `).all(normPath(repoPath)) as Record<string, any>[]
  return rows.map(rowToMemory)
}

export function getMemoryById(id: string): Memory | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id)
  return row ? rowToMemory(row as Record<string, any>) : null
}

export function deleteMemory(id: string) {
  getDb().prepare('DELETE FROM memories WHERE id = ?').run(id)
}

export function deleteStaleMemories(repoPath: string): number {
  const result = getDb().prepare('DELETE FROM memories WHERE repo_path = ? AND stale = 1').run(normPath(repoPath))
  return result.changes as number
}

export function markMemoryStale(id: string) {
  getDb().prepare('UPDATE memories SET stale = 1, updated_at = ? WHERE id = ?').run(Date.now(), id)
}

export function countMemories(repoPath: string): number {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as n FROM memories WHERE repo_path = ? AND stale = 0').get(normPath(repoPath)) as { n: number }
  return row.n
}

export function getMemoryFiles(memoryId: string): Array<{ file_path: string; file_hash: string }> {
  return getDb().prepare('SELECT file_path, file_hash FROM memory_files WHERE memory_id = ?').all(memoryId) as any[]
}

export function getMemoriesWithFiles(repoPath: string): Array<Memory & { tracked_files: Array<{ file_path: string; file_hash: string }> }> {
  const memories = getMemories(repoPath, { includeStale: false })
  return memories.map(m => ({
    ...m,
    tracked_files: getMemoryFiles(m.id)
  }))
}

export function getTagStats(repoPath: string): Record<string, number> {
  const rows = getDb().prepare(
    'SELECT tags FROM memories WHERE repo_path = ? AND stale = 0'
  ).all(normPath(repoPath)) as Record<string, any>[]
  const stats: Record<string, number> = {}
  for (const row of rows) {
    try {
      for (const tag of JSON.parse(row.tags || '[]')) {
        stats[tag] = (stats[tag] || 0) + 1
      }
    } catch {}
  }
  return stats
}

export function deleteAllMemories(repoPath: string): number {
  const result = getDb().prepare('DELETE FROM memories WHERE repo_path = ?').run(normPath(repoPath))
  return result.changes as number
}

export function updateMemory(id: string, content: string, summary: string) {
  getDb().prepare(
    'UPDATE memories SET content = ?, summary = ?, updated_at = ? WHERE id = ?'
  ).run(content, summary, Date.now(), id)
}

export function getMemoriesByTag(repoPath: string, tag: string, limit = 50): Memory[] {
  const rows = getDb().prepare(
    `SELECT * FROM memories WHERE repo_path = ? AND stale = 0 AND tags LIKE ? ORDER BY created_at DESC LIMIT ?`
  ).all(normPath(repoPath), `%"${tag}"%`, limit) as Record<string, any>[]
  return rows.map(rowToMemory)
}

// ─── Session operations ──────────────────────────────────────────────────────

export function saveSession(s: Omit<Session, 'id' | 'processed' | 'created_at'>): string {
  const db = getDb()
  const id = nanoid()
  db.prepare(`
    INSERT INTO sessions (id, repo_path, branch, commit_hash, transcript, processed, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(id, s.repo_path, s.branch, s.commit, s.transcript, Date.now())
  return id
}

export function getSession(id: string): Session | null {
  const row = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, any> | undefined
  if (!row) return null
  return {
    id: row.id,
    repo_path: row.repo_path,
    branch: row.branch,
    commit: row.commit_hash,
    transcript: row.transcript,
    processed: row.processed as 0 | 1,
    created_at: row.created_at,
  } as Session
}

export function markSessionProcessed(id: string) {
  getDb().prepare('UPDATE sessions SET processed = 1 WHERE id = ?').run(id)
}

export function countProcessedSessions(): number {
  const row = getDb().prepare('SELECT COUNT(*) as n FROM sessions WHERE processed = 1').get() as { n: number }
  return row.n
}

export function pruneOldSessions(daysOld = 7) {
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000
  getDb().prepare('DELETE FROM sessions WHERE created_at < ? AND processed = 1').run(cutoff)
}

export function getPendingSessions(): Session[] {
  const rows = getDb().prepare(
    'SELECT * FROM sessions WHERE processed = 0 ORDER BY created_at DESC'
  ).all() as Record<string, any>[]
  return rows.map(row => ({
    id: row.id,
    repo_path: row.repo_path,
    branch: row.branch,
    commit: row.commit_hash,
    transcript: row.transcript,
    processed: row.processed as 0 | 1,
    created_at: row.created_at,
  } as Session))
}

export function getAllSessions(limit = 20): Array<Session & { transcript_len: number }> {
  const rows = getDb().prepare(`
    SELECT id, repo_path, branch, commit_hash, processed, created_at,
           LENGTH(transcript) as transcript_len
    FROM sessions ORDER BY created_at DESC LIMIT ?
  `).all(limit) as Record<string, any>[]
  return rows.map(row => ({
    id: row.id,
    repo_path: row.repo_path,
    branch: row.branch,
    commit: row.commit_hash,
    transcript: '',
    processed: row.processed as 0 | 1,
    created_at: row.created_at,
    transcript_len: row.transcript_len,
  }))
}
