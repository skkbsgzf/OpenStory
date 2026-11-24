/**
 * OpenStory 协议层 · 章节号解析（纯函数，不落盘）。
 *
 * OS-157 上移：此前由 `src/modules/library/textUtil.mjs` 持有、经内核唯一进口转供，
 * 协议层的 chapters.mjs 为一个纯函数永远绕道模块层。今上移到协议层，textUtil 与
 * chapters 都从这里取（模块内与协议层的装载序不再经过任何转供件）。
 * 函数体逐字未动；谱系与出处见 docs/kernel-provenance.md。
 */

/** 中文数字表（「两」归一为 2；零到九）。 */
const CHINESE_DIGITS = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 两: 2 }

/** 中文数字 → 阿拉伯数字（支持到千位；认不出返回 null，不猜）。 */
export function parseChapterNumber(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (/^\d+$/u.test(text)) return Number(text)
  if (!/^[零一二三四五六七八九十百千两]+$/u.test(text)) return null
  const unit = { 十: 10, 百: 100, 千: 1000 }
  let total = 0
  let current = 0
  for (const char of text) {
    if (CHINESE_DIGITS[char] !== undefined) current = CHINESE_DIGITS[char]
    else if (unit[char]) { total += (current || 1) * unit[char]; current = 0 }
    else return null
  }
  return total + current
}
