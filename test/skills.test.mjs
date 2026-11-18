/**
 * Skill 货架用例（OS-22）——解析/装载/体裁过滤/craft 装配/端点。
 *
 * 跑法：
 *   node --test test/skills.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRequest, validateResponse } from '../contracts.mjs'
import {
  builtinSkillsDir,
  craftInstructionBlock,
  craftSkillsForPrompt,
  loadSkills,
  parseSkillMarkdown,
  readAgentPicks,
  skillSummary,
  skillsForGenre,
  writeAgentPicks
} from '../skills.mjs'
import { startDaemon } from '../daemon.mjs'

const GOOD = `---
name: demo-skill
description: 一个演示技能
version: 0.1.0
vendor: Test
category: craft
genres: ["short-story"]
---

# 演示

- 第一条规则
- 第二条规则
`

/* ---------- 解析 ---------- */

test('解析：合法 frontmatter ＋ 正文；缺 description/category 拒收', () => {
  const parsed = parseSkillMarkdown(GOOD, { source: '内置', dir: 'demo' })
  assert.equal(parsed.ok, true)
  assert.equal(parsed.skill.name, 'demo-skill')
  assert.equal(parsed.skill.category, 'craft')
  assert.deepEqual(parsed.skill.genres, ['short-story'])
  assert.ok(parsed.skill.body.includes('第一条规则'))
  assert.ok(parsed.skill.chars > 0)

  const noDesc = GOOD.replace('description: 一个演示技能\n', '')
  assert.equal(parseSkillMarkdown(noDesc, { source: '内置', dir: 'd' }).ok, false)
  const badCat = GOOD.replace('category: craft', 'category: magic')
  assert.equal(parseSkillMarkdown(badCat, { source: '内置', dir: 'd' }).ok, false)
  const noFm = '# 没有 frontmatter\n'
  assert.equal(parseSkillMarkdown(noFm, { source: '内置', dir: 'd' }).ok, false)
})

test('解析：YAML 块标量（description: | 多行）能被读成一段', () => {
  const src = `---
name: block-skill
description: |
  第一行说明
  第二行说明
category: review
---

正文
`
  const parsed = parseSkillMarkdown(src, { source: '内置', dir: 'b' })
  assert.equal(parsed.ok, true)
  assert.ok(parsed.skill.description.includes('第一行说明'))
  assert.ok(parsed.skill.description.includes('第二行说明'))
})

/* ---------- 装载 ---------- */

test('内置货架：30 个技能全部合规，四类齐全', () => {
  const { skills, warnings } = loadSkills([builtinSkillsDir()])
  assert.equal(warnings.length, 0, `不应有 warning：${JSON.stringify(warnings)}`)
  assert.equal(skills.length, 30)
  const byCat = {}
  for (const skill of skills) (byCat[skill.category] ||= []).push(skill.name)
  assert.equal(byCat.craft.length, 21, 'craft：剧本/分镜/去AI/humanizer/信息投放/文风延续/冷感短句/番茄套路/需求铁律/套路设计法/文风×11（彭湃+女频短篇×3+长篇头部×7）')
  assert.equal(byCat.transform.length, 4)
  assert.equal(byCat.review.length, 3, 'review：连续性/一致性/爽文自检')
  assert.equal(byCat.extract.length, 2, 'extract：fact 抽取/采集质量守则')
  for (const expected of ['screenplay-craft', 'storyboard-craft', 'de-ai-writing', 'humanizer', 'shuangwen-chapter-check', 'info-reveal-budget', 'rule-horror-cold-prose', 'prose-continuity-rules', 'fanqie-pattern-playbook', 'reader-needs-ironrules', 'pattern-design-method', 'style-yishou-micheng', 'fact-extraction-quality', 'style-wangbuliao-baiyue', 'style-nianshang-yinshi', 'style-moshi-danmu', 'style-rejinzhi', 'style-fengpi-fanpai', 'style-huanqin-baofu', 'style-chixie-rusong', 'style-da-qin-yaoren', 'style-shangan-guanchang', 'style-shangjiao-guojia']) {
    assert.ok(skills.some((skill) => skill.name === expected), `缺 ${expected}`)
  }
})

