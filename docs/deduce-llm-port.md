# 推演 llmPort 接口（OS-155 显式化）

> 谁在管：`src/modules/deduce/deduceEngine.mjs`（封装层做形状校验）＋
> `src/modules/deduce/engine/candidates.mjs`（引擎真正的调用点）。
> 为什么单独成文：旧口径是「有就给、没就空数组」的**隐式可选副作用**——端口形状没有任何
> 文档与测试约束，宿主换实现只能靠读源码猜。本文明确定义两种合法形状、坏形状的处置，
> 并由 `test/deduceDeterminism.test.mjs` 钉死（三种形态各一条用例）。

## 规范形状（推荐）

```js
const llmPort = {
  /**
   * @param {{ prompt: string, refs: string[] }} input
   *   prompt —— 引擎给的完整提示（含 DEDUCE_DRAMA_SYSTEM_PROMPT、拍序、事实包简报、开头锚定）；
   *   refs   —— 本拍允许引用的实体名（当前引擎传空数组；保留给按实体裁剪上下文的实现）。
   * @returns {Promise<Array<{ text: string, refs?: string[] }> | null>}
   *   数组     —— 每条 `text` 是「我现在怎么做」的第一人称行动选项；`refs` 只能引用已有实体。
   *   null     —— 本拍不给戏剧候选（合法返回，不是错误）。
   */
  async propose({ prompt, refs }) {
    return [{ text: '我现在上前一步搭话', refs: [] }]
  }
}
```

`refs` 里的名字必须是事实包里存在的实体；引擎仍会做两道筛（世界级：实体存在；视角级：
POV 此刻知晓），越界候选被丢弃——端口不需要自己维护这份账本。

## 兼容形状（宿主历史实现）

```js
const llmPort = {
  // 引擎原生的底层形状：返回原始文本，引擎自己从文本里抠 JSON。
  async complete({ system, maxTokens }) {
    return { text: '{"proposals":[{"text":"…","refs":[]}]}' }
  }
}
```

`src/api/handlers/fact.mjs` 的 `buildDeduceLlmPort` 今天给的就是这一种（把活动运行时包成
`complete`）。封装层识别到 `complete` 后**原样转发**，行为与 OS-155 之前逐字相同。

## 校验与降级（封装层 `normalizeLlmPort`）

| 端口形态 | 处置 | 依据 |
|---|---|---|
| `null` / `undefined` / 非对象 | 不给引擎端口——必然▮与命运⚙照常跑，戏剧✦缺席 | 没配模型是常态，推演不能被模型不可用卡死 |
| 有 `complete` 函数 | 原样转发（历史形状），不额外校验返回值 | 行为零变化（宿主现状） |
| 有 `propose` 函数 | 调 `propose({ prompt, refs: [] })`；结果按下表校验 | 规范形状 |
| 两种都没有 | 视为 `null`，响应带 `llmPortNote` | 坏实现不炸拍 |

`propose` 返回值的校验：

| 返回 | 处置 |
|---|---|
| `null` / `undefined` | 本拍无戏剧候选（**合法**，不记 note） |
| 非数组（如数字/字符串/对象） | 视为 `null`；`llmPortNote` 记「返回值不是数组」 |
| 数组里有条目缺 `text`（空串/非字符串） | 该条丢弃；`llmPortNote` 记「有条目形状坏」 |
| 数组里有合法条目 | 转成引擎可解析的 proposals，照常进候选池 |
| `propose` 抛错 | 本拍无戏剧候选；`llmPortNote` 记错误消息 |

「不炸」是硬承诺：任何端口问题只影响本拍戏剧候选的多少，`deducePresent` 仍返回
`{ ok: true, … }`，且**不写日志、不落库**——`llmPortNote` 只是本次响应里的如实说明，
前端可忽略。同种子同事实包下，端口缺席与端口坏形状产出的「必然＋命运」两层完全一致
（确定性测试覆盖）。

## 预算语义（未改）

戏剧候选每次尝试消耗 1 点 AI 预算（`spendAi`，状态里的 `aiActionsLeft`）。预算耗尽后
`propose`/`complete` 都不会被调用——这一点 OS-155 未改动，端口实现不应假设每拍必被调用。
