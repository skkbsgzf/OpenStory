/**
 * OS-44 参考载体用例（node:test）——标签 tokenizer / wikilink / frontmatter / 图谱边权。
 *
 * 标签解析严格照 Obsidian 的口径（从本机 obsidian.asar 逆出的正则），
 * 这些用例是那套行为的钉子：谁改坏了，这里先红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  backlinksOf,
  buildReferenceGraph,
  extractInlineTags,
  extractWikiLinks,
  frontmatterTags,
  maskCode,
  parseFrontmatter,
  scanReferences
} from '../referenceStore.mjs'

/* ---------- 标签 tokenizer ---------- */

test('标签：行首或空白后的 # 才算', () => {
  assert.deepEqual(extractInlineTags('正文 #伏笔 在这里'), ['伏笔'])
  assert.deepEqual(extractInlineTags('#开头也算'), ['开头也算'])
  assert.deepEqual(extractInlineTags('foo#tag 不算'), [], '前一个字符不是空白就不是标签')
  assert.deepEqual(extractInlineTags('a#b #c'), ['c'])
})

test('标签：纯数字拒绝（防 hex 色号误判）', () => {
  assert.deepEqual(extractInlineTags('#123 不是标签'), [])
  assert.deepEqual(extractInlineTags('#123abc 是标签'), ['123abc'])
})

test('标签：嵌套用斜杠，仍是一个标签', () => {
  assert.deepEqual(extractInlineTags('#人物/主角 在这'), ['人物/主角'])
})

test('标签：代码块与行内码里不算', () => {
  const source = '正文 #真标签\n\n```\n#假标签\n```\n\n还有 `#也不算` 外面 #另一个'
  assert.deepEqual(extractInlineTags(source).sort(), ['另一个', '真标签'].sort())
})

test('标签：去重', () => {
  assert.deepEqual(extractInlineTags('#重复 和 #重复'), ['重复'])
})

test('maskCode：围栏与行内码都被掩成空格，长度不变', () => {
  const source = 'a\n```\ncode\n```\nb `x` c'
  const masked = maskCode(source)
  assert.equal(masked.length, source.length)
  assert.ok(!masked.includes('code'))
  assert.ok(!masked.includes('`x`'))
  assert.ok(masked.includes('a'))
})

/* ---------- frontmatter ---------- */

test('frontmatter：flow 数组形态', () => {
  const parsed = parseFrontmatter('---\ntags: [人物, 配角]\ntitle: 林砚\n---\n正文')
  assert.deepEqual(parsed.data.tags, ['人物', '配角'])
  assert.equal(parsed.data.title, '林砚')
  assert.equal(parsed.body.trim(), '正文')
})

test('frontmatter：块状数组形态', () => {
  const parsed = parseFrontmatter('---\ntags:\n  - 人物\n  - 配角\n---\n正文')
  assert.deepEqual(parsed.data.tags, ['人物', '配角'])
})

test('frontmatter：单字符串 tags 也认，带 # 前缀会剥掉', () => {
  assert.deepEqual(frontmatterTags({ tags: '#伏笔' }), ['伏笔'])
  assert.deepEqual(frontmatterTags({ tags: ['a', '#b'] }), ['a', 'b'])
  assert.deepEqual(frontmatterTags({}), [])
})

/* ---------- wikilink ---------- */

test('双链：四种形态都解析', () => {
  const links = extractWikiLinks('见 [[渡口钟声]] 与 [[雾港规则|规则]] 和 [[某篇#第三节]] 以及 ![[图.png]]')
  assert.equal(links.length, 4)
  assert.equal(links[0].target, '渡口钟声')
  assert.equal(links[1].target, '雾港规则')
  assert.equal(links[1].display, '规则')
  assert.equal(links[2].target, '某篇')
  assert.equal(links[2].anchor, '第三节')
  assert.equal(links[3].embed, true)
})

