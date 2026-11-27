/**
 * OS-198：slot 投影的生产链路守护（真实 daemon＋临时库＋临时模块根）。
 *
 * 覆盖：`/api/plugins.slots` 与 manifest 一致；停用工作台后投影消失、重新启用回来；
 * 第三方 iframe 工作台的 `/module-page/<id>/<entry>` 只对已登记已装载的本机模块开放。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { modulePageHtml } from '../public/views/modulePageViews.mjs'
import { TAB_REGISTRY, projectedTabDefs, projectedPanelTabs, visibleTabDefs, moduleView } from '../public/views/registry.mjs'

async function makeDaemon() {
  const base = await mkdtemp(join(tmpdir(), 'os198-slots-'))
  const env = { LOCALAPPDATA: base, APPDATA: base }
  const root = join(base, '夹具库')
  await mkdir(join(root, '.openstory'), { recursive: true })
  await writeFile(join(root, '.openstory', 'ui-state.json'), '{}', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    schemaVersion: 1,
    libraries: [{ path: root, name: '夹具库' }]
  }), 'utf-8')
  const daemon = await startDaemon({ port: 0, preferencesPath, env, logger: { log() {} } })
  return { base, env, root, daemon, origin: `http://127.0.0.1:${daemon.port}` }
}

async function close(item) {
  await item.daemon.close()
  await rm(item.base, { recursive: true, force: true })
}

async function withDaemon(run) {
  const item = await makeDaemon()
  try { return await run(item) } finally { await close(item) }
}

const json = async (response) => ({ status: response.status, payload: await response.json().catch(() => null) })
const get = (origin, path) => fetch(`${origin}${path}`).then(json)
const plugins = (origin, root) => get(origin, `/api/plugins?root=${encodeURIComponent(root)}`)
const post = (origin, path, body) => fetch(`${origin}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
}).then(json)
const put = (origin, root, state) => fetch(`${origin}/api/ui-state`, {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root, state })
}).then(json)

const tabPages = (payload) => (payload.slots?.tab ?? []).map((item) => item.page)

async function writeIframeModule(moduleRoot) {
  const dir = join(moduleRoot, 'ext-frame')
  await mkdir(dir, { recursive: true })
  const manifest = {
    spec: 'openstory-module@2',
    id: 'ext-frame',
    name: '外部工作台',
    version: '0.1.0',
    class: 'workbench',
    entry: 'index.mjs',
    requires: [{ id: 'base.write', min: 1 }],
    slots: [{ slot: 'tab', page: 'ext-page', order: 90 }],
    pages: [{ id: 'ext-page', label: '外部页', kind: 'iframe', entry: 'page.html' }],
    endpoints: []
  }
  await writeFile(join(dir, 'module.manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  await writeFile(join(dir, 'index.mjs'), `export async function activate(context) {
  context.resolve('base.write', { min: 1 })
  return { pages: { 'ext-page': { id: 'ext-page', label: '外部页' } } }
}`, 'utf-8')
  await writeFile(join(dir, 'page.html'), '<!doctype html><title>外部页</title><script src="./app.js"></script><p>OS-198 iframe</p>', 'utf-8')
  await writeFile(join(dir, 'app.js'), 'console.log("OS-198 asset")', 'utf-8')
  await writeFile(join(dir, 'secret.txt'), 'not a declared entry', 'utf-8')
  return dir
}

const slotCtx = () => ({ current: { path: '/lib' }, brief: null, briefGenre: null, libDirs: ['正文', '世界书', '剧本', '故事源', '习惯', '日志'], settingsOpen: false })

test('OS-198-daemon：/api/plugins.slots 与 manifest 一致，停用习惯后消失、启用后回来', async () => {
  await withDaemon(async ({ origin, root }) => {
    const initial = await plugins(origin, root)
    assert.equal(initial.status, 200)
    assert.ok(initial.payload.slots?.tab, '响应必须带 slots.tab')
    assert.deepEqual(tabPages(initial.payload), ['artifacts', 'chapters', 'knowledge-base', 'worldbook', 'script', 'log', 'storysource', 'habits', 'roleplay'])
    assert.ok(initial.payload.slots.tab.every((item) => item.view === 'builtin'), '内置页面走 builtin 视图')
    assert.deepEqual(initial.payload.slotWarnings, [])

    const off = await put(origin, root, { modules: { enabled: { habits: false } } })
    assert.equal(off.status, 200)
    const without = await plugins(origin, root)
    assert.ok(!tabPages(without.payload).includes('habits'), '停用后投影里没有习惯')
    assert.deepEqual(tabPages(without.payload), ['artifacts', 'chapters', 'knowledge-base', 'worldbook', 'script', 'log', 'storysource', 'roleplay'])

    const on = await put(origin, root, { modules: { enabled: { habits: true } } })
    assert.equal(on.status, 200)
    const back = await plugins(origin, root)
    assert.deepEqual(tabPages(back.payload), ['artifacts', 'chapters', 'knowledge-base', 'worldbook', 'script', 'log', 'storysource', 'habits', 'roleplay'])
  })
})

test('OS-198-前端：module 视图按投影出 iframe，app.js 渲染分支把视图键交给渲染器', () => {
  const slots = { tab: [{ slot: 'tab', module: 'ext-frame', page: 'ext-page', label: '外部页', view: 'iframe', entry: 'page.html' }] }
  const html = modulePageHtml('module:ext-frame/ext-page', { slots, localModules: [{ id: 'ext-frame', version: '0.1.0' }], root: '/库' })
  assert.match(html, /<iframe/u)
  assert.match(html, /\/module-page\/ext-frame\/page\.html\?root=%2F/u)
  assert.doesNotMatch(modulePageHtml('', { slots }), /<iframe/u, '空视图键＝如实空态，不许误指向别的页面')

  // 冒烟抓到过的回归：viewHtml 只转交 ...args 时，module 分支的渲染器拿到 undefined。
  // 该断言钉住 app.js 的接线口，防止 render 分支退回不带视图键的调用。
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf-8')
  assert.match(app, /state\.view\.startsWith\('module:'\)\) viewEl\.innerHTML = viewHtml\(state\.view, state\.view\)/u)
})

test('OS-198-daemon：第三方 iframe 页面进投影并可由 /module-page 提供；内置模块不走该路由', async () => {
  await withDaemon(async ({ base, origin, root }) => {
    const moduleRoot = join(base, '模块根')
    await writeIframeModule(moduleRoot)
    const added = await post(origin, '/api/module-roots/add', { path: moduleRoot, confirm: true })
    assert.equal(added.status, 200, JSON.stringify(added.payload))
    assert.equal(added.payload.localModules.find((item) => item.id === 'ext-frame')?.status, 'loaded')

    const listed = await plugins(origin, root)
    const iframe = listed.payload.slots.tab.find((item) => item.page === 'ext-page')
    assert.ok(iframe, '第三方页签必须进投影')
    assert.equal(iframe.module, 'ext-frame')
    assert.equal(iframe.view, 'iframe')
    assert.equal(iframe.entry, 'page.html')
    assert.equal(iframe.label, '外部页')

    const page = await fetch(`${origin}/module-page/ext-frame/page.html`)
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-type') || '', /text\/html/u)
    assert.match(await page.text(), /OS-198 iframe/u)

    const asset = await fetch(`${origin}/module-page/ext-frame/app.js`)
    assert.equal(asset.status, 200, '入口引用的白名单静态资源照常服务')
    assert.match(await asset.text(), /OS-198 asset/u)

    const builtin = await fetch(`${origin}/module-page/chapters/index.html`)
    assert.equal(builtin.status, 404, '内置模块不允许走本机模块页面路由')

    const escape = await fetch(`${origin}/module-page/ext-frame/%2e%2e/module.manifest.json`)
    assert.ok([400, 403, 404].includes(escape.status), `包外路径必须拒绝，实际 ${escape.status}`)

    // OS-198a P3c/P3d：未声明入口与 manifest 永不服务。
    const secret = await fetch(`${origin}/module-page/ext-frame/secret.txt`)
    assert.equal(secret.status, 403, '非声明入口且扩展名不在白名单 → 拒绝')
    const manifest = await fetch(`${origin}/module-page/ext-frame/module.manifest.json`)
    assert.equal(manifest.status, 403, 'module.manifest.json 永不服务')
    const modEntry = await fetch(`${origin}/module-page/ext-frame/index.mjs`)
    assert.equal(modEntry.status, 403, '模块 entry 永不服务')
    const unrelated = await fetch(`${origin}/module-page/ext-frame/other.json`)
    assert.ok([403, 404].includes(unrelated.status), '入口未引用的资源不放行')
  })
})

test('OS-198a-daemon：第三方页签收起后刷新仍在，「＋」面板能勾回并回到原位', async () => {
  await withDaemon(async ({ base, origin, root }) => {
    const moduleRoot = join(base, '模块根')
    await writeIframeModule(moduleRoot)
    const added = await post(origin, '/api/module-roots/add', { path: moduleRoot, confirm: true })
    assert.equal(added.status, 200)
    const view = moduleView('ext-frame', 'ext-page')

    // 收起：写进库内 ui-state（× 的真实落盘动作）。
    const hidden = await put(origin, root, { tabHidden: [view] })
    assert.equal(hidden.status, 200)
    // 刷新重进：从 daemon 读回 ui-state 与 slots 投影，页签栏里没有它，面板里仍有它。
    const reread = await get(origin, `/api/ui-state?root=${encodeURIComponent(root)}`)
    assert.equal(reread.status, 200)
    const saved = reread.payload.state?.tabHidden ?? []
    assert.ok(saved.includes(view), '收起状态必须落库内 ui-state')
    const listed = await plugins(origin, root)
    const slots = listed.payload.slots
    const defs = projectedTabDefs({ slots, ctx: slotCtx() })
    assert.ok(defs.some((def) => def.view === view), '投影本身仍含第三方页')
    assert.ok(visibleTabDefs(defs, new Set(saved)).every((def) => def.view !== view), '收起后页签栏没有它')
    const panel = projectedPanelTabs(slots, TAB_REGISTRY, slotCtx())
    assert.ok(panel.some((item) => item.view === view && item.label === '外部页'), '刷新后面板里能勾回')

    // 勾回：去掉死条目后页签按投影原位回来。
    const restored = await put(origin, root, { tabHidden: saved.filter((item) => item !== view) })
    assert.equal(restored.status, 200)
    const back = await get(origin, `/api/ui-state?root=${encodeURIComponent(root)}`)
    const defsBack = projectedTabDefs({ slots: (await plugins(origin, root)).payload.slots, ctx: slotCtx() })
    assert.ok(!(back.payload.state?.tabHidden ?? []).includes(view))
    assert.ok(visibleTabDefs(defsBack, new Set(back.payload.state?.tabHidden ?? [])).some((def) => def.view === view), '勾回后页签回来')
  })
})