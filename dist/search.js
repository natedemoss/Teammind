"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchMemories = searchMemories;
exports.rankMemoriesForInjection = rankMemoriesForInjection;
exports.findDuplicate = findDuplicate;
exports.formatMemoriesForContext = formatMemoriesForContext;
const db_1 = require("./db");
const embed_1 = require("./embed");
const constants_1 = require("./constants");
// Full semantic + keyword hybrid search — used by MCP tool (mid-session)
async function searchMemories(query, repoPath, opts = {}) {
    const { filePath, limit = 5 } = opts;
    const memories = (0, db_1.getAllMemoriesWithEmbeddings)(repoPath);
    if (memories.length === 0)
        return [];
    // Embed query
    let queryVec = null;
    try {
        queryVec = await (0, embed_1.embed)(query);
    }
    catch {
        // Fall back to keyword search if embedding fails
    }
    const scored = memories.map(m => {
        let score = 0;
        // Semantic score
        if (queryVec && m.embedding) {
            const memVec = (0, embed_1.deserializeVec)(m.embedding);
            score += (0, embed_1.cosineSimilarity)(queryVec, memVec) * 2;
        }
        // Keyword score
        score += (0, embed_1.keywordScore)(query, m.content + ' ' + m.summary);
        // Recency boost: memories from last 14 days get +0.1
        const ageDays = (Date.now() - m.created_at) / (1000 * 60 * 60 * 24);
        if (ageDays < 14)
            score += 0.1 * (1 - ageDays / 14);
        // File path relevance boost
        if (filePath) {
            const normalizedFp = filePath.replace(/\\/g, '/');
            if (m.file_paths.some(fp => normalizedFp.includes(fp) || fp.includes(normalizedFp))) {
                score += 0.5;
            }
        }
        // Tag boost for high-priority tags
        if (m.tags.includes('bug') || m.tags.includes('gotcha'))
            score += 0.05;
        if (m.tags.includes('security'))
            score += 0.1;
        return { ...m, score };
    });
    // Apply file filter if provided
    const filtered = filePath
        ? scored.filter(m => {
            const normalizedFp = filePath.replace(/\\/g, '/');
            return m.file_paths.length === 0 ||
                m.file_paths.some(fp => normalizedFp.includes(fp) || fp.includes(normalizedFp));
        })
        : scored;
    return filtered
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}
// Fast keyword-only ranking — used for session injection (no model needed, must be fast)
function rankMemoriesForInjection(repoPath, branch, limit = constants_1.MAX_INJECT_MEMORIES) {
    const memories = (0, db_1.getMemories)(repoPath, { limit: 200, includeStale: false });
    if (memories.length === 0)
        return [];
    const scored = memories.map(m => {
        let score = 0;
        // Recency: most recent gets highest score
        const ageDays = (Date.now() - m.created_at) / (1000 * 60 * 60 * 24);
        score += Math.max(0, 10 - ageDays * 0.5);
        // Branch match boost
        if (m.git_branch === branch)
            score += 3;
        // Tag priority
        if (m.tags.includes('gotcha') || m.tags.includes('bug'))
            score += 2;
        if (m.tags.includes('security'))
            score += 3;
        if (m.tags.includes('config'))
            score += 1;
        return { ...m, score };
    });
    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}
// Check if a memory is a near-duplicate of an existing one
// Returns the ID of the duplicate if found, null otherwise
async function findDuplicate(content, repoPath, threshold = 0.88) {
    const existing = (0, db_1.getAllMemoriesWithEmbeddings)(repoPath);
    if (existing.length === 0)
        return null;
    let queryVec = null;
    try {
        queryVec = await (0, embed_1.embed)(content);
    }
    catch {
        return null; // can't dedup without embeddings
    }
    for (const m of existing) {
        if (!m.embedding)
            continue;
        const memVec = (0, embed_1.deserializeVec)(m.embedding);
        const sim = (0, embed_1.cosineSimilarity)(queryVec, memVec);
        if (sim >= threshold)
            return m.id;
    }
    return null;
}
// Format memories for injection into Claude's context
function formatMemoriesForContext(memories, projectName, branch) {
    if (memories.length === 0)
        return '';
    const lines = [
        `<team_memory project="${projectName}" branch="${branch}">`
    ];
    for (let i = 0; i < memories.length; i++) {
        const m = memories[i];
        const tag = m.tags[0] || 'note';
        const staleTag = m.stale ? ' [may be outdated]' : '';
        const fileHint = m.file_paths.length > 0 ? ` — ${m.file_paths[0]}` : '';
        lines.push(`${i + 1}. [${tag}] ${m.summary}${staleTag}${fileHint}`);
    }
    lines.push(`</team_memory>`);
    lines.push(`(${memories.length} memories loaded — use memory_search tool for details or more)`);
    return lines.join('\n');
}
//# sourceMappingURL=search.js.map