test('双链：代码块里的不解析', () => {
  const links = extractWikiLinks('正文 [[真链]]\n\n```\n[[假链]]\n```')
  assert.equal(links.length, 1)
  assert.equal(links[0].target, '真链')
})

/* ---------- 图谱 ---------- */

test('图谱：参考→标签边，标签节点按 / 拆层计数', () => {
  const index = {
    notes: [
      { path: '参考/林砚.md', rel: '林砚.md', title: '林砚', tags: ['人物', '人物/主角'], links: [], excerpt: '', chars: 100 },
      { path: '参考/渡口.md', rel: '渡口.md', title: '渡口', tags: ['人物'], links: [], excerpt: '', chars: 50 }
    ],
    tags: [],
    tagNotes: {}
  }
  const graph = buildReferenceGraph(index)
  const tagNodes = graph.nodes.filter((node) => node.kind === 'tag')
  assert.equal(tagNodes.length, 2, '两个标签各一个节点')
  // 人物 被两篇用，人物/主角 被一篇用 → 边共 3 条
  assert.equal(graph.edges.filter((edge) => edge.sources.includes('tag')).length, 3)
})

test('图谱：参考→正文产物是单向边', () => {
  const index = {
    notes: [{
      path: '参考/渡口钟声.md', rel: '渡口钟声.md', title: '渡口钟声',
      tags: [], links: [{ target: '正文/003-倒带.md' }], excerpt: '', chars: 10
    }],
    tags: [],
    tagNotes: {}
  }
  const graph = buildReferenceGraph(index)
  const edge = graph.edges.find((item) => item.sources.includes('link'))
  assert.ok(edge, '应该有 link 边')
  // 边是无向存储（a<b 排序），两端要正好是这两个节点，且来源只有一条
  assert.deepEqual([edge.a, edge.b].sort(), ['参考/渡口钟声.md', '正文/003-倒带.md'].sort())
  assert.equal(edge.sources.length, 1)
  assert.equal(edge.sources[0], 'link')
  // 产物节点是只读的，且没有任何「来自正文」的边源
  const artifact = graph.nodes.find((node) => node.kind === 'artifact')
  assert.equal(artifact.readonly, true)
  assert.ok(!graph.edges.some((item) => item.sources.includes('fromArtifact')), '正文不产生边')
})

test('图谱：条目作为只读节点', () => {
  const index = {
    notes: [{
      path: '参考/林砚身世.md', rel: '林砚身世.md', title: '林砚身世',
      tags: [], links: [{ target: '条目:c1' }], excerpt: '', chars: 10
    }],
    tags: [],
    tagNotes: {}
  }
  const entries = [{ id: 'c1', name: '林砚', layer: 'character', definition: '雾港的摆渡人' }]
  const graph = buildReferenceGraph(index, { entries })
  const entryNode = graph.nodes.find((node) => node.kind === 'entry')
  assert.ok(entryNode)
  assert.equal(entryNode.readonly, true)
  assert.equal(entryNode.label, '林砚')
})

test('图谱：参考互链按标题匹配', () => {
  const index = {
    notes: [
      { path: '参考/甲.md', rel: '甲.md', title: '甲', tags: [], links: [{ target: '乙' }], excerpt: '', chars: 1 },
      { path: '参考/乙.md', rel: '乙.md', title: '乙', tags: [], links: [], excerpt: '', chars: 1 }
    ],
    tags: [],
    tagNotes: {}
  }
  const graph = buildReferenceGraph(index)
  const edge = graph.edges.find((item) => item.sources.includes('link'))
  assert.ok(edge)
  assert.deepEqual([edge.a, edge.b].sort(), ['参考/乙.md', '参考/甲.md'].sort())
})

/* ---------- 扫描与反链 ---------- */

