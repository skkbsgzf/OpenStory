/**
 * 《水浒传》前 10 回派生 wiki 骨架（OS-230 唯一事实源的派生层）。
 *
 * 按 FACT-FIRST：派生层不构成独立真源；derivedFrom 由 fact 内核按写后 revision 覆盖。
 * 本文件只提供受控输入；落盘必须经 MCP 的 fact_entries_import。
 */
import { SHUIHU_10CH_FACTS } from './shuihu-10ch-facts.mjs'

const chapterSummaries = [
  { chapter: 1, title: '误走妖魔', summary: '嘉祐三年京师瘟疫，范仲淹奏请天师，洪信赴龙虎山误放一百单八魔君。', function: '建立', emotion: '疑', beats: 4 },
  { chapter: 2, title: '王进私走', summary: '高俅追拿旧怨，王进私走延安，史家村收史进为徒；史进烧庄上华山。', function: '引人物', emotion: '迫', beats: 4 },
  { chapter: 3, title: '拳打镇关西', summary: '史进遇鲁达，鲁达为金氏父女出头三拳打死郑屠，逃亡五台山。', function: '立好汉', emotion: '怒', beats: 4 },
  { chapter: 4, title: '大闹五台山', summary: '鲁达剃度智深，醉闹山门，长老荐往东京。', function: '转场', emotion: '豪', beats: 3 },
  { chapter: 5, title: '倒拔垂杨柳', summary: '智深降服菜园泼皮，倒拔绿杨，结识林冲；高衙内调戏林妻。', function: '接主线', emotion: '义', beats: 4 },
  { chapter: 6, title: '误入白虎堂', summary: '高俅使陆谦诱林冲带刀入白虎节堂，刺配沧州，智深野猪林相救。', function: '加害', emotion: '冤', beats: 4 },
  { chapter: 7, title: '风雪山神庙', summary: '陆谦火烧草料场，林冲山神庙听得阴谋，杀三人冒雪投梁山。', function: '爆发', emotion: '烈', beats: 4 },
  { chapter: 8, title: '智取生辰纲', summary: '林冲纳投名状；杨志押纲，吴用设计于黄泥冈以蒙汗药劫走生辰纲。', function: '聚义', emotion: '谋', beats: 4 },
  { chapter: 9, title: '火并王伦', summary: '晁盖等上梁山，王伦嫉贤，林冲火并，众推晁盖为寨主。', function: '换寨主', emotion: '快', beats: 4 },
  { chapter: 10, title: '宋江杀惜', summary: '宋江私放晁盖，阎婆惜拾书要挟，宋江怒杀之，投柴进庄避难。', function: '引宋江', emotion: '迫', beats: 4 }
]

const causalGraph = {
  nodes: chapterSummaries.map((item) => ({ id: `ch${item.chapter}`, chapter: item.chapter, event: item.title, kind: 'chapter' })),
  edges: [
    { from: 'ch1', to: 'ch6', type: 'foreshadow', strength: 0.7, evidence: '一百单八魔君散四方' },
    { from: 'ch2', to: 'ch6', type: 'cause', strength: 0.8, evidence: '高俅记恨王进，后加害林冲' },
    { from: 'ch5', to: 'ch6', type: 'cause', strength: 0.9, evidence: '高衙内调戏林妻' },
    { from: 'ch6', to: 'ch7', type: 'cause', strength: 1, evidence: '陆谦火烧草料场' },
    { from: 'ch8', to: 'ch9', type: 'cause', strength: 0.9, evidence: '劫生辰纲后上梁山' },
    { from: 'ch9', to: 'ch10', type: 'cause', strength: 0.8, evidence: '晁盖谢宋江，书信引祸' }
  ],
  threads: [
    { name: '官逼民反（林冲线）', chapters: [5, 6, 7, 9], closed: false },
    { name: '好汉聚义（晁盖线）', chapters: [8, 9], closed: false },
    { name: '宋江逃亡线', chapters: [10], closed: false }
  ]
}

const characterProfiles = [
  { name: '林冲', needs: [{ level: 3, need: '保全家小', object: '妻子张氏', fear: '高衙内再逼', cost: '一再忍辱', evidence: '第五回庙前忍气' }] },
  { name: '鲁智深', needs: [{ level: 2, need: '除恶扶弱', object: '受欺百姓', fear: '无辜受害', cost: '亡命江湖', evidence: '第三回拳打镇关西' }] },
  { name: '宋江', needs: [{ level: 4, need: '仗义全名', object: '江湖兄弟', fear: '官府追捕', cost: '杀惜逃亡', evidence: '第十回私放晁盖' }] }
]

const foreshadows = [
  { chapter: 1, text: '一百单八魔君散作金光', target: '全书一百单八将', status: 'open' },
  { chapter: 2, text: '高俅旧怨', target: '林冲白虎堂之祸', status: 'resolved', byChapter: 6 },
  { chapter: 10, text: '宋江投柴进庄', target: '武松出场', status: 'open' }
]

export const SHUIHU_10CH_WIKI = Object.freeze({
  version: '1.0.0',
  protagonist: '林冲／宋江',
  slots: {
    gimmick: '前 10 回以官逼民反与七星聚义双线并进，事实链先于正文。',
    plotDesign: '瘟疫起 → 魔君散 → 教头被害 → 好汉聚义 → 押司逃亡。',
    intro: '洪太尉误走妖魔，一百单八魔君投四方。',
    style: '宋明白话为骨，文言为饰；以动作和对话推进。'
  },
  worldElements: { scenes: ['龙虎山', '五台山', '白虎节堂', '野猪林', '山神庙', '黄泥冈', '梁山泊', '郓城县'], items: ['生辰纲', '梁山书信'] },
  ledger: { knowledgeLedger: [], stateLedger: [] },
  storySummary: '《水浒传》前 10 回：从洪太尉误走妖魔，到林冲被逼上梁山、晁盖智取生辰纲，再到宋江私放晁盖怒杀阎婆惜。',
  arc: { stages: [{ name: '起因', chapters: [1, 2] }, { name: '加害', chapters: [5, 6, 7] }, { name: '聚义', chapters: [8, 9] }, { name: '逃亡', chapters: [10] }] },
  chapterSummaries,
  foreshadows,
  excerpts: [],
  characterProfiles,
  causalGraph,
  failures: [],
  factEntryCount: SHUIHU_10CH_FACTS.length
})
