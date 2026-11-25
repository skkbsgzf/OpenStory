/**
 * OS-153 fact 词表与校验转自有护栏（node:test，零依赖）——src/kernel/fact/domain/ 8 件。
 *
 * 影子迁移（设计稿 §0.3-1）：8 件**逐字复制**进 src/kernel/fact/domain/（OS-156 起 core 原件
 * 已删，本目录是唯一真源）。因此这里做四类锁：
 *   ① 三层样本逐字段校验：合法条目零 error；缺必填/坏类型/未知枚举/id 漂移各报预期码；
 *   ② stableEntryId：同输入同 id（中文名稳定、别名不参与 id）；
 *   ③ 双时间轴与状态机的边界（null／闭区间端点／交叉区间／合法与非法转移）；
 *   ④ 金样锁：18 组语料的 errors／warnings 全字段输出 sha256 逐组冻结（OS-156 删除 core 原件前
 *      由 src≡core 等价对拍实测），桶的导出面与常量值同样冻结。
 *
 * 全部是纯函数用例，不落盘——绝不碰作者真库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import {
  validateFactEntry,
  isWorldviewEntry
} from '../src/modules/fact/fact/domain/schema.js'
import { stableEntryId, sha1Hex } from '../src/modules/fact/fact/domain/stableId.js'
import {
  isActiveAt,
  intersectValidity,
  normalizeSpan,
  spansOverlap,
  validityBounds,
  validityFromSpan,
  validateValidityShape
} from '../src/modules/fact/fact/domain/validity.js'
import {
  canTransitionStatus,
  validateStatusTransition,
  transitionEntryStatus
} from '../src/modules/fact/fact/domain/status.js'
import * as domain from '../src/modules/fact/fact/domain/index.mjs'

/* ---------- 三层样本（worldview／character／plot） ---------- */

function provenanceOf(mode = 'author') {
  return {
    mode,
    book: '测试之书',
    book_id: 'book-os153',
    chapters: [1, 2],
    scenes: [],
    extractor: 'os153-fixture',
    confidence: 0.8,
    quote_hash: 'd41d8cd98f00b204e9800998ecf8427e'
  }
}

function worldviewEntry(overrides = {}) {
  return {
    schema: 'fact.data/v3',
    layer: 'worldview',
    name: '灵潮',
    domain: '修炼体系',
    slot: 'power_levels',
    definition: '每逢甲子，天地灵气暴涨三月。',
    rank: 1,
    aliases: ['潮汐', '灵汐'],
    provenance: provenanceOf(),
    fingerprint: { vec: [0.1, 0.2], metrics: { density: 0.5 } },
    status: 'draft',
    validity: { from: 1, to: 12 },
    readerCognition: { firstMention: true, supplementNeeded: false },
    id: stableEntryId({ layer: 'worldview', domain: '修炼体系', slot: 'power_levels', name: '灵潮' }),
    ...overrides
  }
}

function characterEntry(overrides = {}) {
  return {
    schema: 'fact.data/v3',
    layer: 'character',
    name: '柯秒',
    domain: '人物',
    provenance: provenanceOf(),
    fingerprint: { vec: [0.3, 0.4], metrics: {} },
    identity: '旧钟楼的钟表匠',
    personality: '认死理，寡言。',
    anchors: { speech: ['停摆的表，也有它的时辰。'], behavior: [], catchphrase: [] },
    memoryPoints: ['父亲留下的怀表'],
    castRole: { tier: 'protagonist', goal: '守住旧钟楼', plotFunction: '见证时间停摆' },
    knowledge: [{ fromEntry: '停摆的表', kind: 'event', atSpan: { from: 3, to: 3 } }],
    status: 'proposed',
    validity: { from: 2, to: null },
    id: stableEntryId({ layer: 'character', domain: '人物', name: '柯秒' }),
    ...overrides
  }
}

