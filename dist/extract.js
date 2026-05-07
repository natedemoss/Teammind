"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractMemoriesFromTranscript = extractMemoriesFromTranscript;
exports.formatTranscript = formatTranscript;
// [tag, regex, weight]  — causal/gotcha language weighted higher (2-3x)
const SIGNALS = [
    ['bug', /\b(bug|bugs|broken|crash(?:es|ed)?|root cause|caused by|turned out|was failing|failed because)\b/gi, 1],
    ['bug', /\b(fix(?:ed|es|ing)?|the (?:real )?(?:issue|problem|cause) was|traced (?:back )?to)\b/gi, 1],
    ['decision', /\b(instead of|rather than|chose|decided|we (?:chose|opted|went with)|switch(?:ed)? (?:to|from)|replaced?|prefer(?:red)?|avoid(?:ed)?)\b/gi, 2],
    ['decision', /\b(the reason|because|that'?s why|this is why|so that|in order to|which (?:is why|means))\b/gi, 2],
    ['gotcha', /\b(note that|important:|caveat|warning:|gotcha|watch out|be careful|unexpected|non-obvious|tricky|quirk|pitfall|edge case|footgun)\b/gi, 3],
    ['performance', /\b(slow|performance|bottleneck|optim(?:ize|izing|ized)|memory leak|throughput|latency|timeout|blocking)\b/gi, 1],
    ['security', /\b(security|vulnerab(?:le|ility)|injection|xss|csrf|sanitize|auth(?:entication|orization)?|secret|credential)\b/gi, 2],
    ['config', /\b(env(?:ironment)? variable|\.env\b|config(?:uration)?|flag|env var)\b/gi, 1],
    ['api', /\b(api|sdk|endpoint|workaround|undocumented|library|package)\b/gi, 1],
    ['pattern', /\b(pattern|architecture|convention|approach|design|strategy)\b/gi, 1],
];
const SCORE_THRESHOLD_BASE = 3;
const SCORE_THRESHOLD_LONG = 5; // stricter for very long sessions (more noise)
function scoreAndTag(text) {
    const tagSet = new Set();
    let score = 0;
    for (const [tag, rx, weight] of SIGNALS) {
        const count = (text.match(rx) || []).length;
        if (count > 0) {
            score += count * weight;
            tagSet.add(tag);
        }
    }
    return { score, tags: [...tagSet].slice(0, 5) };
}
function firstSentence(text) {
    const m = text.match(/^.{10,}?[.!?](?:\s|$)/);
    return ((m ? m[0] : text.slice(0, 80)).trim()).slice(0, 80);
}
function extractFilePaths(text) {
    const matches = text.match(/\b(?:src|dist|lib|app|pages|components|hooks|utils|api|test|spec|config)\/[\w./\-]+\.\w+/g) || [];
    return [...new Set(matches)].slice(0, 5);
}
function extractFunctions(text) {
    const SKIP = new Set(['if', 'for', 'while', 'switch', 'return', 'async', 'await', 'require', 'import', 'export', 'function', 'const', 'let', 'var', 'new', 'typeof', 'instanceof']);
    const matches = text.match(/\b(?:[A-Z][a-zA-Z]+\.)?[a-z][a-zA-Z0-9]{2,}\(\)/g) || [];
    return [...new Set(matches)]
        .map(m => m.replace('()', ''))
        .filter(m => !SKIP.has(m))
        .slice(0, 5);
}
// Word-overlap dedup within the same extraction pass (avoids saving nearly identical paragraphs)
function wordOverlap(a, b) {
    const words = (s) => new Set(s.toLowerCase().split(/\W+/).filter(w => w.length > 4));
    const wa = words(a), wb = words(b);
    const intersection = [...wa].filter(w => wb.has(w)).length;
    const union = new Set([...wa, ...wb]).size;
    return union === 0 ? 0 : intersection / union;
}
function isCodeBlock(text) {
    return text.startsWith('```') || text.startsWith('    ') || text.startsWith('\t');
}
function isPureBulletList(text) {
    const lines = text.split('\n').filter(l => l.trim());
    return lines.length > 1 && lines.every(l => /^\s*[-*•\d.]\s/.test(l));
}
// Extract assistant message bodies from the formatted transcript
function getAssistantParagraphs(transcript) {
    const all = [];
    const rx = /\[ASSISTANT\]:\s*/gi;
    let m;
    while ((m = rx.exec(transcript)) !== null) {
        // Grab text from end of marker to next role marker
        const start = m.index + m[0].length;
        const rest = transcript.slice(start);
        const cutoff = rest.search(/\n\[(?:USER|HUMAN|ASSISTANT)\]:/i);
        const body = (cutoff > 0 ? rest.slice(0, cutoff) : rest).trim();
        if (body.length < 100)
            continue;
        const paras = body
            .split(/\n{2,}/)
            .map(p => p.trim())
            .filter(p => p.length >= 60 &&
            !isCodeBlock(p) &&
            !isPureBulletList(p));
        all.push(...paras);
    }
    return all;
}
// No API key required — extracts memories locally using signal heuristics
async function extractMemoriesFromTranscript(transcript, _apiKey // kept for interface compatibility, not used
) {
    if (!transcript || transcript.length < 100)
        return [];
    // Use a stricter threshold for very long sessions to reduce noise
    const threshold = transcript.length > 50000 ? SCORE_THRESHOLD_LONG : SCORE_THRESHOLD_BASE;
    const memories = [];
    const paragraphs = getAssistantParagraphs(transcript);
    for (const para of paragraphs) {
        const { score, tags } = scoreAndTag(para);
        if (score < threshold)
            continue;
        // Skip near-duplicates found within this same session
        if (memories.some(m => wordOverlap(m.content, para) > 0.6))
            continue;
        memories.push({
            content: para.slice(0, 2000),
            summary: firstSentence(para),
            tags,
            file_paths: extractFilePaths(para),
            functions: extractFunctions(para),
        });
    }
    return memories.slice(0, 10);
}
// Format a raw hook payload into [ROLE]: content lines
function formatTranscript(hookPayload) {
    try {
        const transcript = hookPayload?.transcript || hookPayload?.messages || [];
        if (!Array.isArray(transcript) || transcript.length === 0) {
            return typeof hookPayload === 'string' ? hookPayload : JSON.stringify(hookPayload);
        }
        return transcript
            .map((msg) => {
            const role = (msg.role || 'unknown').toUpperCase();
            const content = Array.isArray(msg.content)
                ? msg.content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('\n')
                : String(msg.content || '');
            return `[${role}]: ${content}`;
        })
            .join('\n\n');
    }
    catch {
        return JSON.stringify(hookPayload).slice(0, 50000);
    }
}
//# sourceMappingURL=extract.js.map