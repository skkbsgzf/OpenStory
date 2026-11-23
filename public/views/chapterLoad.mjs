/**
 * 正文页「章节清单」加载状态机（OS-147）——纯函数，零 import、零 DOM。
 *
 * 为什么要有它（作者实测的卡死）：
 *   首次进正文时会先画一帧 `<div class="loading">正在读取章节…</div>`，加载完成后
 *   却只调 refreshChapterRows() 去刷 `.chapter-rows`——占位帧里根本没有这个节点，
 *   于是**没有任何重绘**。页面能不能恢复，完全取决于别处异步加载（参考索引/图谱）
 *   碰巧再 render() 一次；而正文渲染过一次之后那几条旁路都短路了，占位就永久留在屏幕上
 *   （不报错、不 reject、fetch 也没失败，刷新才恢复）。
 *
 * 本文件把「要不要发请求 / 要不要先画占位 / 谁负责收口」从 UI 里抽出来，三条判据：
 *   ① 缓存命中（有清单且非 force）＝不拉、不画占位；调用方已经把页面摆好了（终态）。
 *   ② 每次真正发请求都领一个 epoch；**只有最新的 epoch 负责收口**，旧响应不覆盖新清单，
 *      也不清占位标志——迟到的响应不能把界面按回旧态。
 *   ③ 画过占位的请求收口时必须整页重画（repaint=true）；没画过占位的只刷左栏行。
 *
 * store 就是 `state.write` 本身（`{ chapters, listLoading }`），epoch/painted/phase
 * 三个键由本文件惰性补上——换库时 state.write 被整体重置，序号跟着归零，行为正确。
 */

/** 加载阶段（只为可读性与断言，UI 只认 listLoading）。 */
export const CHAPTER_PHASE = Object.freeze({
  idle: 'idle',
  loading: 'loading',
  ready: 'ready',
  failed: 'failed'
})

const num = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0)

/**
 * 领取一次加载：要不要发请求、要不要先画占位。
 * @param {object} store                       state.write（会被就地补 epoch/painted/phase）
 * @param {{force?:boolean, hasChapters?:boolean}} [options]
 * @returns {{fetch:boolean, paint:boolean, epoch:number}} fetch=false ＝ 缓存命中，本次不拉
 */
export function beginChapterLoad(store, { force = false, hasChapters = false } = {}) {
  const epoch = num(store.epoch)
  if (!force && hasChapters) return { fetch: false, paint: false, epoch }
  store.epoch = epoch + 1
  store.phase = CHAPTER_PHASE.loading
  // 只有「清单空」才会出现占位帧（writeHtml 只在 chapters 为空时走 listLoading 分支）
  const paint = !hasChapters
  if (paint) store.painted = true
  return { fetch: true, paint, epoch: store.epoch }
}

/**
 * 收口一次加载：这次结果算不算数、收口后要不要整页重画。
 * @param {object} store      state.write（换库后被重置过也算数——epoch 对不上即判迟到的旧响应）
 * @param {number} epoch      beginChapterLoad 给的号
 * @param {{ok?:boolean}} [options] ok=false ＝ 请求失败（清单不变，错误由调用方如实上报）
 * @returns {{apply:boolean, repaint:boolean, phase:string}}
 */
export function finishChapterLoad(store, epoch, { ok = true } = {}) {
  // 迟到/跨库的旧响应：不覆盖清单、不清占位（最新那次会收口），只回报「你别动」
  if (epoch !== num(store.epoch)) return { apply: false, repaint: false, phase: store.phase ?? CHAPTER_PHASE.idle }
  const repaint = store.painted === true
  store.painted = false
  store.phase = ok ? CHAPTER_PHASE.ready : CHAPTER_PHASE.failed
  return { apply: true, repaint, phase: store.phase }
}
