import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NAMING_TABLE, TAB_REGISTRY } from '../../public/views/registry.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONCEPT_MODULES = Object.freeze({
  chapters: 'chapters', worldbook: 'worldbook', script: 'script', storysource: 'storysource',
  roleplay: 'roleplay', habits: 'habits', exchange: 'exchange',
  log: 'log', analysis: 'analysis', imagegen: 'imagegen', knowledge: 'knowledge', artifacts: 'artifacts'
})
/** OS-190 §2.4 分类表：12 个工作台正名 → manifest 的 slug。 */
const WORKBENCHES = Object.freeze({
  chapters: '正文', worldbook: '世界书', script: '剧本', storysource: '故事源', roleplay: '扮演',
  habits: '习惯', artifacts: '产物', log: '日志', analysis: '分析', knowledge: '知识库',
  imagegen: '生图与识图', exchange: '导入导出'
})
/** OS-189：只此一处是一次性升级，必须认得旧名；其余旧名一律逐行白名单。 */
const UPGRADE_FILE = 'src/protocol/libraryUpgrade.mjs'

/**
 * 出处声明逐行白名单：键＝相对路径，值＝「该行必须包含的片段」。
 * 不设整文件豁免——任何新增旧名（含旧目录名常量）都默认报红。
 */
const PROVENANCE_LINES = Object.freeze({
  'src/modules/fact/fact/domain/vocabulary.js': ['pinax pedia-v2 ADR'],
  'src/kernel/index.mjs': ['谱系：'],
  'src/modules/fact/enrich/pseudoChapters.mjs': ['vendor 自 Pinax-next'],
  'src/modules/fact/enrich/metrics.mjs': ['vendor 自 Pinax-next'],
  'src/services/enrichEngine.mjs': ['Pinax-next', 'Pinax 六槽位'],
  'src/modules/worldbook/worldbookFileContract.mjs': ['谱系：', 'Pinax 运行时', 'Pinax 富关系', 'Pinax 扩展'],
  'src/protocol/worldbookContract.mjs': ['@pinax/core'],
  'src/modules/storage/projectDoc.mjs': ['Pinax-next'],
  'src/modules/library/textUtil.mjs': ['谱系：函数体逐字拷贝自 Pinax-next', '@pinax/core']
})

function walk(dir, prefix, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    const rel = `${prefix}/${name}`
    const stats = statSync(full)
    if (stats.isDirectory()) walk(full, rel, out)
    else if (/\.(?:mjs|js|json|md|html|css)$/u.test(name)) out.push(rel)
  }
  return out
}

export function auditNamingConsistency({ repo = REPO, naming = NAMING_TABLE, tabs = TAB_REGISTRY } = {}) {
  const violations = []
  const byId = new Map(naming.map((row) => [row.id, row]))
  const dirs = new Set()
  for (const row of naming) {
    if (!row.dir) continue
    if (dirs.has(row.dir)) violations.push(`命名表目录重复：${row.dir}`)
    dirs.add(row.dir)
    if (row.dir !== (row.tab ?? row.dir)) violations.push(`${row.id}: 目录与页签/入口名不一致`)
    if (row.logModule && row.logModule !== row.dir) violations.push(`${row.id}: 日志模块与目录不一致`)
  }
  for (const entry of tabs.filter((item) => !item.retired && item.label)) {
    const row = byId.get(entry.concept)
    if (!row) {
      violations.push(`${entry.id}: concept ${entry.concept} 未登命名表`)
      continue
    }
    if (row.tab !== entry.label) violations.push(`${entry.id}: 页签名与命名表不一致`)
    if ((row.dirTab === false ? null : row.dir) !== (entry.dir ?? null)) violations.push(`${entry.id}: 目录与命名表不一致`)
    if ((row.panelLabel ?? null) !== (entry.panelLabel ?? null)) violations.push(`${entry.id}: 面板名与命名表不一致`)
  }
  for (const [concept, moduleId] of Object.entries(CONCEPT_MODULES)) {
    const rel = `src/modules/${moduleId}/module.manifest.json`
    let manifest
    try { manifest = JSON.parse(readFileSync(join(repo, rel), 'utf-8')) } catch { violations.push(`${rel}: 模块 manifest 缺失`); continue }
    const row = byId.get(concept)
    if (manifest.name !== (row?.tab ?? row?.dir)) violations.push(`${rel}: 模块显示名不一致`)
  }
  const storage = byId.get('libraryStorage')
  const expectedStorage = {
    metadataDir: '.openstory', projectSpec: 'openstory-project@4', carrierPrefix: 'openstory.carrier.',
    wikiSchema: 'openstory-wiki-derived@2', tempPrefix: '.openstory-tmp-'
  }
  for (const [key, value] of Object.entries(expectedStorage)) {
    if (storage?.[key] !== value) violations.push(`libraryStorage.${key} 应为 ${value}`)
  }
  // OS-190 断言②：每个工作台的 manifest name = 正名（分类表值）
  for (const [concept, proper] of Object.entries(WORKBENCHES)) {
    const rel = `src/modules/${concept}/module.manifest.json`
    let manifest
    try { manifest = JSON.parse(readFileSync(join(repo, rel), 'utf-8')) } catch { violations.push(`${rel}: 工作台 manifest 缺失`); continue }
    if (manifest.class !== 'workbench') violations.push(`${rel}: 应为 class=workbench`)
    if (manifest.name !== proper) violations.push(`${rel}: manifest name「${manifest.name}」≠ 正名「${proper}」`)
  }
  // OS-190 断言③：分类表 12 个工作台都有 manifest（上面逐项已读，这里统计数量兜底）
  const present = Object.keys(WORKBENCHES).filter((concept) => existsSync(join(repo, `src/modules/${concept}/module.manifest.json`)))
  if (present.length !== Object.keys(WORKBENCHES).length) violations.push(`分类表 12 个工作台只找到 ${present.length} 个 manifest`)
  // OS-190 断言①：页面 id = slug（每个工作台 manifest 的 pages[].id 与 slots[].page 都等于 module id）
  for (const concept of Object.keys(WORKBENCHES)) {
    const rel = `src/modules/${concept}/module.manifest.json`
    let manifest
    try { manifest = JSON.parse(readFileSync(join(repo, rel), 'utf-8')) } catch { continue }
    for (const page of manifest.pages ?? []) {
      if (page.id !== manifest.id) violations.push(`${rel}: 页面 id「${page.id}」≠ slug「${manifest.id}」`)
    }
    for (const slot of manifest.slots ?? []) {
      if (slot.page !== manifest.id) violations.push(`${rel}: slot.page「${slot.page}」≠ slug「${manifest.id}」`)
    }
  }
  return { ok: violations.length === 0, violations, concepts: naming.length }
}

