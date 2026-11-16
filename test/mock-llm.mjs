/**
 * 端到端 mock LLM：按 prompt 里的「窗口名」路由返回对应的合法 JSON。
 *
 * 用途：验证 daemon 的 enrichRun → enrichEngine → writeFactFile → enrichGraph 全链接线，
 * 不消耗真实 token。路由靠 prompt 关键词（每个窗的 prompt 都有独特标识）。
 */
import http from 'node:http'

const CHAPTERS = {
  chapters: [
    { chapter: 1, title: '弹幕预警', summary: '沈岚看到弹幕预警末世将至，林逸不信并让她别囤货。', function: '建立', emotion: '疑', beats: 3, foreshadows: ['弹幕预言逐条应验'], excerpt: { beat: '弹幕浮现', quote: '末世只剩三天。' } },
    { chapter: 2, title: '反向设局', summary: '沈岚识破林逸与顾茵合谋骗贷，决定反向设局引导他卖房买米。', function: '对峙', emotion: '燃', beats: 4, foreshadows: ['卖房合同的法律效力'], excerpt: { beat: '诱导签约', quote: '房子换成米，稳赚。' } },
    { chapter: 3, title: '合同收网', summary: '房产过户完成，沈岚携合同脱身，林逸带着米进仓等待末世。', function: '揭露', emotion: '爽', beats: 4, foreshadows: [], excerpt: { beat: '出示合同', quote: '白纸黑字。' } }
  ]
}
const CHARACTER = {
  chapters: [{ chapter: 1, choice: '不信弹幕反囤货' }, { chapter: 3, choice: '出示合同收网' }],
  identity: '反向设局的清醒者',
  archetype: '觉醒者',
  goal: '识破骗局并保全资产',
  personality: ['冷静', '果断'],
  arc: { start: '被劝阻囤货的怀疑者', end: '用合同完成收网的胜利者', turnChapter: 2, evidence: '第2节决定反向设局' },
  keyChoices: [{ chapter: 2, choice: '反向设局引导卖房' }],
  needs: [
    { level: 2, need: '安全', object: '资产与住所', fear: '被骗光一无所有', cost: '与男友决裂', evidence: '第1节看到弹幕即开始防备' },
    { level: 5, need: '自我实现', object: '买房独立', fear: '永远依附他人', cost: '放弃恋情', evidence: '第3节携合同脱离' }
  ],
  mirror: '林逸：盲信者与清醒者的镜像',
  summary: '沈岚靠弹幕预警识破骗局，反向设局完成收网。'
}
const CAUSAL = {
  nodes: [
    { chapter: 1, event: '弹幕预警', kind: 'revelation' },
    { chapter: 2, event: '反向设局', kind: 'decision' },
    { chapter: 3, event: '合同收网', kind: 'action' }
  ],
  edges: [
    { fromChapter: 1, toChapter: 2, type: 'trigger', strength: 1, evidence: '预警触发设局' },
    { fromChapter: 2, toChapter: 3, type: 'cause', strength: 0.9, evidence: '设局导致收网' }
  ],
  threads: [
    { name: '反杀主线', chapters: [1, 2, 3], closed: true },
    { name: '感情线', chapters: [1, 2], closed: false }
  ]
}
const WORLDELEMENTS = {
  scenes: [{ name: '超市', chapters: [1], desc: '弹幕首次出现的地方' }, { name: '仓库', chapters: [3], desc: '林逸囤米翻车现场' }],
  items: [{ name: '静音耳塞', chapters: [1], holder: '沈岚', desc: '预警的起点' }, { name: '购房合同', chapters: [2, 3], holder: '沈岚', desc: '收网凭证' }]
}
const LEDGER = {
  knowledgeLedger: [{ character: '沈岚', knows: '末世将至且林逸在骗她', chapter: 1 }],
  stateLedger: [{ object: '房产', state: '已过户到沈岚名下', chapter: 3 }]
}

function route(prompt) {
  if (prompt.includes('章节拆解器')) return JSON.stringify(CHAPTERS)
  if (prompt.includes('因果图构建器')) return JSON.stringify(CAUSAL)
  if (prompt.includes('人物拆解器')) return JSON.stringify(CHARACTER)
  if (prompt.includes('世界要素登记员')) return JSON.stringify(WORLDELEMENTS)
  if (prompt.includes('状态台账登记员')) return JSON.stringify(LEDGER)
  if (prompt.includes('槽位 gimmick')) return JSON.stringify({ logline: '末世三天，她靠弹幕反杀囤货的男友。', elements: ['末世倒计时', '弹幕互动', '反向设局'], empathy: '识破谎言的自证快感', coolPoint: '信息差碾压', emotionPromise: '爽——冷静碾压无脑', confidence: 'inferred' })
  if (prompt.includes('plot-design')) return JSON.stringify({ structure: { picked: '逆袭升级', evidence: '第1节受骗到第3节收网', confidence: 'inferred' }, mainline: '预警→设局→收网', subplot: '', stages: [{ phase: '受骗', chapters: [1, 1], job: '建立' }, { phase: '设局', chapters: [2, 2], job: '对峙' }, { phase: '收网', chapters: [3, 3], job: '揭露' }], turningPoints: [{ chapter: 2, event: '决定反向设局' }] })
  if (prompt.includes('导语设计')) return JSON.stringify({ entry: '弹幕预警切入', hookType: '悬念+反常', firstBeat: '看到末世预警', expectation: '她怎么应对', confidence: 'fact' })
  if (prompt.includes('文风拆解器')) return JSON.stringify({ density: '高潮放慢', sentence: '短句为主', pov: '第一人称跟随沈岚', dialogue: '短促', action: '动作代心理', character: '标签化', environment: '情绪容器', transition: '果断', ending: '钩子收束', rules: ['短句推进', '弹幕插入打断'] })
  if (prompt.includes('小说梗概器')) return JSON.stringify({ storySummary: '沈岚靠弹幕预警识破骗局，反向设局后收网。', arc: [{ phase: '预警', chapters: [1, 1], text: '弹幕预警' }] })
  // 叙述者探针等未知窗：给空 narrator
  return JSON.stringify({ narrator: '' })
}

const calls = []
http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    calls.push(body.length)
    let prompt = ''
    try { prompt = JSON.parse(body).messages?.[0]?.content ?? '' } catch { }
    const out = route(prompt)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: out }, finish_reason: 'stop' }] }))
  })
}).listen(8999, () => console.log('mock llm on 8999'))

process.on('SIGTERM', () => process.exit(0))