test('装载：本机覆盖内置；目录名与 name 不一致的拒收', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-skill-'))
  try {
    const userDir = join(base, 'skills')
    await mkdir(join(userDir, 'demo-skill'), { recursive: true })
    await writeFile(join(userDir, 'demo-skill', 'SKILL.md'), GOOD.replace('一个演示技能', '本机改写版'), 'utf-8')
    await mkdir(join(userDir, 'wrong-name'), { recursive: true })
    await writeFile(join(userDir, 'wrong-name', 'SKILL.md'), GOOD, 'utf-8')
    const { skills, warnings } = loadSkills([builtinSkillsDir(), userDir])
    const demo = skills.find((skill) => skill.name === 'demo-skill')
    assert.equal(demo.source, '本机')
    assert.equal(demo.description, '本机改写版')
    assert.ok(warnings.some((warning) => warning.code === 'SKILL_NAME_MISMATCH'))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- 体裁过滤与装配 ---------- */

test('体裁过滤：genres 含 * 或命中即兼容；craft 装配只收 craft 类', () => {
  const { skills } = loadSkills([builtinSkillsDir()])
  const drama = skillsForGenre(skills, 'short-drama')
  assert.ok(drama.some((skill) => skill.name === 'storyboard-craft'), '分镜兼容短剧')
  assert.ok(drama.some((skill) => skill.name === 'screenplay-craft'), '编剧兼容短剧')
  assert.ok(drama.every((skill) => skill.genres.includes('*') || skill.genres.includes('short-drama')))

  const block = craftInstructionBlock(skills)
  assert.ok(block.includes('【技法·screenplay-craft】'))
  assert.ok(block.includes('【技法·storyboard-craft】'))
  assert.ok(block.includes('【技法·de-ai-writing】'))
  assert.ok(!block.includes('continuity-check'), 'review 类不进 instruction')
  assert.ok(!block.includes('chapter-rewrite'), 'transform 类不进 instruction')
})

test('清单形状：summary 不带正文（省流量）', () => {
  const { skills } = loadSkills([builtinSkillsDir()])
  const summary = skillSummary(skills[0])
  assert.equal(summary.body, undefined)
  assert.ok(summary.name)
  assert.ok(summary.category)
  assert.ok(Number.isInteger(summary.chars))
})

/* ---------- 契约与端点 ---------- */

test('契约：skills/skill 两端点形状', () => {
  assert.equal(validateRequest('skillsGet', {}).ok, true)
  assert.equal(validateRequest('skillsGet', { genre: 'short-story' }).ok, true)
  assert.equal(validateRequest('skillGet', { name: 'demo-skill' }).ok, true)
  assert.equal(validateRequest('skillGet', {}).ok, false)
  assert.equal(validateResponse('skillsGet', { ok: true, skills: [], warnings: [] }).ok, true)
  assert.equal(validateResponse('skillGet', { ok: true, skill: {} }).ok, true)
})

test('daemon 端到端：列技能（体裁过滤）→ 取全文 → 未知技能 404', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-skillapi-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '正文'), { recursive: true })
  const preferencesPath = join(base, 'prefs.json')
  await writeFile(preferencesPath, JSON.stringify({ recentProjects: [{ path: root, name: '夹具库' }] }), 'utf-8')
  const daemon = await startDaemon({ port: 0, preferencesPath, env: { ...process.env, LOCALAPPDATA: base }, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    const all = await (await fetch(`${origin}/api/skills`)).json()
    assert.equal(all.ok, true)
    assert.equal(all.skills.length, 32) // 30 内置＋写作/编剧套件捆绑 2（OS-68）
    assert.ok(all.skills.every((skill) => skill.body === undefined), '清单不带正文')

    const drama = await (await fetch(`${origin}/api/skills?genre=short-drama`)).json()
    // 体裁过滤只对声明了具体 genres 的技能生效；其余是 ["*"] 全兼容
    assert.ok(drama.skills.some((skill) => skill.name === 'storyboard-craft'), '分镜在短剧体裁可用')
    const featureOnly = all.skills.filter((skill) => skill.genres.length && !skill.genres.includes('*'))
    assert.ok(featureOnly.length >= 2, '有技能声明了具体体裁')
    assert.equal(drama.skills.length, 17, '短剧：排除长篇/短篇专属 13 个，其余 17 个兼容（含套件捆绑 2）')
    assert.ok(!drama.skills.some((skill) => skill.name === 'rule-horror-cold-prose'), '长篇专属技能在短剧下被过滤')

    const one = await (await fetch(`${origin}/api/skill?name=screenplay-craft`)).json()
    assert.equal(one.ok, true)
    assert.ok(one.skill.body.includes('三幕'), '全文含正经内容')
    assert.equal(one.skill.category, 'craft')

    const missing = await fetch(`${origin}/api/skill?name=没有这个技能`)
    assert.equal(missing.status, 404)
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- OS-70：Agent 选择链（风格词条单选/方法论多选/缺省裁剪） ---------- */

test('选择链：读写往返＋坏技能名拒收', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-picks-'))
  const root = join(base, '库')
  await mkdir(root, { recursive: true })
  try {
    // 无文件＝null（缺省裁剪）
    assert.equal(await readAgentPicks(root), null)
    // 写入：风格单选＋方法多选
    const written = await writeAgentPicks(root, [builtinSkillsDir()], { style: 'style-chixie-rusong', methods: ['de-ai-writing'] })
    assert.equal(written.ok, true)
    const picks = await readAgentPicks(root)
    assert.deepEqual(picks, { style: 'style-chixie-rusong', methods: ['de-ai-writing'] })
    // 货架上没有的技能拒收
    const bad = await writeAgentPicks(root, [builtinSkillsDir()], { style: 'nope', methods: [] })
    assert.equal(bad.ok, false)
    // 清空（显式空选择也是合法状态）
    const cleared = await writeAgentPicks(root, [builtinSkillsDir()], { style: '', methods: [] })
    assert.equal(cleared.ok, true)
    assert.deepEqual(await readAgentPicks(root), { style: '', methods: [] })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('注入裁剪：缺省剔 style 包；显式 picks 只注入所选', () => {
  const { skills } = loadSkills([builtinSkillsDir()])
  const craft = skills.filter((skill) => skill.category === 'craft')
  const bodyOf = (name) => craft.find((skill) => skill.name === name)

  // 缺省：任何体裁都不出现 style-* 文风包
  for (const genre of ['', 'short-story', 'long-serial']) {
    const matched = craftSkillsForPrompt(skills, genre, null)
    assert.ok(!matched.some((skill) => skill.name.startsWith('style-')), `体裁 ${genre || '(无)'} 缺省不得注入文风包`)
  }
  // 缺省＋体裁：genres 匹配的非 style craft 仍在（如 de-ai-writing ["*"]）
  const def = craftSkillsForPrompt(skills, 'long-serial', null)
  assert.ok(def.some((skill) => skill.name === 'de-ai-writing'))

  // 显式：风格单选＋方法多选——只注入所选，别的文风包不进来
  const picks = { style: 'style-chixie-rusong', methods: ['de-ai-writing', 'info-reveal-budget'] }
  const explicit = craftSkillsForPrompt(skills, 'long-serial', picks)
  assert.deepEqual(explicit.map((skill) => skill.name).sort(), ['de-ai-writing', 'info-reveal-budget', 'style-chixie-rusong'])
})
