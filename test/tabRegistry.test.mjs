/**
 * 页签/路由声明式注册表用例（OS-143，G4 前端注册协议，node:test）。
 *
 * 注册表 public/views/registry.mjs 收敛了原先散在 app.js 的五张页签表＋renderTabs 扫描＋
 * go 作用域校验。这里钉死四件事：
 *   ① 快照——现有页签集合一个不多一个不少（产物/正文/剧本/日志/世界书/故事源/习惯/扮演/设置）；
 *   ② 行为保真——用测试内复刻的「迁移前 renderTabs 旧算法」对拍 computeTabDefs，
 *      多场景（体裁裁剪/词表外/退场/无库/目录序）逐字段 deepEqual；
 *   ③ 扩展性验收核心——给注册表**副本**加一条，页签列表就多一项、隐藏/退场规则照常生效，
 *      全程不需要改 app.js（测试只 import registry.mjs，不碰 app.js 的任何行为）；
 *   ④ 解耦契约——registry 零 import（不可能反向依赖 app.js），render 只存注册名，
 *      app.js 的 VIEW_RENDERERS 插座覆盖全部注册名（读源码校验，不在 node 里加载 app.js）。
 *
 * 跑法：node --test test/tabRegistry.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TAB_REGISTRY, DIR_LABELS, DIR_ORDER, READONLY_DIRS, PAGE_TO_DIR_LOCAL,
  DEFAULT_HIDDEN_TABS, RETIRED_DIRS,
  computeTabDefs, dirTabDefs, visibleTabDefs,
  viewScope, renderNameForView, isKnownDir, dirPanelLabel, dirTabEntry, builtinPanelTabs,
  creatableDirNames
} from '../public/views/registry.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 页签定义的规范形（旧算法固定页签没有 readonly 键；比较前统一投影）。 */
const canon = (defs) => (defs ?? []).map((def) => ({
  view: def.view,
  label: def.label,
  ic: def.ic,
  readonly: def.readonly === true,
  closable: def.closable !== false
}))

/**
 * 迁移前 renderTabs 的扫描语义（自 OS-143 前的 public/app.js 逐行复刻，作为对拍基准）。
 * 保留旧注释里的裁定号——这里每一行都是行为保真锚。
 */
function legacyTabDefs(ctx = {}) {
  const defs = []
  if (ctx.current) {
    // OS-12：页签首格固定＝产物中心
    defs.push({ view: 'artifacts', label: '产物', ic: '产', closable: true })
    const libDirs = ctx.libDirs ?? []
    const hasDir = (name) => libDirs.includes(name)
    const excluded = new Set((ctx.briefGenre?.excludedPages ?? []).map((page) => PAGE_TO_DIR_LOCAL[page] ?? page))
    // OS-19：体裁声明后（如短故事）没有 正文/ 目录就不出正文页签
    if (!ctx.brief || hasDir('正文')) defs.push({ view: 'write', label: '正文', ic: '章', closable: true })
    const extra = libDirs
      // OS-88：正文/世界书/扮演都有内置页签，不能再按目录重复出一个
      .filter((dir) => dir !== '正文' && dir !== '扮演' && !excluded.has(dir))
      // OS-88/92：只认词表内的目录——词表外（素材/漫画/联机/作者自建）不出页签
      .filter((dir) => Boolean(DIR_LABELS[dir]) || dir === '习惯')
      // OS-86：已退场的旧目录（大纲/构思/资料/约束）一律不出页签
      .filter((dir) => !RETIRED_DIRS.includes(dir))
      .sort((left, right) => {
        const li = DIR_ORDER.indexOf(left)
        const ri = DIR_ORDER.indexOf(right)
        return (li === -1 ? 99 : li) - (ri === -1 ? 99 : ri)
      })
      .map((dir) => ({
        // OS-172：世界书走 reference 视图；故事源按目录视图，显示名与磁盘名一致
        view: dir === '世界书' ? 'reference' : (dir === '习惯' ? 'habits' : `dir:${dir}`),
        label: DIR_LABELS[dir] || dir,
        ic: (DIR_LABELS[dir] || dir).slice(0, 1),
        readonly: READONLY_DIRS.has(dir),
        closable: true
      }))
    defs.push(...extra)
    defs.push({ view: 'deduce', label: '扮演', ic: '扮', closable: true })
  }
  // OS-32：设置是可关闭页签，打开才出现
  if (ctx.settingsOpen) defs.push({ view: 'settings', label: '设置', ic: '设', closable: true })
  return defs
}

