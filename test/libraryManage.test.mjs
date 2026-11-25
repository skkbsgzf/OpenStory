/**
 * OpenStory OS-7 用例（node:test，零依赖）——库管理写操作：建库/登记/诊断/修主模块/扫描/导入。
 *
 * 跑法：
 *   node --test openstory/test/libraryManage.test.mjs
 *
 * 走的是与 daemon 完全相同的复用链（createProject/planImport/runImport），源目录只读承诺有专测。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRequest, validateResponse } from '../src/api/contracts.mjs'
import {
  createLibrary,
  diagnoseLibrary,
  importLibrary,
  mapManageError,
  registerLibrary,
  scanLibrary,
  setPrimaryCarrier
} from '../src/host/libraryManage.mjs'
import { startDaemon } from '../src/host/daemon.mjs'

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os7-'))
  const parent = join(base, '写作')
  await mkdir(parent, { recursive: true })
  const preferencesPath = join(base, 'libraries.json')
  const source = join(parent, '旧稿')
  await mkdir(join(source, '正文'), { recursive: true })
  await mkdir(join(source, '大纲'), { recursive: true })
  await writeFile(join(source, '正文', '第1章 雨停.md'), '# 第1章 雨停\n\n雨到傍晚才停。', 'utf-8')
  await writeFile(join(source, '正文', '第2章 渡口.md'), '# 第2章 渡口\n\n雾从水面漫上来。', 'utf-8')
  await writeFile(join(source, '大纲', '总大纲.md'), '三幕：雨停—渡口—离港。', 'utf-8')
  await writeFile(join(source, '随手记.txt'), '认不出的东西', 'utf-8')
  return { base, parent, preferencesPath, source, empty: join(parent, '空地'), draftDir: source }
}

/* ---------- 登记清单 ---------- */