function plotEntry(overrides = {}) {
  return {
    schema: 'fact.data/v3',
    layer: 'plot',
    name: '停摆的表',
    domain: '主线',
    provenance: provenanceOf(),
    fingerprint: { vec: [0.5, 0.25], metrics: {} },
    events: [{ track: 'fact', novelty: ['笑'], segments: [{ index: 1, chars: 1200 }] }],
    rhythmSpec: { windowChars: [400, 1200, 3600], noveltyTags: ['燃'] },
    structureTemplates: [{ id: '三幕', kind: 'beat-sheet', beats: ['起', '承', '转'] }],
    status: 'adopted',
    validity: { from: 3, to: 3 },
    id: stableEntryId({ layer: 'plot', domain: '主线', name: '停摆的表' }),
    ...overrides
  }
}

const codesOf = (items) => items.map((item) => item.code)

/* ---------- ① 三层样本逐字段校验 ---------- */

test('合法三层样本（worldview／character／plot）全部零 error 且 ok', () => {
  for (const entry of [worldviewEntry(), characterEntry(), plotEntry()]) {
    const result = validateFactEntry(entry)
    assert.deepEqual(result.errors, [], `${entry.layer} 合法样本不该报错：${JSON.stringify(result.errors)}`)
    assert.equal(result.ok, true, `${entry.layer} 合法样本 ok 应为 true`)
    assert.equal(isWorldviewEntry(entry), entry.layer === 'worldview')
  }
})

test('缺必填：worldview 少 definition／character 少 fingerprint／plot 少 provenance 各报 MISSING_REQUIRED', () => {
  const noDefinition = worldviewEntry()
  delete noDefinition.definition
  const noFingerprint = characterEntry()
  delete noFingerprint.fingerprint
  const noProvenance = plotEntry()
  delete noProvenance.provenance

  const missing = [
    [noDefinition, 'definition'],
    [noFingerprint, 'fingerprint'],
    [noProvenance, 'provenance']
  ]
  for (const [entry, field] of missing) {
    const result = validateFactEntry(entry)
    assert.equal(result.ok, false)
    assert.ok(
      result.errors.some((error) => error.code === 'MISSING_REQUIRED' && error.field === field),
      `${entry.layer} 缺 ${field} 应报 MISSING_REQUIRED，实际：${JSON.stringify(result.errors)}`
    )
  }
})

test('坏类型：schema 非串／validity 非对象／aliases 非字符串数组／confidence 越界各报预期码', () => {
  assert.deepEqual(codesOf(validateFactEntry(worldviewEntry({ schema: 42 })).errors), ['SCHEMA_MISMATCH'])
  assert.deepEqual(codesOf(validateFactEntry(worldviewEntry({ validity: '第一章' })).errors), ['VALIDITY_SHAPE'])
  assert.deepEqual(codesOf(validateFactEntry(worldviewEntry({ aliases: '潮汐' })).errors), ['ALIASES_SHAPE'])
  const badConfidence = worldviewEntry({ provenance: { ...provenanceOf(), confidence: 1.5 } })
  assert.deepEqual(codesOf(validateFactEntry(badConfidence).errors), ['PROVENANCE_CONFIDENCE'])
  const badRange = worldviewEntry({ validity: { from: 9, to: 2 } })
  assert.deepEqual(codesOf(validateFactEntry(badRange).errors), ['VALIDITY_RANGE'])
  assert.deepEqual(codesOf(validateFactEntry('不是对象').errors), ['INVALID_ENTRY'])
})

test('未知枚举：layer／slot／status／provenance.mode／castRole.tier 各报预期码', () => {
  assert.ok(codesOf(validateFactEntry(worldviewEntry({ layer: 'style' })).errors).includes('UNKNOWN_LAYER'))
  assert.ok(codesOf(validateFactEntry(worldviewEntry({ slot: '不存在的槽位' })).errors).includes('UNKNOWN_SLOT'))
  assert.ok(codesOf(validateFactEntry(worldviewEntry({ status: 'published' })).errors).includes('STATUS_INVALID'))
  const badMode = worldviewEntry({ provenance: { ...provenanceOf(), mode: 'guess' } })
  assert.ok(codesOf(validateFactEntry(badMode).errors).includes('PROVENANCE_MODE'))
  const badTier = characterEntry({ castRole: { tier: '路人' } })
  assert.ok(codesOf(validateFactEntry(badTier).errors).includes('CAST_ROLE_TIER'))
})

