import { SEED_ROWS } from './seed'
import { SEED_VERSION } from './seed-version'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 存储带种子版本号：npm run reset:demo 推进版本号后，下次打开就按复位配方回滚，
// 不用再去浏览器里手动清存储。
const STORAGE_KEY = 'pharma-cleanroom:entries'

// 复位配方：版本号对不上时，灭菌验证恢复示例数据、成品检验条数归零，其余模块原样保留。
const RESET_RECIPE = {
  sterilize: 'seed',
  finishedqc: 'clear',
} as const

type StoredShape = { version: string; rows: Record<string, EntryRow[]> }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function applyResetRecipe(rows: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const next = { ...rows }
  for (const [key, mode] of Object.entries(RESET_RECIPE)) {
    next[key] = mode === 'seed' ? clone(SEED_ROWS[key] ?? []) : []
  }
  return next
}

function persist(rows: Record<string, EntryRow[]>): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  const shape: StoredShape = { version: SEED_VERSION, rows }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shape))
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredShape> & Record<string, EntryRow[]>
    // 兼容旧格式：以前直接存 { 模块: 行[] }，没有版本号，按版本不一致处理
    const versioned = parsed !== null && typeof parsed === 'object' && 'rows' in parsed
    const storedRows = versioned ? (parsed.rows as Record<string, EntryRow[]>) : parsed
    const storedVersion = versioned ? parsed.version : null
    let rows = { ...fallback, ...storedRows }
    if (storedVersion !== SEED_VERSION) {
      rows = applyResetRecipe(rows)
      persist(rows)
    }
    return rows
  } catch {
    persist(fallback)
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
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
