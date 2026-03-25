export interface TeamMemoryExport {
    version: '1.0';
    exported_at: string;
    memories: Array<{
        id: string;
        content: string;
        summary: string;
        tags: string[];
        file_paths: string[];
        functions: string[];
        git_commit: string | null;
        git_branch: string | null;
        created_by: string;
        created_at: string;
    }>;
}
export declare function exportMemories(repoPath: string): TeamMemoryExport;
export declare function importMemories(filePath: string, repoPath: string, createdBy?: string): Promise<{
    imported: number;
    skipped: number;
}>;
export declare function writeExportFile(exportData: TeamMemoryExport, outputPath: string): void;
