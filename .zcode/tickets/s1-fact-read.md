# 工单 S1：Fact 读接口层（故事源的数据底座）

## 背景
OpenStory 的 fact 真源在 `拆解/<bookId>.json`（entries + 兄弟 wiki），内核 `core/pinax/next/kernel/factFileStore.mjs` 读能力完备，但 **daemon 没有暴露条目级读端点**——前端只能拿到章级摘要（`/api/fact/curve`），拿不到条目本体、溯源、按层筛选。

故事源页要替代现在的「拆解」只读倾倒板，必须有这份数据。

## 任务

### 1. 新增两个只读端点（contracts.mjs + daemon.mjs）

```js
factEntriesGet: {
  method: 'GET',
  path: '/api/fact/entries',
  // 条目查询：按 bookId/layer/q 过滤，分页。给故事源三形态共用。
  request: { query: { root: 'string', bookId: 'string?', layer: 'string?', q: 'string?', offset: 'string?', limit: 'string?' } },
  response: { ok: 'true', bookId: 'string', book: 'object?', revision: 'number', total: 'number', entries: 'array', layers: 'object', warnings: 'array?' },
  errors: ['INVALID_ENTRY', 'NOT_FOUND']
},
factBooksGet: {
  method: 'GET',
  path: '/api/fact/books',
  // 书目列表：拆解/ 下所有 <bookId>.json，带 revision/条目数/wiki 有无。
  request: { query: { root: 'string' } },
  response: { ok: 'true', books: 'array' },
  errors: []
}
```

### 2. daemon.mjs 实现要求

- **必须走 `createFactFileStore({ root }).list(...)`**，不许自己 readdir + JSON.parse 绕过内核（FACT-FIRST 规则 1）。
- `list()` 返回的 entries 已带 `bookId`/`bookName`/`revision`；直接透传，不要重排字段。
- 按 `layer` 过滤在**服务端做**（内核 list 支持 layer 参数就传，不支持就在拿到结果后 filter——但别把全部条目丢给前端再筛）。
- `q` 搜索：对 `name` 做大小写不敏感子串匹配，命中即返回。
- 分页：`offset` 默认 0，`limit` 默认 100、上限 500（超限 clamp 不报错）。
- `layers` 字段返回 `{ plot: n, character: n, worldview: n, ... }` 的计数表（**未过滤前**的全量统计，供前端做层筛选器）。
- `factBooksGet` 用 `readdir` 列 `拆解/*.json`（排除 `.wiki.json` / `.operations.jsonl` / `拆解汇总.json` / `拆解索引.json`），每本读顶层 `book`/`revision`/`entries.length`，并检查兄弟 `<id>.wiki.json` 是否存在。
- 坏档不整体失败：单本解析失败 → 该书 `error` 字段标注，其余照常返回。

### 3. 测试

新建 `test/fact-entries.test.mjs`：
- 用临时目录造一份两本书的拆解夹（一本正常 3 条条目、一本 JSON 损坏）。
- 断言：正常书能读到 3 条；损坏书被跳过且 warnings 有记录；layer 过滤生效；limit=1 分页正确；q 搜索命中 name。
- 断言响应能过 `validateResponse('factEntriesGet', payload)`。

## 允许改的文件
- `contracts.mjs`
- `daemon.mjs`
- `test/fact-entries.test.mjs`（新建）
- `test/contracts.test.mjs`（如果它断言端点总数，同步数字）

## 验收
`node .zcode/run-gate.mjs` 全绿，且 `node tools/acceptance/acceptance.mjs` 14 检查全过。
