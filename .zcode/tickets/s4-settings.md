# 工单 S4：设置页配齐（生图/识图 provider + DSH 模型 + 可行性校验）

## 背景
作者要求：
> 设置里面尽快配齐全局的生图，识图接口，需要加接口可行性校验，同时用 dsh，也要加 model 选项，指定 openstory 的默认模型，默认子 agent 模型，等其他常用的 agent 设置功能

现状：
- `agent-config.json` 只有单套 `{ endpoint, model, apiKey, runtime, reasoningEffort, chineseReasoning }`
- 生图端点从 agent-config 里顺带读 `imageEndpoint`（无独立配置面、无校验）
- 识图（vision）**完全不存在**
- 设置页有 plugins/modules/suites/runtime/appearance/discover/data/kb/about 十节，无「模型」节

## 任务

### 1. 配置结构升级（向后兼容）

`agent-config.json` 新结构（**旧字段保留，读到旧格式自动迁移**）：

```json
{
  "text":    { "endpoint": "", "model": "", "apiKey": "", "runtime": "dsh", "reasoningEffort": "", "chineseReasoning": true },
  "image":   { "enabled": false, "endpoint": "", "model": "", "apiKey": "" },
  "vision":  { "enabled": false, "endpoint": "", "model": "", "apiKey": "" },
  "agent":   { "defaultModel": "", "subagentModel": "", "profile": "" },
  "updatedAt": "..."
}
```

**迁移规则**：读到旧格式（顶层有 `endpoint`/`model`/`apiKey`）时，映射到 `text.*`，其余沿用默认，写回新格式。

### 2. 新端点（contracts.mjs + daemon.mjs）

```js
configGet: {   // 聚合读：脱敏
  GET /api/config
  response: { ok, text: {endpoint,model,apiKeyMasked,runtime,reasoningEffort,chineseReasoning}, image: {...}, vision: {...}, agent: {...}, configPath }
},
configPut: {   // 分块写：body 只传要改的块
  PUT /api/config
  request: { body: { text?: object, image?: object, vision?: object, agent?: object } }
  response: { ok, ...同上 }
},
configProbe: { // ★可行性校验：真发一个最小请求
  POST /api/config/probe
  request: { body: { kind: 'text'|'image'|'vision', overrides?: object } }
  response: { ok, kind, reachable: boolean, latencyMs: number, model?: string, detail?: string, error?: string }
  errors: ['INVALID_ENTRY']
}
```

**probe 实现要求**：
- `text`：向 `text.endpoint` 发 `POST /v1/chat/completions`，`messages:[{role:'user',content:'ping'}]`，`max_tokens:1`。200 即 reachable。
- `image`：向 `image.endpoint` 发 `POST /v1/images/generations`，`prompt:'a red dot'`，`size:'256x256'`，`n:1`，`response_format:'b64_json'`。拿到 b64 即 reachable。**注意**：这会真花钱，前端必须二次确认；daemon 侧 `probe` 只做一次、不重试。
- `vision`：发一张内联的 8×8 红色 PNG（base64 常量），问「这张图是什么颜色，只回答颜色名」。200 + 有回复即 reachable。
- 每种都有 15 秒超时；超时返回 `reachable:false, error:'TIMEOUT'`，不抛。
- **overrides**：允许传未保存的配置试连（用户填了但还没点保存时能测）。

### 3. 设置页新分节「模型与能力」

在 `SETTINGS_SECTIONS` 里插入 `{ id: 'models', label: '模型', hint: '对话 / 生图 / 识图' }`（放在 plugins 之后）。

分四张卡：

**A. 对话模型（text）**
- 运行时选择（沿用现有 runtime 选择器：dsh / cli / endpoint）
- 当 runtime=dsh 时：拉 `/api/agent/dsh/models` 填充「主模型」「子 agent 模型」两个下拉
- 当 runtime≠dsh 时：显示 endpoint + model + apiKey 三个输入
- 「测试连接」按钮 → `configProbe({kind:'text'})`

**B. 生图（image）**
- 开关 enabled
- endpoint（OpenAI 兼容，填到 `/v1` 为止）+ model + apiKey
- 「测试连接」→ `configProbe({kind:'image'})`，**点击后弹确认框**：「这会真生成一张图（消耗额度），继续？」

**C. 识图（vision）**
- 开关 + endpoint + model + apiKey
- 「测试连接」→ `configProbe({kind:'vision'})`

**D. Agent 默认档**
- 主模型 / 子 agent 模型（从 dsh models 拉）
- profile 名（可选）

每张卡右上角显示 probe 结果徽标：`未测试` / `✓ 可达 (312ms)` / `✗ 不可达（原因）`。

### 4. 现有调用点适配

- `daemon.mjs` 里 `deduceImage` 读 `imageEndpoint` 的地方，改成读新 `image` 块（兼容旧字段）
- 任何读 `agentConfig` 的地方（streamChat 等）改成读 `text`
- `agentConfigGet/Put` 两个老端点**保留**（MCP/旧前端可能还用），内部转发到新结构

### 5. 测试

`test/config.test.mjs`（新建）：
- 旧格式迁移：写一份旧 config，读出来是新结构且值不丢
- 脱敏：apiKey 只回尾号
- probe 对不可达 endpoint 返回 `reachable:false` 不抛（用 `http://127.0.0.1:9`）
- configPut 分块写：只传 image 不改 text

## 允许改的文件
- `contracts.mjs`
- `daemon.mjs`
- `public/app.js`（设置页新分节 + probe 交互）
- `public/index.html`（设置卡片样式，走令牌）
- `test/config.test.mjs`（新建）
- `test/contracts.test.mjs`（同步端点总数）

## 验收
`node .zcode/run-gate.mjs` 全绿 + `node tools/acceptance/acceptance.mjs` 14 检查全过。

## 注意
- **凭据红线**：完整 apiKey 永不回显（只回 `apiKeyMasked` 尾 4 位）
- probe 的 image 真花钱——前端必须二次确认，daemon 不自动调用
