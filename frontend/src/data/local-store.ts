import { SEED_ROWS } from './seed'
import resetState from './reset-state.json'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 键带 reset-state.json 里的版本号：每跑一次 `npm run reset:sterilize` 版本自增，
// 上一轮（或别人机器上）残留的存储自动作废，不用再手动清浏览器存储。
const STORAGE_PREFIX = 'pharma-cleanroom:entries'
const STORAGE_KEY = `${STORAGE_PREFIX}:v${resetState.version}`

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 首次读到新版本时，把旧版本及无版本的残留键清掉。
function purgeLegacyStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  const storage = window.localStorage
  const legacyKeys: string[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (key && key.startsWith(STORAGE_PREFIX) && key !== STORAGE_KEY) {
      legacyKeys.push(key)
    }
  }
  legacyKeys.forEach((key) => storage.removeItem(key))
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  purgeLegacyStorage()
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 复位/测试场景下外部可能直接改写了 localStorage，丢弃内存缓存强制重读。
export function invalidateCache(): void {
  cache = null
}
