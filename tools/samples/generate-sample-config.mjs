/**
 * OS-160 / OS-172：样例库生成器（可重跑，零依赖）。
 *
 * 先把样例库拷进同盘临时目录，用真实一次性升级与配置写入函数生成新布局；
 * 全部步骤成功后才整体替换样例库。旧布局只存在于临时副本，不把备份、退役目录
 * 或迁移标记带进交付样例。
 *
 * 用法：node tools/samples/generate-sample-config.mjs
 */
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, renameSync, rmSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeUiState } from '../../src/protocol/libState.mjs'
import { saveSuiteSettings, setSuiteEnabled } from '../../src/services/suites.mjs'
import { upgradeLibrary } from '../../src/protocol/libraryUpgrade.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SAMPLE = join(REPO, 'samples', '水浒传')
const BUILTIN_SUITES = join(REPO, 'suites')
const dirs = [BUILTIN_SUITES]

function text(value) { return String(value ?? '') }
function copyTree(source, target) {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) copyTree(from, to)
    else if (entry.isSymbolicLink()) throw new Error('样例库不应含符号链接：' + from)
    else copyFileSync(from, to)
  }
}
function fail(message) { console.error('生成失败：' + message); process.exit(1) }
if (!existsSync(SAMPLE)) fail('样例库不存在：' + SAMPLE)

const base = mkdtempSync(join(dirname(SAMPLE), '.shuihu-generate-'))
const tempRoot = join(base, 'sample-lib')
const previous = join(base, 'previous')
let movedPrevious = false
try {
  copyTree(SAMPLE, tempRoot)

  const upgraded = await upgradeLibrary(tempRoot)
  if (!upgraded.ok) fail(upgraded.message)

  const ui = await writeUiState(tempRoot, {
    hiddenTabs: [],
    moduleEnabled: {},
    agentCollapsed: false,
    selectedTab: '正文'
  })
  if (!ui.ok) fail('写 ui-state 失败：' + ui.message)

  const saved = await saveSuiteSettings(dirs, '', 'writing', {
    newChapterTitle: '第{N}章',
    deduceBranches: 2
  }, tempRoot)
  if (!saved.ok) fail('写套件设置失败：' + saved.message)
  const enabled = await setSuiteEnabled(dirs, '', 'writing', true, tempRoot)
  if (!enabled.ok) fail('设套件启停失败：' + enabled.message)

  rmSync(join(tempRoot, '.history'), { recursive: true, force: true })
  rmSync(join(tempRoot, '.openstory', 'upgrade.json'), { force: true })
  rmSync(join(tempRoot, '.openstory', 'log', '库升级'), { recursive: true, force: true })
  for (const name of readdirSync(tempRoot)) {
    if (/\.retired-/u.test(name)) rmSync(join(tempRoot, name), { recursive: true, force: true })
  }

  const uiState = JSON.parse(readFileSync(join(tempRoot, '.openstory', 'ui-state.json'), 'utf-8'))
  const suiteState = JSON.parse(readFileSync(join(tempRoot, '.openstory', 'plugins', 'suite-state.json'), 'utf-8'))
  if (text(uiState.selectedTab) !== '正文' || suiteState.suites?.writing?.values?.newChapterTitle !== '第{N}章') {
    fail('回读自检不通过：产出的配置内容不对')
  }

  renameSync(SAMPLE, previous)
  movedPrevious = true
  try {
    renameSync(tempRoot, SAMPLE)
  } catch (error) {
    renameSync(previous, SAMPLE)
    movedPrevious = false
    throw error
  }
  console.log('✓ 样例库已由真实升级与配置写入路径重生成')
} catch (error) {
  if (movedPrevious && !existsSync(SAMPLE)) {
    try { renameSync(previous, SAMPLE) } catch { /* 保留 base 供人工恢复 */ }
  }
  fail(text(error?.message || error))
} finally {
  rmSync(base, { recursive: true, force: true })
}
