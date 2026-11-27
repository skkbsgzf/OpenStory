/**
 * 《水浒传》MCP-only clean-room 构建配方（OS-217）。
 *
 * 这是**内容输入**，不是落盘器：本文件只导出受版本控制的文本/结构化数据。
 * 构建器必须通过 MCP 工具把这些值写进临时空库，禁止直接 writeFile 业务内容。
 *
 * 语义来源：公版《水浒传》第一回与项目既有示例的浓缩改写；事实条目按 fact.data/v3
 * 重新构造（稳定 id、domain/slot/provenance/fingerprint），不复制旧样本的非法 id。
 */
import { createHash } from 'node:crypto'
import { stableEntryId, validateFactEntry } from '../../src/modules/fact/fact/domain/index.mjs'

const BOOK_ID = 'shuihu'
const DOMAIN = '水浒传'

const provenance = (chapters = [1]) => ({
  mode: 'author',
  book: '水浒传',
  book_id: BOOK_ID,
  chapters,
  scenes: [],
  extractor: 'os217-controlled-recipe'
})

function entry(layer, name, extra = {}) {
  const domain = extra.domain ?? DOMAIN
  const slot = extra.slot ?? ''
  const value = {
    schema: 'fact.data/v3',
    id: stableEntryId({ layer, domain, slot, name }),
    layer,
    name,
    domain,
    status: 'adopted',
    provenance: provenance(extra.chapters ?? [1]),
    fingerprint: { vec: null, metrics: { source: 'controlled-recipe' } },
    ...extra
  }
  delete value.chapters
  return value
}

const chapter = `# 第一回　张天师祈禳瘟疫　洪太尉误走妖魔

话说大宋仁宗天子在位，嘉祐三年三月三日五更三点，天子驾坐紫宸殿，受百官朝贺。当有殿头官喝道：「有事出班早奏，无事卷帘退朝。」

只见班部丛中，宰相赵哲、参政文彦博出班奏道：「目今京师瘟疫盛行，伤损军民甚多。伏望陛下释罪宽恩，省刑薄税，以禳天灾，救济万民。」

天子听奏，急敕翰林院随即草诏，一面降赦天下罪囚，应有民间税赋悉皆赦免；一面命在京宫观寺院修设好事禳灾。不料其年瘟疫转盛，仁宗天子闻知，龙体不安，复会百官计议。

参知政事范仲淹奏道：「以臣愚见，必欲禳此天灾，可宣嗣汉天师星夜临朝，就京师禁院修设三千六百分罗天大醮，奏闻上帝，可以禳保民间瘟疫。」

天子准奏，随即降诏，令内外提点宫观事、殿前太尉洪信为天使，前往江西信州龙虎山，宣请嗣汉天师张真人星夜临朝，祈禳瘟疫。

那洪信领了圣旨，不敢久停，随即收拾行李，带了从人，离了东京，取路望信州来。

---

洪太尉一行到了龙虎山上清宫，住持真人接入。太尉问天师何在，真人道：「天师性好清高，倦于迎送，自向山顶结茅庵居止。若要见时，须是太尉自去，斋戒沐浴，更换布衣，休带从人，步行上山。」

太尉听罢，心中不悦，然是圣旨，只得依了。次日五更，他便换了布衣草履，独自上山。

行不到半里，忽见一只吊睛白额锦毛虎，望着太尉扑将来。那太尉惊倒在地，浑身冷汗。虎却不去伤他，只在身边闻了闻，便径自去了。

太尉爬起来，正待要走，忽然一阵怪风过处，竹影里跳出一条吊桶大小、雪花也似的大蛇来，直抢到面前。那太尉又惊倒在地，那蛇盘作一堆，吐着信子看他。良久，蛇也去了。

太尉连遭两吓，再不敢上山，慌忙下山回宫，对真人道：「本欲上山见天师，奈何受此惊吓，只得且回。」

真人道：「此乃天师试探，非真虎蛇也。」

太尉心中疑惧，闲步到上清宫后殿，见一所殿宇，门上贴着一道封皮，层层叠叠，朱印累累。太尉道：「此是何殿？」

真人道：「此乃唐朝洞玄国师镇压魔王之所，凡遇此殿，不可擅开。」

太尉不信，定要看。真人再三苦劝，太尉只是不从，喝令从人把封皮揭了，将门推开。

只听得一声响亮，好似天摧地塌，岳撼山崩。黑烟起处，一道黑气从殿中冲出，直上半天，散作百十道金光，望四面八方去了。

众人惊得目瞪口呆。真人跌足道：「太尉，你误了大事！此殿中锁的是一百单八个魔君，如今被你放将出去，如之奈何？」

洪太尉听罢，面如土色，浑身冷汗，急急收拾下山，回东京复旨去了。

后来这一百单八人，散在四方，或为官，或为吏，或为僧道，或为商贾。一似：

> 一朝云雨会，终作栋梁材。

毕竟不知这一百单八人果是何等样人，且听下回分解。
`

