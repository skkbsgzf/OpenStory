/**
 * 从《水浒传》前 10 回事实链生成知识库源（OS-230 唯一事实源的产品侧投影）。
 *
 * 纪律：事实链是权威源，正文是逐字出处；这里产出的是**只读知识库源**（manifest + docs），
 * 供知识库工作台预览/登记/浏览。不写任何作品库，不登记任何清单。
 *
 * 用法：node tools/samples/build-shuihu-kb.mjs --out knowledge-packs/shuihu-10ch
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { SHUIHU_10CH_FACTS } from './shuihu-10ch-facts.mjs'
import { SHUIHU_10CH_WIKI } from './shuihu-10ch-wiki.mjs'

const outIndex = process.argv.indexOf('--out')
const OUT = resolve(process.argv[outIndex + 1] ?? 'knowledge-packs/shuihu-10ch')
const DOCS = join(OUT, 'docs')

const GENRE = '古典白话'
const byLayer = (layer) => SHUIHU_10CH_FACTS.filter((entry) => entry.layer === layer)
const chaptersOf = (entry) => (entry.provenance?.chapters ?? []).join('、')

function frontmatter(title, tags) {
  return `---\ntitle: ${title}\ntags: [${tags.join(', ')}]\ngenre: ${GENRE}\n---\n\n`
}

const indexMd = `${frontmatter('索引', ['索引'])}# 水浒传前 10 回知识库

本库是《水浒传》前 10 回的**事实链投影**：事实条目是权威源，正文只作逐字出处（FACT-FIRST）。
内容为公版小说浓缩改写，可自由使用。

- 章节：第 1–10 回
- 事实条目：${SHUIHU_10CH_FACTS.length} 条
- 文档：章纲、人物、事件、设定、技法

## 怎么用

按「谁做了什么、为什么」提问；命中会回指事实条目与回目。
`

const outlineMd = `${frontmatter('章纲', ['章纲', '结构'])}# 章纲

${SHUIHU_10CH_WIKI.chapterSummaries.map((item) => `## 第 ${item.chapter} 回　${item.title}\n\n${item.summary}\n\n- 功能：${item.function}\n- 情绪：${item.emotion}`).join('\n\n')}

## 主线

${SHUIHU_10CH_WIKI.storySummary}

## 弧线

${SHUIHU_10CH_WIKI.arc.stages.map((stage) => `- ${stage.name}：第 ${stage.chapters.join('、')} 回`).join('\n')}

## 伏笔

${SHUIHU_10CH_WIKI.foreshadows.map((item) => `- 第 ${item.chapter} 回：${item.text} → ${item.target}（${item.status === 'open' ? '未收' : `第 ${item.byChapter} 回收`}）`).join('\n')}
`

const charactersMd = `${frontmatter('人物', ['人物', '角色'])}# 人物

${byLayer('character').map((entry) => `## ${entry.name}

${entry.definition}

- 出场：第 ${chaptersOf(entry)} 回
- 身份：${entry.identity || '—'}
- 目标：${entry.castRole?.goal || '—'}
- 剧情作用：${entry.castRole?.plotFunction || '—'}`).join('\n\n')}
`

const plotsMd = `${frontmatter('事件', ['事件', '剧情'])}# 事件

${byLayer('plot').map((entry) => `## ${entry.name}

${entry.fact}

- 回目：第 ${chaptersOf(entry)} 回
${(entry.events ?? []).map((event) => `- ${event.who}：${event.content}`).join('\n')}`).join('\n\n')}
`

const worldMd = `${frontmatter('设定', ['设定', '世界观'])}# 设定

${byLayer('worldview').map((entry) => `## ${entry.name}

${entry.definition}

- 类别：${entry.slot}
- 回目：第 ${chaptersOf(entry)} 回`).join('\n\n')}

## 场景与物件

- 场景：${SHUIHU_10CH_WIKI.worldElements.scenes.join('、')}
- 物件：${SHUIHU_10CH_WIKI.worldElements.items.join('、')}
`

const craftMd = `${frontmatter('技法', ['技法'])}# 技法

## 叙事风格

${SHUIHU_10CH_WIKI.slots.style}

## 结构设计

${SHUIHU_10CH_WIKI.slots.plotDesign}

## 钩子

${SHUIHU_10CH_WIKI.slots.gimmick}

## 因果链

${SHUIHU_10CH_WIKI.causalGraph.edges.map((edge) => `- ${edge.from} → ${edge.to}（${edge.type}）：${edge.evidence}`).join('\n')}
`

const distractorMd = `${frontmatter('干扰项', ['干扰项'])}# 干扰项

本文件属负查询对照：不涉及《水浒传》任何人物、事件或设定。
内容为通用的现代办公流程说明（归档、编号、审批流），与古典白话叙事无关。
`

const docs = [
  ['index.md', indexMd],
  ['outline.md', outlineMd],
  ['characters.md', charactersMd],
  ['plots.md', plotsMd],
  ['world.md', worldMd],
  ['craft.md', craftMd],
  ['distractor.md', distractorMd]
]

const manifest = {
  schema: 'openstory.knowledge-base@1',
  schemaVersion: 1,
  id: 'shuihu-10ch',
  name: '水浒传前 10 回',
  version: '1.0.0',
  vendor: 'OpenStory',
  license: 'CC-BY-4.0',
  documentEntry: 'docs/index.md',
  formats: ['.md'],
  exclude: ['gold.json'],
  retrievalDefaults: { topK: 6, minScore: 0.3, budgetChars: 6000 },
  tagMap: {},
  nodeMap: {},
  edgeMap: {}
}

const license = `Creative Commons Attribution 4.0 International (CC-BY-4.0)

These documents are derived from the public-domain classic 《水浒传》(chapters 1-10),
condensed and restructured for OpenStory. You may share and adapt them for any purpose,
including commercially, provided you give appropriate credit, link to the license,
and indicate if changes were made.

License text: https://creativecommons.org/licenses/by/4.0/legalcode
Provided "AS IS", without warranty of any kind.
`

await mkdir(DOCS, { recursive: true })
await writeFile(join(OUT, 'knowledge.base.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
await writeFile(join(OUT, 'LICENSE'), license, 'utf8')
for (const [name, text] of docs) await writeFile(join(DOCS, name), text, 'utf8')

console.log(JSON.stringify({ ok: true, out: OUT, docs: docs.length, facts: SHUIHU_10CH_FACTS.length, manifest: join(OUT, 'knowledge.base.json') }, null, 2))
