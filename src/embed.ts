import { MODEL_CACHE_DIR, EMBED_MODEL, EMBED_DIM } from './constants'

// Lazy-loaded pipeline — only initializes on first use
let _pipeline: any = null
let _loading = false
let _loadPromise: Promise<any> | null = null

async function getPipeline(): Promise<any> {
  if (_pipeline) return _pipeline
  if (_loadPromise) return _loadPromise

  _loadPromise = (async () => {
    // @huggingface/transformers is ESM — use dynamic import
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = MODEL_CACHE_DIR
    env.allowRemoteModels = true

    _pipeline = await pipeline('feature-extraction', EMBED_MODEL, {
      dtype: 'q8',  // 8-bit quantization for smaller footprint
    })
    return _pipeline
  })()

  return _loadPromise
}

export async function embed(text: string): Promise<Float32Array> {
  const model = await getPipeline()
  const output = await model(text.slice(0, 512), { pooling: 'mean', normalize: true })
  return output.data as Float32Array
}

export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0, normA = 0, normB = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function serializeVec(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer)
}

export function deserializeVec(buf: Buffer | Uint8Array): Float32Array {
  // node:sqlite returns BLOBs as Uint8Array — normalize to Buffer first
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
}

// Fast keyword overlap score — used when embeddings aren't available
export function keywordScore(query: string, content: string): number {
  const qWords = new Set(
    query.toLowerCase().split(/\W+/).filter(w => w.length > 2)
  )
  const cText = content.toLowerCase()
  let score = 0
  for (const word of qWords) {
    if (cText.includes(word)) score += 1
  }
  return score / Math.max(qWords.size, 1)
}

// Pre-warm the model in background (called during init)
export async function warmupModel(): Promise<void> {
  await getPipeline()
  // Run a dummy embed to JIT-compile the ONNX graph
  await embed('warmup')
}
