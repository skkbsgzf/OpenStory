/**
 * Skill 货架用例（OS-22）——解析/装载/体裁过滤/craft 装配/端点。
 *
 * 跑法：
 *   node --test test/skills.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRequest, validateResponse } from '../src/api/contracts.mjs'
import {
  builtinSkillsDir,
  craftInstructionBlock,
  craftSkillsForPrompt,
  loadSkills,
  parseSkillMarkdown,
  readAgentPicks,
  skillSummary,
  skillsForGenre,
  SKILL_CATEGORIES,
  SKILL_CONFIRM_LEVELS,
  writeAgentPicks
} from '../src/services/skills.mjs'
import { MCP_TOOL_NAMES } from '../src/host/mcp.mjs'
import { maxRequiredConfirm, semanticsForCall } from '../src/protocol/mcpToolSemantics.mjs'
import { startDaemon } from '../src/host/daemon.mjs'

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

  // OS-212：operate 可装载、旧四类零回归、坏 category 仍拒
  const operate = GOOD.replace('category: craft', 'category: operate').replace('description: 一个演示技能', 'description: 构建说明书').replace('genres:', 'tools: [openstory_libraries]\ngenres:')
  const opParsed = parseSkillMarkdown(operate, { source: '内置', dir: 'd' })
  assert.equal(opParsed.ok, true)
  assert.equal(opParsed.skill.category, 'operate')
  assert.deepEqual(SKILL_CATEGORIES, ['craft', 'review', 'transform', 'extract', 'operate'])

  // OS-212 fail-closed：tools 形状坏 / confirm 级别坏一律拒绝装载（不再 warning 照装）
  const badTools = parseSkillMarkdown(GOOD.replace('genres:', 'tools: openstory_skills_read\ngenres:'), { source: '内置', dir: 'd' })
  assert.equal(badTools.ok, false)
  assert.equal(badTools.warning.code, 'SKILL_TOOLS_SHAPE')
  const badConfirm = parseSkillMarkdown(GOOD.replace('genres:', 'confirm: nuke\ngenres:'), { source: '内置', dir: 'd' })
  assert.equal(badConfirm.ok, false)
  assert.equal(badConfirm.warning.code, 'SKILL_CONFIRM_LEVEL')
  assert.deepEqual(SKILL_CONFIRM_LEVELS, ['read', 'create', 'migrate', 'restore'])
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

// OS-212（P0）：YAML 允许键加引号——`"tools": [...]`、`'confirm': read` 都是合法写法，
// PyYAML/js-yaml dump 默认就可能这么产出。之前键名不剥引号，meta 里存成 `"tools"`，
// toolDeclarations 读 meta.tools 得 undefined → 默认 []，违规声明被静默洗白且零 warning。
test('OS-212 P0：带引号的 frontmatter 键不得绕过声明校验（fail-closed 反证）', () => {
  const mk = (fm) => `---\n${fm}\n---\n\n# 正文\n\nbody`
  // 反例 1：双引号 tools 声明写工具 + review 类 = 必须拒收（不是静默洗成无工具）
  const quotedTools = parseSkillMarkdown(mk('name: quoted-tools\ndescription: d\ncategory: review\n"tools": [openstory_novel_write_chapter]\nconfirm: read'), { source: '探针', dir: 'quoted-tools' })
  assert.equal(quotedTools.ok, false, '双引号 tools 不得洗白')
  assert.equal(quotedTools.warning.code, 'SKILL_READONLY_WRITE')

  // 反例 2：双引号 allowed-tools 带 shell 能力 = 必须拒收
  const quotedAllowed = parseSkillMarkdown(mk('name: quoted-allowed\ndescription: d\ncategory: operate\ntools: [openstory_novel_read_chapter]\nconfirm: read\n"allowed-tools": [Bash, Write]'), { source: '探针', dir: 'quoted-allowed' })
  assert.equal(quotedAllowed.ok, false, '双引号 allowed-tools 不得洗白')
  assert.equal(quotedAllowed.warning.code, 'SKILL_ALLOWED_TOOLS_UNSAFE')

  // 反例 3：单引号 confirm 也必须被读到（否则写工具按缺省 read 静默放行）
  const quotedConfirm = parseSkillMarkdown(mk('name: quoted-confirm\ndescription: d\ncategory: operate\ntools: [openstory_novel_write_chapter]\n\'confirm\': create'), { source: '探针', dir: 'quoted-confirm' })
  assert.equal(quotedConfirm.ok, true, '单引号 confirm 是合法 YAML，应当装载')
  assert.equal(quotedConfirm.skill.confirm, 'create', '单引号 confirm 必须读到真实级别')

  // 反例 4：引号键重复声明仍要判重（剥引号后与裸键同键）
  const duplicate = parseSkillMarkdown(mk('name: dup\ndescription: d\ncategory: review\ntools: []\n"tools": []'), { source: '探针', dir: 'dup' })
  assert.equal(duplicate.ok, false, '剥引号后同名键重复＝拒收')
  assert.equal(duplicate.warning.code, 'SKILL_TOOLS_DUPLICATE')
})

// OS-212（P1）：PROTOCOL.md 的模板带行内注释，照抄模板必须能装载；值里的 # 不是注释。
test('OS-212 P1：frontmatter 行内注释按 YAML 剥除，值内 # 保留', () => {
  const parsed = parseSkillMarkdown(`---
name: comment-skill
description: 一句话说明（何时该用它）
category: craft                   # craft｜review｜transform｜extract｜operate
tools: [openstory_novel_read_chapter]   # 可选：官方 MCP 工具名
confirm: read                     # 可选：read｜create｜migrate｜restore
domain: 第3章#tag
---

正文
`, { source: '探针', dir: 'comment' })
  assert.equal(parsed.ok, true, `照抄 PROTOCOL 模板必须能装载：${JSON.stringify(parsed.warning ?? {})}`)
  assert.equal(parsed.skill.category, 'craft', '行内注释必须剥掉')
  assert.deepEqual(parsed.skill.tools, ['openstory_novel_read_chapter'])
  assert.equal(parsed.skill.confirm, 'read')
  assert.equal(parsed.skill.domain, '第3章#tag', '值内的 # 不是注释（前面无空白）')
})

test('内置货架：32 个技能全部合规，五类齐全（含 build-project operate 正片）', () => {
  const { skills, warnings } = loadSkills([builtinSkillsDir()])
  assert.equal(warnings.length, 0, `不应有 warning：${JSON.stringify(warnings)}`)
  assert.equal(skills.length, 32)
  const byCat = {}
  for (const skill of skills) (byCat[skill.category] ||= []).push(skill.name)
  assert.equal(byCat.craft.length, 21, 'craft：剧本/分镜/去AI/信息投放/文风延续/冷感短句/番茄套路/需求铁律/套路设计法/文风×11（彭湃+女频短篇×3+长篇头部×7）')
  assert.equal(byCat.transform.length, 5, 'transform：改写/大纲/世界书/场景扩写/humanizer（OS-212 归位）')
  assert.equal(byCat.review.length, 3, 'review：连续性/一致性/爽文自检')
  assert.equal(byCat.extract.length, 2, 'extract：fact 抽取/采集质量守则')
  assert.equal(byCat.operate?.length ?? 0, 1, 'OS-216：build-project 是第一个 operate 正片')
  const buildProject = skills.find((skill) => skill.name === 'build-project')
  assert.equal(buildProject.category, 'operate')
  assert.equal(buildProject.confirm, 'restore')
  assert.equal(buildProject.tools.length, MCP_TOOL_NAMES.length, 'build-project 必须声明全部构建工具')
  assert.deepEqual(buildProject.tools.slice().sort(), MCP_TOOL_NAMES.slice().sort(), '声明工具必须与真实 tools/list 逐名一致')
  for (const expected of ['screenplay-craft', 'storyboard-craft', 'de-ai-writing', 'humanizer', 'shuangwen-chapter-check', 'info-reveal-budget', 'rule-horror-cold-prose', 'prose-continuity-rules', 'fanqie-pattern-playbook', 'reader-needs-ironrules', 'pattern-design-method', 'style-yishou-micheng', 'fact-extraction-quality', 'style-wangbuliao-baiyue', 'style-nianshang-yinshi', 'style-moshi-danmu', 'style-rejinzhi', 'style-fengpi-fanpai', 'style-huanqin-baofu', 'style-chixie-rusong', 'style-da-qin-yaoren', 'style-shangan-guanchang', 'style-shangjiao-guojia']) {
    assert.ok(skills.some((skill) => skill.name === expected), `缺 ${expected}`)
  }
  // OS-212：humanizer 归 transform，且不再伪装 OpenStory 自动写权
  const humanizer = skills.find((skill) => skill.name === 'humanizer')
  assert.equal(humanizer.category, 'transform')
  assert.deepEqual(humanizer.tools, [])
  assert.equal(humanizer.confirm, 'read')

  // OS-212 门禁：SKILL_CATEGORIES 与协议 category 表一致（与 skills/PROTOCOL.md 逐项核对）。
  // 严格逐项比对：子串检查放过了「多一项/少一项、顺序颠倒」，工单口径是多一项/少一项＝红。
  const protocol = readFileSync(new URL('../skills/PROTOCOL.md', import.meta.url), 'utf-8')
  const categoryLine = protocol.split('\n').find((line) => line.includes('# craft｜review'))
  assert.ok(categoryLine, 'PROTOCOL frontmatter 示例缺 category 行')
  const documented = categoryLine.slice(categoryLine.indexOf('# ') + 2).split('｜').map((item) => item.trim())
  assert.deepEqual(documented, [...SKILL_CATEGORIES], 'PROTOCOL category 表必须与 SKILL_CATEGORIES 逐项一致（数量、顺序）')
})

test('OS-172：产品作者身份与依赖声明', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
  assert.equal(pkg.author, 'skkbsgzf <59155174+skkbsgzf@users.noreply.github.com>')
  assert.equal(pkg.dependencies['@xenova/transformers'], '^2.17.2')
  assert.equal(pkg.license, 'SEE LICENSE IN LICENSE')
})

test('OS-172：七个内置技能归属作者；工具映射收窄且不保留旧工具名', () => {
  const { skills, warnings } = loadSkills([builtinSkillsDir()])
  assert.equal(warnings.length, 0, `不应有 warning：${JSON.stringify(warnings)}`)
  const expectedTools = {
    'fact-consistency': ['openstory_skills_read'],
    'fact-extract': ['openstory_skills_read', 'openstory_novel_read_chapter'],
    'outline-restructure': [],
    'scene-expand': ['openstory_novel_read_chapter'],
    'worldbook-refactor': ['openstory_reference_index', 'openstory_reference_read_note'],
    'continuity-check': ['openstory_novel_read_chapter', 'openstory_reference_index'],
    'chapter-rewrite': ['openstory_novel_read_chapter']
  }
  for (const [name, tools] of Object.entries(expectedTools)) {
    const skill = skills.find((item) => item.name === name)
    assert.ok(skill, `缺内置技能 ${name}`)
    assert.equal(skill.vendor, 'skkbsgzf', `${name} vendor 未归一`)
    assert.deepEqual(skill.tools, tools, `${name} 工具映射漂移`)
    assert.ok(skill.tools.every((tool) => !tool.startsWith('pinax_')), `${name} 不得声明旧工具`)
    const notice = skill.body.split('## 可用性')[1]?.split('\n## ')[0] || ''
    const usage = skill.body.replace(notice, '')
    assert.match(notice, /不可用/u, `${name} 缺不可用提示`)
    assert.doesNotMatch(usage, /pinax_[a-z_]+/u, `${name} 的可用流程不得保留旧工具名`)
    assert.doesNotMatch(skill.body, /pinax_[a-z_]+/u, `${name} 不得保留旧工具名`)
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

    // OS-212：临时 operate fixture 验证工具白名单与确认级别（正片 OS-216/OS-223 未建，先用夹具）。
    // 夹具按 fail-closed 口径写成**合法形状**：写工具 openstory_novel_write_chapter 的
    // requiredConfirm=create，故 confirm 至少 create；不是靠放宽校验迁就旧夹具。
    const fixture = `---
name: temp-operate
description: 临时操作说明书夹具
category: operate
tools: [openstory_libraries, openstory_files, openstory_novel_write_chapter]
confirm: create
---

只读说明书，写操作按声明的工具与确认级别执行。
`
    await mkdir(join(userDir, 'temp-operate'), { recursive: true })
    await writeFile(join(userDir, 'temp-operate', 'SKILL.md'), fixture, 'utf-8')
    const loaded = loadSkills([builtinSkillsDir(), userDir])
    const op = loaded.skills.find((skill) => skill.name === 'temp-operate')
    assert.ok(op, '合法 operate fixture 应可装载')
    assert.equal(op.category, 'operate')
    assert.deepEqual(op.tools, ['openstory_libraries', 'openstory_files', 'openstory_novel_write_chapter'])
    assert.equal(op.confirm, 'create')
    // 声明的工具必须来自 MCP 注册表：已声明的写工具存在，但未声明的不能凭空出现
    for (const tool of op.tools) assert.ok(MCP_TOOL_NAMES.includes(tool), `operate 声明的 ${tool} 不在 MCP 注册表`)
    assert.ok(!MCP_TOOL_NAMES.includes('openstory_nope'), '未知工具不应在注册表')

    // OS-212 反例：一律 fail-closed 拒绝装载（不 warning 照装）。
    const rejected = (raw, code, label) => {
      const parsed = parseSkillMarkdown(raw, { source: '夹具', dir: 'x' })
      assert.equal(parsed.ok, false, `${label} 必须拒绝装载`)
      assert.equal(parsed.warning.code, code, `${label} 拒绝码`)
    }
    rejected(fixture.replace('confirm: create', 'confirm: read'), 'SKILL_WRITE_WITHOUT_CONFIRM', '写工具＋confirm:read')
    rejected(fixture.replace('openstory_novel_write_chapter', 'shell_exec'), 'SKILL_TOOLS_NOT_MCP', 'shell_exec 伪装')
    rejected(fixture.replace('openstory_novel_write_chapter', 'openstory_nope'), 'SKILL_TOOL_UNCLASSIFIED', '未知 openstory_nope')
    // delete 类工具门槛 restore，create 确认不足（new_chapter 阈值 create 不满足此反例）。
    rejected(fixture.replace('openstory_novel_write_chapter', 'openstory_novel_delete_chapter'), 'SKILL_WRITE_WITHOUT_CONFIRM', '写工具确认不足')
    rejected(fixture.replace('category: operate', 'category: review'), 'SKILL_READONLY_WRITE', 'review＋写工具')
    rejected(fixture.replace('category: operate', 'category: extract'), 'SKILL_READONLY_WRITE', 'extract＋写工具')
    // P0-1：只读类＋写确认，tools 为空也必须拒绝（此前 `&& tools.length` 漏网）。
    const readonlyConfirm = (category, level) => `---
name: temp-operate
description: 临时操作说明书夹具
category: ${category}
confirm: ${level}
---

正文`
    rejected(readonlyConfirm('review', 'migrate'), 'SKILL_READONLY_WRITE', 'review＋confirm:migrate（无 tools）')
    rejected(readonlyConfirm('extract', 'migrate'), 'SKILL_READONLY_WRITE', 'extract＋confirm:migrate（无 tools）')
    rejected(readonlyConfirm('review', 'restore'), 'SKILL_READONLY_WRITE', 'review＋confirm:restore（无 tools）')
    rejected(readonlyConfirm('craft', 'restore'), 'SKILL_READONLY_WRITE', 'craft＋confirm:restore（无 tools）')
    // 带读工具的同形态也仍然拒绝（等价加强，不删原断言）。
    const readonlyMigrate = readonlyConfirm('review', 'migrate').replace('confirm:', 'tools: [openstory_libraries]\nconfirm:')
    rejected(readonlyMigrate, 'SKILL_READONLY_WRITE', 'review＋confirm:migrate（有读工具）')
    rejected(readonlyMigrate.replace('category: review', 'category: extract'), 'SKILL_READONLY_WRITE', 'extract＋confirm:migrate（有读工具）')

    // P0-2：标准 YAML 块序列 `tools:` + `- item`——**零缩进**（yaml.dump 默认）与缩进
    // 两种形态都必须解析，不得静默丢成空数组（此前只测缩进形态，绕开了漏洞）。
    const blockFixture = (category, items, level, indent = '') => `---
name: temp-operate
description: 临时操作说明书夹具
category: ${category}
tools:
${items.map((item) => `${indent}- ${item}`).join('\n')}
confirm: ${level}
---

正文`
    for (const [label, indent] of [['零缩进', ''], ['缩进', '  ']]) {
      const blockReview = parseSkillMarkdown(blockFixture('review', ['openstory_novel_new_chapter'], 'migrate', indent), { source: '夹具', dir: 'x' })
      assert.equal(blockReview.ok, false, `${label}块序列声明的写工具不得被静默抹掉`)
      assert.equal(blockReview.warning.code, 'SKILL_READONLY_WRITE')
      const blockReview2 = parseSkillMarkdown(blockFixture('review', ['openstory_novel_write_chapter', 'openstory_habits_put'], 'restore', indent), { source: '夹具', dir: 'x' })
      assert.equal(blockReview2.ok, false, `${label}块序列多写工具同样拒绝`)
      const blockExtract = parseSkillMarkdown(blockFixture('extract', ['openstory_novel_new_chapter', 'openstory_novel_delete_chapter'], 'read', indent), { source: '夹具', dir: 'x' })
      assert.equal(blockExtract.ok, false, `${label}extract+new_chapter 必须拒绝`)
      const blockCraft = parseSkillMarkdown(blockFixture('craft', ['openstory_image_generate'], 'read', indent), { source: '夹具', dir: 'x' })
      assert.equal(blockCraft.ok, false, `${label}craft+image_generate 必须拒绝`)
      // 合法块序列读工具（operate）必须完整保留，不能 tools=[] 被误拒。
      const blockOk = parseSkillMarkdown(blockFixture('operate', ['openstory_libraries', 'openstory_files'], 'read', indent), { source: '夹具', dir: 'x' })
      assert.equal(blockOk.ok, true, `${label}合法 operate 块序列应装载`)
      assert.deepEqual(blockOk.skill.tools, ['openstory_libraries', 'openstory_files'])
    }
    // P2：块内注释行、重复 tools 键都不得把声明洗成空。
    const commentBlock = `---
name: temp-operate
description: 临时操作说明书夹具
category: review
tools:
  # 官方工具
  - openstory_novel_new_chapter
---

正文`
    rejected(commentBlock, 'SKILL_READONLY_WRITE', '块内注释不吞后续项')
    const dupTools = `---
name: temp-operate
description: 临时操作说明书夹具
category: review
tools: [openstory_novel_new_chapter]
tools: []
---

正文`
    rejected(dupTools, 'SKILL_TOOLS_DUPLICATE', '重复 tools 键拒绝')

    // 评审 P1：合法 YAML 折叠纯量（PyYAML 读成字符串）不许把 tools/allowed-tools
    // 静默洗成空——那会把写工具声明和 Bash 伪装一起吞掉。
    const folded = (line) => `---
name: temp-operate
description: 临时操作说明书夹具
category: review
${line}
---

正文`
    rejected(folded('tools:\n  openstory_novel_new_chapter'), 'SKILL_TOOLS_SHAPE', '折叠纯量 tools 必须拒绝')
    rejected(folded('allowed-tools:\n  Bash\n  Edit'), 'SKILL_TOOLS_SHAPE', '折叠纯量 allowed-tools 必须拒绝')
    // 决定权限的 category/confirm 重复键同样不许后者覆盖前者（洗成 operate+restore）。
    rejected(folded('category: review\ncategory: operate\ntools: [openstory_novel_write_chapter]\nconfirm: restore'), 'SKILL_TOOLS_DUPLICATE', '重复 category 键拒绝')
    rejected(folded('confirm: read\nconfirm: restore'), 'SKILL_TOOLS_DUPLICATE', '重复 confirm 键拒绝')

    // P1：allowed-tools 必须解析、校验并进 skill 对象；shell/fs 直写语义拒绝装载。
    const allowedFixture = (list) => `---
name: temp-operate
description: 临时操作说明书夹具
category: review
tools: [openstory_libraries]
allowed-tools:
${list.map((item) => `  - ${item}`).join('\n')}
---

正文`
    rejected(allowedFixture(['Bash', 'Write', 'Edit']), 'SKILL_ALLOWED_TOOLS_UNSAFE', 'operate 声明 Bash/Write/Edit')
    const allowedOk = parseSkillMarkdown(allowedFixture(['Read', 'Grep']), { source: '夹具', dir: 'x' })
    assert.equal(allowedOk.ok, true)
    assert.deepEqual(allowedOk.skill.allowedTools, ['Read', 'Grep'])
    const realHumanizer = parseSkillMarkdown(readFileSync(new URL('../skills/humanizer/SKILL.md', import.meta.url), 'utf-8'), { source: '内置', dir: 'humanizer' })
    assert.deepEqual(realHumanizer.skill.allowedTools, ['Read', 'Grep', 'Glob', 'AskUserQuestion'])
    // 合法读类工具声明不回退：operate 至少要有一个已分类工具
    rejected(fixture.replace('tools: [openstory_libraries, openstory_files, openstory_novel_write_chapter]', 'tools: []'), 'SKILL_TOOLS_REQUIRED', 'operate 空 tools')
    // 错误确认级别与坏形状仍各有一例反证
    rejected(fixture.replace('confirm: create', 'confirm: nuke'), 'SKILL_CONFIRM_LEVEL', '错误确认级别')
    rejected(fixture.replace('tools: [openstory_libraries, openstory_files, openstory_novel_write_chapter]', 'tools: openstory_libraries'), 'SKILL_TOOLS_SHAPE', '坏 tools 形状')

    // P1-4：deduce_present 声明时无法绑定 reset 实参，按最坏门槛（restore）校验——
    // confirm:create 的说明书可以合规带上 reset=true 清盘，必须拒绝。
    const deduceFixture = (confirm) => `---
name: temp-operate
description: 临时操作说明书夹具
category: operate
tools: [openstory_deduce_present]
confirm: ${confirm}
---

正文`
    assert.equal(parseSkillMarkdown(deduceFixture('restore'), { source: '夹具', dir: 'x' }).ok, true)
    rejected(deduceFixture('create'), 'SKILL_WRITE_WITHOUT_CONFIRM', 'deduce_present 声明按最坏门槛需 restore')
    rejected(deduceFixture('read'), 'SKILL_WRITE_WITHOUT_CONFIRM', 'deduce_present 续拍也保存状态')
    assert.equal(semanticsForCall('openstory_deduce_present', {}).requiredConfirm, 'create')
    assert.equal(semanticsForCall('openstory_deduce_present', { reset: true }).requiredConfirm, 'restore')
    assert.equal(maxRequiredConfirm('openstory_deduce_present'), 'restore')
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
  assert.ok(!block.includes('humanizer'), 'OS-212：humanizer 归 transform，不再默认注入所有体裁 prompt')
  assert.ok(!block.includes('【技法·temp-operate】'), 'operate 永不进 instruction')
  const op = parseSkillMarkdown(`---
name: temp-operate
description: 操作说明书
category: operate
tools: [openstory_libraries]
---

正文`, { source: '夹具', dir: 'x' })
  assert.equal(op.ok, true)
  const opBlock = craftInstructionBlock([...skills, op.skill])
  assert.ok(!opBlock.includes('temp-operate'), 'operate 不自动注入 prompt，只能按需读取')
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
  await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [{ path: root, name: '夹具库' }] }), 'utf-8')
  const daemon = await startDaemon({ port: 0, preferencesPath, env: { ...process.env, LOCALAPPDATA: base }, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    const all = await (await fetch(`${origin}/api/skills`)).json()
    assert.equal(all.ok, true)
    assert.equal(all.skills.length, 34) // 32 内置（含 build-project）＋写作/编剧套件捆绑 2（OS-68）
    assert.ok(all.skills.every((skill) => skill.body === undefined), '清单不带正文')
    // OS-212：确认级别与工具声明必须随唯一读路径（/api/skills 清单）抵达调用方，
    // 否则 Agent 拿到清单却不知道 operate 说明书的写权限边界。
    assert.ok(all.skills.every((skill) => Array.isArray(skill.tools) && typeof skill.confirm === 'string'), '清单带 tools/confirm')
    const humanizerSummary = all.skills.find((skill) => skill.name === 'humanizer')
    assert.deepEqual(humanizerSummary.tools, [], 'humanizer 清单里工具声明为空')
    assert.equal(humanizerSummary.confirm, 'read')

    const drama = await (await fetch(`${origin}/api/skills?genre=short-drama`)).json()
    // 体裁过滤只对声明了具体 genres 的技能生效；其余是 ["*"] 全兼容
    assert.ok(drama.skills.some((skill) => skill.name === 'storyboard-craft'), '分镜在短剧体裁可用')
    const featureOnly = all.skills.filter((skill) => skill.genres.length && !skill.genres.includes('*'))
    assert.ok(featureOnly.length >= 2, '有技能声明了具体体裁')
    assert.equal(drama.skills.length, 19, '短剧：排除长篇/短篇专属 13 个，其余 18 个兼容（含套件捆绑 2＋visual-describe）')
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
