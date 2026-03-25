export interface StalenessReport {
    checked: number;
    markedStale: number;
    staleMemories: Array<{
        id: string;
        summary: string;
        changedFiles: string[];
    }>;
}
export declare function checkAndMarkStaleness(repoPath: string): Promise<StalenessReport>;
