import { Memory } from './db';
export interface SearchResult extends Memory {
    score: number;
}
export declare function searchMemories(query: string, repoPath: string, opts?: {
    filePath?: string;
    limit?: number;
}): Promise<SearchResult[]>;
export declare function rankMemoriesForInjection(repoPath: string, branch: string, limit?: number): Memory[];
export declare function findDuplicate(content: string, repoPath: string, threshold?: number): Promise<string | null>;
export declare function formatMemoriesForContext(memories: Memory[], projectName: string, branch: string): string;
