/**
 * OS-217 完整受控输入（从旧样本冻结，保留功能数据，不复制非法 fact 主档）。
 *
 * 业务内容仍由 build-shuihu-mcp.mjs 经 MCP 落盘；这里只提供版本化文本/结构/字节。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SHUIHU_RECIPE } from './shuihu-recipe.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const INPUT = join(HERE, 'shuihu-input')
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

const legacyWiki = JSON.parse(readFileSync(join(INPUT, '故事源', 'shuihu.wiki.json'), 'utf8'))
const { derivedFrom, generated_at, ...wikiSemantics } = legacyWiki
const legacySession = JSON.parse(readFileSync(join(INPUT, '扮演', 'session.json'), 'utf8'))

const assets = [
  ['角色/洪信.png', '扮演/素材/角色/洪信.png'],
  ['角色/范仲淹.png', '扮演/素材/角色/范仲淹.png'],
  ['场景/龙虎山.png', '扮演/素材/场景/龙虎山.png'],
  ['bgm/平静.mp3', '扮演/素材/bgm/平静.mp3']
].map(([path, rel]) => ({ path, dataBase64: bytes(rel).toString('base64') }))

export const SHUIHU_FULL_RECIPE = Object.freeze({
  ...SHUIHU_RECIPE,
  chapter: Object.freeze({ path: '正文/001-第一回 张天师祈禳瘟疫.md', text: readFileSync(join(INPUT, '正文', '001-第一回 张天师祈禳瘟疫.md'), 'utf8') }),
  notes: Object.freeze(notes()),
  habits: Object.freeze(JSON.parse(readFileSync(join(INPUT, '习惯', 'habits.json'), 'utf8'))),
  wiki: Object.freeze(wikiSemantics),
  session: Object.freeze(legacySession),
  assets: Object.freeze(assets)
})