const assertSameAsLegacy = (ctx, registry) => {
  assert.deepEqual(canon(computeTabDefs(ctx, registry)), canon(legacyTabDefs(ctx)))
}

/* ---------- ① 快照：现有页签集合一个不多一个不少 ---------- */

test('快照：默认小说库的页签集合与顺序（产物/正文/剧本/日志/世界书/故事源/习惯/扮演）', () => {
  const defs = computeTabDefs({
    current: { path: '/lib' },
    brief: null,
    briefGenre: null,
    libDirs: ['正文', '世界书', '剧本', '故事源', '习惯', '日志'],
    settingsOpen: false
  })
  assert.deepEqual(defs.map((def) => def.view),
    ['artifacts', 'write', 'reference', 'dir:剧本', 'dir:日志', 'dir:故事源', 'habits', 'deduce'])
  assert.deepEqual(defs.map((def) => def.label),
    ['产物', '正文', '世界书', '剧本', '日志', '故事源', '习惯', '扮演'])
  // OS-89：日志页签挂「只读」牌
  const logTab = defs.find((def) => def.view === 'dir:日志')
  assert.equal(logTab.readonly, true)
  assert.equal(defs.find((def) => def.view === 'write').readonly, false)
  // 设置未打开不出现；打开了补在末尾（OS-32 可关闭页签）
  const openDefs = computeTabDefs({ current: { path: '/lib' }, brief: null, briefGenre: null, libDirs: ['正文'], settingsOpen: true })
  assert.deepEqual(openDefs.map((def) => def.view), ['artifacts', 'write', 'deduce', 'settings'])
})

test('快照：无库时只剩设置页；正文页签受体裁裁剪（OS-19）', () => {
  assert.deepEqual(computeTabDefs({ current: null, settingsOpen: false }).map((def) => def.view), [])
  assert.deepEqual(computeTabDefs({ current: null, settingsOpen: true }).map((def) => def.view), ['settings'])
  // 短故事体裁：声明了 brief 且磁盘无 正文/ 目录 → 不出正文页签
  const noWrite = computeTabDefs({ current: true, brief: { genre: 'short' }, briefGenre: null, libDirs: ['世界书', '日志'], settingsOpen: false })
  assert.ok(!noWrite.some((def) => def.view === 'write'))
  // 没声明体裁：即便 正文/ 目录不在，正文页签照出（OS-8 行为）
  const keepWrite = computeTabDefs({ current: true, brief: null, briefGenre: null, libDirs: [], settingsOpen: false })
  assert.deepEqual(keepWrite.map((def) => def.view), ['artifacts', 'write', 'deduce'])
})

/* ---------- ② 行为保真：与迁移前旧算法逐字段对拍 ---------- */

