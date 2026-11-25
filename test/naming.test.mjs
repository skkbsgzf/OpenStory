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
import { MODULE_MANIFESTS } from '../src/protocol/modules.mjs'

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
  '世界书',   // 世界书笔记（moduleOfPath）
  '剧本',     // 剧本写通道（moduleOfPath）
  '故事源',   // fact 条目 / enrich 旁挂 wiki（LOG_MODULES.storysource）
  '扮演',     // 扮演会话（LOG_MODULES.roleplay）
  '习惯',     // 习惯表（LOG_MODULES.habits）
  '导入导出', // 导入导出文件（LOG_MODULES.exchange）
  '库升级',   // 旧库一次性升级（libraryUpgrade）
  '界面状态'  // 库内 ui-state（LOG_MODULES.uiState）
])

/* ---------- ① 表覆盖页签 ---------- */

test('表覆盖页签：manifest 的 tab 显示名全部来自命名表，视图行为表不再存页签名', () => {
  const tabPlacements = MODULE_MANIFESTS
    .filter((manifest) => manifest.class === 'workbench')
    .flatMap((manifest) => (manifest.slots ?? []).filter((placement) => placement.slot === 'tab').map((placement) => ({ manifest, placement })))
  assert.ok(tabPlacements.length >= 8, '未退场页签条目数不该变少')
  for (const { manifest, placement } of tabPlacements) {
    const page = (manifest.pages ?? []).find((item) => item.id === placement.page)
    const row = namingEntry(placement.page) ?? namingEntry(manifest.id)
    assert.ok(row, `页签 ${manifest.id}/${placement.page} 缺命名表行`)
    assert.equal(page.label, row.tab, `页签 ${placement.page} 的显示名与命名表 tab 列不一致`)
    if (row.dir && row.dirTab !== false) assert.equal(namingEntryForDir(row.dir)?.id, row.id, `目录 ${row.dir} 反查不到 ${row.id}`)
  }
  // 宿主设置页仍在命名表里；视图行为表不许再带 label/dir/module/order。
  assert.equal(namingEntry('settings')?.tab, '设置')
  for (const entry of TAB_REGISTRY) {
    for (const key of ['label', 'dir', 'module', 'order', 'panelLabel']) {
      assert.equal(Object.prototype.hasOwnProperty.call(entry, key), false, `TAB_REGISTRY:${entry.id} 不该有 ${key}`)
    }
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
  // 目录→模块名的推断也走表：三个正名目录与日志模块逐字相等
  assert.equal(logModuleForDir('世界书'), '世界书')
  assert.equal(logModuleForDir('故事源'), '故事源')
  assert.equal(logModuleForDir('扮演'), '扮演')
  assert.equal(logModuleForDir('导入导出'), '导入导出')
  assert.equal(logModuleForDir('正文'), '正文')
  assert.equal(logModuleForDir('不认识的目录'), null)

  // OS-188a：旧关系扩展键已抬升为 relationExtensions，产品代码只许迁移器认旧名。
  const oldKeyOffenders = []
  for (const { rel, src } of walkMjs('src')) {
    if (rel === 'src/protocol/libraryUpgrade.mjs') continue
    if (src.includes('pinaxRelationExtensions')) oldKeyOffenders.push(rel)
  }
  assert.deepEqual(oldKeyOffenders, [], '旧键只许留在 libraryUpgrade.mjs')
  const migrator = readFileSync(join(REPO, 'src/protocol/libraryUpgrade.mjs'), 'utf-8')
  assert.match(migrator, /pinaxRelationExtensions/u, '迁移器必须认得旧键才能升级作者旧库')
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
    chapters: namingEntry('chapters').dir,
    write: namingEntry('chapters').dir,
    worldbook: namingEntry('worldbook').dir,
    entries: namingEntry('worldbook').dir,
    script: namingEntry('script').dir
  })
  // 视图→日志模块名：页签层走表，不再在 app.js 里堆 if
  assert.equal(logModuleForView('chapters'), '正文')
  assert.equal(logModuleForView('worldbook'), '世界书')
  assert.equal(logModuleForView('habits'), '习惯')
  assert.equal(logModuleForView('roleplay'), '扮演')
  assert.equal(logModuleForView('dir:故事源'), '故事源')
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
  for (const name of ['正文', '世界书', '习惯', '扮演']) {
    assert.ok(!fnBody.includes(`'${name}'`), `moduleOfCurrentView 里不该再有 '${name}' 字面量`)
  }
})

