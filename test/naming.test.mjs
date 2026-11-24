/**
 * 五层命名单一真源表一致性（OS-148，G8a/G8d，node:test）。
 *
 * 表本体：public/views/registry.mjs 的 NAMING_TABLE（概念 id ＋ 目录/页签/面板名/
 * changelog 模块/契约域/MCP 前缀）。后端经 src/protocol/naming.mjs 只 re-export。
 * 这里钉死四件事：
 *   ① 表覆盖页签——TAB_REGISTRY 每个未退场且带 label 的条目，dir/label/panelLabel
 *      都能在表里查到且相等（页签层不再有第二份字面量）；
 *   ② 表覆盖日志——代码里实际用到的 changelog 模块名 ⊆ 表的模块列（清单显式写在下面，
 *      漏登＝红），且 src/ 里不再有「module: '中文名'」这类绕过表的字面量；
 *   ③ 表的两列取值真实存在——契约域是 src/api/contracts/ 下的文件名，
 *      MCP 前缀能在 src/host/mcp.mjs 的工具名里找到；
 *   ④ 单一来源——DIR_LABELS/DIR_ORDER/READONLY_DIRS/PAGE_TO_DIR_LOCAL/LOG_MODULES
 *      全部由表逐键派生，app.js 的视图→模块名映射已交给表。
 *
 * 跑法：node --test test/naming.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NAMING_TABLE, TAB_REGISTRY, DIR_LABELS, DIR_ORDER, READONLY_DIRS, PAGE_TO_DIR_LOCAL, LOG_MODULES,
  namingEntry, namingEntryForDir, logModuleForDir, logModuleForView
} from '../public/views/registry.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')

/** 递归收集某目录下的 .mjs（相对仓根的路径＋源码）。 */
function walkMjs(dirRel) {
  const out = []
  for (const name of readdirSync(join(REPO, dirRel))) {
    const rel = `${dirRel}/${name}`
    if (statSync(join(REPO, rel)).isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      out.push(...walkMjs(rel))
    } else if (name.endsWith('.mjs')) {
      out.push({ rel, src: readFileSync(join(REPO, rel), 'utf-8') })
    }
  }
  return out
}

/**
 * 代码里实际用到的 changelog 模块名（显式清单，漏登＝红）。
 * 新增一个模块要么在命名表里给它一行，要么把它的日志挂到既有行的 logModule 上——
 * 无论哪种，都必须先出现在这张清单里。
 */
const LOG_MODULES_IN_USE = Object.freeze([
  '正文',     // 正文写通道（moduleOfPath）
  '参考',     // 参考笔记（moduleOfPath）
  '剧本',     // 剧本写通道（moduleOfPath）
  '拆解',     // fact 条目 / enrich 旁挂 wiki（LOG_MODULES.storysource / .enrich）
  '故事源',   // moduleOfPath 对 拆解/ 目录的既有实况（dirLogModule，不迁移）
  '推演',     // 推演会话（LOG_MODULES.roleplay）
  '习惯',     // 习惯表（LOG_MODULES.habits）
  '界面状态'  // 库内 ui-state（LOG_MODULES.uiState）
])

/* ---------- ① 表覆盖页签 ---------- */