test('id 漂移：非 12 位十六进制报 ID_FORMAT，与 stableEntryId 不一致报 ID_MISMATCH', () => {
  assert.deepEqual(codesOf(validateFactEntry(worldviewEntry({ id: 'NOT-HEX' })).errors), ['ID_FORMAT'])
  assert.deepEqual(codesOf(validateFactEntry(worldviewEntry({ id: 'ffffffffffff' })).errors), ['ID_MISMATCH'])
})

test('ADR S2-1：castRole 缺 goal 在 author 模式是 warning、analyze 模式是 error', () => {
  const authorResult = validateFactEntry(characterEntry({
    castRole: { tier: 'supporting' },
    provenance: provenanceOf('author')
  }))
  assert.equal(authorResult.errors.some((error) => error.code === 'CAST_ROLE_INCOMPLETE'), false, 'author 模式不拦转')
  assert.ok(authorResult.warnings.some((error) => error.code === 'CAST_ROLE_INCOMPLETE'), 'author 模式给警告')

  const analyzeResult = validateFactEntry(characterEntry({
    castRole: { tier: 'supporting' },
    provenance: provenanceOf('analyze')
  }))
  assert.ok(analyzeResult.errors.some((error) => error.code === 'CAST_ROLE_INCOMPLETE'), 'analyze 模式直接拒')
})

/* ---------- ② stableEntryId ---------- */

