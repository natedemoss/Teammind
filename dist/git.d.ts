export interface GitContext {
    root: string;
    branch: string;
    commit: string;
}
export declare function normalizePath(p: string): string;
export declare function getGitContext(cwd: string): Promise<GitContext | null>;
export declare function hashFile(filePath: string): string;
export declare function resolveFilePaths(filePaths: string[], repoRoot: string): string[];
