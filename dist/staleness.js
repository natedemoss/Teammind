"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAndMarkStaleness = checkAndMarkStaleness;
const path_1 = __importDefault(require("path"));
const db_1 = require("./db");
const git_1 = require("./git");
async function checkAndMarkStaleness(repoPath) {
    const memories = (0, db_1.getMemoriesWithFiles)(repoPath);
    const report = { checked: 0, markedStale: 0, staleMemories: [] };
    for (const memory of memories) {
        if (memory.tracked_files.length === 0)
            continue;
        report.checked++;
        const changedFiles = [];
        for (const tf of memory.tracked_files) {
            const absPath = path_1.default.isAbsolute(tf.file_path)
                ? tf.file_path
                : path_1.default.join(repoPath, tf.file_path);
            const currentHash = (0, git_1.hashFile)(absPath);
            // Empty hash means file doesn't exist or couldn't be read
            if (tf.file_hash && currentHash && currentHash !== tf.file_hash) {
                changedFiles.push(tf.file_path);
            }
        }
        if (changedFiles.length > 0) {
            (0, db_1.markMemoryStale)(memory.id);
            report.markedStale++;
            report.staleMemories.push({
                id: memory.id,
                summary: memory.summary,
                changedFiles,
            });
        }
    }
    return report;
}
//# sourceMappingURL=staleness.js.map