test('登记：追加去重；清单缺失从零起；坏档拒绝且绝不覆盖', async () => {
  const { base, parent, preferencesPath } = await makeFixture()
  try {
    const first = await registerLibrary(preferencesPath, join(parent, '长夜'), '长夜')
    assert.equal(first.ok, true)
    assert.equal(first.duplicate, false)
    const doc = JSON.parse(await readFile(preferencesPath, 'utf-8'))
    assert.equal(doc.libraries.length, 1)
    assert.equal(doc.libraries[0].name, '长夜')

    const dupe = await registerLibrary(preferencesPath, join(parent, '长夜'), '改名也没用')
    assert.equal(dupe.duplicate, true)
    const doc2 = JSON.parse(await readFile(preferencesPath, 'utf-8'))
    assert.equal(doc2.libraries.length, 1, '重复路径不重复登记')

    await registerLibrary(preferencesPath, join(parent, '别的'), '别的')
    const doc3 = JSON.parse(await readFile(preferencesPath, 'utf-8'))
    assert.equal(doc3.libraries.length, 2)

    await writeFile(preferencesPath, '{ broken', 'utf-8')
    const corrupt = await registerLibrary(preferencesPath, join(parent, '再来'), '再来')
    assert.equal(corrupt.ok, false)
    assert.match(corrupt.message, /拒绝登记/)
    assert.equal(await readFile(preferencesPath, 'utf-8'), '{ broken', '坏档没被覆盖')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- 建库 ---------- */

test('建库：novel 主模块全链；重复路径拒绝；非绝对路径拒绝；bare 空壳 needsPrimary', async () => {
  const { base, parent, preferencesPath } = await makeFixture()
  try {
    const created = await createLibrary({ path: join(parent, '长夜'), name: '长夜', primaryCarrier: 'openstory.carrier.novel', preferencesPath })
    assert.equal(created.ok, true)
    assert.equal(created.document.spec, 'openstory-project@4')
    assert.equal(created.document.kind, 'novel')
    assert.equal(created.needsPrimary, false)
    const dirs = await readdir(created.root)
    // OS-164/G8b 合法更新：退场四目录不再随新库落盘，参考/ 作为真笔记目录补进来。
    for (const dir of ['正文', '世界书', '世界书', '日志', '.openstory']) {
      assert.ok(dirs.includes(dir), `骨架缺 ${dir}`)
    }
    for (const retired of ['大纲', '构思', '资料', '约束']) {
      assert.ok(!dirs.includes(retired), `新库不该再建退场目录 ${retired}`)
    }
    const prefs = JSON.parse(await readFile(preferencesPath, 'utf-8'))
    assert.equal(prefs.libraries[0].name, '长夜')

    const dupe = await createLibrary({ path: join(parent, '长夜'), name: '长夜', primaryCarrier: 'openstory.carrier.novel', preferencesPath })
    assert.equal(dupe.ok, false, '目标目录非空拒绝')

    const relative = await createLibrary({ path: '写作/长夜2', name: '长夜2', preferencesPath })
    assert.equal(relative.ok, false)
    assert.match(relative.message, /绝对路径/)

    const bare = await createLibrary({ path: join(parent, '裸库'), name: '裸库', preferencesPath })
    assert.equal(bare.ok, true)
    assert.equal(bare.needsPrimary, true)
    const bareDoc = JSON.parse(await readFile(join(parent, '裸库', '.openstory', 'project.json'), 'utf-8'))
    assert.equal(bareDoc.carriers.primary, null)

    const badName = await createLibrary({ path: join(parent, 'x'), name: '', preferencesPath })
    assert.equal(badName.ok, false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- 诊断 ---------- */

test('诊断：健康/空地/有稿无标记/裸库/缺路径 五种 verdict', async () => {
  const { base, parent, preferencesPath, empty, draftDir } = await makeFixture()
  try {
    await createLibrary({ path: join(parent, '长夜'), name: '长夜', primaryCarrier: 'openstory.carrier.novel', preferencesPath })

    const healthy = await diagnoseLibrary(join(parent, '长夜'))
    assert.equal(healthy.verdict.ok, true)
    assert.equal(healthy.shape.project.kind, 'novel')
    assert.equal(healthy.shape.project.primary, 'openstory.carrier.novel')

    await mkdir(empty, { recursive: true })
    const emptyVerdict = await diagnoseLibrary(empty)
    assert.equal(emptyVerdict.verdict.ok, false)
    assert.equal(emptyVerdict.verdict.action, 'create-here')

    const draftVerdict = await diagnoseLibrary(draftDir)
    assert.equal(draftVerdict.verdict.action, 'import-here')
    assert.equal(draftVerdict.shape.dirEmpty, false)

    await createLibrary({ path: join(parent, '裸库'), name: '裸库', preferencesPath })
    const bareVerdict = await diagnoseLibrary(join(parent, '裸库'))
    assert.equal(bareVerdict.verdict.action, 'pick-primary')

    const missing = await diagnoseLibrary(join(parent, '不存在'))
    assert.equal(missing.verdict.action, 'create-here')
    assert.equal(missing.shape.exists, false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- 修主模块 ---------- */

test('修主模块：bare→novel 连 kind 一起落；kind 冲突拒绝；revision 闸；未知载体拒绝', async () => {
  const { base, parent, preferencesPath } = await makeFixture()
  try {
    await createLibrary({ path: join(parent, '裸库'), name: '裸库', preferencesPath })
    const root = join(parent, '裸库')

    const stale = await setPrimaryCarrier({ root, primaryCarrier: 'openstory.carrier.novel', expectedRevision: 7 })
    assert.equal(stale.ok, false)
    assert.equal(stale.code, 'REVISION_MISMATCH', 'STALE_REVISION 透传成 REVISION_MISMATCH')

    const set = await setPrimaryCarrier({ root, primaryCarrier: 'openstory.carrier.novel' })
    assert.equal(set.ok, true)
    assert.equal(set.document.carriers.primary, 'openstory.carrier.novel')
    assert.equal(set.document.kind, 'novel')
    assert.ok(set.enabled.includes('openstory.carrier.novel'))

    const conflict = await setPrimaryCarrier({ root, primaryCarrier: 'openstory.carrier.script' })
    assert.equal(conflict.ok, false)
    assert.match(conflict.message, /请新建相应类型的库/)

    const unknown = await setPrimaryCarrier({ root, primaryCarrier: 'openstory.carrier.comic' })
    assert.equal(unknown.ok, false, 'kind 一致（record 型无 projectKind）或未知载体都拒绝')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- 扫描与导入 ---------- */

test('扫描/导入：计划→落盘→源目录一个字没动；相对路径与不存在目录拒收', async () => {
  const { base, parent, preferencesPath, source, draftDir } = await makeFixture()
  try {
    const created = await createLibrary({ path: join(parent, '长夜'), name: '长夜', primaryCarrier: 'openstory.carrier.novel', preferencesPath })
    assert.equal(created.ok, true)

    const badSource = await scanLibrary({ root: created.root, sourcePath: '相对/路径' })
    assert.equal(badSource.ok, false)
    assert.equal(badSource.code, 'INVALID_ENTRY')
    const missingSource = await importLibrary({ root: created.root, sourcePath: join(parent, '不存在') })
    assert.equal(missingSource.ok, false)
    assert.equal(missingSource.code, 'NOT_FOUND')

    const scan = await scanLibrary({ root: created.root, sourcePath: source })
    assert.equal(scan.ok, true)
    assert.equal(scan.plan.mode, 'plan')
    assert.ok(Array.isArray(scan.plan.items) && scan.plan.items.length >= 3, '2 章＋1 大纲都在计划里')
    assert.ok(scan.plan.items.every((item) => item.target, '每项都有目标相对路径'))

    const report = await importLibrary({ root: created.root, sourcePath: source })
    assert.equal(report.ok, true)
    assert.equal(report.report.createdCount, 3)
    assert.equal(report.report.failedCount, 0)

    const chapters = await readdir(join(parent, '长夜', '正文'))
    assert.deepEqual(chapters, ['001-雨停.md', '002-渡口.md'], '规范命名落盘')
    const outlines = await readdir(join(parent, '长夜', '大纲'))
    assert.equal(outlines.length, 1)

    const untouched = await readFile(join(source, '正文', '第1章 雨停.md'), 'utf-8')
    assert.equal(untouched, '# 第1章 雨停\n\n雨到傍晚才停。', '源目录只读承诺')
    assert.deepEqual(await readdir(draftDir), ['大纲', '正文', '随手记.txt'], '源目录结构没变')

    const again = await importLibrary({ root: created.root, sourcePath: source })
    assert.equal(again.ok, true)
    assert.equal(again.report.reusedCount, 3, '同内容复用不重写')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- 契约 ---------- */

test('契约：library 五端点形状', () => {
  assert.equal(validateRequest('libraryDiagnose', {}).ok, false)
  assert.equal(validateRequest('libraryDiagnose', { root: 'r' }).ok, true)
  assert.equal(validateRequest('libraryCreate', { path: 'D:\\x', name: 'n' }).ok, true)
  assert.equal(validateRequest('libraryCreate', { name: 'n' }).ok, false)
  assert.equal(validateRequest('libraryScan', { root: 'r', sourcePath: 'D:\\src' }).ok, true)
  assert.equal(validateRequest('libraryPrimary', { root: 'r', primaryCarrier: 'p', expectedRevision: '3' }).ok, false, 'revision 要整数')
  assert.equal(validateRequest('libraryPrimary', { root: 'r', primaryCarrier: 'p' }).ok, true)
  assert.equal(validateResponse('libraryDiagnose', { ok: true, shape: {}, verdict: {} }).ok, true)
  assert.equal(validateResponse('libraryCreate', { ok: true, root: 'r', document: {}, needsPrimary: false, registered: {} }).ok, true)
  assert.equal(validateResponse('libraryImport', { ok: true, report: {} }).ok, true)
})

/* ---------- daemon 端到端 ---------- */

test('daemon 端到端：create→diagnose→scan→import→chapter 读到导入稿；bare→primary→diagnose ok', async () => {
  const fixture = await makeFixture()
  const daemon = await startDaemon({
    port: 0,
    preferencesPath: fixture.preferencesPath,
    agentConfigPath: join(fixture.base, 'agent-config.json'),
    agentSessionsDir: join(fixture.base, 'sessions'),
    logger: { log() {} }
  })
  const origin = `http://127.0.0.1:${daemon.port}`
  const post = (path, body) => fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  try {
    const create = await post('/api/library/create', { path: join(fixture.parent, '长夜'), name: '长夜', primaryCarrier: 'openstory.carrier.novel' })
    assert.equal(create.status, 200)
    const created = (await create.json())
    assert.equal(created.ok, true)
    assert.equal(created.needsPrimary, false)

    // 建好即可诊断（新库已在清单里＝白名单放行）
    const diag = await fetch(`${origin}/api/library/diagnose?root=${encodeURIComponent(created.root)}`)
    const diagPayload = await diag.json()
    assert.equal(diagPayload.verdict.ok, true)

    // 未登记 root 的诊断拒收
    const outside = await fetch(`${origin}/api/library/diagnose?root=${encodeURIComponent(join(fixture.base, '别的'))}`)
    assert.equal(outside.status, 403)

    const scan = await post('/api/library/scan', { root: created.root, sourcePath: fixture.source })
    assert.equal(scan.status, 200)
    const plan = (await scan.json()).plan
    assert.ok(plan.importable >= 3)

    const imp = await post('/api/library/import', { root: created.root, sourcePath: fixture.source })
    assert.equal(imp.status, 200)
    const report = (await imp.json()).report
    assert.equal(report.createdCount, 3)

    // 导入的稿子从正文通道真的读得到
    const chapter = await fetch(`${origin}/api/chapter?root=${encodeURIComponent(created.root)}&file=${encodeURIComponent('正文/001-雨停.md')}`)
    const chapterPayload = await chapter.json()
    assert.equal(chapterPayload.ok, true)
    assert.ok(chapterPayload.text.includes('雨到傍晚才停'))

    // bare → primary → diagnose ok
    const bare = await post('/api/library/create', { path: join(fixture.parent, '裸库'), name: '裸库' })
    assert.equal((await bare.json()).needsPrimary, true)
    const primary = await post('/api/library/primary', { root: join(fixture.parent, '裸库'), primaryCarrier: 'openstory.carrier.script' })
    assert.equal(primary.status, 200)
    const diagFixed = await fetch(`${origin}/api/library/diagnose?root=${encodeURIComponent(join(fixture.parent, '裸库'))}`)
    assert.equal((await diagFixed.json()).verdict.ok, true)

    // 坏色参之外的常规错误：源目录不存在 → 404
    const badScan = await post('/api/library/scan', { root: created.root, sourcePath: join(fixture.parent, '不存在') })
    assert.equal(badScan.status, 404)
  } finally {
    await daemon.close()
    await rm(fixture.base, { recursive: true, force: true })
  }
})