test('stableEntryId：同输入同 id、12 位小写十六进制、中文名稳定、别名不参与', () => {
  const base = { layer: 'worldview', domain: '修炼体系', slot: 'power_levels', name: '灵潮' }
  const first = stableEntryId(base)
  const second = stableEntryId({ ...base })
  assert.equal(first, second, '同输入必须同 id')
  assert.match(first, /^[0-9a-f]{12}$/u, 'id 是 12 位小写十六进制')
  assert.equal(first, worldviewEntry().id, '样本条目用的就是同一 id')
  assert.equal(stableEntryId({ ...base, aliases: ['潮汐'] }), first, '别名不参与 id 计算')
  assert.notEqual(stableEntryId({ ...base, name: '灵汐' }), first, '名字变则 id 变（不是随机而是换输入）')
  assert.equal(stableEntryId({ layer: 'plot', name: '停摆的表' }), stableEntryId({ layer: 'plot', domain: '', slot: '', name: '停摆的表' }))
  assert.equal(sha1Hex('abc').length, 40, 'sha1Hex 输出 40 位十六进制')
  assert.equal(sha1Hex('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d', 'SHA-1 标准向量（纯 JS 实现同值）')
})

/* ---------- ③ 双时间轴 ---------- */

test('isActiveAt：null 视为无界、闭区间端点相交算生效、不相交判否', () => {
  assert.equal(isActiveAt(undefined, 5), true, 'validity 缺省＝无界＝生效')
  assert.equal(isActiveAt({ from: null, to: null }, 5), true)
  assert.equal(isActiveAt({ from: 3, to: 5 }, 5), true, '闭区间：终点当章仍生效')
  assert.equal(isActiveAt({ from: 3, to: 5 }, 3), true, '闭区间：起点当章仍生效')
  assert.equal(isActiveAt({ from: 3, to: 5 }, 6), false, '越过后不生效')
  assert.equal(isActiveAt({ from: 3, to: null }, 99), true, '开上界无界')
  assert.equal(isActiveAt({ from: 8, to: null }, 7), false)
  assert.equal(isActiveAt({ from: 3, to: 5 }, { from: 5, to: 9 }), true, '区间相交（端点相触）')
  assert.equal(isActiveAt({ from: 3, to: 5 }, { from: 6, to: 9 }), false)
})

test('intersectValidity：交叉取窄、单侧无界取另一侧、无交集为 null', () => {
  assert.deepEqual(intersectValidity({ from: 1, to: 5 }, { from: 3, to: 9 }), { from: 3, to: 5 })
  assert.deepEqual(intersectValidity({ from: null, to: 5 }, { from: 3, to: null }), { from: 3, to: 5 })
  assert.deepEqual(intersectValidity(undefined, { from: 2, to: 3 }), { from: 2, to: 3 }, '一侧全无界＝另一侧')
  assert.deepEqual(intersectValidity({ from: null, to: null }, { from: null, to: null }), { from: null, to: null })
  assert.equal(intersectValidity({ from: 1, to: 2 }, { from: 5, to: 6 }), null, '无交集返回 null')
  assert.equal(intersectValidity({ from: 1, to: 4 }, { from: 4, to: 8 }).to, 4, '端点相触仍相交')
})

test('跨度工具：normalizeSpan／validityBounds／spansOverlap／validityFromSpan 与 validity 形状校验', () => {
  assert.deepEqual(normalizeSpan(7), { from: 7, to: 7 })
  assert.deepEqual(normalizeSpan({ from: 2 }), { from: 2, to: null })
  assert.deepEqual(normalizeSpan('第一章'), { from: null, to: null })
  assert.deepEqual(validityBounds({ from: 2, to: 4 }), { from: 2, to: 4 })
  assert.deepEqual(validityBounds(null), { from: null, to: null })
  assert.equal(spansOverlap({ from: 1, to: 2 }, { from: 2, to: 3 }), true)
  assert.equal(spansOverlap({ from: 1, to: 2 }, { from: 3, to: 4 }), false)
  assert.deepEqual(validityFromSpan({ first_chapter: 2, last_chapter: 6 }), { from: 2, to: 6 })
  assert.deepEqual(validityFromSpan({ first_scene: 4 }), { from: 4, to: null })
  assert.deepEqual(validityFromSpan({}), { from: null, to: null })
  assert.deepEqual(validateValidityShape(undefined), { ok: true, errors: [] }, 'undefined 视为未提供')
  assert.equal(validateValidityShape({ from: 'a' }).ok, false)
  assert.deepEqual(codesOf(validateValidityShape({ from: 5, to: 1 }).errors), ['VALIDITY_RANGE'])
})

/* ---------- ④ 状态机 ---------- */

test('状态机：draft→proposed→adopted→superseded 合法；跨级与终态出边非法', () => {
  assert.equal(canTransitionStatus('draft', 'proposed'), true)
  assert.equal(canTransitionStatus('proposed', 'adopted'), true)
  assert.equal(canTransitionStatus('adopted', 'superseded'), true)
  assert.equal(canTransitionStatus('proposed', 'draft'), true, '打回草稿是合法边')
  assert.equal(canTransitionStatus('draft', 'adopted'), false, '跨级非法')
  assert.equal(canTransitionStatus('superseded', 'draft'), false, '终态无出边')
  assert.equal(canTransitionStatus('draft', 'draft'), true, '同状态幂等放行')
  assert.equal(canTransitionStatus('published', 'draft'), false, '词表外状态一律非法')

  const legal = validateStatusTransition('draft', 'proposed')
  assert.deepEqual(legal, { ok: true, from: 'draft', to: 'proposed', allowed: ['proposed', 'superseded'] })
  const illegal = validateStatusTransition('adopted', 'draft')
  assert.equal(illegal.ok, false)
  assert.equal(illegal.code, 'ILLEGAL_STATUS_TRANSITION')
  assert.deepEqual(illegal.allowed, ['superseded'])
  assert.equal(validateStatusTransition('draft', 'published').code, 'UNKNOWN_STATUS')

  const entry = { name: '灵潮', status: 'proposed' }
  const moved = transitionEntryStatus(entry, 'adopted')
  assert.equal(moved.ok, true)
  assert.equal(moved.entry.status, 'adopted')
  assert.equal(entry.status, 'proposed', '不改原对象')
  assert.equal(transitionEntryStatus(entry, 'superseded').ok, true, 'proposed→superseded 是表内合法边')
  const unknown = transitionEntryStatus(entry, 'nope')
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'UNKNOWN_STATUS')
})

/* ---------- ⑤ 与 core 原件行为等价 ---------- */

