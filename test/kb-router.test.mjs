/**
 * kbRouter 用例（KB-ARCH P0）——库路由/配置解析/提示段装配/增强指令拼装。
 * 跑法：node --test test/kb-router.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAugmentedPrompt, knowledgePromptSection, resolveCollections, routeQuery } from '../src/modules/kb/kbRouter.mjs'
import { listFingerprintPacks, runStyleCheck } from '../src/services/style-check.mjs'

test('路由：五个意图各归其库；未知意图拒收', () => {
  assert.deepEqual(routeQuery({ intent: 'style' }).collectionIds, ['文风库'])
  assert.deepEqual(routeQuery({ intent: 'precedent' }).collectionIds, ['案例库', '套路库'])
  assert.deepEqual(routeQuery({ intent: 'signal' }).collectionIds, ['信号库'])
  assert.deepEqual(routeQuery({ intent: 'recipe' }).collectionIds, ['技法库'])
  const all = routeQuery({ genre: 'long-serial', intent: 'all' })
  assert.equal(all.collectionIds.length, 5)
  assert.equal(all.genre, 'long-serial')
  assert.equal(routeQuery({ intent: 'magic' }).ok, false)
})

test('配置：六库映射可解析；缺文件降级不抛', () => {
  const good = resolveCollections('C:/Users/Administrator/AppData/Local/PinaxNext/openstory/kb-config.json')
  assert.equal(good.ok, true)
  assert.equal(good.map['文风库'].length > 10, true)
  assert.deepEqual(routeQuery({ intent: 'style' }).collectionIds.map((alias) => good.map[alias]).filter(Boolean).length, 1)
  assert.equal(resolveCollections('Z:/nope/kb-config.json').ok, false)
})

test('提示段：按 style→recipe→precedent→signal 排序；空命中返回空串', () => {
  const hits = [
    { source: 'signal', title: '读者五铁律', text: '信号正文' },
    { source: 'precedent', title: '《流产后我不闹了》', text: '案例正文' },
    { source: 'style', title: 'style-moshi-danmu', text: '文风正文' }
  ]
  const section = knowledgePromptSection(hits)
  const order = ['【style·style-moshi-danmu】', '【案例·《流产后我不闹了》】', '【signal·读者五铁律】'].map((s) => section.indexOf(s))
  assert.ok(order[0] < order[1] && order[1] < order[2], '排序错误：' + section)
  assert.equal(knowledgePromptSection([]), '')
  assert.equal(knowledgePromptSection(null), '')
  // 裁剪生效
  const clipped = knowledgePromptSection([{ source: 'style', title: 'x', text: '啊'.repeat(3000) }], { maxChars: 100 })
  assert.ok(clipped.length < 200)
})

test('增强指令：任务＋知识块＋守卫要求三位一体', () => {
  const prompt = buildAugmentedPrompt('写一篇短篇开头', [
    { source: 'style', title: 'style-moshi-danmu', text: '【】弹幕直投' }
  ])
  assert.ok(prompt.startsWith('【写作任务】'))
  assert.ok(prompt.includes('【style·style-moshi-danmu】'))
  assert.ok(prompt.includes('不得复述原文语句'))
  const bare = buildAugmentedPrompt('只写任务', [])
  assert.ok(!bare.includes('【style'))
  assert.ok(bare.includes('【要求】'))
})

/* ---------- 指纹门禁 ---------- */

test('指纹：规格覆盖 7 个包；非法包名拒收', () => {
  assert.equal(listFingerprintPacks().length, 7)
  assert.equal(runStyleCheck('文本', 'style-none').ok, false)
})

test('指纹：弹幕样文高命中；白开水样文低命中', () => {
  const danmu = [
    '【别囤货了，末世三天就结束了，赶紧把钱转走。】',
    '【妹妹快跑，你男友就是个骗子，他联合商人坑你的。】',
    '【听我的，这米一粒都不能买，回头卖房套现才对！】',
    '1',
    '我盯着眼前亮起的弹幕，心里发毛，可细细一想，又觉得字字在理。',
    '“这米你到底买不买？”商人皱着眉催我，语气很不耐烦。',
    '我笑着摇头：“不买了，一百吨米，我们两个人吃到明年也吃不完。”',
    '男友急得跳脚：“你疯了？过了这村就没这店了！”',
    '弹幕又亮起：【他就是看上你的钱了，别理他！】',
    '2',
    '回家路上我越想越后怕，真是天大的笑话啊！',
    '“你今天到底怎么了？”男友追出来问，脸色铁青。',
    '我说没什么，只是突然不想当冤大头了。',
    '【好样的妹妹！大快人心！】',
    '【下一个建议：把房子挂出去，越快越好！】'
  ]
  const hit = runStyleCheck(danmu.join('\n'), 'style-moshi-danmu')
  assert.equal(hit.pass, true, '弹幕样文应达标：' + JSON.stringify(hit.language) + JSON.stringify(hit.structure))
  const bland = '今天天气很好，我们出门散步，看到很多有趣的事情，心情变得十分舒畅，回家之后写了一篇日记记录这一天的点点滴滴。'.repeat(10)
  const miss = runStyleCheck(bland, 'style-moshi-danmu')
  assert.equal(miss.pass, false, '白开水不应达标')
  assert.ok(miss.F < 0.6 || miss.S < 0.5)
})

test('指纹：官场长句样文 vs 极短句样文 互相区分', () => {
  const changSentence = '李修远看着墙上挂着的日历，想着自己从大一上学期开始谈恋爱，四年里打工赚生活费给女友交学费，放弃了省城国营企业的实习机会，连女友父亲住院的医药费都是跟自己父母要来的，结果对方笔试第一上岸之后就直接提了分手。'.repeat(4)
  const official = runStyleCheck('2005年3月，分手。\n' + changSentence, 'style-shangan-guanchang')
  assert.ok(official.F >= 0.6, '官场长句 F 应达标：' + JSON.stringify(official.language))
  const ultraShort = '他走了。\n我笑了。\n“再见。”\n不理。\n就这样。\n挺好。\n不哭。\n真的。\n一点。\n都不。'.repeat(8)
  const miss = runStyleCheck(ultraShort, 'style-shangan-guanchang')
  assert.equal(miss.pass, false, '极短句不应冒充官场文')
})