test('对拍旧算法：九种场景下 computeTabDefs 与迁移前 renderTabs 语义逐字节等价', () => {
  const full = { current: true, brief: null, briefGenre: null, libDirs: ['正文', '世界书', '剧本', '故事源', '习惯', '日志'], settingsOpen: false }
  // 磁盘目录序影响 DIR_ORDER 轨道外（99 组）的稳定展开序
  const reordered = { ...full, libDirs: ['日志', '习惯', '故事源', '剧本', '世界书', '正文'] }
  const noWriteDir = { current: true, brief: { deliverable: 'short' }, briefGenre: null, libDirs: ['世界书', '日志'], settingsOpen: true }
  // OS-19：体裁裁剪——worldbook 排除世界书目录，entries 排除故事源目录
  const genreWorldbook = { current: true, brief: {}, briefGenre: { excludedPages: ['worldbook', 'entries'] }, libDirs: ['正文', '世界书', '故事源', '日志'], settingsOpen: false }
  const genreScript = { current: true, brief: {}, briefGenre: { excludedPages: ['script'] }, libDirs: ['正文', '世界书', '剧本', '日志'], settingsOpen: false }
  // OS-92：词表外目录不出页签
  const unknownDirs = { current: true, brief: null, briefGenre: null, libDirs: ['分镜', '素材', '人物', '场景', '联机', '正文'], settingsOpen: false }
  // OS-84/86：退场目录在磁盘上也不出页签
  const retiredOnDisk = { current: true, brief: null, briefGenre: null, libDirs: ['大纲', '构思', '资料', '约束', '正文', '世界书', '日志'], settingsOpen: false }
  const noCurrent = { current: null, settingsOpen: true }
  const emptyDirs = { current: true, brief: null, briefGenre: null, libDirs: [], settingsOpen: false }
  for (const ctx of [full, reordered, noWriteDir, genreWorldbook, genreScript, unknownDirs, retiredOnDisk, noCurrent, emptyDirs]) {
    assertSameAsLegacy(ctx)
  }
})

/* ---------- ③ 扩展性验收核心：加一条就多一项，app.js 不用改 ---------- */

test('扩展性：注册表副本加一条目录型页签，页签列表就多一项（不改 app.js）', () => {
  // 词表外目录「分镜」——过去要改 app.js 的 DIR_LABELS，现在给注册表加一条即可
  const extended = [...TAB_REGISTRY, {
    id: 'storyboard', kind: 'module', view: 'dir:分镜', dir: '分镜', dirScan: true,
    label: '分镜', icon: '分', render: 'dirViewHtml', closable: true, scope: 'library'
  }]
  const defs = computeTabDefs({ current: true, brief: null, briefGenre: null, libDirs: ['正文', '分镜'], settingsOpen: false }, extended)
  assert.deepEqual(defs.map((def) => def.view), ['artifacts', 'write', 'dir:分镜', 'deduce'])
  assert.equal(defs.find((def) => def.view === 'dir:分镜').label, '分镜')
  // 磁盘上没有该目录 → 不出（目录型页签的既有语义）
  const absent = computeTabDefs({ current: true, brief: null, briefGenre: null, libDirs: ['正文'], settingsOpen: false }, extended)
  assert.ok(!absent.some((def) => def.view === 'dir:分镜'))
})

test('扩展性：副本加一条模块页签（visibleWhen 门控）＋隐藏/退场规则照常生效', () => {
  const extended = [...TAB_REGISTRY, {
    id: 'analysis', kind: 'module', view: 'analysis', label: '分析', icon: '析',
    render: 'analysisHtml', closable: true, scope: 'library',
    visibleWhen: (ctx) => ctx.hasDir('剧本')
  }]
  const defs = computeTabDefs({ current: true, brief: null, briefGenre: null, libDirs: ['正文', '剧本'], settingsOpen: false }, extended)
  assert.ok(defs.some((def) => def.view === 'analysis'), '门控条件满足时模块页签出现')
  const gated = computeTabDefs({ current: true, brief: null, briefGenre: null, libDirs: ['正文'], settingsOpen: false }, extended)
  assert.ok(!gated.some((def) => def.view === 'analysis'), '门控条件不满足时不出现')
  // OS-36 的 × 只收页签不动磁盘：隐藏过滤照常生效（对注册表新条目同样适用）
  const visible = visibleTabDefs(defs, new Set(['analysis', 'write']))
  assert.deepEqual(visible.map((def) => def.view),
    ['artifacts', 'dir:剧本', 'deduce'].filter((view) => defs.some((def) => def.view === view)))
  // 默认隐藏种子（OS-48）恰好是四个退场目录的 dir 视图
  assert.deepEqual([...DEFAULT_HIDDEN_TABS], ['dir:大纲', 'dir:构思', 'dir:资料', 'dir:约束'])
})

/* ---------- 退场规则：任何输入下都不出现 ---------- */

