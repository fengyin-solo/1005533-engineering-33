// 灭菌验证业务规则校验：用 esbuild 把数据层打包后，在内存 localStorage 上逐条断言。
// 随仓库保留，任何改动后执行 `npm run check:sterilize` 回归。
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(here, '..', 'src')

const result = await build({
  stdin: {
    contents: `
export { listEntries, runAction } from '@/api/local-service'
export { storageKey, invalidateCache } from '@/data/local-store'
`,
    resolveDir: srcDir,
    sourcefile: 'harness-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  write: false,
  alias: { '@': srcDir },
  logLevel: 'silent',
})
const code = result.outputFiles[0].text
const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')

// 内存版 localStorage
const mem = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    key: (i) => [...mem.keys()][i] ?? null,
    get length() { return mem.size },
  },
}

const { listEntries, runAction, storageKey, invalidateCache } = await import(dataUrl)

// 直接改写 localStorage 后必须让内存缓存失效
function mutate(fn) {
  const raw = JSON.parse(mem.get(storageKey()))
  fn(raw)
  mem.set(storageKey(), JSON.stringify(raw))
  invalidateCache()
}

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) { passed += 1; console.log('  ✓', name) }
  else { failed += 1; console.log('  ✗', name, detail) }
}

const s = () => listEntries('sterilize').items
const q = () => listEntries('finishedqc').items
const byId = (id) => s().find((r) => r.id === id)

console.log('复位后的初始状态：')
check('灭菌验证 3 条示例', s().length === 3, `实际 ${s().length}`)
check('成品检验 0 条', q().length === 0, `实际 ${q().length}`)
check('存储键带版本', storageKey().includes(':v'), storageKey())
check('待验证记录验证人留空', byId(1)['验证人'] === '')
check('温度探头数取自台账（12）', byId(1)['温度探头数'] === 12)
check('装载方式取自台账', byId(1)['装载方式'] === '单层出瓶装载')

console.log('顺次推进 / 倒序挡回 / 重复提交：')
// id2（设备B）初始灭菌中：先把它顺次走完，释放设备B 供后续用例使用
let r = runAction('sterilize', 2, '提交验证', '李工')
check('灭菌中重复提交被挡回', !r.ok && /重复提交|顺次/.test(r.message), r.message)
r = runAction('sterilize', 2, '作废验证', '李工')
check('灭菌中越级作废被挡', !r.ok && /越级/.test(r.message), r.message)
r = runAction('sterilize', 2, '确认验证', '李工')
check('确认验证通过', r.ok && byId(2).status === '已验证', r.message)
check('结果落到成品检验待办', q().length === 1 && q()[0].status === '待检验', JSON.stringify(q()))
check('待办编号幂等键 FINI-STER-0002', q()[0]['检验编号'] === 'FINI-STER-0002', q()[0]['检验编号'])
check('待办待处理标记 pending', q()[0].pending === true)
r = runAction('sterilize', 2, '确认验证', '李工')
check('已验证再确认被挡、不重复建待办', !r.ok && q().length === 1, `${r.message} / 待办${q().length}条`)
r = runAction('sterilize', 2, '作废验证', '李工')
check('已验证顺次作废成功', r.ok && byId(2).status === '已失效' && byId(2).abnormal === true, r.message)
r = runAction('sterilize', 2, '提交验证', '李工')
check('已失效倒序提交被挡回', !r.ok && /倒序/.test(r.message), r.message)