const facts = [
  entry('worldview', '一百单八魔君', { slot: 'creatures', definition: '上清宫后殿镇压的一百单八个魔君，被洪太尉误放，散作百十道金光投四方。全书一百单八将即应此数。' }),
  entry('worldview', '天师试探', { slot: 'abilities', definition: '龙虎山天师以吊睛白额虎与雪花大蛇试探洪太尉心志，非真兽。此设定确立「神异」基调，为后文一百单八星宿转世张本。' }),
  entry('character', '洪信', { definition: '殿前太尉，奉旨赴龙虎山宣请天师。性刚愎，不听真人劝阻擅开后殿，误放一百单八魔君。', identity: '殿前太尉', castRole: { tier: 'supporting', goal: '请天师禳疫', plotFunction: '误放魔君，推动全书引线' } }),
  entry('character', '范仲淹', { definition: '参知政事，奏请宣嗣汉天师修罗天大醮禳灾。', identity: '参知政事', castRole: { tier: 'supporting', goal: '为京师禳灾', plotFunction: '提出请天师，推动情节' } }),
  entry('character', '张天师', { definition: '嗣汉天师，居龙虎山顶茅庵，性好清高。以虎蛇试洪太尉。', identity: '嗣汉天师', castRole: { tier: 'supporting', goal: '试探来使心志', plotFunction: '设下虎蛇试探' } }),
  entry('plot', '误走妖魔', {
    fact: '洪太尉不听真人劝阻，强开上清宫后殿，放走一百单八魔君，散作金光投四方。全书由此起。',
    events: [
      { index: 1, who: '洪信', channel: 'action', content: '强开伏魔殿', segments: [{ index: 1, chars: 6 }] },
      { index: 2, who: '一百单八魔君', channel: 'action', content: '散作金光投四方', segments: [{ index: 1, chars: 7 }] }
    ]
  }),
  entry('plot', '京师瘟疫', {
    fact: '嘉祐三年京师瘟疫盛行，仁宗命洪信赴龙虎山宣天师修醮禳灾——这是整个故事的动因。',
    events: [
      { index: 1, who: '仁宗', channel: 'action', content: '命洪信赴龙虎山', segments: [{ index: 1, chars: 7 }] }
    ]
  })
]

for (const item of facts) {
  const checked = validateFactEntry(item)
  if (!checked.ok) throw new Error(`配方事实不合法：${item.name} ${JSON.stringify(checked.errors)}`)
}

const notes = [
  ['世界书/人物/洪信.md', `---\ntags: [人物, 主角, 朝廷]\ntitle: 洪信\n---\n\n# 洪信\n\n殿前太尉，奉旨赴龙虎山宣请天师。性刚愎，不听真人劝阻擅开后殿，误放一百单八魔君。\n\n## 关键转折\n\n- 奉命请天师禳疫\n- 上山遇虎蛇试探\n- 强开伏魔殿，误走妖魔（见 [[误走妖魔]]）\n`],
  ['世界书/人物/范仲淹.md', `---\ntags: [人物, 朝廷]\ntitle: 范仲淹\n---\n\n# 范仲淹\n\n参知政事，奏请宣嗣汉天师修罗天大醮禳灾。\n\n## 剧情作用\n\n推动仁宗派洪信赴龙虎山，是「京师瘟疫」与「误走妖魔」之间的引线。\n`],
  ['世界书/人物/张天师.md', `---\ntags: [人物, 方外]\ntitle: 张天师\n---\n\n# 张天师\n\n嗣汉天师，居龙虎山顶茅庵，性好清高。以虎蛇试洪太尉。\n`],
  ['世界书/事件/京师瘟疫.md', `---\ntags: [事件, 主线]\ntitle: 京师瘟疫\n---\n\n# 京师瘟疫\n\n嘉祐三年京师瘟疫盛行，仁宗命洪信赴龙虎山宣天师修醮禳灾。\n\n- 动因：瘟疫伤损军民\n- 应对：修醮、请天师\n- 引向：[[误走妖魔]]\n`],
  ['世界书/事件/误走妖魔.md', `---\ntags: [事件, 主线, 伏笔]\ntitle: 误走妖魔\n---\n\n# 误走妖魔\n\n[[洪信]] 不听 [[张天师]] 劝阻，强开上清宫后殿，放走一百单八魔君，散作金光投四方。全书由此起。\n\n## 关联\n\n- 人物：[[洪信]]、[[范仲淹]]、[[张天师]]\n- 前因：[[京师瘟疫]]\n`],
  ['世界书/场景/龙虎山.md', `---\ntags: [场景, 山野]\ntitle: 龙虎山\n---\n\n# 龙虎山\n\n江西信州龙虎山，上清宫与山顶茅庵所在。山路多雾松石，天师以虎蛇试探来使。\n`],
  ['世界书/资料/宋代背景.md', `---\ntags: [资料, 背景]\ntitle: 宋代背景\n---\n\n# 宋代背景\n\n公版《水浒传》第一回：宋仁宗嘉祐三年，京师瘟疫，朝廷修醮禳灾，派殿前太尉洪信赴龙虎山宣请嗣汉天师。\n`]
]