test('退场目录（大纲/构思/资料/约束）在任何输入下都不出页签，注册表留档 retired 标记', () => {
  // 注册表里退场条目留档（OS-84/86 的历史与裁定进表），且全部带 retired
  const retiredEntries = TAB_REGISTRY.filter((entry) => RETIRED_DIRS.includes(entry.dir))
  assert.deepEqual(retiredEntries.map((entry) => entry.dir), ['大纲', '构思', '资料', '约束'])
  for (const entry of retiredEntries) assert.equal(entry.retired, true)
  // 输入再怎么变——目录在磁盘、体裁没裁剪、连隐藏集合都反过来勾——退场目录依旧不出
  const inputs = [
    { current: true, brief: null, briefGenre: null, libDirs: ['大纲'], settingsOpen: false },
    { current: true, brief: null, briefGenre: null, libDirs: ['大纲', '构思', '资料', '约束'], settingsOpen: true },
    { current: true, brief: null, briefGenre: { excludedPages: [] }, libDirs: ['大纲', '正文', '世界书'], settingsOpen: false },
    { current: true, brief: null, briefGenre: { excludedPages: ['outline', 'notes', 'material', 'constraint'] }, libDirs: ['大纲', '构思', '资料', '约束', '正文'], settingsOpen: false }
  ]
  for (const ctx of inputs) {
    const views = computeTabDefs(ctx).map((def) => def.view)
    for (const dir of RETIRED_DIRS) assert.ok(!views.includes(`dir:${dir}`), `退场目录 ${dir} 不该出现在 ${JSON.stringify(views)}`)
  }
  // dirTabDefs 直呼也滤（双保险的另一半）
  const direct = dirTabDefs({ libDirs: ['大纲', '世界书'], excluded: new Set(), registry: TAB_REGISTRY })
  assert.deepEqual(direct.map((def) => def.view), ['reference'])
})

/* ---------- 词表 / 面板 / 作用域 / 渲染插座 ---------- */

test('OS-92 词表外目录不出页签；「＋」面板的识别判定与显示名与旧词表一致', () => {
  const defs = computeTabDefs({ current: true, brief: null, briefGenre: null, libDirs: ['素材', '漫画', '视频', '体验', '联机', '文档', '人物', '场景'], settingsOpen: false })
  assert.deepEqual(defs.map((def) => def.view), ['artifacts', 'write', 'deduce'])
  for (const dir of ['素材', '漫画', '分镜', '人物', '场景']) {
    assert.equal(isKnownDir(dir), false)
    assert.equal(dirTabEntry(dir), null)
    assert.equal(dirPanelLabel(dir), dir, '词表外目录在面板里原样显示并标「未识别」')
  }
  for (const dir of ['剧本', '日志', '故事源', '世界书', '习惯', '正文']) assert.equal(isKnownDir(dir), true)
  // OS-172：世界书在页签栏与「＋」面板都叫「世界书」；故事源两处都叫「故事源」
  assert.equal(dirPanelLabel('世界书'), '世界书')
  assert.equal(dirPanelLabel('故事源'), '故事源')
  const refEntry = dirTabEntry('世界书')
  assert.equal(refEntry.label, '世界书')
  assert.equal(refEntry.view, 'reference')
  // OS-36：面板「常用」区＝产物/正文/扮演，need＝勾选要求的目录
  assert.deepEqual(builtinPanelTabs(), [
    { view: 'artifacts', label: '产物', need: null },
    { view: 'write', label: '正文', need: '正文' },
    { view: 'deduce', label: '扮演', need: null }
  ])
})

test('OS-83 可新建业务模块清单：磁盘缺什么列什么（词表内＋未退场），全齐时为空', () => {
  assert.deepEqual(creatableDirNames(['正文', '世界书']), [
    { dir: '剧本', label: '剧本' },
    { dir: '日志', label: '日志' }
  ])
  assert.deepEqual(creatableDirNames(['正文', '世界书', '剧本']), [{ dir: '日志', label: '日志' }])
  assert.deepEqual(creatableDirNames(['正文', '世界书', '剧本', '日志']), [], '词表内目录全在磁盘时没有可建项')
  // 退场目录（大纲/构思/资料/约束在 DIR_ORDER 词表外本来就不列）永不为「可建」推荐
  for (const dir of RETIRED_DIRS) {
    assert.ok(!creatableDirNames([]).some((item) => item.dir === dir))
  }
})

