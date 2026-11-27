/**
 * 剧本原生渲染（OS-75 前端入口 · OS-214 起转发到服务端真源）。
 *
 * 真源已下沉到 `src/modules/script/scriptParse.mjs`：解析/渲染/字数统计全是纯函数
 * （无 state、无 DOM），因此浏览器与 daemon 共用同一份——服务端互转端点
 * `POST /api/script/to-fact` 必须与前端解析出同样的幕/场景/台词，否则「双向不丢信息」
 * 就是空的。这里只做 re-export。
 */

export {
  classifyScriptLine,
  parseScript,
  renderScriptBlock,
  renderScriptBody,
  scriptStats,
  splitScriptBlocks
} from '../src/modules/script/scriptParse.mjs'
