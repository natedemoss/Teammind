export interface Memory {
    id: string;
    content: string;
    summary: string;
    tags: string[];
    file_paths: string[];
    functions: string[];
    embedding: Buffer | null;
    repo_path: string;
    git_commit: string | null;
    git_branch: string | null;
    created_at: number;
    updated_at: number;
    created_by: string;
    source: 'auto' | 'manual';
    stale: 0 | 1;
}
export interface Session {
    id: string;
    repo_path: string;
    branch: string | null;
    commit: string | null;
    transcript: string;
    processed: 0 | 1;
    created_at: number;
}
export declare function getDb(): any;
export declare function saveMemory(m: Omit<Memory, 'id' | 'created_at' | 'updated_at'>): string;
export declare function saveMemoryFiles(memoryId: string, files: Array<{
    path: string;
    hash: string;
}>): void;
export declare function getMemories(repoPath: string, opts?: {
    limit?: number;
    includeStale?: boolean;
}): Memory[];
export declare function getAllMemoriesWithEmbeddings(repoPath: string): Memory[];
export declare function getMemoryById(id: string): Memory | null;
export declare function deleteMemory(id: string): void;
export declare function deleteStaleMemories(repoPath: string): number;
export declare function markMemoryStale(id: string): void;
export declare function countMemories(repoPath: string): number;
export declare function getMemoryFiles(memoryId: string): Array<{
    file_path: string;
    file_hash: string;
}>;
export declare function getMemoriesWithFiles(repoPath: string): Array<Memory & {
    tracked_files: Array<{
        file_path: string;
        file_hash: string;
    }>;
}>;
export declare function getTagStats(repoPath: string): Record<string, number>;
export declare function deleteAllMemories(repoPath: string): number;
export declare function updateMemory(id: string, content: string, summary: string): void;
export declare function getMemoriesByTag(repoPath: string, tag: string, limit?: number): Memory[];
export declare function saveSession(s: Omit<Session, 'id' | 'processed' | 'created_at'>): string;
export declare function getSession(id: string): Session | null;
export declare function markSessionProcessed(id: string): void;
export declare function countProcessedSessions(): number;
export declare function pruneOldSessions(daysOld?: number): void;
export declare function getPendingSessions(): Session[];
export declare function getAllSessions(limit?: number): Array<Session & {
    transcript_len: number;
}>;