const script = `# 第一幕 京师求雨

*〔场景：紫宸殿，早朝〕*

**仁宗**：京师瘟疫盛行，众卿有何良策？

**范仲淹**：可宣嗣汉天师临朝，修设罗天大醮。

# 第二幕 龙虎山试探

*〔场景：上清宫后山，雾中〕*

**真人**：太尉若要见天师，须斋戒沐浴，步行上山。

**洪信**：圣旨在身，岂敢迟延。

# 第三幕 误走妖魔

*〔场景：上清宫后殿，伏魔殿前〕*

**真人**：此殿镇压魔王，不可擅开。

**洪信**：我奉圣旨而来，倒要看看里面是什么。

*〔黑烟起处，百十道金光散向四方。〕*
`

const habits = {
  schema: 'openstory.habits/v1',
  tone: 'direct',
  style: '宋明白话为骨，文言为饰；以动作和对话推进，不写现代心理术语',
  bannedWords: ['心理活动', '压力', '效率'],
  preferredWords: ['那厮', '恁地', '只得'],
  bannedPatterns: ['同段重复「不是…而是…」'],
  bannedRhetoric: ['不必要血腥细节'],
  formulas: ['动作在前，后果紧随', '人物出场自然带出身份或绰号', '回目两件事并列或对照']
}

const session = {
  schema: 'openstory.deduce-session/v1',
  bookId: BOOK_ID,
  sessionId: 'main',
  title: '主线',
  branchId: 'main',
  cursor: 1,
  nodes: [{
    id: 'os217-node-1',
    round: 1,
    branchId: 'main',
    parentId: '',
    choiceId: 'recipe-1',
    scene: { who: '洪信、范仲淹、张天师', where: '龙虎山', tension: '试探与威压', hook: '伏魔殿封皮已被揭开' },
    candidates: [{ id: 'recipe-1', source: '受控配方', text: '洪信强开伏魔殿' }],
    prose: '洪信把封皮层层揭下，殿门吱呀一声开了。黑烟直冲半天，散作百十道金光，望四面八方去了。',
    events: [],
    createdAt: '2026-01-01T00:00:00.000Z'
  }],
  buffer: { chapterNo: 1, nodes: [], words: 0 },
  archived: [],
  pending: [],
  rollingSummary: null
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6x0sAAAAASUVORK5CYII=', 'base64')
const mp3 = Buffer.from('494433040000000000000000', 'hex') // 仅用于协议/字节探针，不是可播放音频

export const SHUIHU_RECIPE = Object.freeze({
  bookId: BOOK_ID,
  name: '水浒传',
  domain: DOMAIN,
  primaryCarrier: 'openstory.carrier.novel',
  chapter: Object.freeze({ path: '正文/001-第一回 张天师祈禳瘟疫.md', text: chapter }),
  facts: Object.freeze(facts),
  notes: Object.freeze(notes.map(([path, text]) => Object.freeze({ path, text }))),
  script: Object.freeze({ path: '剧本/001-第一回 误走妖魔.md', text: script }),
  habits: Object.freeze(habits),
  session: Object.freeze(session),
  uiState: Object.freeze({ typography: { ui: 'comfortable', doc: 'm' } }),
  assets: Object.freeze([
    Object.freeze({ path: '角色/洪信.png', dataBase64: png.toString('base64') }),
    Object.freeze({ path: '场景/龙虎山.png', dataBase64: png.toString('base64') }),
    Object.freeze({ path: 'bgm/平静.mp3', dataBase64: mp3.toString('base64') })
  ])
})

export function semanticDigest(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}
