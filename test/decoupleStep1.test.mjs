/**
 * OS-123 解耦① 护栏（node:test，零依赖）——章节号解析＋导入适配收编为本仓自持后，
 * 自有 textUtil.mjs / importAdapter.mjs 仍守 vendor 时代的承诺：
 *   · parseChapterNumber 中文数字矩阵（一二三/十二/一百二十三/两/非法）；
 *   · parseWorldbookEntryFile 契约 v2 读侧投影（合规条目 → 运行时形状；不合规透传错误码）；
 *   · planImport：源只读、目标零写入、认不出的一律 skip 带原因；
 *   · runImport：按计划落盘、目标只新增不覆盖（不同内容 → ERR_FILE_EXISTS）、同内容复用。
 *
 * 跑法：node --test openstory/test/decoupleStep1.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseChapterNumber, parseWorldbookEntryFile } from '../src/modules/library/textUtil.mjs'
import { planImport, runImport } from '../src/modules/library/importAdapter.mjs'
import { createLibrary } from '../src/modules/library/libraryManage.mjs'
import { serializeWorldbookEntryFile } from '../vendor/contracts/worldbookFileContract.js'

/* ---------- 夹具 ---------- */

async function snapshot(root) {
  const out = {}
  async function walk(dir, prefix) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel)
      else if (entry.isFile()) out[rel] = await readFile(join(dir, entry.name), 'utf-8')
    }
  }
  await walk(root, '')
  return out
}

/** 源目录：两章（含中文数字章号）＋一条合规世界书＋两个认不出的文件。 */
async function makeSource(base) {
  const source = join(base, '旧稿')
  await mkdir(join(source, '正文'), { recursive: true })
  await mkdir(join(source, '世界书'), { recursive: true })
  const files = {
    [join(source, '正文', '第一章 雨停.md')]: '# 第一章 雨停\n\n雨到傍晚才停。',
    [join(source, '正文', '第十二章 渡口.md')]: '# 第十二章 渡口\n\n雾从水面漫上来。',
    [join(source, '正文', '导演手记.md')]: '拍摄注意：雨戏用人工雨，不写正文。',
    [join(source, '世界书', '人物-林潮.md')]: serializeWorldbookEntryFile({
      id: 'wb-lin-001', name: '林潮', kind: 'character', keys: ['林潮', '渔主'], content: '海针船主，沉默寡言。'
    }),
    [join(source, '随手记.txt')]: '认不出的顶层散文件'
  }
  for (const [file, content] of Object.entries(files)) await writeFile(file, content, 'utf-8')
  return { source, files }
}

async function makeTarget(base) {
  const parent = join(base, '写作')
  await mkdir(parent, { recursive: true })
  const created = await createLibrary({
    path: join(parent, '长夜'),
    name: '长夜',
    primaryCarrier: 'pinax.carrier.novel',
    preferencesPath: join(base, 'next-preferences.json')
  })
  assert.equal(created.ok, true, `夹具建库失败：${JSON.stringify(created)}`)
  return resolve(created.root)
}

/* ---------- parseChapterNumber 中文数字矩阵 ---------- */

test('parseChapterNumber：中文数字矩阵（一二三/十二/一百二十三/两/非法）', () => {
  // 中文数字
  assert.equal(parseChapterNumber('一'), 1)
  assert.equal(parseChapterNumber('二'), 2)
  assert.equal(parseChapterNumber('三'), 3)
  assert.equal(parseChapterNumber('十二'), 12)
  assert.equal(parseChapterNumber('二十'), 20)
  assert.equal(parseChapterNumber('一百二十三'), 123)
  assert.equal(parseChapterNumber('十'), 10)
  assert.equal(parseChapterNumber('百'), 100)
  assert.equal(parseChapterNumber('一千零五'), 1005)
  // 「两」归 2
  assert.equal(parseChapterNumber('两'), 2)
  assert.equal(parseChapterNumber('两千三百'), 2300)
  // 阿拉伯数字直通
  assert.equal(parseChapterNumber('42'), 42)
  assert.equal(parseChapterNumber('0'), 0)
  // 非法/空：认不出返回 null，不猜
  assert.equal(parseChapterNumber(''), null)
  assert.equal(parseChapterNumber('   '), null)
  assert.equal(parseChapterNumber(null), null)
  assert.equal(parseChapterNumber(undefined), null)
  assert.equal(parseChapterNumber('abc'), null)
  assert.equal(parseChapterNumber('12a'), null)
  assert.equal(parseChapterNumber('廿三'), null, '「廿」不在字符表，认不出')
  assert.equal(parseChapterNumber('第十二章'), null, '带「第…章」修饰的整体串不解析')
})

