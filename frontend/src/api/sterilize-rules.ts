import { listRows, saveRows } from '@/data/local-store'
import { findLedgerRow, PROBE_PRECISION_LIMIT } from '@/data/sterilize-ledger'
import type { ActionResult, EntryRow } from '@/data/types'

// 灭菌验证的专属规则，状态流转的入口仍在 local-service.ts，这里只被它调用：
//  - 装载方式 / 温度探头数以台账为准，各入口取回的是同一份
//  - 温度探头精度不够时退回校准，不推进状态
//  - 确认验证要求验证人已签字，确认后结果落到成品检验待办

export type SterilizeGuard = ActionResult & { calibrate?: boolean }

/** 读取口径：命中台账的记录，装载方式与温度探头数一律按台账统一。 */
export function applyLedgerToRow(row: EntryRow): EntryRow {
  const ledger = findLedgerRow(String(row['灭菌设备'] ?? ''), String(row['灭菌程序'] ?? ''))
  if (!ledger) {
    return row
  }
  return { ...row, 装载方式: ledger.装载方式, 温度探头数: ledger.温度探头数 }
}

/** 列表 / 导出等读入口统一走这里，保证各入口取回的温度探头数属同一份。 */
export function normalizeForRead(key: string, rows: EntryRow[]): EntryRow[] {
  if (key !== 'sterilize') {
    return rows
  }
  return rows.map(applyLedgerToRow)
}

/** 状态推进前的校验：精度不够退回校准，确认验证要验证人签字。 */
export function guardSterilizeTransition(row: EntryRow, action: string): SterilizeGuard {
  const ledger = findLedgerRow(String(row['灭菌设备'] ?? ''), String(row['灭菌程序'] ?? ''))
  if (ledger && ledger.探头精度 > PROBE_PRECISION_LIMIT) {
    return {
      ok: false,
      calibrate: true,
      message: `温度探头数精度不够（当前 ${ledger.探头精度}℃，要求 ≤${PROBE_PRECISION_LIMIT}℃），退回校准`,
    }
  }
  if (action === '确认验证' && String(row['验证人'] ?? '').trim() === '') {
    return { ok: false, message: '验证人未签字，不能确认验证' }
  }
  return { ok: true, message: '' }
}

/** 确认验证后：结果落到成品检验的待办；同一份验证重复提交只落一条。 */
export function enqueueFinishedQcTodo(row: EntryRow): void {
  const key = 'finishedqc'
  const source = String(row['验证编号'] ?? '')
  const rows = listRows(key)
  if (rows.some((item) => String(item['来源验证编号'] ?? '') === source)) {
    return
  }
  const nextId = rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const todo: EntryRow = {
    id: nextId,
    status: '待检验',
    pending: true,
    abnormal: false,
    检验编号: `FINI-${String(nextId).padStart(4, '0')}`,
    产品批号: source,
    检验项目: '灭菌验证结果检验',
    标准规定: '符合灭菌程序与装载方式核定要求',
    检验结果: '待检',
    判定结论: '待判定',
    检验人: '待分配',
    检验状态: '待检验',
    来源验证编号: source,
  }
  saveRows(key, [...rows, todo])
}
