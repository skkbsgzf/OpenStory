/**
 * 习惯表服务（OS-57，OS-141 daemon 拆分落位）——本库的写作习惯：正向＋负向词条，
 * Agent 成文前必读。
 *
 * 定位（作者口径）：原「参考/约束」里的规则类内容移到这里。世界书只管创作型条目
 * （人物/场景/事件），规则归习惯。
 * 形态：描述性自定义表单。必含正向（惯用词/描述公式）与负向（禁用词/禁用句式/禁用修辞）。
 * 存储：习惯/habits.json（库内），原子写＋.history 备份（与正文同一可逆语义）。
 * 全仓只此一份定义；handler 一律从这里 import，不许复制。
 */
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'
import { recordChange } from '../../protocol/changelog.mjs'
import { LOG_MODULES } from '../../protocol/naming.mjs' // OS-148：日志模块名只从命名表取

export function text(value) {
  return String(value ?? '')
}

const HABITS_SCHEMA = 'openstory.habits/v1'
const HABITS_DEFAULT = {
  schema: HABITS_SCHEMA,
  tone: 'direct',
  style: '',
  bannedWords: [],
  preferredWords: [],
  bannedPatterns: [],
  bannedRhetoric: [],
  formulas: []
}

function habitsPath(root) {
  return join(root, '习惯', 'habits.json')
}

function readHabitsRaw(root) {
  try {
    const parsed = JSON.parse(readFileSync(habitsPath(root), 'utf-8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function readHabits(root) {
  const raw = readHabitsRaw(root)
  if (!raw) return { ...HABITS_DEFAULT }
  const merged = { ...HABITS_DEFAULT }
  for (const key of Object.keys(HABITS_DEFAULT)) {
    if (raw[key] !== undefined) merged[key] = raw[key]
  }
  return merged
}

const HABIT_LIST_KEYS = ['bannedWords', 'preferredWords', 'bannedPatterns', 'bannedRhetoric', 'formulas']

export function normalizeHabits(input) {
  if (!input || typeof input !== 'object') return null
  const out = { schema: HABITS_SCHEMA, tone: input.tone === 'gentle' ? 'gentle' : 'direct', style: text(input.style).slice(0, 400) }
  for (const key of HABIT_LIST_KEYS) {
    const list = Array.isArray(input[key]) ? input[key].map((item) => text(item).trim().slice(0, 60)).filter(Boolean) : []
    out[key] = [...new Set(list)].slice(0, 60)
  }
  return out
}

/** 习惯 lint（OS-59）：对一段将要落盘的文本跑禁用词/句式检测，返回命中清单。
 * 只报不拦——是否仍要采纳由作者定；Agent 只做提醒（习惯表是作者自己的规矩）。 */
export function lintHabits(text$input, habits) {
  const body = text(text$input)
  const hits = []
  if (!body.trim() || !habits) return hits
  for (const word of Array.isArray(habits.bannedWords) ? habits.bannedWords : []) {
    const count = body.split(word).length - 1
    if (count > 0) hits.push({ kind: 'bannedWord', pattern: word, count, message: `禁用词「${word}」出现 ${count} 次` })
  }
  for (const pattern of Array.isArray(habits.bannedPatterns) ? habits.bannedPatterns : []) {
    const parts = text(pattern).split('…').filter(Boolean)
    let count = 0
    if (parts.length > 1) {
      const escaped = parts.map((part) => part.replace(/[\.*+?^${}()|[\]\\]/gu, '\\$&')).join('[\\s\\S]{0,12}')
      try { count = [...body.matchAll(new RegExp(escaped, 'gu'))].length } catch { count = 0 }
    } else {
      count = body.split(pattern).length - 1
    }
    if (count > 0) hits.push({ kind: 'bannedPattern', pattern, count, message: `禁用句式「${pattern}」出现 ${count} 次` })
  }
  return hits
}

export async function writeHabitsWithBackup(root, habits) {
  const path = habitsPath(root)
  await mkdir(dirname(path), { recursive: true })
  let backup = null
  let beforeText = ''
  let existed = false
  try {
    const prev = readFileSync(path)
    beforeText = prev.toString('utf-8')
    existed = true
    backup = join(dirname(path), '.history', `habits-${Date.now()}.json`)
    await mkdir(dirname(backup), { recursive: true })
    await writeFile(backup, prev)
  } catch { /* 首次没有旧稿 */ }
  const nextText = JSON.stringify(habits, null, 2)
  await atomicWriteFile(path, nextText)
  // OS-89：习惯表修改也留 diff + log（AGENTS.md 第 10 条）
  await recordChange({
    root, module: LOG_MODULES.habits, file: '习惯/habits.json',
    op: existed ? 'update' : 'create',
    before: beforeText, after: nextText, actor: 'author'
  }).catch(() => {})
  return backup
}
