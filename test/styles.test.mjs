/**
 * OpenStory OS-5/6 用例（node:test，零依赖）——风格包目录加载。（OS-54：wiki 工作面已剔除）
 *
 * 跑法：
 *   node --test openstory/test/styles.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRequest, validateResponse } from '../src/api/contracts.mjs'
import {
  builtinStylesDir,
  defaultUserStylesDir,
  loadStylePacks,
  normalizeStylePack
} from '../src/services/stylePacks.mjs'
import { isHexColor } from '../src/services/stylePacks.mjs'
import { startDaemon } from '../src/host/daemon.mjs'

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os5-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '拆解'), { recursive: true })
  await mkdir(join(root, '.pinax'), { recursive: true })
  await writeFile(join(root, '拆解', 'book-1.json'), JSON.stringify({
    book: { id: 'book-1', title: '夹具书<脚本试炼>' },
    entries: [{ schema: 'fact.data/v3', id: 'e1', layer: 'plot', name: '第一段', status: 'draft' }],
    revision: 1
  }), 'utf-8')
  await writeFile(join(root, '拆解', 'book-1.wiki.json'), JSON.stringify({
    derivedFrom: { factRevision: 1, schema: 'pinax-wiki-derived@1' },
    book: { id: 'book-1', title: '夹具书<脚本试炼>', author: '林某', group: '雾港组' },
    characters: [
      { name: '林砚<script>', identity: '摆渡人', archetype: '引路者', summary: '雾港渡口的摆渡人', appearances: 7 },
      { name: '余欢', identity: '律师' }
    ],
    chapters: [
      { no: 1, title: '雨停之后', summary: '雨到傍晚才停。' },
      { no: 2, title: '渡口' }
    ],
    terms: [{ name: '青浦渡口', definition: '故事发生地。' }]
  }), 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    recentProjects: [{ path: root, name: '夹具库', at: '2026-11-15T00:00:00.000Z' }]
  }), 'utf-8')
  return { base, root, preferencesPath, builtinDir: join(base, '内置皮'), userDir: join(base, '本机皮') }
}

const CORAL = {
  id: 'coral', name: '珊瑚 · Airbnb 系', description: '白底墨字',
  tokens: { '--bg': '#ffffff', '--accent': '#ff385c', '--content-max': '1180px' }
}

/* ---------- 风格包规整 ---------- */

test('风格包规整：合法包收下；id/name/tokens/注入字符逐项把门', () => {
  const ok = normalizeStylePack(CORAL, { source: '内置', file: 'coral.json' })
  assert.equal(ok.ok, true)
  assert.equal(ok.pack.source, '内置')
  assert.equal(ok.pack.tokens['--accent'], '#ff385c')

  assert.equal(normalizeStylePack({ ...CORAL, id: '坏 id!' }, { source: '内置', file: 'x' }).ok, false)
  assert.equal(normalizeStylePack({ ...CORAL, name: '' }, { source: '内置', file: 'x' }).ok, false)
  assert.equal(normalizeStylePack({ ...CORAL, tokens: { 'color': '#fff' } }, { source: '内置', file: 'x' }).ok, false, 'token 名必须 --kebab')
  assert.equal(normalizeStylePack({ ...CORAL, tokens: { '--bg': 'red' } }, { source: '内置', file: 'x' }).ok, false, '缺 --accent')
  const inject = normalizeStylePack({ ...CORAL, tokens: { '--bg': '#fff', '--accent': 'red</style><script>' } }, { source: '内置', file: 'x' })
  assert.equal(inject.ok, false, '值带 < > 拒收')
  assert.equal(normalizeStylePack({ ...CORAL, tokens: { '--bg': '#fff;@import', '--accent': '#333' } }, { source: '内置', file: 'x' }).ok, false, '值带 ; @ 拒收')
  assert.equal(normalizeStylePack('不是对象', { source: '内置', file: 'x' }).ok, false)
})

/* ---------- 目录加载与合并 ---------- */

