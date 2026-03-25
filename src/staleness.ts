import path from 'path'
import { getMemoriesWithFiles, markMemoryStale } from './db'
import { hashFile } from './git'

export interface StalenessReport {
  checked: number
  markedStale: number
  staleMemories: Array<{ id: string; summary: string; changedFiles: string[] }>
}

export async function checkAndMarkStaleness(repoPath: string): Promise<StalenessReport> {
  const memories = getMemoriesWithFiles(repoPath)
  const report: StalenessReport = { checked: 0, markedStale: 0, staleMemories: [] }

  for (const memory of memories) {
    if (memory.tracked_files.length === 0) continue
    report.checked++

    const changedFiles: string[] = []

    for (const tf of memory.tracked_files) {
      const absPath = path.isAbsolute(tf.file_path)
        ? tf.file_path
        : path.join(repoPath, tf.file_path)

      const currentHash = hashFile(absPath)

      // Empty hash means file doesn't exist or couldn't be read
      if (tf.file_hash && currentHash && currentHash !== tf.file_hash) {
        changedFiles.push(tf.file_path)
      }
    }

    if (changedFiles.length > 0) {
      markMemoryStale(memory.id)
      report.markedStale++
      report.staleMemories.push({
        id: memory.id,
        summary: memory.summary,
        changedFiles,
      })
    }
  }

  return report
}
