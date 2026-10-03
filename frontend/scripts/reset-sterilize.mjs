#!/usr/bin/env node
/**
 * 灭菌验证环境复位（一条命令串起「回滚复位 + 铺种子数据」）：
 *   1. 起跑前先核对依赖：node 版本、node_modules 是否齐，缺了自动 npm ci / npm install
 *   2. 按验证组核定台账（src/data/sterilize-ledger.json）生成灭菌验证示例数据：
 *      装载方式、温度探头数一律取台账口径
 *   3. 成品检验（finishedqc）条数归零
 *   4. 写入 src/data/reset-state.json 并把 version 自增；前端存储键带版本，
 *      别人克隆后 / 上一轮残留的浏览器存储会自动失效，无需手动清 localStorage
 *   5. 写完回读做断言自检，任何一项不过就非零退出
 *
 * 用法：node scripts/reset-sterilize.mjs   （也可在 frontend/ 下 npm run reset:sterilize）
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptDir, '..')
const ledgerPath = resolve(frontendDir, 'src/data/sterilize-ledger.json')
const statePath = resolve(frontendDir, 'src/data/reset-state.json')

const STATUS_PENDING = { 待验证: true, 灭菌中: true, 已验证: false, 已失效: false }
const SAMPLE_STATUS = ['待验证', '灭菌中', '已验证']

function info(message) {
  console.log(`[reset-sterilize] ${message}`)
}

function fail(message) {
  console.error(`[reset-sterilize] 错误：${message}`)
  process.exit(1)
}

// ---- 1. 起跑前先核对依赖 -------------------------------------------------
function checkDependencies() {
  const major = Number(process.versions.node.split('.')[0])
  if (Number.isNaN(major) || major < 18) {
    fail(`需要 Node.js >= 18，当前为 ${process.versions.node}`)
  }
  info(`Node.js ${process.versions.node} 版本 OK`)

  const requireFromFrontend = createRequire(resolve(frontendDir, 'package.json'))
  const pkg = requireFromFrontend('./package.json')
  const nodeModulesDir = resolve(frontendDir, 'node_modules')
  const isInstalled = (name) => {
    // 运行时依赖按解析入口核对；devDependencies 里有 @types/* 这类无入口的包，按包目录核对
    try {
      requireFromFrontend.resolve(name)
      return true
    } catch {
      const parts = name.startsWith('@') && name.includes('/') ? name.split('/') : [name]
      return existsSync(resolve(nodeModulesDir, ...parts, 'package.json'))
    }
  }
  const required = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]
  const missing = required.filter((name) => !isInstalled(name))

  if (missing.length > 0) {
    info(`依赖缺失（${missing.join(', ')}），开始安装...`)
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    try {
      if (existsSync(resolve(frontendDir, 'package-lock.json'))) {
        execSync(`"${npmCmd}" ci`, { cwd: frontendDir, stdio: 'inherit' })
      } else {
        execSync(`"${npmCmd}" install`, { cwd: frontendDir, stdio: 'inherit' })
      }
    } catch {
      fail('依赖安装失败，请手工在 frontend/ 下执行 npm install 后重跑')
    }
    // 安装后再核对一遍
    const stillMissing = required.filter((name) => !isInstalled(name))
    if (stillMissing.length > 0) {
      fail(`依赖安装后仍缺失：${stillMissing.join(', ')}`)
    }
  }
  info('依赖核对通过')
}

// ---- 2. 按台账口径铺灭菌验证示例数据 --------------------------------------
function buildSterilizeRows(ledgerDoc) {
  const ledger = ledgerDoc.ledger
  const samples = ledgerDoc.samples
  return samples.map((sample, index) => {
    const matched = ledger.find(
      (item) => item.灭菌设备 === sample.灭菌设备 && item.灭菌程序 === sample.灭菌程序,
    )
    if (!matched) {
      fail(`示例「${sample.验证编号}」的设备+程序不在验证组核定台账内：${sample.灭菌设备} / ${sample.灭菌程序}`)
    }
    const status = SAMPLE_STATUS[index] ?? sample.状态
    if (!STATUS_PENDING.hasOwnProperty(status)) {
      fail(`示例「${sample.验证编号}」状态「${status}」非法`)
    }
    // 非待验证的记录验证人必须已签字
    if (status !== '待验证' && String(sample.验证人 ?? '').trim() === '') {
      fail(`示例「${sample.验证编号}」状态为「${status}」，验证人必须签字`)
    }
    // 温度探头数直接取台账，保证各入口取回的是同一份
    if (!Number.isInteger(matched.温度探头数) || matched.温度探头数 <= 0) {
      fail(`台账中 ${sample.灭菌设备} / ${sample.灭菌程序} 的温度探头数不是正整数，需退回校准台账`)
    }
    return {
      id: sample.id,
      status,
      pending: STATUS_PENDING[status],
      abnormal: false,
      验证编号: sample.验证编号,
      灭菌设备: matched.灭菌设备,
      灭菌程序: matched.灭菌程序,
      装载方式: matched.装载方式,
      温度探头数: matched.温度探头数,
      灭菌保持时间: sample.灭菌保持时间,
      验证日期: sample.验证日期,
      验证人: sample.验证人 ?? '',
      验证状态: status,
    }
  })
}

// ---- 3/4. 归零成品检验、版本自增并落盘 ------------------------------------
function writeResetState(sterilizeRows) {
  let previous = { version: 0 }
  if (existsSync(statePath)) {
    try {
      previous = JSON.parse(readFileSync(statePath, 'utf8'))
    } catch {
      info('旧 reset-state.json 解析失败，按 v0 起算')
    }
  }
  const nextState = {
    version: Number(previous.version ?? 0) + 1,
    sterilize: sterilizeRows,
    finishedqc: [],
  }
  writeFileSync(statePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8')
  return nextState
}

// ---- 5. 回读断言自检 ------------------------------------------------------
function verifyState(state, ledgerDoc) {
  const assertions = [
    [state.sterilize.length === ledgerDoc.samples.length, '灭菌验证示例条数与台账样例一致'],
    [state.finishedqc.length === 0, '成品检验条数已归零'],
  ]
  for (const row of state.sterilize) {
    const matched = ledgerDoc.ledger.find(
      (item) => item.灭菌设备 === row.灭菌设备 && item.灭菌程序 === row.灭菌程序,
    )
    assertions.push([!!matched, `${row.验证编号} 能在台账查到`])
    if (matched) {
      assertions.push([
        row.装载方式 === matched.装载方式,
        `${row.验证编号} 装载方式与台账一致`,
      ])
      assertions.push([
        row.温度探头数 === matched.温度探头数,
        `${row.验证编号} 温度探头数与台账一致（${matched.温度探头数}）`,
      ])
      assertions.push([
        Number.isInteger(row.温度探头数) && row.温度探头数 > 0,
        `${row.验证编号} 温度探头数精度合格（正整数）`,
      ])
    }
    assertions.push([
      row.status === row.验证状态,
      `${row.验证编号} 状态字段一致（${row.status}）`,
    ])
    assertions.push([
      row.status === '待验证' || String(row.验证人).trim() !== '',
      `${row.验证编号} 推进中的记录验证人已签字`,
    ])
  }
  let failed = 0
  for (const [passed, label] of assertions) {
    console.log(`  ${passed ? '✓' : '✗'} ${label}`)
    if (!passed) failed += 1
  }
  if (failed > 0) {
    fail(`自检失败 ${failed} 项，复位未生效`)
  }
}

function main() {
  info('灭菌验证环境复位开始')
  checkDependencies()
  if (!existsSync(ledgerPath)) {
    fail(`找不到台账文件：${ledgerPath}`)
  }
  const ledgerDoc = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  const sterilizeRows = buildSterilizeRows(ledgerDoc)
  const state = writeResetState(sterilizeRows)
  info(`reset-state.json 已写入，版本推进到 v${state.version}（浏览器旧存储将自动作废）`)
  info('回读自检：')
  verifyState(state, ledgerDoc)
  info(`完成：灭菌验证恢复 ${state.sterilize.length} 条示例数据，成品检验 ${state.finishedqc.length} 条`)
}

main()
