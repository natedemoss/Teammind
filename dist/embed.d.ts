export declare function embed(text: string): Promise<Float32Array>;
export declare function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number;
export declare function serializeVec(vec: Float32Array): Buffer;
export declare function deserializeVec(buf: Buffer | Uint8Array): Float32Array;
export declare function keywordScore(query: string, content: string): number;
export declare function warmupModel(): Promise<void>;
