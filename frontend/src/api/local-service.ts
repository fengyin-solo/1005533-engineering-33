import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  STERILIZE_STATUSES,
  nextSterilizeStatus,
  reconcileSterilizeRow,
} from '@/data/sterilize'
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
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 灭菌验证确认通过后，结果落到成品检验的待办；同一份验证重复提交只算一次（按检验编号幂等）。
function createFinishedQcTodo(sterilizeRow: EntryRow): string {
  const serial = String(sterilizeRow.验证编号 ?? sterilizeRow.id)
  const reportNo = `FINI-${serial}`
  const qcRows = listRows('finishedqc')
  if (qcRows.some((row) => String(row.检验编号) === reportNo)) {
    return `成品检验待办「${reportNo}」已存在，不重复登记`
  }
  const nextId = qcRows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const todo: EntryRow = {
    id: nextId,
    status: '待检验',
    pending: true,
    abnormal: false,
    检验编号: reportNo,
    产品批号: serial,
    检验项目: '无菌检查',
    标准规定: '应无菌生长',
    检验结果: '',
    判定结论: '',
    检验人: '',
    检验状态: '待检验',
  }
  saveRows('finishedqc', [...qcRows, todo])
  return `已生成成品检验待办「${reportNo}」`
}

// 灭菌验证的专用流转规则，返回 null 表示不走通用分支之外的特殊处理已完成。
function runSterilizeAction(row: EntryRow, action: string, operator: string): ActionResult {
  const targetMap: Record<string, string> = {
    提交验证: '灭菌中',
    确认验证: '已验证',
    作废验证: '已失效',
  }
  const target = targetMap[action]
  if (!target) {
    return { ok: false, message: `灭菌验证记录没有登记「${action}」这个动作` }
  }
  const current = String(row.status)

  // 状态顺次往下推进，倒序/越级挡回；同一份验证重复提交只算一次
  const guard = nextSterilizeStatus(current, target)
  if (!guard.ok) {
    return { ok: false, message: guard.message }
  }

  // 提交验证：按设备排期（同一台设备同时只允许一批在灭菌中）、台账口径统一、精度校准
  if (action === '提交验证') {
    const busy = listRows('sterilize').some(
      (item) =>
        Number(item.id) !== Number(row.id) &&
        String(item.灭菌设备) === String(row.灭菌设备) &&
        String(item.status) === '灭菌中',
    )
    if (busy) {
      return {
        ok: false,
        message: `灭菌设备「${String(row.灭菌设备)}」已有在灭菌中的批次，灭菌验证按设备排期，请排队`,
      }
    }
    const reconciled = reconcileSterilizeRow(row)
    if (!reconciled.ok) {
      return { ok: false, message: reconciled.message }
    }
    const signer = String(row.验证人 ?? '').trim() || operator.trim()
    if (!signer) {
      return { ok: false, message: '验证人要签字：请先登记验证人后再提交验证' }
    }
    const updated: EntryRow = {
      ...row,
      status: target,
      pending: target !== STERILIZE_STATUSES[STERILIZE_STATUSES.length - 1],
      abnormal: false,
      装载方式: reconciled.装载方式,
      温度探头数: reconciled.温度探头数,
      验证人: signer,
      验证状态: target,
    }
    persistSterilizeRow(row.id, updated)
    const note = reconciled.message !== '与台账一致' ? `（${reconciled.message}）` : ''
    return { ok: true, message: `灭菌验证记录已${action}，当前状态「${target}」${note}` }
  }

  // 确认验证：验证人必须签字；确认后结果落到成品检验的待办
  if (action === '确认验证') {
    const signer = String(row.验证人 ?? '').trim()
    if (!signer) {
      return { ok: false, message: '确认验证前验证人必须签字' }
    }
    const updated: EntryRow = {
      ...row,
      status: target,
      pending: false,
      abnormal: false,
      验证状态: target,
    }
    persistSterilizeRow(row.id, updated)
    const todoNote = createFinishedQcTodo(updated)
    return { ok: true, message: `灭菌验证记录已${action}，当前状态「${target}」；${todoNote}` }
  }

  // 作废验证：仅允许从「已验证」顺次作废
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: false,
    abnormal: true,
    验证状态: target,
  }
  persistSterilizeRow(row.id, updated)
  return { ok: true, message: `灭菌验证记录已${action}，当前状态「${target}」` }
}

function persistSterilizeRow(id: number, updated: EntryRow): void {
  const rows = listRows('sterilize')
  const next = rows.map((row) => (Number(row.id) === Number(id) ? updated : row))
  saveRows('sterilize', next)
}

export function runAction(key: string, id: number, action: string, operator = ''): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }

  if (key === 'sterilize') {
    return runSterilizeAction(row, action, operator)
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const current = String(row.status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  const index = rows.findIndex((item) => Number(item.id) === id)
  next[index] = updated
  saveRows(key, next)
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
  for (const row of listRows(key)) {
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
