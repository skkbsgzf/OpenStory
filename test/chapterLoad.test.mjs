/**
 * OS-147：正文页章节清单加载状态机——「占位必须被自己收口」的回归断言。
 *
 * 背景（作者实测卡死，2/2 复现）：正文渲染过一次之后，去设置里拨任一模块开关、再点「正文」，
 * 页面永久停在「正在读取章节…」。根因不是异常也不是 fetch 失败——首次加载先画了占位帧，
 * 收口时却只调 refreshChapterRows() 刷 `.chapter-rows`，而占位帧里根本没有这个节点，
 * 于是「成功」等于什么都没画；以前能恢复全靠别处异步加载（参考索引/图谱）顺带 render() 一次，
 * 正文进过一次之后那几条旁路都短路了，占位就永远留在屏幕上。
 *
 * 这里钉死状态机的三条契约（全部来自 public/views/chapterLoad.mjs，纯函数零 DOM）：
 *   ① 缓存命中不拉不画，调用方已摆好的页面就是终态；
 *   ② 画过占位的那次请求收口时必须 repaint=true（失败也一样——失败要如实报错，不许静默停住）；
 *   ③ 只有最新 epoch 收口：迟到的旧响应不覆盖新清单、也不清占位标志。
 *
 * 浏览器手工复现步骤仍需人跑一次（Node 里没有真 DOM）：见本工单交付说明。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CHAPTER_PHASE, beginChapterLoad, finishChapterLoad } from '../public/views/chapterLoad.mjs'

/** 与 state.write 同形的夹具（只有清单与加载标志；测试不碰磁盘）。 */
function store(chapters = 0) {
  return { chapters: Array.from({ length: chapters }, (_, i) => ({ file: `正文/00${i + 1}.md` })), listLoading: false }
}

test('OS-147 缓存命中：不拉、不画占位，页面已由调用方 render（终态）', () => {
  const write = store(3)
  const step = beginChapterLoad(write, { force: false, hasChapters: write.chapters.length > 0 })
  assert.equal(step.fetch, false)
  assert.equal(step.paint, false)
  assert.equal(write.epoch, undefined, '缓存命中不该领号，也不该改动 store')
  assert.equal(write.painted, undefined, '缓存命中不该留下占位标志')
})

test('OS-147 空清单首进：画占位，收口必须整页重画（正是卡死的那一步）', () => {
  const write = store(0)
  const step = beginChapterLoad(write, { force: false, hasChapters: false })
  assert.deepEqual({ fetch: step.fetch, paint: step.paint }, { fetch: true, paint: true })
  assert.equal(write.phase, CHAPTER_PHASE.loading)
  assert.equal(write.painted, true)

  const done = finishChapterLoad(write, step.epoch, { ok: true })
  assert.equal(done.apply, true)
  assert.equal(done.repaint, true, '占位帧里没有 .chapter-rows，只刷行等于不刷——必须整页重画')
  assert.equal(done.phase, CHAPTER_PHASE.ready)
  assert.equal(write.painted, false, '收口后不许遗留占位标志（否则下一次会误判）')
})

test('OS-147 加载失败：同样整页重画（如实报错，不许永久占位）', () => {
  const write = store(0)
  const step = beginChapterLoad(write, { hasChapters: false })
  const done = finishChapterLoad(write, step.epoch, { ok: false })
  assert.equal(done.apply, true)
  assert.equal(done.repaint, true)
  assert.equal(done.phase, CHAPTER_PHASE.failed)
  assert.equal(write.painted, false)
})

test('OS-147 有清单 + force：照常拉，但不画占位、只刷左栏行（不动纸面/光标）', () => {
  const write = store(2)
  const step = beginChapterLoad(write, { force: true, hasChapters: true })
  assert.deepEqual({ fetch: step.fetch, paint: step.paint }, { fetch: true, paint: false })
  const done = finishChapterLoad(write, step.epoch, { ok: true })
  assert.equal(done.apply, true)
  assert.equal(done.repaint, false, '没画过占位就该走局部刷新，别整页重绘')
})

test('OS-147 重入：两个请求接连发起，只有最新那次收口（旧响应不覆盖清单）', () => {
  const write = store(0)
  const first = beginChapterLoad(write, { hasChapters: false })
  const second = beginChapterLoad(write, { hasChapters: false })
  assert.ok(second.epoch > first.epoch)

  const lateFirst = finishChapterLoad(write, first.epoch, { ok: true })
  assert.equal(lateFirst.apply, false, '迟到的旧响应不许写清单')
  assert.equal(lateFirst.repaint, false, '占位由最新那次负责换掉')

  const done = finishChapterLoad(write, second.epoch, { ok: true })
  assert.equal(done.apply, true)
  assert.equal(done.repaint, true, '占位标志要撑到最新那次收口，不能被旧响应提前清掉')
  assert.equal(write.painted, false)
})

test('OS-147 最新那次先回、旧响应后到：旧响应不得把界面按回旧态', () => {
  const write = store(0)
  const first = beginChapterLoad(write, { hasChapters: false })
  const second = beginChapterLoad(write, { hasChapters: false })
  const done = finishChapterLoad(write, second.epoch, { ok: true })
  assert.equal(done.repaint, true)
  const lateFirst = finishChapterLoad(write, first.epoch, { ok: false })
  assert.deepEqual({ apply: lateFirst.apply, repaint: lateFirst.repaint }, { apply: false, repaint: false })
  assert.equal(write.phase, CHAPTER_PHASE.ready, '旧响应的失败不许把阶段打回 failed')
})

test('OS-147 换库：state.write 整体换新对象后，旧库的迟到响应自动作废', () => {
  const oldStore = store(0)
  const step = beginChapterLoad(oldStore, { hasChapters: false })
  const newStore = store(0) // openLibrary 的写法：state.write = { chapters: [], listLoading: false }
  const done = finishChapterLoad(newStore, step.epoch, { ok: true })
  assert.deepEqual({ apply: done.apply, repaint: done.repaint }, { apply: false, repaint: false })
  assert.equal(newStore.listLoading, false, '新库的界面状态不能被上一个库的请求改动')
})

test('OS-147 终态不变量：任意 begin→finish 组合结束后都不留占位标志', () => {
  const sequences = [
    [true],
    [false],
    [false, false],
    [false, true],
    [true, false],
    [true, true]
  ]
  for (const oks of sequences) {
    const write = store(0)
    const epochs = oks.map(() => beginChapterLoad(write, { hasChapters: false }).epoch)
    oks.forEach((ok, index) => finishChapterLoad(write, epochs[index], { ok }))
    assert.equal(write.painted, false, `序列 ${JSON.stringify(oks)} 收口后仍在占位`)
    assert.ok([CHAPTER_PHASE.ready, CHAPTER_PHASE.failed].includes(write.phase), `序列 ${JSON.stringify(oks)} 没进终态`)
  }
})
