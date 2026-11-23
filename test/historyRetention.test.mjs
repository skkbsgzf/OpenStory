/**
 * OpenStory OS-137 用例（node:test，零依赖）——.history 保留策略。
 *
 * 规则（保守优先）：绝不删最新一份；任何自然日至少保留该日最后一份（日锚）；
 * 每个原文件保留最新 keepPerFile 份；应删清单按 mtime 从旧到新。
 *
 * 跑法：
 *   node --test openstory/test/historyRetention.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { HISTORY_KEEP_DEFAULT, pruneHistoryBackups, resolveHistoryKeepPerFile, startDaemon } from '../src/host/daemon.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const originOf = (daemon) => `http://127.0.0.1:${daemon.port}`

/** 造一条备份条目。mtime 用 ISO 串（与 listArtifacts 同口径）。 */
function bak(name, mtime, original = '正文/001-雨停.md') {
  return { name, original, mtime }
}

/** 同一自然日内 N 份备份：从 00:00 起每 10 分钟一份，第 0 份最旧。 */
function sameDay(day, count, original = '正文/001-雨停.md') {
  const base = new Date(`${day}T00:00:00.000Z`).getTime()
  const stem = basename(original)
  return Array.from({ length: count }, (_, index) => {
    const iso = new Date(base + index * 10 * 60 * 1000).toISOString()
    return bak(`${stem}.bak-${iso.replace(/[:.]/gu, '-')}`, iso, original)
  })
}

test('策略：超配额删最旧，留下的正好是最新 N 份', () => {
  const entries = sameDay('2026-11-20', 8)
  const doomed = pruneHistoryBackups(entries, { keepPerFile: 3 })
  assert.deepEqual(doomed.map((entry) => entry.name), entries.slice(0, 5).map((entry) => entry.name),
    '应删清单＝最旧 5 份，且按 mtime 从旧到新')
  const doomedNames = new Set(doomed.map((entry) => entry.name))
  assert.ok(!doomedNames.has(entries[7].name), '最新一份绝不删')
})

test('策略：配额为 1 也只删到日锚为止，最新一份永在', () => {
  // 两天各若干份，配额 1：保留＝两天各自的日锚；第二天锚即最新一份
  const day1 = sameDay('2026-11-20', 2)
  const day2 = sameDay('2026-11-22', 3)
  const doomed = pruneHistoryBackups([...day1, ...day2], { keepPerFile: 1 })
  assert.deepEqual(doomed.map((entry) => entry.name), [day1[0].name, day2[0].name, day2[1].name],
    '各日只留日锚（day1[1]、day2[2]）；最新一份与两天日锚都在保留侧')
})

test('策略：同日多份只留日锚＋配额内的最新，跨天日锚不被冲掉', () => {
  // 20 日 3 份＋22 日 4 份，配额 2：保留＝22 日最新的 2 份＋20 日日锚
  const day1 = sameDay('2026-11-20', 3)
  const day2 = sameDay('2026-11-22', 4)
  const entries = [...day1, ...day2]
  const doomed = pruneHistoryBackups(entries, { keepPerFile: 2 })
  assert.deepEqual(doomed.map((entry) => entry.name), [day1[0].name, day1[1].name, day2[0].name, day2[1].name])
  const kept = entries.filter((entry) => !doomed.includes(entry)).map((entry) => entry.name)
  assert.deepEqual(kept, [day1[2].name, day2[2].name, day2[3].name],
    '20 日日锚＋22 日配额内最新 2 份＝3 份保留')
})

test('策略：恰好等于配额不删；多原文件互不挤占', () => {
  const single = sameDay('2026-11-20', 4)
  assert.deepEqual(pruneHistoryBackups(single, { keepPerFile: 4 }), [], '恰好等于配额：一份不删')
  // 两个原文件：一个 6 份（配额 3 删 3），一个 2 份（不删）——按 original 独立配额
  const first = sameDay('2026-11-20', 6)
  const second = sameDay('2026-11-21', 2, '正文/002-渡口.md')
  const doomed = pruneHistoryBackups([...first, ...second], { keepPerFile: 3 })
  assert.equal(doomed.length, 3, '只删 001 的超配额 3 份')
  assert.ok(doomed.every((entry) => entry.original === '正文/001-雨停.md'), '002 一份都不删')
  assert.deepEqual(doomed.map((entry) => entry.name), first.slice(0, 3).map((entry) => entry.name))
})

test('策略：mtime 乱序输入结果一致；mtime 坏的条目绝不删', () => {
  const entries = sameDay('2026-11-20', 8)
  const ordered = pruneHistoryBackups(entries, { keepPerFile: 3 })
  // 倒序打乱，结果必须与有序输入完全一致
  const shuffled = [...entries].reverse()
  assert.deepEqual(pruneHistoryBackups(shuffled, { keepPerFile: 3 }), ordered, '乱序输入＝同样的应删清单')
  const withBroken = [...entries, bak('001-雨停.md.bak-坏时间', '不是时间')]
  const doomed = pruneHistoryBackups(withBroken, { keepPerFile: 3 })
  assert.equal(doomed.length, ordered.length, '坏 mtime 条目不进应删清单')
  assert.ok(!doomed.some((entry) => entry.name === '001-雨停.md.bak-坏时间'), '排不了序就绝不定罪')
})

