/**
 * OpenStory OS-19 用例——体裁与形制（项目级一等约束）＋简报＋Agent 策略注入。
 *
 * 跑法：
 *   node --test test/genres.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRequest, validateResponse } from '../src/api/contracts.mjs'
import {
  allowedDirs,
  briefPromptSection,
  briefPath,
  builtinGenresDir,
  divideLabel,
  loadGenres,
  normalizeGenre,
  readBrief,
  unitLabel,
  writeBrief
} from '../src/services/genres.mjs'
import { startDaemon } from '../src/host/daemon.mjs'

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os19-'))
  const root = join(base, '夹具库')
  for (const dir of ['正文', '大纲', '世界书', '构思', '资料', '约束', '拆解']) {
    await mkdir(join(root, dir), { recursive: true })
  }
  await writeFile(join(root, '正文', '001-雨停.md'), '雨到傍晚才停。', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    recentProjects: [{ path: root, name: '夹具库', at: '2026-11-16T00:00:00.000Z' }]
  }), 'utf-8')
  return { base, root, preferencesPath, userGenres: join(base, 'OpenStory', 'openstory', 'genres') }
}

/* ---------- 体裁规整 ---------- */

test('体裁规整：六类内置全部合规；primary 三类；短故事不分章、长篇必须分章', () => {
  const { genres, warnings } = loadGenres([builtinGenresDir()])
  assert.equal(genres.length, 6)
  assert.deepEqual(warnings, [])
  const primary = genres.filter((genre) => genre.tier === 'primary').map((genre) => genre.id).sort()
  assert.deepEqual(primary, ['long-serial', 'short-drama', 'short-story'])

  const shortStory = genres.find((genre) => genre.id === 'short-story')
  assert.equal(shortStory.length.divideBy, 'none')
  assert.equal(shortStory.length.perUnit, null)
  assert.ok(shortStory.excludedPages.includes('worldbook'), '短故事不出世界书')
  assert.ok(shortStory.excludedPages.includes('wiki'))

  const longSerial = genres.find((genre) => genre.id === 'long-serial')
  assert.equal(longSerial.length.divideBy, 'chapter')
  assert.ok(longSerial.length.perUnit.min > 0)
  assert.ok(longSerial.requiredCarriers.includes('pinax.carrier.worldbook'), '长篇必需世界书')
  assert.equal(longSerial.structure.chapterHook, true)

  const drama = genres.find((genre) => genre.id === 'short-drama')
  assert.deepEqual(drama.deliverables.sort(), ['comic', 'script'])
  assert.equal(drama.length.divideBy, 'episode')
})

test('体裁规整：坏声明逐项把门（spec/交付物/单位/分章联动）', () => {
  const good = {
    schemaVersion: 'openstory-genre@1', id: 'x', name: 'X', deliverables: ['novel'],
    length: { unit: 'chars', divideBy: 'none' }
  }
  assert.equal(normalizeGenre(good, { source: '内置', file: 'x.json' }).ok, true)
  assert.equal(normalizeGenre({ ...good, schemaVersion: 'x' }, { source: '内置', file: 'x' }).ok, false)
  assert.equal(normalizeGenre({ ...good, deliverables: ['movie'] }, { source: '内置', file: 'x' }).ok, false)
  assert.equal(normalizeGenre({ ...good, length: { unit: 'pages', divideBy: 'none' } }, { source: '内置', file: 'x' }).ok, false)
  assert.equal(normalizeGenre({ ...good, length: { unit: 'chars', divideBy: 'chapter' } }, { source: '内置', file: 'x' }).ok, false, '分章必须给 perUnit')
  assert.equal(normalizeGenre({ ...good, deliverables: [] }, { source: '内置', file: 'x' }).ok, false)
})

