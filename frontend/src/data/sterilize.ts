import ledgerDoc from './sterilize-ledger.json'

// 灭菌验证核定台账：装载方式、温度探头数以验证组核定的这份为准，各入口取回来都是同一份。
export type LedgerEntry = {
  灭菌设备: string
  灭菌程序: string
  装载方式: string
  温度探头数: number
}

export const STERILIZE_LEDGER: LedgerEntry[] = ledgerDoc.ledger as LedgerEntry[]

export const STERILIZE_STATUSES = ['待验证', '灭菌中', '已验证', '已失效'] as const

/** 按「灭菌设备 + 灭菌程序」查台账，查不到返回 null。 */
export function findLedgerEntry(equipment: string, program: string): LedgerEntry | null {
  return (
    STERILIZE_LEDGER.find(
      (item) => item.灭菌设备 === String(equipment ?? '') && item.灭菌程序 === String(program ?? ''),
    ) ?? null
  )
}

/** 温度探头数必须是正整数：带小数、非数字、零或负数都说明精度不够，退回校准。 */
export function probePrecisionValid(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0
  }
  if (typeof value === 'string' && value.trim() !== '') {
    if (!/^\d+$/.test(value.trim())) {
      return false
    }
    return Number(value.trim()) > 0
  }
  return false
}

export type ReconcileResult = {
  ok: boolean
  message: string
  装载方式: string
  温度探头数: number
}

export type ReconcileInput = Record<string, unknown>

/**
 * 装载方式与灭菌程序不一致时按台账口径统一：
 * 先查台账，再校探头精度（精度不够退回校准），最后把装载方式/探头数统一成台账值。
 */
export function reconcileSterilizeRow(row: ReconcileInput): ReconcileResult {
  const equipment = String(row.灭菌设备 ?? '')
  const program = String(row.灭菌程序 ?? '')
  const ledger = findLedgerEntry(equipment, program)
  if (!ledger) {
    return {
      ok: false,
      message: `灭菌设备「${equipment}」+ 灭菌程序「${program}」不在验证组核定台账内，无法提交验证`,
      装载方式: String(row.装载方式 ?? ''),
      温度探头数: Number(row.温度探头数 ?? 0),
    }
  }
  if (!probePrecisionValid(row.温度探头数)) {
    return {
      ok: false,
      message: `温度探头数「${String(row.温度探头数)}」精度不够（须为正整数），退回校准后再提交`,
      装载方式: ledger.装载方式,
      温度探头数: ledger.温度探头数,
    }
  }
  const notes: string[] = []
  if (String(row.装载方式 ?? '') !== ledger.装载方式) {
    notes.push(`装载方式按台账统一为「${ledger.装载方式}」`)
  }
  if (Number(row.温度探头数) !== ledger.温度探头数) {
    notes.push(`温度探头数按台账统一为 ${ledger.温度探头数}`)
  }
  return {
    ok: true,
    message: notes.length > 0 ? notes.join('；') : '与台账一致',
    装载方式: ledger.装载方式,
    温度探头数: ledger.温度探头数,
  }
}

/** 状态顺次往下推进，倒序/越级一律挡回；目标态只能是当前态的下一个状态。 */
export function nextSterilizeStatus(current: string, target: string): { ok: boolean; message: string } {
  const currentIndex = STERILIZE_STATUSES.indexOf(current as (typeof STERILIZE_STATUSES)[number])
  const targetIndex = STERILIZE_STATUSES.indexOf(target as (typeof STERILIZE_STATUSES)[number])
  if (currentIndex < 0 || targetIndex < 0) {
    return { ok: false, message: `灭菌验证状态「${current}」不在登记的状态链上` }
  }
  if (targetIndex === currentIndex) {
    return { ok: false, message: `灭菌验证已经是「${target}」，重复提交只算一次` }
  }
  if (targetIndex < currentIndex) {
    return { ok: false, message: `状态只能顺次推进，「${current}」不能倒序回「${target}」` }
  }
  if (targetIndex !== currentIndex + 1) {
    return { ok: false, message: `状态不能越级跳转，需先推进到「${STERILIZE_STATUSES[currentIndex + 1]}」` }
  }
  return { ok: true, message: '' }
}
