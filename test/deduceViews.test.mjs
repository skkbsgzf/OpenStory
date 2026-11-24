/**
 * 扮演纯视图金样测试（OS-164）：固定夹具 → 固定 HTML；纯度（零 import/DOM/存储）；
 * app.js 薄壳测试。状态机/打字机/定时器留宿主，不在本测试范围。内存夹具，不碰真库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deduceTreePickHtml, deduceTreeHtml, dedPackHtml, deducePrologueHtml,
  fateHumanFromLegacy, deduceTurnLineHtml, deducePendingFactHtml, deduceProseMsgHtml,
  deduceWhoChipsHtml, deducePendingHtml, deduceSideHtml, deduceAgentHtml
} from '../public/views/deduceViews.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
function esc(value) { return String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;') }
function text(value) { return String(value ?? '') }

test('剧情树：选中提示与树视图金样', () => {
  const engine = { session: { nodes: [{ id: 'n1', round: 2, branchId: 'main' }, { id: 'n2', round: 1, branchId: 'b1' }] }, treePick: 'n1', turnBusy: false }
  const pick = deduceTreePickHtml({ engine, esc })
  assert.match(pick, /选中：第 2 拍 · 主线/u)
  assert.match(pick, /data-action="deduce-tree-branch"/u)
  assert.equal(pick, deduceTreePickHtml({ engine, esc }))
  const tree = deduceTreeHtml({ engine, esc, pickHtml: pick })
  assert.match(tree, /共 2 拍 · 2 条分支/u)
  assert.match(tree, /id="deduce-tree-host"/u)
  assert.equal(deduceTreePickHtml({ engine: {}, esc }), '')
})

test('事实包健康度：缺口如实标 gap，齐全标 ok', () => {
  const html = dedPackHtml({ data: { sceneCard: { who: ['a', 'b'], where: '山神庙', hook: '雪' }, fronts: [{}], candidates: [{ source: '必然' }] }, esc })
  assert.match(html, /1 条在走/u)
  assert.equal((html.match(/ded-pack-row ok/gu) || []).length, 5)
  const thin = dedPackHtml({ data: { candidates: [{ source: '命运' }] }, esc })
  assert.match(thin, /只有命运骰/u)
  assert.equal(thin, dedPackHtml({ data: { candidates: [{ source: '命运' }] }, esc }))
})

test('序章：身份/场景/前情三段金样，收起态默认不渲染正文', () => {
  const narrative = {
    identity: { name: '林砚', archetype: '教头', identity: '禁军教头', goal: '复仇', personality: ['隐忍'] },
    scene: { text: '风雪山神庙', others: [{ name: '鲁达' }], where: '山神庙' },
    recap: { story: '八十万禁军教头被陷害。', soFar: [{ chapter: 1, title: '夜', summary: '起因' }], recent: [{ round: 2, excerpt: '推门' }] },
    missing: []
  }
  const closed = deducePrologueHtml({ narrative, recapOpen: false, esc })
  assert.match(closed, /你扮演 <b>林砚<\/b>/u)
  assert.match(closed, /▸ 前情提要/u)
  assert.doesNotMatch(closed, /八十万禁军教头被陷害/u)
  const open = deducePrologueHtml({ narrative, recapOpen: true, esc })
  assert.match(open, /第1章 夜/u)
  assert.match(open, /第2拍/u)
  assert.equal(open, deducePrologueHtml({ narrative, recapOpen: true, esc }))
})

test('命运骰人话：旧黑话翻人话，新文案原样', () => {
  const chosen = { id: 'c1', text: '剧情检定 2d6=3+2=5：顺遂' }
  assert.match(fateHumanFromLegacy(chosen, { text }), /世界不拦你/u)
  assert.match(fateHumanFromLegacy({ text: '剧情检定 2d6=1+1=2：受阻' }, { text }), /世界设了坎/u)
  assert.equal(fateHumanFromLegacy({ text: '已经是人话' }, { text }), '')
  const line = deduceTurnLineHtml({ choiceId: 'c1', candidates: [chosen] }, { esc, text })
  assert.match(line, /fl-you-text/u)
  assert.equal(deduceTurnLineHtml({ candidates: [] }, { esc, text }), '')
})

test('事实待确认卡：裁定来源与两条动作按钮', () => {
  const html = deducePendingFactHtml({ id: 'p1', round: 3, decidedBy: 'author', entry: { layer: 'plot', name: '伏笔', definition: '一封密信' } }, { esc, text })
  assert.match(html, /作者裁定/u)
  assert.match(html, /data-action="deduce-pending-write"/u)
  assert.match(html, /data-action="deduce-pending-dismiss"/u)
  assert.equal(html, deducePendingFactHtml({ id: 'p1', round: 3, decidedBy: 'author', entry: { layer: 'plot', name: '伏笔', definition: '一封密信' } }, { esc, text }))
})

test('本拍正文：历史拍静态回放 / 最新拍打字机槽与编辑态', () => {
  const history = deduceProseMsgHtml({ round: 1, prose: '推开庙门。', beats: [{ name: '林砚', text: '冷。' }] }, false, { esc, text })
  assert.match(history, /推开庙门/u)
  assert.match(history, /林砚/u)
  const live = deduceProseMsgHtml({ round: 2 }, true, { engine: { draft: { prose: '风雪压城' } }, esc, text })
  assert.match(live, /id="deduce-dialog-text" data-stage-text="风雪压城"/u)
  const editing = deduceProseMsgHtml({ round: 2 }, true, { engine: { draft: { prose: '草稿' }, draftEdit: true, turnBusy: false }, esc, text })
  assert.match(editing, /id="deduce-draft"/u)
  assert.match(editing, /data-action="deduce-promote-flow"/u)
})

test('在场头像：无人空态 + 首字色块 + 资产图注入', () => {
  assert.match(deduceWhoChipsHtml([], { esc }), /这一拍无人在场/u)
  const fallback = deduceWhoChipsHtml(['林冲'], { esc })
  assert.match(fallback, /林/u)
  const withAsset = deduceWhoChipsHtml(['林冲'], { esc, assets: { characters: [{ name: '林冲', file: 'a.png' }] }, dedAssetUrl: (a) => `/asset/${a.file}` })
  assert.match(withAsset, /src="\/asset\/a.png"/u)
})

test('待决回合：空候选兜底三条（修掉原 who/where 后置声明的 TDZ）', async () => {
  const data = { round: 4, pov: '林砚', sceneCard: { who: ['鲁达'], where: '山神庙', hook: '林砚该动手了' }, candidates: [] }
  const html = deducePendingHtml(data, { engine: {}, esc, text, whoChipsHtml: (list) => deduceWhoChipsHtml(list, { esc }) })
  assert.match(html, /data-action="deduce-engine-choose"/u)
  assert.match(html, /data-candidate-id="fallback-talk"/u, '兜底候选落到按钮 id 上')
  assert.match(html, /我在山神庙里再仔细看一圈/u)
  assert.match(html, /我开口对鲁达说点什么/u)
  const withCand = deducePendingHtml({ ...data, candidates: [{ id: 'c1', source: '命运', text: '掷骰' }, { id: 'c2', source: '戏剧', text: '追出去' }] }, { engine: {}, esc, text })
  assert.doesNotMatch(withCand, /掷骰/u, '命运不进玩家选项')
  assert.match(withCand, /追出去/u)
})

test('已知信息牌与 Agent 表单：分区金样', () => {
  const data = { narrative: { identity: { name: '林砚' }, scene: { others: [{ name: '鲁达' }], where: '山神庙' }, recap: { story: '前情' } }, fronts: [{ name: '追兵', filled: 1, max: 4 }] }
  const side = deduceSideHtml(data, { esc })
  assert.match(side, /你扮演/u)
  assert.match(side, /在你面前/u)
  assert.match(side, /width:25%/u)
  assert.equal(side, deduceSideHtml(data, { esc }))
  const agent = deduceAgentHtml({ deduce: { premise: '设定', variables: '变量', question: '问题', reply: '回答' }, configured: true, esc })
  assert.match(agent, /data-action="deduce-start"/u)
  assert.match(agent, /转为待确认卡/u)
  assert.doesNotMatch(agent, /先在右上角设置里配好模型端点/u)
})

test('纯度：deduceViews 零 import/DOM/存储；app.js 十二个函数只留薄壳', () => {
  const src = readFileSync(join(REPO, 'public/views/deduceViews.mjs'), 'utf-8')
  assert.doesNotMatch(src, /\bimport\s*\(/u)
  assert.doesNotMatch(src, /^\s*import\s/u)
  assert.doesNotMatch(src, /document|window|localStorage|sessionStorage|indexedDB/u)
  const app = readFileSync(join(REPO, 'public/app.js'), 'utf-8')
  const names = ['deduceTreePickHtml', 'deduceTreeHtml', 'dedPackHtml', 'deducePrologueHtml', 'fateHumanFromLegacy',
    'deduceTurnLineHtml', 'deducePendingFactHtml', 'deduceProseMsgHtml', 'deduceWhoChipsHtml',
    'deducePendingHtml', 'deduceSideHtml', 'deduceAgentHtml']
  for (const name of names) {
    const start = app.indexOf(`function ${name}(`)
    assert.ok(start >= 0, `${name} 薄壳应在 app.js`)
    const open = app.indexOf('{', start)
    let depth = 0; let close = open
    for (; close < app.length; close++) {
      if (app[close] === '{') depth++
      else if (app[close] === '}' && --depth === 0) break
    }
    const body = app.slice(open + 1, close)
    assert.ok(body.length < 700, `${name} 应是薄壳（<700），实际 ${body.length}`)
    assert.match(body, /deduceViews\./u, `${name} 必须转交 views`)
  }
})