test('表覆盖页签：TAB_REGISTRY 未退场条目的 dir/label/panelLabel 全部来自命名表', () => {
  const tabEntries = TAB_REGISTRY.filter((entry) => !entry.retired && entry.label)
  assert.ok(tabEntries.length >= 8, '未退场页签条目数不该变少')
  for (const entry of tabEntries) {
    const row = namingEntry(entry.concept)
    assert.ok(row, `页签 ${entry.id} 缺 concept 指向（命名表里没有这一行）`)
    assert.equal(row.tab, entry.label, `页签 ${entry.id} 的显示名与命名表 tab 列不一致`)
    assert.equal(row.dirTab === false ? null : row.dir ?? null, entry.dir ?? null, `页签 ${entry.id} 的目录与命名表 dir 列不一致`)
    assert.equal(row.panelLabel ?? null, entry.panelLabel ?? null, `页签 ${entry.id} 的面板名与命名表 panelLabel 列不一致`)
    // 反向：目录能反查到同一行（五层互相可查）
    if (entry.dir) assert.equal(namingEntryForDir(entry.dir)?.id, row.id, `目录 ${entry.dir} 反查不到 ${row.id}`)
  }
  // 概念 id 唯一、行形状完整
  assert.equal(new Set(NAMING_TABLE.map((row) => row.id)).size, NAMING_TABLE.length, '概念 id 必须唯一')
  for (const row of NAMING_TABLE) {
    assert.equal(typeof row.id, 'string')
    assert.ok('tab' in row && 'dir' in row, `命名表 ${row.id} 行缺列`)
  }
})

/* ---------- ② 表覆盖日志模块 ---------- */

test('表覆盖日志模块：代码用到的模块名 ⊆ 表的模块列，且 src/ 里没有绕过表的字面量', () => {
  const tableModules = new Set()
  for (const row of NAMING_TABLE) {
    if (row.logModule) tableModules.add(row.logModule)
    if (row.dirLogModule) tableModules.add(row.dirLogModule)
  }
  for (const name of LOG_MODULES_IN_USE) {
    assert.ok(tableModules.has(name), `日志模块「${name}」没登在命名表的 logModule/dirLogModule 列里——漏登`)
  }
  // LOG_MODULES 常量瞄的就是表里的模块名，不能各写一份
  for (const [id, name] of Object.entries(LOG_MODULES)) {
    assert.equal(namingEntry(id)?.logModule, name, `LOG_MODULES.${id} 与命名表不一致`)
    assert.ok(LOG_MODULES_IN_USE.includes(name), `LOG_MODULES.${id}＝${name} 不在显式清单里`)
  }
  // src/ 里不许再出现 module: '中文名'（名字只从表里取）
  const offenders = []
  for (const { rel, src } of walkMjs('src')) {
    for (const match of src.matchAll(/module:\s*'([\u4e00-\u9fa5][^']*)'/gu)) {
      offenders.push(`${rel} → module: '${match[1]}'`)
    }
  }
  assert.deepEqual(offenders, [], '日志模块名必须走 LOG_MODULES（命名表），不许写字面量')
  // 目录→模块名的推断也走表：拆解目录的既有日志名是「故事源」，正文照旧
  assert.equal(logModuleForDir('拆解'), '故事源')
  assert.equal(logModuleForDir('正文'), '正文')
  assert.equal(logModuleForDir('不认识的目录'), null)
})

/* ---------- ③ 契约域 / MCP 前缀取值真实存在 ---------- */

test('表的两列取值真实存在：契约域是 contracts/ 下的文件，MCP 前缀能在 mcp.mjs 里找到', () => {
  const domains = new Set(readdirSync(join(REPO, 'src/api/contracts'))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => name.replace(/\.mjs$/u, '')))
  const mcpTools = [...readFileSync(join(REPO, 'src/host/mcp.mjs'), 'utf-8').matchAll(/name:\s*'([a-z_]+)'/gu)]
    .map((match) => match[1])
  assert.ok(mcpTools.length >= 15, 'MCP 工具名应该能读到（本单不改工具名，只登记前缀）')
  for (const row of NAMING_TABLE) {
    if (row.contract !== null && row.contract !== undefined) {
      assert.ok(domains.has(row.contract), `命名表 ${row.id} 的契约域「${row.contract}」不是 src/api/contracts/ 下的文件`)
    }
    if (row.mcpPrefix !== null && row.mcpPrefix !== undefined) {
      assert.ok(mcpTools.some((tool) => tool.startsWith(row.mcpPrefix)),
        `命名表 ${row.id} 的 MCP 前缀「${row.mcpPrefix}」在 mcp.mjs 里找不到对应工具`)
    }
  }
})