test('风格包目录：内置＋本机合并，本机按 id 覆盖；坏档跳过＋warning；目录缺失不炸', async () => {
  const { base, builtinDir, userDir } = await makeFixture()
  try {
    await mkdir(builtinDir, { recursive: true })
    await mkdir(userDir, { recursive: true })
    await writeFile(join(builtinDir, 'coral.json'), JSON.stringify(CORAL), 'utf-8')
    await writeFile(join(builtinDir, 'ink.json'), JSON.stringify({ ...CORAL, id: 'ink', name: '纸墨', tokens: { ...CORAL.tokens, '--accent': '#7a5c2e' } }), 'utf-8')
    await writeFile(join(builtinDir, '坏档.json'), '{ not json', 'utf-8')
    // 本机覆盖 coral＋上新第四套
    await writeFile(join(userDir, 'coral.json'), JSON.stringify({ ...CORAL, name: '珊瑚（本机改）', tokens: { ...CORAL.tokens, '--accent': '#e0457b' } }), 'utf-8')
    await writeFile(join(userDir, 'celadon.json'), JSON.stringify({ id: 'celadon', name: '青瓷', description: '影青釉面', tokens: { '--bg': '#f2f7f5', '--accent': '#3a9188' } }), 'utf-8')
    await writeFile(join(userDir, '坏包.json'), JSON.stringify({ id: 'bad id!', name: 'x' }), 'utf-8')

    const { styles, warnings } = await loadStylePacks([builtinDir, userDir])
    const ids = styles.map((pack) => pack.id)
    assert.deepEqual(ids, ['coral', 'ink', 'celadon'])
    const coral = styles.find((pack) => pack.id === 'coral')
    assert.equal(coral.name, '珊瑚（本机改）', '本机覆盖内置')
    assert.equal(coral.source, '本机')
    assert.equal(styles.find((pack) => pack.id === 'ink').source, '内置')
    assert.ok(warnings.some((warning) => warning.code === 'STYLE_PACK_UNREADABLE'), '坏档记 warning')
    assert.ok(warnings.some((warning) => warning.code === 'STYLE_PACK_ID'), '坏 id 记 warning')

    const missing = await loadStylePacks([join(base, '不在'), userDir])
    assert.ok(missing.warnings.some((warning) => warning.code === 'STYLES_DIR_MISSING'), '内置目录缺失记 warning')
    assert.equal(missing.styles.length, 2)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('风格包路径：内置随仓，本机跟 LOCALAPPDATA', () => {
  assert.ok(builtinStylesDir().includes('styles'), '内置目录在仓内 styles/ 下')
  assert.equal(
    defaultUserStylesDir({ LOCALAPPDATA: 'C:/Users/x/AppData/Local' }).replaceAll('\\', '/'),
    'C:/Users/x/AppData/Local/OpenStory/openstory/styles'
  )
  assert.equal(defaultUserStylesDir({}), '')
})

/* ---------- 契约 ---------- */

test('契约：stylesGet/wikiHtmlGet 形状', () => {
  assert.equal(validateRequest('stylesGet', {}).ok, true)
  assert.equal(validateResponse('stylesGet', { ok: true, styles: [], warnings: [] }).ok, true)
  assert.equal(validateResponse('stylesGet', { ok: true, warnings: [] }).ok, false)
})

/* ---------- daemon 端到端 ---------- */

test('daemon 端到端：/api/styles 四包＋坏档 warning', async () => {
  const fixture = await makeFixture()
  try {
    await mkdir(fixture.builtinDir, { recursive: true })
    await mkdir(fixture.userDir, { recursive: true })
    await writeFile(join(fixture.builtinDir, 'coral.json'), JSON.stringify(CORAL), 'utf-8')
    await writeFile(join(fixture.builtinDir, 'ink.json'), JSON.stringify({ ...CORAL, id: 'ink', name: '纸墨', tokens: { ...CORAL.tokens, '--accent': '#7a5c2e' } }), 'utf-8')
    await writeFile(join(fixture.builtinDir, 'night.json'), JSON.stringify({ ...CORAL, id: 'night', name: '暗夜', tokens: { ...CORAL.tokens, '--accent': '#ff6b88' } }), 'utf-8')
    await writeFile(join(fixture.userDir, 'celadon.json'), JSON.stringify({ id: 'celadon', name: '青瓷', description: '影青釉面', tokens: { '--bg': '#f2f7f5', '--accent': '#3a9188' } }), 'utf-8')
    await writeFile(join(fixture.userDir, '坏包.json'), JSON.stringify({ name: '缺 id' }), 'utf-8')

    const daemon = await startDaemon({
      port: 0,
      preferencesPath: fixture.preferencesPath,
      stylesDirs: [fixture.builtinDir, fixture.userDir],
      logger: { log() {} }
    })
    const origin = `http://127.0.0.1:${daemon.port}`
    try {
      const styles = await (await fetch(`${origin}/api/styles`)).json()
      assert.equal(styles.ok, true)
      assert.deepEqual(styles.styles.map((pack) => pack.id), ['coral', 'ink', 'night', 'celadon'])
      assert.equal(styles.styles[3].source, '本机')
      assert.ok(styles.warnings.some((warning) => warning.code === 'STYLE_PACK_ID'), '缺 id 的包记 warning')

    } finally {
      await daemon.close()
    }
  } finally {
    await rm(fixture.base, { recursive: true, force: true })
  }
})