test('go() 作用域校验：flow/global 不需要库；library/未知视图没库退回库清单', () => {
  assert.equal(viewScope('settings'), 'global')
  assert.equal(viewScope('libraries'), 'global')
  assert.equal(viewScope('lib-create'), 'flow')
  assert.equal(viewScope('lib-import'), 'flow')
  assert.equal(viewScope('repair'), 'flow')
  for (const view of ['write', 'artifacts', 'deduce', 'reference', 'habits']) assert.equal(viewScope(view), 'library')
  assert.equal(viewScope('dir:剧本'), 'library')
  assert.equal(viewScope('dir:不认识的目录'), 'library')
  assert.equal(viewScope('nope'), null, '未知视图按「需要库」处理——与旧算法同语义')
  assert.equal(viewScope(undefined), null)
})

test('渲染插座：registry 只存注册名，app.js 的 VIEW_RENDERERS 覆盖全部注册名', () => {
  const renderNames = [...new Set(TAB_REGISTRY.filter((entry) => entry.render).map((entry) => entry.render))]
  assert.ok(renderNames.length >= 8)
  assert.equal(renderNameForView('write'), 'writeHtml')
  assert.equal(renderNameForView('settings'), 'settingsHtml')
  assert.equal(renderNameForView('dir:剧本'), 'dirViewHtml', 'dir:* 统一走 dirViewHtml（剧本/故事源 fork 在其内部）')
  assert.equal(renderNameForView('dir:日志'), 'dirViewHtml')
  assert.equal(renderNameForView('nope'), null)
  // 读 app.js 源码校验插座覆盖（不 import app.js——它是浏览器脚本）
  const appSource = readFileSync(join(HERE, '..', 'public', 'app.js'), 'utf-8')
  const match = /const VIEW_RENDERERS = \{([^}]*)\}/.exec(appSource)
  assert.ok(match, 'app.js 必须声明 VIEW_RENDERERS 插座')
  const registered = new Set([...match[1].matchAll(/([A-Za-z]\w*)/g)].map((m) => m[1]))
  for (const name of renderNames) {
    assert.ok(registered.has(name), `VIEW_RENDERERS 缺注册名 ${name}——该视图会渲染失败`)
  }
})

test('registry 纯度：零 import、零 DOM/存储——不可能反向依赖 app.js', () => {
  const source = readFileSync(join(HERE, '..', 'public', 'views', 'registry.mjs'), 'utf-8')
  assert.doesNotMatch(source, /^\s*import\s/m, '注册表不许静态 import 任何模块')
  assert.doesNotMatch(source, /require\(/, '注册表不许 require')
  assert.doesNotMatch(source, /import\(/, '注册表不许动态 import（纯数据＋纯函数）')
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|localStorage|sessionStorage/, '注册表不碰 DOM 与浏览器存储')
  // 依赖方向只能是壳→表：剥掉注释后，代码里不许出现 app.js 字样
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.doesNotMatch(code, /app\.js/, '注册表代码不引用 app.js')
})

test('词表映射原样保真：PAGE_TO_DIR_LOCAL/READONLY_DIRS/DIR_ORDER/DIR_LABELS', () => {
  assert.deepEqual({ ...PAGE_TO_DIR_LOCAL }, { write: '正文', entries: '世界书', worldbook: '世界书', script: '剧本' })
  assert.deepEqual([...DIR_ORDER], ['正文', '世界书', '剧本', '日志'])
  assert.deepEqual([...RETIRED_DIRS], ['大纲', '构思', '资料', '约束'])
  assert.ok(READONLY_DIRS.has('日志'))
  assert.equal(READONLY_DIRS.size, 1)
  assert.equal(DIR_LABELS['故事源'], '故事源')
  assert.equal(DIR_LABELS['正文'], '正文')
})
