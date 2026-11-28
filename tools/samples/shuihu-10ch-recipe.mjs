/**
 * 《水浒传》前 10 回满配受控配方（OS-230 唯一事实源）。
 *
 * 内容输入 = 第 1 回既有 clean-room 输入 + 第 2–10 回受控正文 + 39 条 fact.data/v3
 * + 派生 wiki + 18 篇世界书 + 既有习惯/扮演/素材。本文件只提供版本化数据；
 * 落盘必须经 build-shuihu-mcp.mjs 调 MCP 工具，禁止直接 writeFile 业务稿件。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SHUIHU_RECIPE } from './shuihu-recipe.mjs'
import { SHUIHU_10CH_FACTS } from './shuihu-10ch-facts.mjs'
import { SHUIHU_10CH_WIKI } from './shuihu-10ch-wiki.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const INPUT = join(HERE, 'shuihu-input')
const MORE = join(HERE, 'shuihu-input-10ch')
const bytes = (rel) => readFileSync(join(INPUT, rel))

function notes() {
  const out = []
  const visit = (abs, prefix) => {
    for (const name of readdirSync(abs).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))) {
      const full = join(abs, name)
      const rel = prefix ? `${prefix}/${name}` : name
      if (statSync(full).isDirectory()) visit(full, rel)
      else if (name.endsWith('.md')) out.push({ path: `世界书/${rel}`, text: readFileSync(full, 'utf8') })
    }
  }
  visit(join(INPUT, '世界书'), '')
  return out
}

const chapters = [
  { path: '正文/001-第一回 张天师祈禳瘟疫.md', text: readFileSync(join(INPUT, '正文', '001-第一回 张天师祈禳瘟疫.md'), 'utf8') }
]
for (const name of readdirSync(join(MORE, '正文')).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))) {
  if (name.endsWith('.md')) chapters.push({ path: `正文/${name}`, text: readFileSync(join(MORE, '正文', name), 'utf8') })
}

// 剧本：第 1 回也用 10 回剧本目录里的精修版（旧单本配方仍走 SHUIHU_RECIPE.script，OS-217 回归不受影响）。
const scripts = []
for (const name of readdirSync(join(MORE, '剧本')).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))) {
  if (name.endsWith('.md')) scripts.push({ path: `剧本/${name}`, text: readFileSync(join(MORE, '剧本', name), 'utf8') })
}

const legacyWiki = JSON.parse(readFileSync(join(INPUT, '故事源', 'shuihu.wiki.json'), 'utf8'))
const { derivedFrom, generated_at, ...wikiSemantics } = legacyWiki
const legacySession = JSON.parse(readFileSync(join(INPUT, '扮演', 'session.json'), 'utf8'))

const assets = [
  ['角色/洪信.png', '扮演/素材/角色/洪信.png'],
  ['角色/范仲淹.png', '扮演/素材/角色/范仲淹.png'],
  ['场景/龙虎山.png', '扮演/素材/场景/龙虎山.png'],
  ['bgm/平静.mp3', '扮演/素材/bgm/平静.mp3']
].map(([path, rel]) => ({ path, dataBase64: bytes(rel).toString('base64') }))

export const SHUIHU_10CH_RECIPE = Object.freeze({
  ...SHUIHU_RECIPE,
  chapters: Object.freeze(chapters),
  scripts: Object.freeze(scripts),
  facts: Object.freeze(SHUIHU_10CH_FACTS),
  wiki: Object.freeze(SHUIHU_10CH_WIKI),
  notes: Object.freeze(notes()),
  habits: Object.freeze(JSON.parse(readFileSync(join(INPUT, '习惯', 'habits.json'), 'utf8'))),
  session: Object.freeze(legacySession),
  assets: Object.freeze(assets),
  factSource: Object.freeze({ scope: '水浒传前10回', policy: 'FACT-FIRST：事实链优先、正文为出处', chapters: 10 })
})
