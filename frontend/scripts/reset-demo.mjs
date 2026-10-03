#!/usr/bin/env node
/**
 * 复位演示数据：灭菌验证恢复示例数据、成品检验条数归零。
 *
 * 数据存在浏览器 localStorage 里，命令行够不到，所以做法是推进种子版本号
 * （src/data/seed-version.ts）：前端下次打开发现版本不一致，就按复位配方回滚
 * （见 src/data/local-store.ts 的 RESET_RECIPE），不用手动清浏览器存储。
 *
 * 用法：frontend 目录下 `npm run reset:demo`，或仓库根目录 `make reset-demo`。
 * 路径全部相对本脚本解析，克隆到任何机器上都能直接跑。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(cmd, args) {
  return spawnSync(cmd, args, { cwd: frontendDir, stdio: 'inherit' })
}

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

// 1) 起跑前先核对依赖：Node 版本要够 Vite 用，npm 要能找到
const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 18) {
  fail(`需要 Node.js >= 18，当前是 ${process.versions.node}`)
}
const npmProbe = spawnSync(npmCmd, ['--version'], { stdio: 'pipe' })
if (npmProbe.error || npmProbe.status !== 0) {
  fail('没有找到 npm，请先安装 Node.js（自带 npm）再跑这条命令')
}
console.log(`依赖核对通过：node ${process.versions.node} / npm ${String(npmProbe.stdout).trim()}`)

// 2) 依赖没装就先装上；装过但平台不对（比如 node_modules 从别的机器拷来，
//    rollup 原生绑定对不上，npm 可选依赖的老 bug）就清掉重装，保证克隆后一次跑通
function nativeBindingOk() {
  const probe = spawnSync(process.execPath, ['-e', "require('rollup/dist/native.js')"], {
    cwd: frontendDir,
    stdio: 'pipe',
  })
  return probe.status === 0
}

function installDeps(fresh) {
  if (fresh) {
    rmSync(join(frontendDir, 'node_modules'), { recursive: true, force: true })
    console.log('已清掉不可用的 node_modules，重新安装…')
  } else {
    console.log('node_modules 不存在，先装依赖（npm install）…')
  }
  const installed = run(npmCmd, ['install'])
  if (installed.status !== 0) {
    process.exit(installed.status ?? 1)
  }
}

if (!existsSync(join(frontendDir, 'node_modules'))) {
  installDeps(false)
} else if (!nativeBindingOk()) {
  installDeps(true)
}

// 3) 推进种子版本号：下次打开页面即触发复位
const version = new Date().toISOString()
const versionFile = join(frontendDir, 'src', 'data', 'seed-version.ts')
writeFileSync(
  versionFile,
  [
    '// 种子版本号：由 npm run reset:demo 重新生成，请勿手改。',
    '// 版本号一变，前端下次打开就按复位配方回滚（见 local-store.ts 的 RESET_RECIPE）。',
    `export const SEED_VERSION = '${version}'`,
    '',
  ].join('\n'),
)
console.log(`种子版本号已推进到 ${version}`)

// 4) 类型检查过一遍，确认这次复位一次跑通
const typecheck = run(npmCmd, ['run', 'typecheck'])
if (typecheck.status !== 0) {
  process.exit(typecheck.status ?? 1)
}

console.log('复位已生效，下次打开或刷新页面时：')
console.log('  · 灭菌验证恢复示例数据（STER-0001 ~ STER-0003）')
console.log('  · 成品检验条数归零，验证确认后结果会重新落到成品检验待办')
