import path from 'path'
import os from 'os'

export const TEAMMIND_DIR = path.join(os.homedir(), '.teammind')
export const DB_PATH = path.join(TEAMMIND_DIR, 'db.sqlite')
export const MODEL_CACHE_DIR = path.join(TEAMMIND_DIR, 'model-cache')
export const HOOKS_DIR = path.join(TEAMMIND_DIR, 'hooks')
export const MAX_INJECT_MEMORIES = 10
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2'
export const EMBED_DIM = 384
export const VERSION = '0.1.0'
