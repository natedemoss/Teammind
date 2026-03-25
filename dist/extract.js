"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractMemoriesFromTranscript = extractMemoriesFromTranscript;
exports.formatTranscript = formatTranscript;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const constants_1 = require("./constants");
const EXTRACTION_PROMPT = `You are analyzing a Claude Code session transcript to extract high-value memories for a development team.

Extract ONLY memories that provide non-obvious, lasting value:
✓ Bugs found and their root cause
✓ Architectural decisions made and WHY
✓ Non-obvious gotchas or undocumented behaviors
✓ Performance findings
✓ Security considerations
✓ API quirks or workarounds discovered
✓ Important constraints or business rules discovered in code

DO NOT extract:
✗ Generic programming advice
✗ Things obvious from reading the code
✗ Temporary debugging steps that were reverted
✗ Standard library usage
✗ Basic explanations of how code works

For each memory output valid JSON with these exact fields:
- content: Full explanation (2-5 sentences, enough context to be useful later)
- summary: One line, max 80 chars, action-oriented
- tags: Array from ["bug","decision","gotcha","pattern","performance","security","config","api"]
- file_paths: Array of relative file paths involved (empty array if none)
- functions: Array of "ClassName.methodName" or "functionName" (empty array if none)

Respond with ONLY a JSON array. If nothing worth remembering, respond with [].

TRANSCRIPT:
{{TRANSCRIPT}}`;
async function extractMemoriesFromTranscript(transcript, apiKey) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key)
        return [];
    try {
        const client = new sdk_1.default({ apiKey: key });
        // Trim transcript to avoid huge token counts (keep last 80k chars which is ~20k tokens)
        const trimmed = transcript.length > 80000
            ? transcript.slice(-80000)
            : transcript;
        const response = await client.messages.create({
            model: constants_1.HAIKU_MODEL,
            max_tokens: 4096,
            messages: [{
                    role: 'user',
                    content: EXTRACTION_PROMPT.replace('{{TRANSCRIPT}}', trimmed)
                }]
        });
        const text = response.content[0].type === 'text' ? response.content[0].text : '';
        // Extract JSON array — handle markdown code fences if present
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
            text.match(/(\[[\s\S]*\])/);
        if (!jsonMatch)
            return [];
        const raw = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        if (!Array.isArray(raw))
            return [];
        return raw
            .filter((m) => m && typeof m.content === 'string' && m.content.length > 10)
            .map((m) => ({
            content: String(m.content || '').slice(0, 2000),
            summary: String(m.summary || m.content || '').slice(0, 80),
            tags: Array.isArray(m.tags) ? m.tags.slice(0, 5) : [],
            file_paths: Array.isArray(m.file_paths) ? m.file_paths : [],
            functions: Array.isArray(m.functions) ? m.functions : [],
        }));
    }
    catch {
        return [];
    }
}
// Format a conversation transcript from Claude Code's hook payload
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