test('扫描：目录不存在时诚实返回 exists:false', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-ref-'))
  try {
    const result = await scanReferences(base)
    assert.equal(result.ok, true)
    assert.deepEqual(result.notes, [])
    assert.equal(result.stats.exists, false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('扫描：读标签/链接/标题/摘要，标签笔记带描述', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-ref-'))
  const root = join(base, '库')
  await mkdir(join(root, '参考', '人物'), { recursive: true })
  await mkdir(join(root, '参考', '标签'), { recursive: true })
  await writeFile(join(root, '参考', '人物', '林砚.md'),
    '---\ntags: [人物]\n---\n\n# 林砚\n\n雾港的摆渡人。 #主主角 见 [[渡口钟声]]\n', 'utf-8')
  await writeFile(join(root, '参考', '标签', '伏笔.md'),
    '---\nkind: tag\ntag: 伏笔\ndescription: 埋下但尚未回收的线索\ncolor: amber\n---\n\n', 'utf-8')
  try {
    const index = await scanReferences(root)
    assert.equal(index.notes.length, 2)
    const note = index.notes.find((item) => item.title === '林砚')
    assert.ok(note, '标题应从 H1 取')
    assert.deepEqual(note.tags, ['人物', '主主角'])
    assert.equal(note.links[0].target, '渡口钟声')
    const tagNote = index.notes.find((item) => item.isTagNote)
    assert.equal(tagNote.tagName, '伏笔')
    assert.match(tagNote.description, /线索/u)
    // 标签清单里伏笔带描述
    const tag = index.tags.find((item) => item.name === '伏笔')
    assert.ok(tag)
    assert.match(tag.description, /线索/u)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('反链：已链接与未链接分段', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-ref-'))
  const root = join(base, '库')
  await mkdir(join(root, '参考'), { recursive: true })
  await writeFile(join(root, '参考', '目标.md'), '# 雾港规则\n\n规则正文\n', 'utf-8')
  await writeFile(join(root, '参考', '甲的笔记.md'), '见 [[雾港规则]] 这条\n', 'utf-8')
  await writeFile(join(root, '参考', '乙的笔记.md'), '我记得雾港规则里有这一条\n', 'utf-8')
  try {
    const index = await scanReferences(root)
    const backlinks = backlinksOf(index, '参考/目标.md')
    assert.equal(backlinks.linked.length, 1, '甲建了链')
    assert.equal(backlinks.linked[0].title, '甲的笔记')
    assert.equal(backlinks.unlinked.length, 1, '乙只是提到了')
    assert.equal(backlinks.unlinked[0].title, '乙的笔记')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- 系统提示：只给链接不给全文（OS-45 作者口径） ---------- */

test('系统提示：参考只暴露路径/标题/标签，正文一个字都不进上下文', async () => {
  const { __test } = await import('../daemon.mjs')
  const base = await mkdtemp(join(tmpdir(), 'openstory-refprompt-'))
  const root = join(base, '库')
  await mkdir(join(root, '参考'), { recursive: true })
  // 独一无二的句子，用来探测是否泄漏
  await writeFile(join(root, '参考', '渡口钟声.md'),
    '---\ntags: [道具, 伏笔]\n---\n\n# 渡口钟声\n\n这是秘密句子XYZQ，钟只在雾起时响。\n', 'utf-8')
  try {
    const bundle = await __test.systemPromptFor(root, [], [], [], { canReadFiles: true })
    const prompt = bundle.prompt
    // ① 路径与标题要给（Agent 靠它去读）
    assert.ok(prompt.includes('参考/渡口钟声.md'), '要给路径')
    assert.ok(prompt.includes('渡口钟声'), '要给标题')
    assert.ok(prompt.includes('#道具'), '要给标签')
    // ② 正文一个字都不能有（这是作者明确要求：不可全量丢上下文）
    assert.ok(!prompt.includes('XYZQ'), '正文不能进上下文')
    assert.ok(!prompt.includes('钟只在雾起时响'), '摘要也不能进上下文')
    // ③ 要明确告诉它「自己用工具读」
    assert.match(prompt, /文件读取工具/u)
    assert.match(prompt, /不要一次读一堆参考/u)
    // ④ 只读约束
    assert.match(prompt, /只能读/u)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
