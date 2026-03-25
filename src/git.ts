import { createHash } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import simpleGit from 'simple-git'

export interface GitContext {
  root: string
  branch: string
  commit: string
}

export async function getGitContext(cwd: string): Promise<GitContext | null> {
  try {
    const git = simpleGit(cwd)
    const isRepo = await git.checkIsRepo()
    if (!isRepo) return null

    const root = (await git.revparse(['--show-toplevel'])).trim()
    const branchResult = await git.branch()
    const branch = branchResult.current || 'unknown'
    const commit = (await git.revparse(['HEAD'])).trim()

    return { root, branch, commit }
  } catch {
    return null
  }
}

export function hashFile(filePath: string): string {
  try {
    if (!existsSync(filePath)) return ''
    const content = readFileSync(filePath)
    return createHash('sha256').update(content).digest('hex').slice(0, 16)
  } catch {
    return ''
  }
}

export function resolveFilePaths(filePaths: string[], repoRoot: string): string[] {
  return filePaths
    .map(fp => {
      // If already absolute, keep. Otherwise resolve from repo root.
      if (path.isAbsolute(fp)) return fp
      return path.join(repoRoot, fp)
    })
    .filter(fp => existsSync(fp))
}
