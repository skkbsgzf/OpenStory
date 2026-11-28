/**
 * 《水浒传》前 10 回事实链（OS-230 唯一事实源，受控配方）。
 *
 * 按 FACT-FIRST：事实条目是权威源，正文只作逐字出处。每条 fact 的
 * provenance.chapters 指向对应回目；stable id 由 stableEntryId 生成，跨重建零漂移。
 * 本文件只提供数据，落盘必须经 MCP（build-shuihu-mcp.mjs）。
 */
import { stableEntryId, validateFactEntry } from '../../src/modules/fact/fact/domain/index.mjs'

const BOOK_ID = 'shuihu'
const DOMAIN = '水浒传'

const provenance = (chapters) => ({
  mode: 'author',
  book: '水浒传',
  book_id: BOOK_ID,
  chapters,
  scenes: [],
  extractor: 'os230-10ch-controlled-recipe'
})

function entry(layer, name, chapters, extra = {}) {
  const domain = extra.domain ?? DOMAIN
  const slot = extra.slot ?? ''
  const value = {
    schema: 'fact.data/v3',
    id: stableEntryId({ layer, domain, slot, name }),
    layer,
    name,
    domain,
    status: 'adopted',
    provenance: provenance(chapters),
    fingerprint: { vec: null, metrics: { source: 'controlled-recipe' } },
    ...extra
  }
  delete value.chapters
  return value
}

function character(name, chapters, definition, castRole) {
  return entry('character', name, chapters, {
    definition,
    identity: castRole.identity ?? '',
    castRole: { tier: castRole.tier ?? 'supporting', goal: castRole.goal ?? '', plotFunction: castRole.plotFunction ?? '' }
  })
}

function plot(name, chapters, fact, events) {
  return entry('plot', name, chapters, { fact, events })
}

function worldview(name, chapters, slot, definition) {
  return entry('worldview', name, chapters, { slot, definition })
}

// 第一回既有 7 条事实，保留原 id 口径（与原样本一致），provenance 归到第一回。
const firstSeven = [
  worldview('一百单八魔君', [1], 'creatures', '上清宫后殿镇压的一百单八个魔君，被洪太尉误放，散作百十道金光投四方。全书一百单八将即应此数。'),
  worldview('天师试探', [1], 'abilities', '龙虎山天师以吊睛白额虎与雪花大蛇试探洪太尉心志，非真兽。此设定确立「神异」基调。'),
  character('洪信', [1], '殿前太尉，奉旨赴龙虎山宣请天师，性刚愎，误放一百单八魔君。', { identity: '殿前太尉', goal: '请天师禳疫', plotFunction: '误放魔君，推动全书引线' }),
  character('范仲淹', [1], '参知政事，奏请宣嗣汉天师修罗天大醮禳灾。', { identity: '参知政事', goal: '为京师禳灾', plotFunction: '提出请天师' }),
  character('张天师', [1], '嗣汉天师，居龙虎山顶茅庵，性好清高，以虎蛇试洪太尉。', { identity: '嗣汉天师', goal: '试探来使心志', plotFunction: '设下虎蛇试探' }),
  plot('误走妖魔', [1], '洪太尉不听劝阻，强开上清宫后殿，放走一百单八魔君，散作金光投四方。全书由此起。', [
    { index: 1, who: '洪信', channel: 'action', content: '强开伏魔殿', segments: [{ index: 1, chars: 6 }] },
    { index: 2, who: '一百单八魔君', channel: 'action', content: '散作金光投四方', segments: [{ index: 1, chars: 7 }] }
  ]),
  plot('京师瘟疫', [1], '嘉祐三年京师瘟疫盛行，仁宗命洪信赴龙虎山宣天师修醮禳灾——整个故事的动因。', [
    { index: 1, who: '仁宗', channel: 'action', content: '命洪信赴龙虎山', segments: [{ index: 1, chars: 7 }] }
  ])
]