/* ---------- ⑤ 页签名→目录名：src/ 只许从表派生（OS-150a） ---------- */

test('OS-150a：src/ 里页签名→目录名只从命名表派生（genres 不再抄第二份；残留键是显式台账）', () => {
  const genres = readFileSync(join(REPO, 'src/services/genres.mjs'), 'utf-8')
  assert.match(genres, /import \{ PAGE_TO_DIR_LOCAL \} from '\.\.\/protocol\/naming\.mjs'/u,
    'genres.mjs 必须经 protocol/naming.mjs 取表')
  assert.match(genres, /PAGE_TO_DIR_LOCAL\[page\]/u, 'excludedPages 的目录解析必须走表')
  // 表内四键的字面量对不许在 src/ 里凑成第二份「页签名→目录名」映射：
  //   · 一张映射至少命中两对，或变量名就叫 *PAGE_TO_DIR*（命中一对也算）；
  //   · 单点命中不算——如 projectDoc.mjs 的 dataDirs:{script:'剧本'} 是载体清单的
  //     数据目录键，不是页签名映射（不归命名表管）。
  const tablePairs = Object.entries(PAGE_TO_DIR_LOCAL).map(([page, dir]) => `${page}: '${dir}'`)
  const offenders = []
  for (const { rel, src } of walkMjs('src')) {
    const hits = tablePairs.filter((pair) => src.includes(pair))
    if (hits.length >= 2 || (hits.length >= 1 && /(?:const|let|var)\s+\w*PAGE_TO_DIR\w*\s*=/u.test(src))) {
      offenders.push(`${rel} → ${hits.join(' / ')}`)
    }
  }
  assert.deepEqual(offenders, [], '页签名→目录名只许从命名表派生，不许另抄一份')
  // 表里没有的概念（退场目录/人话别名）只许待在这份显式台账里；新增键＝改这里并说明去留
  const residual = (genres.match(/const PAGE_TO_DIR_RETIRED = Object\.freeze\(\{([\s\S]*?)\}\)/u) || [])[1] || ''
  const residualKeys = [...residual.matchAll(/([A-Za-z]\w*):\s*'([^']+)'/gu)].map((match) => match[1]).sort()
  assert.deepEqual(residualKeys, [
    'comic', 'constraint', 'dossier', 'experience', 'material', 'notes', 'online', 'outline', 'video', 'wiki', 'wikiHtml'
  ], '残留映射是显式台账——新增「页签名→目录名」键要在这里登记并在交付说明写去留')
})

test('OS-172：有目录的模块显示名、入口名、目录名与日志模块名四者一致', () => {
  const pairs = [
    ['chapters', 'chapters'], ['worldbook', 'worldbook'], ['script', 'script'],
    ['storysource', 'storysource'], ['roleplay', 'roleplay'], ['habits', 'habits'],
    ['exchange', 'exchange']
  ]
  for (const [moduleId, conceptId] of pairs) {
    const manifest = JSON.parse(readFileSync(join(REPO, 'src/modules', moduleId, 'module.manifest.json'), 'utf-8'))
    const row = namingEntry(conceptId)
    assert.ok(row?.dir, `${conceptId} 应声明唯一磁盘目录`)
    assert.equal(manifest.name, row.tab ?? row.dir, `${moduleId} 模块显示名不一致`)
    assert.equal(row.dir, row.tab ?? row.dir, `${conceptId} 目录与页签/入口名不一致`)
    assert.equal(row.logModule, row.dir, `${conceptId} 日志模块与目录不一致`)
  }
  assert.equal(namingEntry('worldbook').dir, '世界书')
  assert.equal(namingEntry('storysource').dir, '故事源')
  assert.equal(namingEntry('roleplay').dir, '扮演')
  assert.equal(NAMING_TABLE.filter((row) => ['世界书', '故事源', '扮演'].includes(row.dir)).length, 3)
})

/* ---------- ⑥ 扮演页读自己的日志（OS-150a） ---------- */

test('OS-150a / OS-172：扮演页的「本模块修改」查的是扮演模块（取表，不写死）', () => {
  assert.equal(logModuleForView('roleplay'), '扮演')
  const appSrc = readFileSync(join(REPO, 'public/app.js'), 'utf-8')
  assert.doesNotMatch(appSrc, /moduleLogHtml\('扮演'/u, '扮演页不许写死一个不存在的日志模块名')
  assert.match(appSrc, /moduleLogHtml\(registryModule\?\.logModuleForView\('roleplay'\)/u,
    '扮演页的日志模块名必须经注册表 logModuleForView 取')
})