function mutationCorpus() {
  return [
    ['worldview 合法', worldviewEntry()],
    ['character 合法', characterEntry()],
    ['plot 合法', plotEntry()],
    ['缺 definition', (() => { const e = worldviewEntry(); delete e.definition; return e })()],
    ['缺 provenance', (() => { const e = plotEntry(); delete e.provenance; return e })()],
    ['未知 layer', worldviewEntry({ layer: 'style' })],
    ['未知 slot', worldviewEntry({ slot: '不存在的槽位' })],
    ['未知 status', worldviewEntry({ status: 'published' })],
    ['id 漂移', worldviewEntry({ id: 'ffffffffffff' })],
    ['id 坏格式', badIdEntry()],
    ['analyze 带 quote 原文', worldviewEntry({ provenance: { ...provenanceOf('analyze'), quote: '原文' } })],
    ['supporting 缺 goal（author）', characterEntry({ castRole: { tier: 'supporting' } })],
    ['supporting 缺 goal（analyze）', characterEntry({ castRole: { tier: 'supporting' }, provenance: provenanceOf('analyze') })],
    ['节奏窗口逆序', plotEntry({ rhythmSpec: { windowChars: [900, 300], noveltyTags: ['燃'] } })],
    ['事件轨未知', plotEntry({ events: [{ track: '传说' }] })],
    ['结构模板未知 kind', plotEntry({ structureTemplates: [{ name: '三幕', kind: 'unknown-kind' }] })],
    ['关系目标空', characterEntry({ relations: [{ to: '  ' }] })],
    ['非对象', '不是对象']
  ]
}

function badIdEntry() {
  return worldviewEntry({ id: 'NOT-HEX' })
}

/**
 * 金样（OS-156）：删除 core 原件**前**在 src≡core 等价对拍下实测冻结——同一份锁，core 不再需要。
 * 键＝语料标签，值＝validateFactEntry 输出的 sha256（含 ok/errors/warnings 全字段，任何字段漂移都会变）。
 */
const DOMAIN_GOLDENS = {
  'worldview 合法': '7be7e12c6422bbf1b942637a3cf71f9a78fa0bb252416a978a4a095d3f11d6ef',
  'character 合法': '7be7e12c6422bbf1b942637a3cf71f9a78fa0bb252416a978a4a095d3f11d6ef',
  'plot 合法': '7be7e12c6422bbf1b942637a3cf71f9a78fa0bb252416a978a4a095d3f11d6ef',
  '缺 definition': 'fe6ef08efa8a8d492c7097638f1ffb8ccda37cdeb58e7fe61517504e0287304a',
  '缺 provenance': '229b3c5a2642f9da92d429cf9596c891e877781bf727a1995adebb6d8462a285',
  '未知 layer': '84951f9950481ec80b64dd3afde572912c6a2a88f0246f9580f62b90e5771eab',
  '未知 slot': '186050f4d609b6f072a9996fbff3b650dedd4dfeba9e83ccc292ae2a468e4db7',
  '未知 status': '6d3e884c4602f2beaea75e76f3155b027bbe708f229497152a954f1ca89a9cf6',
  'id 漂移': '99749d1fd0c3a0b704181154d779f8e5489613c592817e9d1608aba43c60c2b2',
  'id 坏格式': '5ef5d491b17b35c2d4b450175fd8b5c37acd5f52612761e9363f19937c6b3648',
  'analyze 带 quote 原文': '2e0e30057063058532ec7ad1bc267ef1aa3425596463e8128b7c24d673727a38',
  'supporting 缺 goal（author）': '2ca8d797c7272ada4aaa7af965ee3da5a4c84daf3ff79479653b3b374c47de52',
  'supporting 缺 goal（analyze）': '7fec4f1b672220601b5a3c7820eeaca4d4106b021f442d493161fb25c95a1943',
  '节奏窗口逆序': '7a77c68a0088cd26e7d9f1ea7757c77b7bf3e596689159c204cc082edb18afe1',
  '事件轨未知': '3e57f1379af2ea3f84a712b943a04d182220db27818e965f86d1b0b352fa319c',
  '结构模板未知 kind': '8e9116f1f8549b3c7e47d0e6c03434b0d44377a940687de03c33d2dc58de1917',
  '关系目标空': 'e41eb298eb03ce941da7e26644eb0b4c60d309531df9d7247cc435fd0f24b7bf',
  '非对象': 'd8a7a5cee6b1f00ce42107eb91e62a96e2030d7204fbafeb38f1d648307ce3ef'
}