/* ---------- parseWorldbookEntryFile 契约 v2 读侧投影 ---------- */

test('parseWorldbookEntryFile：合规条目投成运行时形状；不合规透传错误码', () => {
  const md = serializeWorldbookEntryFile({
    id: 'wb-lin-001', name: '林潮', kind: 'character', keys: ['林潮', '渔主'], content: '海针船主，沉默寡言。'
  })
  const parsed = parseWorldbookEntryFile(md)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.entry.id, 'wb-lin-001')
  assert.equal(parsed.entry.name, '林潮')
  assert.equal(parsed.entry.type, 'character', '读侧 type 回落 kind')
  assert.deepEqual(parsed.entry.keys, ['林潮', '渔主'])
  assert.equal(parsed.entry.content, '海针船主，沉默寡言。')
  assert.deepEqual(parsed.entry.relations, { tags: [], locations: [], characters: [], events: [] }, '读侧 relations 对象桶')

  const bad = parseWorldbookEntryFile('不是契约文件的散文本')
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, 'MISSING_FRONTMATTER')
  assert.equal(bad.entry, undefined, '失败侧不带 entry')
})

/* ---------- planImport：源只读 / 目标零写入 / 认不出跳过 ---------- */

test('planImport：出计划不落盘，源目录逐字节未动，认不出的全部 skip 带原因', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os123-'))
  try {
    const { source } = await makeSource(base)
    const target = await makeTarget(base)
    const before = await snapshot(source)

    const plan = planImport({ sourcePath: source, targetPath: target })
    assert.equal(plan.ok, true, `planImport 失败：${JSON.stringify(plan)}`)
    assert.equal(plan.value.mode, 'plan')

    // 章节：中文数字章号被认出，目标名规范 NNN-标题
    const chapters = plan.value.items.filter((item) => item.decision === 'chapter')
    assert.deepEqual(chapters.map((item) => item.number).sort((a, b) => a - b), [1, 12])
    assert.ok(chapters.every((item) => /^正文\/\d{3}-/.test(item.target)), `目标名规范：${JSON.stringify(chapters.map((item) => item.target))}`)
    // 世界书：契约 v2 合规条目按 kind 落目录
    const worldbook = plan.value.items.find((item) => item.decision === 'worldbook')
    assert.ok(worldbook, '世界书条目在计划里')
    assert.equal(worldbook.target, '世界书/人物/林潮.md')
    assert.equal(worldbook.type, 'character')
    assert.equal(plan.value.items.length, 3, '其余文件不该进计划')

    // 认不出的一律 skip 带原因：顶层散文件 unmapped；正文里无章号形态的 chapter-unidentified
    const skipOf = (file) => plan.value.skipped.find((item) => item.file === file)
    assert.equal(skipOf('随手记.txt')?.reason, 'unmapped')
    assert.equal(skipOf('正文/导演手记.md')?.reason, 'chapter-unidentified')
    assert.equal(plan.value.skipped.length, 2)

    // 源只读：计划前后逐文件内容一致
    assert.deepEqual(await snapshot(source), before, '源目录一个字节都没动')
    // 目标零写入：标准目录里没有计划中的文件
    assert.equal(existsSync(join(target, '正文', '001-雨停.md')), false)
    assert.equal(existsSync(join(target, '正文', '012-渡口.md')), false)
    assert.equal(existsSync(join(target, '世界书', '人物', '林潮.md')), false)

    // 计划幂等：再跑一次同一份计划，仍不落盘
    const again = planImport({ sourcePath: source, targetPath: target })
    assert.equal(again.ok, true)
    assert.deepEqual(again.value.items.map((item) => item.target), plan.value.items.map((item) => item.target))
    assert.deepEqual(await snapshot(source), before)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('planImport：源目录不存在 / 目标不是项目 / 源含 .pinax 都拒绝', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os123-guard-'))
  try {
    const { source } = await makeSource(base)
    const target = await makeTarget(base)

    const missing = planImport({ sourcePath: join(base, '不存在'), targetPath: target })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'PINAX_INVALID_INPUT', '内核 fail() 统一 PINAX_ 前缀')

    const notProject = planImport({ sourcePath: source, targetPath: base })
    assert.equal(notProject.ok, false, '目标缺 .pinax/project.json 要拒绝')

    const pinned = await mkdir(join(base, '带pinax', '.pinax'), { recursive: true })
    assert.ok(pinned)
    const withPinax = planImport({ sourcePath: join(base, '带pinax'), targetPath: target })
    assert.equal(withPinax.ok, false)
    assert.match(withPinax.error.message, /\.pinax/)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- runImport：落盘 / 目标只新增不覆盖 / 同内容复用 ---------- */

test('runImport：按计划落盘；同内容复用不重写；不同内容 ERR_FILE_EXISTS 且绝不覆盖', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os123-run-'))
  try {
    const { source, files } = await makeSource(base)
    const target = await makeTarget(base)
    const before = await snapshot(source)

    // 第一次：全部新建
    const first = runImport({ sourcePath: source, targetPath: target })
    assert.equal(first.ok, true, `runImport 失败：${JSON.stringify(first)}`)
    assert.equal(first.value.mode, 'apply')
    assert.equal(first.value.createdCount, 3)
    assert.equal(first.value.reusedCount, 0)
    assert.equal(first.value.failedCount, 0)
    assert.equal(first.value.items.length, 3)

    // 落盘内容与源文件一致
    assert.equal(await readFile(join(target, '正文', '001-雨停.md'), 'utf-8'), `${files[join(source, '正文', '第一章 雨停.md')]}\n`)
    assert.equal(await readFile(join(target, '正文', '012-渡口.md'), 'utf-8'), `${files[join(source, '正文', '第十二章 渡口.md')]}\n`)
    assert.equal(await readFile(join(target, '世界书', '人物', '林潮.md'), 'utf-8'), `${files[join(source, '世界书', '人物-林潮.md')]}\n`)
    // 源只读承诺在 apply 模式同样成立
    assert.deepEqual(await snapshot(source), before)

    // 第二次：同内容全部复用，不重写
    const second = runImport({ sourcePath: source, targetPath: target })
    assert.equal(second.ok, true)
    assert.equal(second.value.createdCount, 0)
    assert.equal(second.value.reusedCount, 3)
    assert.equal(second.value.failedCount, 0)

    // 目标只新增：人为把一个目标文件改成不同内容，再导 → 记 write-failed，绝不覆盖
    const hijacked = join(target, '正文', '012-渡口.md')
    await writeFile(hijacked, '作者后来手写的内容，导入不许动它。', 'utf-8')
    const third = runImport({ sourcePath: source, targetPath: target })
    assert.equal(third.ok, true)
    assert.equal(third.value.createdCount, 0)
    assert.equal(third.value.reusedCount, 2)
    assert.equal(third.value.failedCount, 1)
    assert.equal(third.value.writeFailures[0].code, 'ERR_FILE_EXISTS')
    assert.equal(third.value.writeFailures[0].target, '正文/012-渡口.md')
    assert.equal(await readFile(hijacked, 'utf-8'), '作者后来手写的内容，导入不许动它。', '目标已有内容绝不被导入覆盖')
    assert.deepEqual(await snapshot(source), before)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
