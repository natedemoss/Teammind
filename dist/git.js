"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePath = normalizePath;
exports.getGitContext = getGitContext;
exports.hashFile = hashFile;
exports.resolveFilePaths = resolveFilePaths;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const simple_git_1 = __importDefault(require("simple-git"));
function normalizePath(p) {
    return p.replace(/\\/g, '/');
}
async function getGitContext(cwd) {
    try {
        const git = (0, simple_git_1.default)(cwd);
        const isRepo = await git.checkIsRepo();
        if (!isRepo)
            return null;
        const root = normalizePath((await git.revparse(['--show-toplevel'])).trim());
        const branchResult = await git.branch();
        const branch = branchResult.current || 'unknown';
        const commit = (await git.revparse(['HEAD'])).trim();
        return { root, branch, commit };
    }
    catch {
        return null;
    }
}
function hashFile(filePath) {
    try {
        if (!(0, fs_1.existsSync)(filePath))
            return '';
        const content = (0, fs_1.readFileSync)(filePath);
        return (0, crypto_1.createHash)('sha256').update(content).digest('hex').slice(0, 16);
    }
    catch {
        return '';
    }
}
function resolveFilePaths(filePaths, repoRoot) {
    return filePaths
        .map(fp => {
        // If already absolute, keep. Otherwise resolve from repo root.
        if (path_1.default.isAbsolute(fp))
            return fp;
        return path_1.default.join(repoRoot, fp);
    })
        .filter(fp => (0, fs_1.existsSync)(fp));
}
//# sourceMappingURL=git.js.map