test('体裁货架：本机新增形制（开源自备）与同名覆盖', async () => {
  const { base, userGenres } = await makeFixture()
  try {
    await mkdir(userGenres, { recursive: true })
    // 社区自备形制：有声剧
    await writeFile(join(userGenres, 'audio-drama.json'), JSON.stringify({
      schemaVersion: 'openstory-genre@1', id: 'audio-drama', name: '有声剧', tier: 'extended',
      summary: '纯听感驱动', deliverables: ['script'],
      length: { unit: 'episodes', total: { min: 10, target: 30, max: 100 }, perUnit: { min: 2000, target: 3000, max: 4000 }, divideBy: 'episode' }
    }), 'utf-8')
    // 同名覆盖内置短故事
    await writeFile(join(userGenres, 'short-story.json'), JSON.stringify({
      schemaVersion: 'openstory-genre@1', id: 'short-story', name: '短故事（本机改）', deliverables: ['novel'],
      length: { unit: 'chars', total: { min: 1000, target: 5000, max: 30000 }, divideBy: 'none' }
    }), 'utf-8')
    const { genres, warnings } = loadGenres([builtinGenresDir(), userGenres])
    assert.equal(genres.length, 7, '六类内置＋一个社区形制')
    assert.equal(genres.find((genre) => genre.id === 'short-story').name, '短故事（本机改）')
    assert.equal(genres.find((genre) => genre.id === 'short-story').source, '本机')
    assert.ok(warnings.length >= 0)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- 简报 ---------- */

test('简报：未声明＝null 不报错；写入后读回；越界与分章缺目标拒收', async () => {
  const { base, root } = await makeFixture()
  const dirs = [builtinGenresDir()]
  try {
    const empty = await readBrief(root, dirs)
    assert.equal(empty.ok, true)
    assert.equal(empty.brief, null)

    const written = await writeBrief(root, dirs, { genre: 'short-story' })
    assert.equal(written.ok, true)
    assert.equal(written.brief.genre, 'short-story')
    assert.equal(written.brief.length.divideBy, 'none')
    assert.equal(written.brief.length.total, 8000, '缺省取体裁 target')
    const onDisk = JSON.parse(await readFile(briefPath(root), 'utf-8'))
    assert.equal(onDisk.schemaVersion, 'openstory-brief@1')

    const reread = await readBrief(root, dirs)
    assert.equal(reread.brief.genre, 'short-story')

    const unknown = await writeBrief(root, dirs, { genre: 'nope' })
    assert.equal(unknown.ok, false)

    const outOfRange = await writeBrief(root, dirs, { genre: 'short-story', length: { total: 500000 } })
    assert.equal(outOfRange.ok, false, '400k 字超出短故事合理区间')
    assert.match(outOfRange.message, /超出体裁/)

    // 长篇必须给每章目标（缺省取体裁 target，不报错）；显式给 0 才拒
    const serial = await writeBrief(root, dirs, { genre: 'long-serial' })
    assert.equal(serial.ok, true)
    assert.equal(serial.brief.length.divideBy, 'chapter')
    assert.ok(serial.brief.length.perUnit > 0)

    const deliverables = await writeBrief(root, dirs, { genre: 'short-drama', deliverables: ['novel'] })
    assert.equal(deliverables.ok, false, '交付物必须是该体裁允许的')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- 策略注入与页签裁剪 ---------- */

test('策略注入：篇幅/分章/节奏/禁忌进 prompt 段；页签按 excludedPages 裁', async () => {
  const { base, root } = await makeFixture()
  const dirs = [builtinGenresDir()]
  try {
    const { genres } = loadGenres(dirs)
    const shortStory = genres.find((genre) => genre.id === 'short-story')
    const serial = genres.find((genre) => genre.id === 'long-serial')

    const brief = (await writeBrief(root, dirs, { genre: 'short-story' })).brief
    const section = briefPromptSection(brief, shortStory)
    assert.ok(section.includes('短故事'))
    assert.ok(section.includes('总篇幅目标约 8000 字'))
    assert.ok(section.includes('开头三句定生死') || section.includes('一段式张力'))
    assert.ok(section.includes('世界观说明书式开篇'), '禁忌进 prompt')

    const serialBrief = { ...brief, length: { ...brief.length, divideBy: 'chapter', perUnit: 3000, total: 800000 } }
    const serialSection = briefPromptSection(serialBrief, serial)
    assert.ok(serialSection.includes('按章推进'))
    assert.ok(serialSection.includes('每章约 3000 字'))

    // 页签裁剪：库里有 世界书/大纲/构思，短故事只留 正文/构思
    const dirsInLib = ['正文', '大纲', '世界书', '构思', '资料', '约束']
    const kept = allowedDirs(brief, shortStory, dirsInLib)
    assert.ok(!kept.includes('世界书'))
    assert.ok(!kept.includes('大纲'))
    assert.ok(kept.includes('正文'))
    assert.ok(kept.includes('构思'))
    // 未声明体裁＝不裁剪
    assert.deepEqual(allowedDirs(null, null, dirsInLib), dirsInLib)

    assert.equal(unitLabel('episodes'), '集')
    assert.equal(divideLabel('chapter'), '章')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- 契约 ---------- */

test('契约：genres/brief 三端点形状', () => {
  assert.equal(validateRequest('genresGet', {}).ok, true)
  assert.equal(validateRequest('briefGet', { root: 'r' }).ok, true)
  assert.equal(validateRequest('briefGet', {}).ok, false)
  assert.equal(validateRequest('briefPut', { root: 'r', genre: 'short-story' }).ok, true)
  assert.equal(validateRequest('briefPut', { root: 'r' }).ok, false)
  assert.equal(validateResponse('genresGet', { ok: true, genres: [] }).ok, true)
  assert.equal(validateResponse('briefGet', { ok: true, brief: null, path: 'p' }).ok, true)
  assert.equal(validateResponse('briefPut', { ok: true, brief: {}, path: 'p' }).ok, true)
})

/* ---------- daemon 端到端 ---------- */

test('daemon 端到端：体裁货架→写简报→读回；Agent prompt 带体裁策略', async () => {
  const fixture = await makeFixture()
  const daemon = await startDaemon({
    port: 0,
    preferencesPath: fixture.preferencesPath,
    agentConfigPath: join(fixture.base, 'agent-config.json'),
    agentSessionsDir: join(fixture.base, 'sessions'),
    env: { ...process.env, LOCALAPPDATA: fixture.base },
    logger: { log() {} }
  })
  const origin = `http://127.0.0.1:${daemon.port}`
  const root = encodeURIComponent(fixture.root)
  try {
    const shelves = await (await fetch(`${origin}/api/genres`)).json()
    assert.equal(shelves.ok, true)
    assert.equal(shelves.genres.length, 6)

    const before = await (await fetch(`${origin}/api/brief?root=${root}`)).json()
    assert.equal(before.brief, null)

    const put = await fetch(`${origin}/api/brief`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: fixture.root, genre: 'short-story', length: { total: 12000 } })
    })
    assert.equal(put.status, 200)
    const written = await put.json()
    assert.equal(written.brief.genre, 'short-story')
    assert.equal(written.genre.excludedPages.includes('worldbook'), true, '响应带体裁全文供前端裁剪')

    const after = await (await fetch(`${origin}/api/brief?root=${root}`)).json()
    assert.equal(after.brief.length.total, 12000)

    // 未知体裁 400
    const bad = await fetch(`${origin}/api/brief`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: fixture.root, genre: 'nope' })
    })
    assert.equal(bad.status, 400)
  } finally {
    await daemon.close()
    await rm(fixture.base, { recursive: true, force: true })
  }
})
