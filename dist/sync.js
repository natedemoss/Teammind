"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportMemories = exportMemories;
exports.importMemories = importMemories;
exports.writeExportFile = writeExportFile;
const fs_1 = require("fs");
const db_1 = require("./db");
const embed_1 = require("./embed");
// Strip anything that looks like a secret
const SECRET_PATTERNS = [
    /\b[A-Za-z0-9_-]{20,}\b/g, // Long random tokens
    /(?:api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*\S+/gi,
    /sk-[A-Za-z0-9]{32,}/g, // OpenAI-style keys
    /ghp_[A-Za-z0-9]{36}/g, // GitHub tokens
    /Bearer\s+[A-Za-z0-9._-]+/gi,
];
function scrubSecrets(text) {
    let out = text;
    // Only scrub if the token looks suspicious (in a key=value context)
    out = out.replace(/(?:api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*\S+/gi, '[REDACTED]');
    out = out.replace(/sk-[A-Za-z0-9]{32,}/g, '[REDACTED]');
    out = out.replace(/ghp_[A-Za-z0-9]{36}/g, '[REDACTED]');
    out = out.replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [REDACTED]');
    return out;
}
function exportMemories(repoPath) {
    const memories = (0, db_1.getMemories)(repoPath, { limit: 1000, includeStale: false });
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
    };
}
async function importMemories(filePath, repoPath, createdBy = 'teammate') {
    if (!(0, fs_1.existsSync)(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    const raw = JSON.parse((0, fs_1.readFileSync)(filePath, 'utf8'));
    if (raw.version !== '1.0' || !Array.isArray(raw.memories)) {
        throw new Error('Invalid team memory file format');
    }
    let imported = 0;
    let skipped = 0;
    for (const m of raw.memories) {
        if (!m.content || !m.summary) {
            skipped++;
            continue;
        }
        // Embed and save
        let embedding = null;
        try {
            const vec = await (0, embed_1.embed)(m.content);
            embedding = (0, embed_1.serializeVec)(vec);
        }
        catch { /* embedding optional */ }
        const id = (0, db_1.saveMemory)({
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
        });
        // Save file refs without hashes (can't recompute historical hashes)
        if (m.file_paths.length > 0) {
            (0, db_1.saveMemoryFiles)(id, m.file_paths.map(fp => ({ path: fp, hash: '' })));
        }
        imported++;
    }
    return { imported, skipped };
}
function writeExportFile(exportData, outputPath) {
    (0, fs_1.writeFileSync)(outputPath, JSON.stringify(exportData, null, 2));
}
//# sourceMappingURL=sync.js.map