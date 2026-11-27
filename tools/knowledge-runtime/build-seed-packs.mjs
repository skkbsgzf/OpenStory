/** 生成四题材公开许可种子知识包；只写 knowledge-packs/，不改作者源库。 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'knowledge-packs')
const LICENSE = `Creative Commons Attribution 4.0 International (CC-BY-4.0)

These synthetic seed documents were created for OpenStory. You may share and
adapt them for any purpose, including commercially, provided you give appropriate
credit, link to the license, and indicate if changes were made.

License text: https://creativecommons.org/licenses/by/4.0/legalcode
Provided "AS IS", without warranty of any kind.
`

const packs = [
  {
    id: 'seed-xiuxian', name: '修仙种子包', genre: '修仙',
    docs: {
      'index': ['索引', '入门', '本包收录修仙写作的技法、套路、人物与设定示例。', ['索引']],
      'craft': ['境界突破三拍', '技法', '突破前先付代价，突破中让旧能力失效，突破后用新能力解决旧问题。', ['技法', '突破']],
      'tropes': ['退婚流反转', '套路', '退婚不是终点；把羞辱记成可兑现的目标，三章后让轻视者必须求助。', ['套路', '反转']],
      'character': ['孤傲剑修', '人物', '剑修言少、行动快，用护短与守诺暴露柔软，不靠长篇独白解释。', ['人物', '剑修']],
      'setting': ['灵根与灵脉', '设定', '灵根决定天赋上限，灵脉决定修行速度；两者冲突时可制造资源型困境。', ['设定', '修炼']],
      'distractor-a': ['洞府装修清单', '干扰', '丹房、剑室与静室的采光通风安排。', ['生活']],
      'distractor-b': ['灵兽喂食表', '干扰', '不同灵兽的食量与禁忌零食。', ['生活', '灵兽']]
    },
    queries: [
      ['境界突破怎样避免只换一个称号', ['craft']],
      ['退婚流如何写成长目标而不是当场打脸', ['tropes']],
      ['孤傲剑修怎样展示温柔', ['character']],
      ['灵根和灵脉的区别能制造什么冲突', ['setting']],
      ['量子计算机散热风扇型号', []]
    ]
  },
  {
    id: 'seed-urban', name: '都市种子包', genre: '都市',
    docs: {
      'index': ['索引', '入门', '本包收录都市写作的技法、套路、人物与设定示例。', ['索引']],
      'craft': ['职场冲突落地', '技法', '冲突要有截止时间、可执行动作和代价；会议争论后必须落到一份可核对的交付物。', ['技法', '职场']],
      'tropes': ['隐藏身份反转', '套路', '身份隐藏的价值在关系代价；每次险些暴露都改变信任，而非重复震惊。', ['套路', '身份']],
      'character': ['毒舌搭档', '人物', '毒舌只针对问题不贬低人格，关键节点用一次沉默承担暴露真心。', ['人物', '搭档']],
      'setting': ['城市通勤地图', '设定', '用跨区通勤时间制造阶级与时间差；同一顿饭在不同城区有不同成本。', ['设定', '城市']],
      'distractor-a': ['咖啡豆烘焙曲线', '干扰', '浅中深烘的温度与时间记录。', ['生活']],
      'distractor-b': ['地铁票颜色', '干扰', '不同票面的视觉区分。', ['生活', '交通']]
    },
    queries: [
      ['职场冲突怎样从争吵推进到结果', ['craft']],
      ['隐藏身份反转怎样产生关系代价', ['tropes']],
      ['毒舌搭档如何不写成人身攻击', ['character']],
      ['怎样用城市通勤表现阶层差异', ['setting']],
      ['修仙灵根突破概率', []]
    ]
  },
  {
    id: 'seed-western', name: '西幻种子包', genre: '西幻',
    docs: {
      'index': ['索引', '入门', '本包收录西幻写作的技法、套路、人物与设定示例。', ['索引']],
      'craft': ['冒险队资源账', '技法', '每次胜利都记消耗：马匹、绳索、药剂与伤员；资源见底时选择才有重量。', ['技法', '冒险']],
      'tropes': ['预言自我实现', '套路', '预言先给错误解释，角色为逃避预言做出的动作恰好促成它。', ['套路', '预言']],
      'character': ['退役圣骑士', '人物', '圣骑士守誓但不盲从；用一次违令救人重写誓约，而非恢复光荣。', ['人物', '圣骑士']],
      'setting': ['龙语魔法代价', '设定', '龙语越完整，施法越快；禁句会灼烧记忆，使知识成为消耗品。', ['设定', '魔法']],
      'distractor-a': ['旅店床单规格', '干扰', '亚麻与羊毛床单的保养差异。', ['生活']],
      'distractor-b': ['马车轮毂尺寸', '干扰', '不同地形使用的轮毂宽度。', ['生活', '交通']]
    },
    queries: [
      ['冒险队胜利怎样保持资源压力', ['craft']],
      ['预言反转怎样避免机械应验', ['tropes']],
      ['退役圣骑士如何保留信念又有变化', ['character']],
      ['龙语魔法的代价怎样影响知识使用', ['setting']],
      ['都市写字楼考勤规则', []]
    ]
  },
  {
    id: 'seed-harem', name: '宫斗种子包', genre: '宫斗',
    docs: {
      'index': ['索引', '入门', '本包收录宫斗写作的技法、套路、人物与设定示例。', ['索引']],
      'craft': ['请安信息差', '技法', '同一场请安按站位分成三个信息层；谁先离席、谁被留下，比台词更有效。', ['技法', '信息差']],
      'tropes': ['借刀反噬', '套路', '借刀者必须留下可追溯物证；被借者发现后不揭穿，先让刀转向真正的主人。', ['套路', '权谋']],
      'character': ['笑面掌事', '人物', '掌事从不威胁，只调整任务分配；温柔语气与冷酷调度同时可见。', ['人物', '掌事']],
      'setting': ['内库账册周期', '设定', '月盘、旬盘与年盘互相校验；延迟一天的数据可成为政治筹码。', ['设定', '账册']],
      'distractor-a': ['宫花养护', '干扰', '不同季节宫花的浇水频率。', ['生活']],
      'distractor-b': ['夏季冰鉴除味', '干扰', '冰鉴内放置吸味材料的方法。', ['生活']]
    },
    queries: [
      ['宫斗请安场面怎样用站位传递信息', ['craft']],
      ['借刀反噬套路怎样留证据链', ['tropes']],
      ['笑面掌事如何写出温柔与冷酷', ['character']],
      ['内库账册周期怎样变成权谋筹码', ['setting']],
      ['西幻龙语禁句列表', []]
    ]
  }
]

for (const pack of packs) {
  const dir = join(ROOT, pack.id)
  await mkdir(join(dir, 'docs'), { recursive: true })
  await writeFile(join(dir, 'LICENSE'), LICENSE)
  await writeFile(join(dir, 'knowledge.base.json'), JSON.stringify({
    schema: 'openstory.knowledge-base@1', schemaVersion: 1, id: pack.id, name: pack.name,
    version: '1.0.0', vendor: 'OpenStory', license: 'CC-BY-4.0', documentEntry: 'docs/index.md',
    formats: ['.md'], exclude: ['gold.json'], retrievalDefaults: { topK: 6, minScore: 0.3, budgetChars: 6000 },
    tagMap: {}, nodeMap: {}, edgeMap: {}
  }, null, 2) + '\n')
  for (const [slug, [title, tag, body, tags]] of Object.entries(pack.docs)) {
    const heading = slug === 'index' ? `# ${pack.name}` : `# ${title}`
    const text = `---\ntitle: ${title}\ntags: [${tags.join(', ')}]\ngenre: ${pack.genre}\n---\n\n${heading}\n\n${body}\n`
    await writeFile(join(dir, 'docs', `${slug}.md`), text)
  }
  const gold = {
    schema: 'openstory.knowledge-gold@1', corpus: pack.id, genre: pack.genre,
    thresholds: { sourceAccuracy: 1, negativePrecision: 1, macroRecallAt5: 0.85, perGenreRecallAt5: 0.75 },
    queries: pack.queries.map(([query, expected], index) => ({
      id: `${pack.id}-${index + 1}`, query, expected: expected.map((slug) => `docs/${slug}.md`), negative: expected.length === 0
    }))
  }
  await writeFile(join(dir, 'gold.json'), JSON.stringify(gold, null, 2) + '\n')
}