/**
 * OS-190 任务 0：index.html 头部 .agent-name 文本必须等于 agentbar manifest 的 name（三名一致）。
 */
export function auditAgentName(repo = REPO) {
  const violations = []
  const html = readFileSync(join(repo, 'public/index.html'), 'utf-8')
  const match = /<span class="agent-name">([^<]*)<\/span>/u.exec(html)
  const manifest = JSON.parse(readFileSync(join(repo, 'src/modules/agentbar/module.manifest.json'), 'utf-8'))
  if (!match) violations.push('public/index.html: 找不到 .agent-name')
  else if (match[1] !== manifest.name) violations.push(`.agent-name「${match[1]}」≠ agentbar manifest name「${manifest.name}」`)
  return { ok: violations.length === 0, violations }
}

export function auditLineageNames(repo = REPO) {
  const violations = []
  const roots = ['src', 'public', 'genres', 'skills', 'suites']
  let scanned = 0
  for (const root of roots) {
    for (const rel of walk(join(repo, root), root)) {
      scanned += 1
      if (rel === UPGRADE_FILE) continue
      const allowed = PROVENANCE_LINES[rel] ?? []
      const lines = readFileSync(join(repo, rel), 'utf-8').split('\n')
      lines.forEach((line, index) => {
        if (!/pinax/iu.test(line)) return
        if (allowed.some((needle) => line.includes(needle))) return
        violations.push(`${rel}:${index + 1}: ${line.trim()}`)
      })
    }
  }
  const packageDoc = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf-8'))
  if (packageDoc.author !== 'skkbsgzf <59155174+skkbsgzf@users.noreply.github.com>') {
    violations.push('package.json: author 与作者裁定不一致')
  }
  for (const rel of walk(join(repo, 'suites'), 'suites').filter((file) => file.endsWith('manifest.json'))) {
    const manifest = JSON.parse(readFileSync(join(repo, rel), 'utf-8'))
    // module@2 套件不再携带 vendor：归属由 builtin＋装载源判定（D3 升格）。
    if (manifest.spec !== 'openstory-module@2' && manifest.vendor !== 'skkbsgzf') violations.push(`${rel}: vendor 应为 skkbsgzf`)
  }
  for (const rel of walk(join(repo, 'suites'), 'suites').filter((file) => file.endsWith('SKILL.md'))) {
    const source = readFileSync(join(repo, rel), 'utf-8')
    const vendor = /^vendor:\s*(.+)$/mu.exec(source)?.[1]?.trim()
    if (vendor !== 'skkbsgzf') violations.push(`${rel}: vendor 应为 skkbsgzf`)
  }
  for (const name of ['fact-consistency', 'fact-extract', 'outline-restructure', 'scene-expand', 'worldbook-refactor', 'continuity-check', 'chapter-rewrite']) {
    const rel = `skills/${name}/SKILL.md`
    const source = readFileSync(join(repo, rel), 'utf-8')
    const vendor = /^vendor:\s*(.+)$/mu.exec(source)?.[1]?.trim()
    if (vendor !== 'skkbsgzf') violations.push(`${rel}: vendor 应为 skkbsgzf`)
  }
  return { ok: violations.length === 0, violations, scanned }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const naming = auditNamingConsistency()
  const lineage = auditLineageNames()
  const agent = auditAgentName()
  console.log(JSON.stringify({ naming, lineage, agent }, null, 2))
  process.exitCode = naming.ok && lineage.ok && agent.ok ? 0 : 1
}
