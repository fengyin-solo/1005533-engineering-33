// 灭菌验证台账：装载方式与温度探头数由验证组核定后登记在这里，是唯一口径。
// 页面列表、导出、状态流转里用到的装载方式 / 温度探头数都以这份台账为准，
// 记录上自己存的值不一致时按台账统一；灭菌验证按设备排期。
export type SterilizeLedgerRow = {
  灭菌设备: string
  灭菌程序: string
  装载方式: string
  温度探头数: number
  /** 探头校准精度（℃）：差于 PROBE_PRECISION_LIMIT 即精度不够，退回校准 */
  探头精度: number
  /** 按设备排期 */
  排期: string
}

/** 温度探头精度门槛（℃）：精度数值大于它就算不够，验证退回校准。 */
export const PROBE_PRECISION_LIMIT = 0.5

export const STERILIZE_LEDGER: SterilizeLedgerRow[] = [
  { 灭菌设备: '灭菌柜-A', 灭菌程序: '湿热灭菌 121℃', 装载方式: '满载-金属器具', 温度探头数: 12, 探头精度: 0.3, 排期: '每周一' },
  { 灭菌设备: '灭菌柜-B', 灭菌程序: '湿热灭菌 115℃', 装载方式: '半载-橡胶件', 温度探头数: 10, 探头精度: 0.4, 排期: '每周三' },
  // 灭菌柜-C 探头超差（0.9℃ > 0.5℃），对应验证提交时会被退回校准
  { 灭菌设备: '灭菌柜-C', 灭菌程序: '干热灭菌 170℃', 装载方式: '满载-玻璃器皿', 温度探头数: 8, 探头精度: 0.9, 排期: '每周五' },
]

/** 按设备 + 程序查台账；程序对不上时退到只按设备查，都没有则返回 null（不在台账内）。 */
export function findLedgerRow(device: string, program: string): SterilizeLedgerRow | null {
  return (
    STERILIZE_LEDGER.find((row) => row.灭菌设备 === device && row.灭菌程序 === program) ??
    STERILIZE_LEDGER.find((row) => row.灭菌设备 === device) ??
    null
  )
}