/* ---------- ④ 单一来源：映射全部由表派生，没有第二份字面量 ---------- */

test('单一来源：DIR_LABELS/DIR_ORDER/READONLY_DIRS/PAGE_TO_DIR_LOCAL 全部逐键由表派生', () => {
  const expectedLabels = {}
  for (const row of NAMING_TABLE) {
    if (!row.dir) continue
    if (row.dirLabel === null) continue
    expectedLabels[row.dir] = row.dirLabel ?? row.tab ?? row.dir
  }
  assert.deepEqual({ ...DIR_LABELS }, expectedLabels, 'DIR_LABELS 必须由命名表派生（不许单独维护）')
  assert.deepEqual([...DIR_ORDER],
    ['chapters', 'worldbook', 'script', 'log'].map((id) => namingEntry(id).dir),
    'DIR_ORDER 必须取命名表的目录列')
  assert.deepEqual([...READONLY_DIRS], NAMING_TABLE.filter((row) => row.readonly && row.dir).map((row) => row.dir))
  assert.deepEqual({ ...PAGE_TO_DIR_LOCAL }, {
    write: namingEntry('chapters').dir,
    entries: namingEntry('worldbook').dir,
    worldbook: namingEntry('worldbook').dir,
    script: namingEntry('script').dir
  })
  // 视图→日志模块名：页签层走表，不再在 app.js 里堆 if
  assert.equal(logModuleForView('write'), '正文')
  assert.equal(logModuleForView('reference'), '参考')
  assert.equal(logModuleForView('habits'), '习惯')
  assert.equal(logModuleForView('deduce'), '推演')
  assert.equal(logModuleForView('dir:拆解'), '拆解')
  assert.equal(logModuleForView('dir:日志'), '日志')
  assert.equal(logModuleForView('artifacts'), '', '没有日志维度的视图返回空串')
  assert.equal(logModuleForView(undefined), '')
})

test('单一来源：后端只 re-export（不复制表），app.js 的视图→模块名映射已交给表', () => {
  const protocolNaming = readFileSync(join(REPO, 'src/protocol/naming.mjs'), 'utf-8')
  assert.match(protocolNaming, /from '\.\.\/\.\.\/public\/views\/registry\.mjs'/u,
    'src/protocol/naming.mjs 必须从注册表 re-export')
  assert.doesNotMatch(protocolNaming, /export const NAMING_TABLE/u, '后端不许再定义一份表')
  // registry.mjs 是表的唯一持有者：不许出现「目录: '显示名'」形状的第二份映射
  const registrySrc = readFileSync(join(REPO, 'public/views/registry.mjs'), 'utf-8')
  assert.equal((registrySrc.match(/NAMING_TABLE\s*=\s*Object\.freeze\(\[/gu) || []).length, 1)
  assert.doesNotMatch(registrySrc, /export const DIR_LABELS = Object\.freeze\(\{\s*\n\s*正文/u,
    'DIR_LABELS 不许退回手写字面量')
  // app.js：moduleOfCurrentView 里不再有概念名字面量
  const appSrc = readFileSync(join(REPO, 'public/app.js'), 'utf-8')
  const fnStart = appSrc.indexOf('function moduleOfCurrentView')
  assert.ok(fnStart > 0, 'app.js 里找不到 moduleOfCurrentView')
  const fnBody = appSrc.slice(fnStart, appSrc.indexOf('\n}', fnStart))
  assert.match(fnBody, /registryModule\.logModuleForView/u, 'moduleOfCurrentView 必须取表')
  for (const name of ['正文', '参考', '习惯', '推演']) {
    assert.ok(!fnBody.includes(`'${name}'`), `moduleOfCurrentView 里不该再有 '${name}' 字面量`)
  }
})
