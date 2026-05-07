"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.embed = embed;
exports.cosineSimilarity = cosineSimilarity;
exports.serializeVec = serializeVec;
exports.deserializeVec = deserializeVec;
exports.keywordScore = keywordScore;
exports.warmupModel = warmupModel;
const constants_1 = require("./constants");
// Lazy-loaded pipeline — only initializes on first use
let _pipeline = null;
let _loading = false;
let _loadPromise = null;
async function getPipeline() {
    if (_pipeline)
        return _pipeline;
    if (_loadPromise)
        return _loadPromise;
    _loadPromise = (async () => {
        // @huggingface/transformers is ESM — use dynamic import
        const { pipeline, env } = await Promise.resolve().then(() => __importStar(require('@huggingface/transformers')));
        env.cacheDir = constants_1.MODEL_CACHE_DIR;
        env.allowRemoteModels = true;
        _pipeline = await pipeline('feature-extraction', constants_1.EMBED_MODEL, {
            dtype: 'q8', // 8-bit quantization for smaller footprint
        });
        return _pipeline;
    })();
    return _loadPromise;
}
async function embed(text) {
    const model = await getPipeline();
    const output = await model(text.slice(0, 512), { pooling: 'mean', normalize: true });
    return output.data;
}
function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0)
        return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
function serializeVec(vec) {
    return Buffer.from(vec.buffer);
}
function deserializeVec(buf) {
    // node:sqlite returns BLOBs as Uint8Array — normalize to Buffer first
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}
// Fast keyword overlap score — used when embeddings aren't available
function keywordScore(query, content) {
    const qWords = new Set(query.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    const cText = content.toLowerCase();
    let score = 0;
    for (const word of qWords) {
        if (cText.includes(word))
            score += 1;
    }
    return score / Math.max(qWords.size, 1);
}
// Pre-warm the model in background (called during init)
async function warmupModel() {
    await getPipeline();
    // Run a dummy embed to JIT-compile the ONNX graph
    await embed('warmup');
}
//# sourceMappingURL=embed.js.map