console.log('按设备排期 / 签字：')
// id1 设备A 待验证 -> 提交成功并由当前操作员签字（设备A 转为占用）
r = runAction('sterilize', 1, '提交验证', '张工')
check('id1 提交验证进入灭菌中并签字', r.ok && byId(1).status === '灭菌中' && byId(1)['验证人'] === '张工', r.message)
// 再造一条同设备待验证 -> 排期挡回
mutate((raw) => raw.sterilize.push({
  id: 4, status: '待验证', pending: true, abnormal: false,
  验证编号: 'STER-0004', 灭菌设备: '水浴式灭菌柜A', 灭菌程序: '121℃-30min',
  装载方式: '单层出瓶装载', 温度探头数: 12, 灭菌保持时间: '30min',
  验证日期: '2026-09-04', 验证人: '', 验证状态: '待验证',
}))
r = runAction('sterilize', 4, '提交验证', '张工')
check('同设备已有灭菌中批次，排期挡回', !r.ok && /排期/.test(r.message), r.message)

console.log('探头精度退回校准 / 台账外挡回（此时设备B 已空闲）：')
mutate((raw) => raw.sterilize.push({
  id: 6, status: '待验证', pending: true, abnormal: false,
  验证编号: 'STER-0006', 灭菌设备: '脉动真空灭菌柜B', 灭菌程序: '134℃-8min',
  装载方式: '器具车满载', 温度探头数: 10.5, 灭菌保持时间: '8min',
  验证日期: '2026-09-06', 验证人: '赵工', 验证状态: '待验证',
}))
r = runAction('sterilize', 6, '提交验证', '赵工')
check('探头数小数精度不够退回校准', !r.ok && /精度|校准/.test(r.message), r.message)
mutate((raw) => { raw.sterilize = raw.sterilize.map((x) => x.id === 6 ? { ...x, 温度探头数: '十个' } : x) })
r = runAction('sterilize', 6, '提交验证', '赵工')
check('探头数非数字退回校准', !r.ok && /精度|校准/.test(r.message), r.message)
mutate((raw) => raw.sterilize.push({
  id: 7, status: '待验证', pending: true, abnormal: false,
  验证编号: 'STER-0007', 灭菌设备: '未知灭菌柜X', 灭菌程序: '100℃-5min',
  装载方式: '随便装', 温度探头数: 8, 灭菌保持时间: '5min',
  验证日期: '2026-09-07', 验证人: '赵工', 验证状态: '待验证',
}))
r = runAction('sterilize', 7, '提交验证', '赵工')
check('台账外设备+程序被挡', !r.ok && /台账/.test(r.message), r.message)
// 设备B 空闲：无签字提交先被签字规则挡住
mutate((raw) => raw.sterilize.push({
  id: 8, status: '待验证', pending: true, abnormal: false,
  验证编号: 'STER-0008', 灭菌设备: '脉动真空灭菌柜B', 灭菌程序: '134℃-8min',
  装载方式: '器具车满载', 温度探头数: 10, 灭菌保持时间: '8min',
  验证日期: '2026-09-08', 验证人: '', 验证状态: '待验证',
}))
r = runAction('sterilize', 8, '提交验证', '')
check('无签字提交被挡', !r.ok && /签字/.test(r.message), r.message)

console.log('装载方式/探头数与台账不一致时按台账统一：')
mutate((raw) => raw.sterilize.push({
  id: 5, status: '待验证', pending: true, abnormal: false,
  验证编号: 'STER-0005', 灭菌设备: '脉动真空灭菌柜B', 灭菌程序: '121℃-20min',
  装载方式: '单层出瓶装载（误填）', 温度探头数: 11, 灭菌保持时间: '20min',
  验证日期: '2026-09-05', 验证人: '赵工', 验证状态: '待验证',
}))
r = runAction('sterilize', 5, '提交验证', '赵工')
check('装载方式/探头数按台账统一', r.ok && s().find((x) => x.id === 5)['装载方式'] === '织物打包装载' && s().find((x) => x.id === 5)['温度探头数'] === 10, r.message)
check('统一时给出说明', /台账/.test(r.message), r.message)
// id5 提交后设备B 被占：id8 即使补了签字也得排队
r = runAction('sterilize', 8, '提交验证', '钱工')
check('设备被占时补签字仍按排期挡回', !r.ok && /排期/.test(r.message), r.message)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