test('策略：缺省配额 50；OPENSTORY_HISTORY_KEEP 覆盖；解析失败回缺省', () => {
  assert.equal(HISTORY_KEEP_DEFAULT, 50)
  const fiftyFive = sameDay('2026-11-20', 55)
  assert.equal(pruneHistoryBackups(fiftyFive).length, 5, '不传 options：缺省 50，删 5 份最旧')

  const previous = process.env.OPENSTORY_HISTORY_KEEP
  try {
    process.env.OPENSTORY_HISTORY_KEEP = '3'
    assert.equal(pruneHistoryBackups(sameDay('2026-11-20', 6)).length, 3, '环境变量覆盖生效')
    assert.equal(pruneHistoryBackups(sameDay('2026-11-20', 6), { keepPerFile: 2 }).length, 4, '显式 options 优先于环境变量')
    assert.equal(resolveHistoryKeepPerFile('3'), 3)
    process.env.OPENSTORY_HISTORY_KEEP = 'abc'
    assert.equal(resolveHistoryKeepPerFile(), HISTORY_KEEP_DEFAULT, '乱码回缺省')
    assert.equal(pruneHistoryBackups(fiftyFive).length, 5, '乱码时策略回缺省 50')
    process.env.OPENSTORY_HISTORY_KEEP = '0'
    assert.equal(resolveHistoryKeepPerFile(), HISTORY_KEEP_DEFAULT, '0 不合法（宁可保守）')
    process.env.OPENSTORY_HISTORY_KEEP = '5unit'
    assert.equal(resolveHistoryKeepPerFile(), HISTORY_KEEP_DEFAULT, '带尾巴的数字不认')
    assert.equal(resolveHistoryKeepPerFile(''), HISTORY_KEEP_DEFAULT, '空串回缺省')
    assert.equal(resolveHistoryKeepPerFile(' 12 '), 12, '首尾空白容忍')
  } finally {
    if (previous === undefined) delete process.env.OPENSTORY_HISTORY_KEEP
    else process.env.OPENSTORY_HISTORY_KEEP = previous
  }
})

test('集成：临时库连写 60 次（配额 5）——份数有界、最新在、昨日日锚在、留痕有内容', async () => {
  const previous = process.env.OPENSTORY_HISTORY_KEEP
  process.env.OPENSTORY_HISTORY_KEEP = '5'
  const base = await mkdtemp(join(tmpdir(), 'openstory-os137-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '正文', '.history'), { recursive: true })
  await mkdir(join(root, '.pinax'), { recursive: true })
  await writeFile(join(root, '正文', '001-雨停.md'), '雨到傍晚才停。', 'utf-8')
  // 昨天的日锚种子：mtime 拨到 26 小时前（必是另一个自然日），超出配额也必须活下来
  const anchorName = '001-雨停.md.bak-yesterday'
  const anchorAbs = join(root, '正文', '.history', anchorName)
  await writeFile(anchorAbs, '昨天的版本。', 'utf-8')
  const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000)
  await utimes(anchorAbs, yesterday, yesterday)

  const preferencesPath = join(base, 'next-preferences.json')
  await writeFile(preferencesPath, JSON.stringify({
    recentProjects: [{ path: root, name: '夹具库', at: new Date().toISOString() }]
  }), 'utf-8')

  const daemon = await startDaemon({ port: 0, preferencesPath, logger: { log() {} } })
  try {
    let lastBackup = ''
    for (let index = 1; index <= 60; index += 1) {
      const response = await fetch(`${originOf(daemon)}/api/chapter`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root, file: '正文/001-雨停.md', text: `第 ${index} 版：雨到傍晚才停。` })
      })
      const payload = await response.json()
      assert.equal(payload.ok, true, `第 ${index} 次写入应成功`)
      if (payload.backup) lastBackup = payload.backup
      await sleep(3)  // 错开毫秒，保证备份时间戳不互相覆盖
    }
    assert.ok(lastBackup, '有备份就有相对路径')

    const historyDir = join(root, '正文', '.history')
    const names = (await readdir(historyDir)).filter((name) => name.startsWith('001-雨停.md.bak-'))
    assert.ok(names.length >= 2 && names.length <= 6, `份数有界：2..6（配额 5＋昨日日锚 1），实际 ${names.length}`)
    assert.ok(names.includes(basename(lastBackup)), '最新那份在')
    assert.ok(names.includes(anchorName), '昨日日锚在（超配额也不删）')

    // 留痕日志：当月 jsonl，字段齐全，配额如实
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const logPath = join(root, '.pinax', 'log', 'history-prune', `${month}.jsonl`)
    assert.ok(existsSync(logPath), '留痕日志存在')
    const lines = (await readFile(logPath, 'utf-8')).trim().split('\n').filter(Boolean)
    assert.ok(lines.length > 0, '日志有内容')
    const first = JSON.parse(lines[0])
    assert.equal(first.deleted, true)
    assert.equal(first.reason, 'over-quota')
    assert.equal(first.keepPerFile, 5)
    assert.ok(first.file.includes('.bak-'), 'file 记的是被删备份路径')
    assert.ok(first.runAt, 'runAt 在')
  } finally {
    await daemon.close()
    if (previous === undefined) delete process.env.OPENSTORY_HISTORY_KEEP
    else process.env.OPENSTORY_HISTORY_KEEP = previous
    await rm(base, { recursive: true, force: true })
  }
})
