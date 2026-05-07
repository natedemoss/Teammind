"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.saveMemory = saveMemory;
exports.saveMemoryFiles = saveMemoryFiles;
exports.getMemories = getMemories;
exports.getAllMemoriesWithEmbeddings = getAllMemoriesWithEmbeddings;
exports.getMemoryById = getMemoryById;
exports.deleteMemory = deleteMemory;
exports.deleteStaleMemories = deleteStaleMemories;
exports.markMemoryStale = markMemoryStale;
exports.countMemories = countMemories;
exports.getMemoryFiles = getMemoryFiles;
exports.getMemoriesWithFiles = getMemoriesWithFiles;
exports.getTagStats = getTagStats;
exports.deleteAllMemories = deleteAllMemories;
exports.updateMemory = updateMemory;
exports.getMemoriesByTag = getMemoriesByTag;
exports.saveSession = saveSession;
exports.getSession = getSession;
exports.markSessionProcessed = markSessionProcessed;
exports.countProcessedSessions = countProcessedSessions;
exports.pruneOldSessions = pruneOldSessions;
exports.getPendingSessions = getPendingSessions;
exports.getAllSessions = getAllSessions;
const fs_1 = require("fs");
const nanoid_1 = require("nanoid");
const constants_1 = require("./constants");
function normPath(p) {
    return p.replace(/\\/g, '/');
}
// node:sqlite is built into Node 22+ — zero native deps, no compilation needed
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite');
let _db = null;
function getDb() {
    if (_db)
        return _db;
    if (!(0, fs_1.existsSync)(constants_1.TEAMMIND_DIR)) {
        (0, fs_1.mkdirSync)(constants_1.TEAMMIND_DIR, { recursive: true });
    }
    _db = new DatabaseSync(constants_1.DB_PATH);
    _db.exec("PRAGMA journal_mode=WAL");
    _db.exec("PRAGMA foreign_keys=ON");
    _db.exec("PRAGMA synchronous=NORMAL");
    runMigrations(_db);
    return _db;
}
function runMigrations(db) {
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
  `);
}
// ─── Helpers ────────────────────────────────────────────────────────────────
function rowToMemory(row) {
    return {
        id: row.id,
        content: row.content,
        summary: row.summary,
        tags: JSON.parse(row.tags || '[]'),
        file_paths: JSON.parse(row.file_paths || '[]'),
        functions: JSON.parse(row.functions || '[]'),
        embedding: row.embedding,
        repo_path: row.repo_path,
        git_commit: row.git_commit,
        git_branch: row.git_branch,
        created_at: row.created_at,
        updated_at: row.updated_at,
        created_by: row.created_by,
        source: row.source,
        stale: row.stale,
    };
}
// ─── Memory operations ───────────────────────────────────────────────────────
function saveMemory(m) {
    const db = getDb();
    const id = (0, nanoid_1.nanoid)();
    const now = Date.now();
    db.prepare(`
    INSERT INTO memories
      (id, content, summary, tags, file_paths, functions, embedding,
       repo_path, git_commit, git_branch, created_at, updated_at,
       created_by, source, stale)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, m.content, m.summary, JSON.stringify(m.tags), JSON.stringify(m.file_paths), JSON.stringify(m.functions), m.embedding, normPath(m.repo_path), m.git_commit, m.git_branch, now, now, m.created_by, m.source, m.stale);
    return id;
}
function saveMemoryFiles(memoryId, files) {
    if (files.length === 0)
        return;
    const db = getDb();
    db.exec('BEGIN');
    try {
        const insert = db.prepare('INSERT OR REPLACE INTO memory_files (memory_id, file_path, file_hash) VALUES (?, ?, ?)');
        for (const f of files) {
            insert.run(memoryId, f.path, f.hash);
        }
        db.exec('COMMIT');
    }
    catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
}
function getMemories(repoPath, opts = {}) {
    const db = getDb();
    const { limit = 50, includeStale = false } = opts;
    const sql = includeStale
        ? 'SELECT * FROM memories WHERE repo_path = ? ORDER BY created_at DESC LIMIT ?'
        : 'SELECT * FROM memories WHERE repo_path = ? AND stale = 0 ORDER BY created_at DESC LIMIT ?';
    const rows = db.prepare(sql).all(normPath(repoPath), limit);
    return rows.map(rowToMemory);
}
function getAllMemoriesWithEmbeddings(repoPath) {
    const db = getDb();
    const rows = db.prepare(`
    SELECT * FROM memories
    WHERE repo_path = ? AND stale = 0 AND embedding IS NOT NULL
    ORDER BY created_at DESC LIMIT 500
  `).all(normPath(repoPath));
    return rows.map(rowToMemory);
}
function getMemoryById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    return row ? rowToMemory(row) : null;
}
function deleteMemory(id) {
    getDb().prepare('DELETE FROM memories WHERE id = ?').run(id);
}
function deleteStaleMemories(repoPath) {
    const result = getDb().prepare('DELETE FROM memories WHERE repo_path = ? AND stale = 1').run(normPath(repoPath));
    return result.changes;
}
function markMemoryStale(id) {
    getDb().prepare('UPDATE memories SET stale = 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
}
function countMemories(repoPath) {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as n FROM memories WHERE repo_path = ? AND stale = 0').get(normPath(repoPath));
    return row.n;
}
function getMemoryFiles(memoryId) {
    return getDb().prepare('SELECT file_path, file_hash FROM memory_files WHERE memory_id = ?').all(memoryId);
}
function getMemoriesWithFiles(repoPath) {
    const memories = getMemories(repoPath, { includeStale: false });
    return memories.map(m => ({
        ...m,
        tracked_files: getMemoryFiles(m.id)
    }));
}
function getTagStats(repoPath) {
    const rows = getDb().prepare('SELECT tags FROM memories WHERE repo_path = ? AND stale = 0').all(normPath(repoPath));
    const stats = {};
    for (const row of rows) {
        try {
            for (const tag of JSON.parse(row.tags || '[]')) {
                stats[tag] = (stats[tag] || 0) + 1;
            }
        }
        catch { }
    }
    return stats;
}
function deleteAllMemories(repoPath) {
    const result = getDb().prepare('DELETE FROM memories WHERE repo_path = ?').run(normPath(repoPath));
    return result.changes;
}
function updateMemory(id, content, summary) {
    getDb().prepare('UPDATE memories SET content = ?, summary = ?, updated_at = ? WHERE id = ?').run(content, summary, Date.now(), id);
}
function getMemoriesByTag(repoPath, tag, limit = 50) {
    const rows = getDb().prepare(`SELECT * FROM memories WHERE repo_path = ? AND stale = 0 AND tags LIKE ? ORDER BY created_at DESC LIMIT ?`).all(normPath(repoPath), `%"${tag}"%`, limit);
    return rows.map(rowToMemory);
}
// ─── Session operations ──────────────────────────────────────────────────────
function saveSession(s) {
    const db = getDb();
    const id = (0, nanoid_1.nanoid)();
    db.prepare(`
    INSERT INTO sessions (id, repo_path, branch, commit_hash, transcript, processed, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(id, s.repo_path, s.branch, s.commit, s.transcript, Date.now());
    return id;
}
function getSession(id) {
    const row = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    if (!row)
        return null;
    return {
        id: row.id,
        repo_path: row.repo_path,
        branch: row.branch,
        commit: row.commit_hash,
        transcript: row.transcript,
        processed: row.processed,
        created_at: row.created_at,
    };
}
function markSessionProcessed(id) {
    getDb().prepare('UPDATE sessions SET processed = 1 WHERE id = ?').run(id);
}
function countProcessedSessions() {
    const row = getDb().prepare('SELECT COUNT(*) as n FROM sessions WHERE processed = 1').get();
    return row.n;
}
function pruneOldSessions(daysOld = 7) {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    getDb().prepare('DELETE FROM sessions WHERE created_at < ? AND processed = 1').run(cutoff);
}
function getPendingSessions() {
    const rows = getDb().prepare('SELECT * FROM sessions WHERE processed = 0 ORDER BY created_at DESC').all();
    return rows.map(row => ({
        id: row.id,
        repo_path: row.repo_path,
        branch: row.branch,
        commit: row.commit_hash,
        transcript: row.transcript,
        processed: row.processed,
        created_at: row.created_at,
    }));
}
function getAllSessions(limit = 20) {
    const rows = getDb().prepare(`
    SELECT id, repo_path, branch, commit_hash, processed, created_at,
           LENGTH(transcript) as transcript_len
    FROM sessions ORDER BY created_at DESC LIMIT ?
  `).all(limit);
    return rows.map(row => ({
        id: row.id,
        repo_path: row.repo_path,
        branch: row.branch,
        commit: row.commit_hash,
        transcript: '',
        processed: row.processed,
        created_at: row.created_at,
        transcript_len: row.transcript_len,
    }));
}
//# sourceMappingURL=db.js.map