test('金样：18 组语料的 errors／warnings 逐条冻结（OS-156 删 core 原件前 src≡core 实测）', () => {
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const corpus = mutationCorpus()
  assert.deepEqual(corpus.map(([label]) => label), Object.keys(DOMAIN_GOLDENS), '语料标签与金样一一对应，不许增减')
  for (const [label, entry] of corpus) {
    assert.equal(digest(validateFactEntry(entry)), DOMAIN_GOLDENS[label], `${label}：校验输出与金样不符（行为漂移）`)
  }
})

/** 桶导出面（排序后）与常量值摘要：删除 core 原件前由 src≡core 的导出面对拍实测冻结。 */
const DOMAIN_EXPORTS = [
  'CAST_ROLE_TIERS', 'CATEGORY_MAP', 'CHARACTER_ANCHOR_CHANNELS', 'DEFAULT_ENTRY_STATUS',
  'DEFAULT_RHYTHM_SPEC', 'ENTRY_STATUSES', 'FACT_LAYERS', 'FACT_SCHEMA', 'FACT_SCHEMA_LEGACY',
  'FACT_SOURCE', 'KNOWLEDGE_KINDS', 'NOVELTY_TAGS', 'OTHER_SLOT', 'PLOT_EVENT_TRACKS',
  'PROVENANCE_MODES', 'RHYTHM_WINDOW_DEFAULTS', 'STATUS_TRANSITIONS', 'STRUCTURE_TEMPLATE_KINDS',
  'WORLDVIEW_SLOTS', 'WORLDVIEW_SLOT_NAMES',
  'canTransitionStatus', 'checkPerspective', 'createRhythmSpec', 'instantiateStructureTemplate',
  'intersectValidity', 'isActiveAt', 'isOrderedSlot', 'isWorldviewEntry', 'knowledgeReferencesOf',
  'normalizeKnowledgeLedger', 'normalizeSpan', 'sha1Hex', 'slotForCategory', 'spansOverlap',
  'stableEntryId', 'transitionEntryStatus', 'validateFactEntry', 'validateStatusTransition',
  'validateValidityShape', 'validityBounds', 'validityFromSpan'
]
const DOMAIN_CONSTANTS_DIGEST = 'f2a919aac636166dcde7ad46a90812947426dbbcc15d922297ef2e6ae3dd388c'
/** 常量导出（其余导出都是函数）：清单来自删除 core 原件前的桶导出面。 */
const DOMAIN_CONSTANTS = [
  'CAST_ROLE_TIERS', 'CATEGORY_MAP', 'CHARACTER_ANCHOR_CHANNELS', 'DEFAULT_ENTRY_STATUS',
  'DEFAULT_RHYTHM_SPEC', 'ENTRY_STATUSES', 'FACT_LAYERS', 'FACT_SCHEMA', 'FACT_SCHEMA_LEGACY',
  'FACT_SOURCE', 'KNOWLEDGE_KINDS', 'NOVELTY_TAGS', 'OTHER_SLOT', 'PLOT_EVENT_TRACKS',
  'PROVENANCE_MODES', 'RHYTHM_WINDOW_DEFAULTS', 'STATUS_TRANSITIONS', 'STRUCTURE_TEMPLATE_KINDS',
  'WORLDVIEW_SLOTS', 'WORLDVIEW_SLOT_NAMES'
]

test('金样：桶 index.mjs 的导出面与常量值冻结（导出名一个不多一个不少；枚举值/顺序不许漂）', () => {
  assert.deepEqual(Object.keys(domain).sort(), DOMAIN_EXPORTS, '导出名就是调用面（改名/增删都会断调用方）')
  for (const name of DOMAIN_EXPORTS) {
    const isConstant = DOMAIN_CONSTANTS.includes(name)
    assert.equal(typeof domain[name] === 'function', !isConstant, `${name}：${isConstant ? '应是常量' : '应是函数'}`)
  }
  const constants = {}
  for (const key of DOMAIN_EXPORTS) if (typeof domain[key] !== 'function') constants[key] = domain[key]
  const digest = createHash('sha256').update(JSON.stringify(constants)).digest('hex')
  assert.equal(digest, DOMAIN_CONSTANTS_DIGEST, '常量值与枚举顺序与金样不符')
})
