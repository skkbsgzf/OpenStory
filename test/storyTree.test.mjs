/**
 * OS-61 P3 剧情树布局用例（node:test）——只测纯函数，不测 DOM。
 *   node --test test/storyTree.test.mjs
 * mountStoryTree 的 SVG 渲染/交互归浏览器，这里验布局算法的形状与边界。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutStoryTree, storyNodeLabel, STORY_TREE_DEFAULTS } from '../public/storyTree.mjs'

const { colGap, padX } = STORY_TREE_DEFAULTS

function node(id, round, extra = {}) {
  return { id, round, branchId: 'main', parentId: '', choiceId: '', prose: '', candidates: [], ...extra }
}

function session(nodes, extra = {}) {
  return { schema: 'openstory.deduce-session/v1', branchId: 'main', cursor: nodes.length, nodes, ...extra }
}

test('布局：单分支三拍——x 随拍号递增、同一泳道 y 相同、父→子边齐全', () => {
  const layout = layoutStoryTree(session([
    node('n1', 1, { prose: '雾起了。他走上渡船。' }),
    node('n2', 2, { parentId: 'n1', prose: '船到江心。' }),
    node('n3', 3, { parentId: 'n2', prose: '雾里有人喊他。' })
  ]))
  assert.equal(layout.nodes.length, 3)
  assert.equal(layout.lanes.length, 1)
  assert.equal(layout.lanes[0].branchId, 'main')
  const [a, b, c] = layout.nodes
  assert.equal(a.x, padX)
  assert.equal(b.x, padX + colGap)
  assert.equal(c.x, padX + 2 * colGap)
  assert.equal(a.y, b.y, '同泳道不叠放时 y 相同')
  assert.equal(b.y, c.y)
  assert.ok(b.x > a.x && c.x > b.x, '横轴＝拍号')
  assert.deepEqual(layout.edges.map((edge) => [edge.from, edge.to, edge.fork]), [
    ['n1', 'n2', false],
    ['n2', 'n3', false]
  ])
  assert.ok(layout.width > 0 && layout.height > 0)
})

test('布局：孤立节点（无父／父不存在）不报错，照样落位', () => {
  const layout = layoutStoryTree(session([
    node('solo', 1),
    node('ghost-child', 2, { parentId: '不存在的父' }),
    node('self-loop', 3, { parentId: 'self-loop' })
  ]))
  assert.equal(layout.nodes.length, 3)
  assert.deepEqual(layout.edges, [], '找不到父就不画边，不抛错')
  for (const item of layout.nodes) {
    assert.ok(Number.isFinite(item.x) && Number.isFinite(item.y))
  }
})

test('布局：多分支泳道数正确——主线永远第一条，各占一条泳道', () => {
  const layout = layoutStoryTree(session([
    node('b2-1', 3, { branchId: 'branch-2' }),
    node('m1', 1),
    node('b3-1', 3, { branchId: 'branch-3' }),
    node('m2', 2, { parentId: 'm1' }),
    node('b2-2', 4, { branchId: 'branch-2', parentId: 'b2-1' })
  ], { branchId: 'branch-2', cursor: 4 }))
  assert.equal(layout.lanes.length, 3)
  assert.deepEqual(layout.lanes.map((lane) => lane.branchId), ['main', 'branch-2', 'branch-3'])
  assert.deepEqual(layout.lanes.map((lane) => lane.count), [2, 2, 1])
  const laneOf = Object.fromEntries(layout.nodes.map((item) => [item.id, item.lane]))
  assert.equal(laneOf.m1, 0)
  assert.equal(laneOf['b2-1'], 1)
  assert.equal(laneOf['b3-1'], 2)
  const yOf = Object.fromEntries(layout.nodes.map((item) => [item.id, item.y]))
  assert.notEqual(yOf.m1, yOf['b2-1'], '不同分支不同泳道')
  assert.notEqual(yOf['b2-1'], yOf['b3-1'])
  assert.ok(layout.lanes[1].top >= layout.lanes[0].top + layout.lanes[0].height, '泳道不重叠')
  // 当前节点＝当前分支 cursor 所在拍
  const current = layout.nodes.filter((item) => item.current)
  assert.equal(current.length, 1)
  assert.equal(current[0].id, 'b2-2')
})

test('布局：空会话返回空布局（null／缺 nodes／空数组都不抛）', () => {
  for (const input of [null, undefined, {}, { nodes: [] }, { nodes: null }, '坏形状']) {
    const layout = layoutStoryTree(input)
    assert.deepEqual(layout.nodes, [])
    assert.deepEqual(layout.edges, [])
    assert.deepEqual(layout.lanes, [])
    assert.equal(layout.width, 0)
    assert.equal(layout.height, 0)
  }
})

test('布局：同分支同拍号叠放——y 错开不重叠，泳道高度撑开', () => {
  const layout = layoutStoryTree(session([
    node('a', 2),
    node('b', 2),
    node('c', 2),
    node('d', 3)
  ]))
  const [a, b, c] = layout.nodes
  assert.equal(a.x, b.x, '同拍号同一横坐标')
  assert.ok(b.y > a.y && c.y > b.y, '叠放纵向错开')
  assert.ok(b.y - a.y >= 40, '间距够放标签')
  const single = layoutStoryTree(session([node('only', 1)]))
  assert.ok(layout.lanes[0].height > single.lanes[0].height, '叠放多的泳道更高')
})

test('布局：分叉溯源——forkBranchIds 给新分支首拍补虚线边，有父边不重复补', () => {
  const layout = layoutStoryTree(session([
    node('m1', 1),
    node('m2', 2, { parentId: 'm1', forkBranchIds: ['branch-2'] }),
    node('m3', 3, { parentId: 'm2' }),
    node('b2-1', 3, { branchId: 'branch-2' }),
    node('b2-2', 4, { branchId: 'branch-2', parentId: 'b2-1' })
  ], { branchId: 'branch-2', cursor: 4 }))
  const forkEdges = layout.edges.filter((edge) => edge.fork)
  assert.deepEqual(forkEdges.map((edge) => [edge.from, edge.to]), [['m2', 'b2-1']])
  const intoB2 = layout.edges.filter((edge) => edge.to === 'b2-1')
  assert.equal(intoB2.length, 1, '分叉边只补一条')
  // 新分支首拍已有 parentId 时不再补分叉边
  const linked = layoutStoryTree(session([
    node('m1', 1, { forkBranchIds: ['branch-2'] }),
    node('b2-1', 2, { branchId: 'branch-2', parentId: 'm1' })
  ]))
  assert.equal(linked.edges.filter((edge) => edge.fork).length, 0)
  assert.deepEqual(linked.edges.map((edge) => [edge.from, edge.to]), [['m1', 'b2-1']])
})

test('标签：正文首句截断；没正文退候选；都没有退「第N拍」', () => {
  assert.equal(storyNodeLabel(node('x', 1, { prose: '雾起了。他走上渡船，桨声惊起一只夜鹭。' })), '雾起了')
  const long = storyNodeLabel(node('x', 1, { prose: '这是一句特别长的没有标点的话一直写下去' }), 8)
  assert.equal(long, '这是一句特别长的…')
  assert.equal(storyNodeLabel(node('x', 5, { choiceId: 'c1', candidates: [{ id: 'c0', text: '别的候选' }, { id: 'c1', text: '他决定夜渡。' }] })), '他决定夜渡')
  assert.equal(storyNodeLabel(node('x', 7)), '第7拍')
})