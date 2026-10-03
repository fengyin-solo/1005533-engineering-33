import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  applyLedgerToRow,
  enqueueFinishedQcTodo,
  guardSterilizeTransition,
  normalizeForRead,
} from '@/api/sterilize-rules'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(normalizeForRead(key, listRows(key)), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  const currentIndex = meta.statuses.indexOf(current)
  const targetIndex = meta.statuses.indexOf(target)
  // 同一份记录重复提交只算一次：状态没变就不重复生效、不重复落待办
  if (currentIndex === targetIndex) {
    return { ok: true, message: `${meta.entity}已是「${target}」，重复${action}按一次计` }
  }
  // 状态顺次往下推进，倒序挡回
  if (targetIndex < currentIndex) {
    return { ok: false, message: `${meta.entity}状态只能顺次推进，不允许从「${current}」回退到「${target}」` }
  }
  let working = rows[index]
  const isNegativeAction = NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
  if (key === 'sterilize' && !isNegativeAction) {
    const guard = guardSterilizeTransition(working, action)
    if (!guard.ok) {
      if (guard.calibrate) {
        // 退回校准：状态不推进，只把记录标成异常，看板上能看出来
        const flagged = [...rows]
        flagged[index] = { ...working, abnormal: true }
        saveRows(key, flagged)
      }
      return { ok: false, message: guard.message }
    }
    // 推进时把台账口径写回记录：装载方式、温度探头数与台账保持一致
    working = applyLedgerToRow(working)
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...working,
    status: target,
    pending: target !== lastStatus,
    abnormal: isNegativeAction,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  if (key === 'sterilize' && action === '确认验证') {
    // 验证结果落到成品检验的待办
    enqueueFinishedQcTodo(updated)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of normalizeForRead(key, listRows(key))) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