const rest = [
  // 第二回
  character('王进', [2], '八十万禁军教头，因高俅旧怨携母私走延安府，途经史家村收史进为徒。', { identity: '八十万禁军教头', goal: '避祸投延安', plotFunction: '引出史进与高俅' }),
  character('高俅', [2], '殿帅府太尉，原为泼皮高二，记旧恨追拿王进。', { identity: '殿帅府太尉', goal: '报复王进', plotFunction: '逼走王进，埋下林冲祸根' }),
  character('史进', [2, 3], '史家村少年，身刺九纹龙，拜王进为师，后烧庄投少华山。', { identity: '九纹龙', goal: '寻师王进', plotFunction: '引出少华山与鲁达' }),
  plot('王进私走延安府', [2], '高俅追拿旧怨，王进连夜撇下老母投延安，途中在史家村指点史进棒法。', [
    { index: 1, who: '王进', channel: 'action', content: '私走延安府', segments: [{ index: 1, chars: 5 }] }
  ]),
  plot('史进烧庄上华山', [2], '史进与少华山朱武等结义，猎户告密，官府围庄，史进烧庄夜走华阴县。', [
    { index: 1, who: '史进', channel: 'action', content: '烧庄投少华山', segments: [{ index: 1, chars: 6 }] }
  ]),

  // 第三回
  character('鲁达', [3, 4], '经略府提辖，拳打镇关西后逃亡，五台山出家法名智深。', { identity: '鲁提辖／花和尚', goal: '除恶避祸', plotFunction: '除郑屠、护林冲' }),
  character('郑屠', [3], '绰号镇关西，强占金翠莲，被鲁达三拳打死。', { identity: '镇关西', goal: '欺压金氏父女', plotFunction: '引出鲁达拳打' }),
  plot('拳打镇关西', [3], '鲁达为金翠莲父女出头，到郑屠肉案前消遣，三拳打死镇关西，逃出渭州。', [
    { index: 1, who: '鲁达', channel: 'action', content: '三拳打死郑屠', segments: [{ index: 1, chars: 6 }] }
  ]),

  // 第四回
  character('智真长老', [4], '五台山文殊院长老，为鲁达剃度，赐法名智深，说他心直口快有佛性。', { identity: '文殊院长老', goal: '点化智深', plotFunction: '收留并荐往东京' }),
  worldview('五台山文殊院', [4], 'locations', '鲁达避难出家之所，智真长老住持，后因智深醉闹山门荐往东京大相国寺。'),
  plot('鲁智深大闹五台山', [4], '智深在寺中饮酒，醉后打坏金刚、拆亭，长老修书荐他往东京。', [
    { index: 1, who: '鲁智深', channel: 'action', content: '醉打山门', segments: [{ index: 1, chars: 4 }] }
  ]),

  // 第五回
  character('林冲', [5, 6, 7, 8, 9], '八十万禁军教头，豹子头，因高衙内调戏妻子一再忍让，终被逼上梁山。', { identity: '豹子头', goal: '忍辱求安', plotFunction: '官逼民反主线' }),
  character('高衙内', [5, 6], '高俅义子，调戏林冲娘子，又称病设谋害林冲。', { identity: '高俅义子', goal: '谋占林妻', plotFunction: '逼害林冲的祸首' }),
  worldview('菜园泼皮', [5], 'orgs', '大相国寺菜园附近二三十个泼皮，被鲁智深降服后每日送酒肉。'),
  plot('倒拔垂杨柳', [5], '鲁智深在菜园徒手拔起绿杨树，偶遇林冲，两人结为兄弟。', [
    { index: 1, who: '鲁智深', channel: 'action', content: '倒拔垂杨柳', segments: [{ index: 1, chars: 5 }] }
  ]),

  // 第六回
  character('陆谦', [6, 7], '高俅心腹，献计骗林冲入白虎堂，又到沧州火烧草料场。', { identity: '陆虞候', goal: '害林冲', plotFunction: '两次加害的直接执行者' }),
  worldview('白虎节堂', [6], 'locations', '太尉府军机重地，林冲被诱带刀擅入，成为高俅构陷的罪名。'),
  worldview('野猪林', [6], 'locations', '沧州路上险地，董超薛霸欲在此结果林冲，被鲁智深救下。'),
  plot('误入白虎堂', [6], '高俅使陆谦诱林冲带刀入白虎节堂，指为行刺，发配沧州；鲁智深野猪林相救。', [
    { index: 1, who: '林冲', channel: 'action', content: '带刀误入白虎堂', segments: [{ index: 1, chars: 7 }] },
    { index: 2, who: '鲁智深', channel: 'action', content: '野猪林救林冲', segments: [{ index: 1, chars: 6 }] }
  ]),

  // 第七回
  worldview('山神庙', [7], 'locations', '沧州草料场附近，林冲因草屋被雪压塌在此栖身，听得陆谦阴谋。'),
  plot('风雪山神庙', [7], '陆谦火烧草料场，林冲在山神庙听得阴谋，一枪搠倒三人，冒雪投梁山。', [
    { index: 1, who: '林冲', channel: 'action', content: '山神庙杀陆谦', segments: [{ index: 1, chars: 6 }] },
    { index: 2, who: '陆谦', channel: 'action', content: '火烧草料场', segments: [{ index: 1, chars: 5 }] }
  ]),

  // 第八回
  character('杨志', [8], '殿司制使，押送生辰纲被劫，后投二龙山。', { identity: '青面兽', goal: '押纲复职', plotFunction: '引出智取生辰纲' }),
  character('吴用', [8, 9], '秀才，号智多星，与晁盖等七星聚义，设计用蒙汗药取生辰纲。', { identity: '智多星', goal: '劫纲聚义', plotFunction: '智取生辰纲的谋划者' }),
  worldview('生辰纲', [8], 'items', '梁中书送给蔡京的十万贯金银担，杨志押送，在黄泥冈被晁盖等劫走。'),
  plot('智取生辰纲', [8], '吴用设计，晁盖等扮贩枣客人在黄泥冈以蒙汗药酒麻倒押送军汉，劫走生辰纲。', [
    { index: 1, who: '吴用', channel: 'action', content: '黄泥冈下蒙汗药', segments: [{ index: 1, chars: 7 }] },
    { index: 2, who: '晁盖', channel: 'action', content: '劫走生辰纲', segments: [{ index: 1, chars: 5 }] }
  ]),

  // 第九回
  character('晁盖', [9], '郓城东溪村保正，七星聚义取生辰纲，上梁山后被推为寨主。', { identity: '托塔天王', goal: '聚义梁山', plotFunction: '梁山新寨主' }),
  worldview('梁山泊', [7, 9], 'locations', '水泊梁山，林冲雪夜投奔，晁盖等劫纲后上山，王伦嫉贤被林冲火并。'),
  plot('火并王伦', [9], '王伦不肯接纳晁盖等，林冲怒杀王伦，众推晁盖为寨主，林冲坐第二把交椅。', [
    { index: 1, who: '林冲', channel: 'action', content: '火并白衣秀士王伦', segments: [{ index: 1, chars: 8 }] }
  ]),

  // 第十回
  character('宋江', [10], '郓城押司，人称及时雨，私放晁盖，后怒杀阎婆惜逃亡。', { identity: '及时雨', goal: '仗义疏财', plotFunction: '私放晁盖、杀惜逃亡' }),
  character('阎婆惜', [10], '宋江外室，与张文远有染，拾得梁山书信要挟宋江，被杀。', { identity: '阎婆惜', goal: '要挟宋江', plotFunction: '引出宋江逃亡' }),
  plot('私放晁天王', [10], '宋江得晁盖书信，得知官府捉拿，私放晁盖，后收信被阎婆惜拾得。', [
    { index: 1, who: '宋江', channel: 'action', content: '私放晁盖', segments: [{ index: 1, chars: 4 }] }
  ]),
  plot('怒杀阎婆惜', [10], '阎婆惜以梁山书信要挟，宋江被逼无奈拔刀杀之，连夜投柴进庄避难。', [
    { index: 1, who: '宋江', channel: 'action', content: '怒杀阎婆惜', segments: [{ index: 1, chars: 5 }] }
  ])
]

export const SHUIHU_10CH_FACTS = Object.freeze([...firstSeven, ...rest])

for (const item of SHUIHU_10CH_FACTS) {
  const checked = validateFactEntry(item)
  if (!checked.ok) throw new Error(`前10回事实不合法：${item.name} ${JSON.stringify(checked.errors)}`)
}
