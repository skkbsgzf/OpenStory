# OpenDesign 架构对标（2026-11-22）

> ✅ **已收官（OS-123→133，2026-11-23）**——对标结论已消化：采纳（sidecar 进程治理 OS-127／AG-UI 式协议出口 OS-128／契约分域 OS-130）；明确不抄清单见 [docs/LEGACY-ITEMS.md](../LEGACY-ITEMS.md)【明确不做】档；实施后架构见 [ARCHITECTURE.md](../../ARCHITECTURE.md)。

> 作者问：「我们对标的 opendesign 用的是什么架构」
>
> 本文基于实测：`D:/OpenDesign` 是**安装版但未打 asar**，`resources/app/node_modules/@open-design/*` 全部可读（编译产物 .mjs 保留了源码分段注释与 zod schema），`resources/open-design/` 是数据面（154 个设计系统 / skills / agent-runtimes）。因此下面每一条都有代码依据，不是猜的。

---

## 1. 一句话架构

**OpenDesign = Next.js Web 应用 ＋ 独立 sidecar 进程 ＋ 私有契约包，四层用 npm 包边界硬切。**

```
┌───────────────────────────────────────────────────────────┐
│  Electron 壳（main.cjs 20 行，只做一件事：拉起 web）        │
└──────────────────────────┬────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────┐
│  @open-design/web（Next.js，141 MB standalone）            │
│  app/ + src/ + dist/sidecar/                              │
└──────────────────────────┬────────────────────────────────┘
                           │ sidecar supervisor（named pipe / unix socket）
┌──────────────────────────▼────────────────────────────────┐
│  @open-design/sidecar（2,791 行）                          │
│  进程生命周期：launch / converge / stamp / generation /    │
│  retirement / 端口分配 / 崩溃重启 / 生命周期锁              │
└──────────────────────────┬────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────┐
│  @open-design/platform（1,082 行）                         │
│  command / process / fs / http / toolchain / proxy-env     │
└───────────────────────────────────────────────────────────┘

横向切面（谁都依赖，谁都不实现业务）：
  @open-design/contracts        19,344 行 / 108 段 ← 唯一真源
  @open-design/plugin-runtime      800 行
  @open-design/registry-protocol   150 行
  @open-design/agui-adapter        118 行
```

---

## 2. 五个关键设计决策

### ① 契约包是最大的一块，而且**只有契约**

`@open-design/contracts` 19,344 行 / 108 个源码段打包成 25 个 dist 文件，是全生态最大的单体包。它的 package.json 写着：

> "Shared **pure** TypeScript contracts for the OpenDesign web/daemon boundary."

`pure` 是关键词——这个包里没有 fs、没有网络、没有进程，只有 zod schema 与纯函数校验。108 个源码段按领域切（导出成 76 个 npm 子路径）：

| 域 | 模块数 | 内容 |
|---|---|---|
| `api/*` | 35 | chat / comments / collab / share / export / files / media / memory / projects / registry / workspaces / team-resources / question-form-markup … |
| `runtime/*` | 11 | preview-observability / preview-guards / html-injection-points / deck-protocol / motion-source-player |
| `plugins/*` | 11 | strategy-v2 插件策略 |
| `prompts/*` | 20 | 提示词身份与模板契约 |
| `artifacts/*` | 5 | od-card / artifact-markdown-context / artifact-transcript / history-question-form |
| `observability/*` | 3 | normalized-agent-observation-v1 / runtime-evidence-graph-v1 |
| 其它 | ~15 | design-systems（token-schema / components-manifest / derived-token-outputs）· analytics · critique · errors |

**对照 OpenStory**：本仓 `contracts.mjs` 1,160 行 / 99 端点，是同一个角色，但体量是 OpenDesign 的 6%，而且混了「端点表 + 校验 + 业务常量」。

---

### ② sidecar 是**独立进程**，不是同进程模块

`@open-design/sidecar` 2,791 行，导出的 38 项全是进程管理：

```
launchSidecar / spawnSidecar / stopSidecar / restartSidecar
convergeSidecarLaunch / handoffCurrentSidecarGeneration
readCurrentSidecarStamp / registerSidecarProcess
withSidecarLifecycleLock / supervisorExitDisposition
allocatePort / resolveSidecarClientEndpoint
```

关键机制（都在代码里）：
- **stamp 文件**：sidecar 启动后写 `{ pid, port, generation, ... }`，客户端读 stamp 找它
- **generation 代际**：重启时 generation +1，旧客户端连接自动失效，避免半死状态
- **生命周期锁**：`withSidecarLifecycleLock` 防止并发拉起多个实例
- **进程树清理**：`process-tree.ts` / `process-retirement.ts`，避免孤儿进程
- **named pipe / unix socket**：Windows 走 `\\.\pipe\...`，不是 TCP 端口

**对照 OpenStory**：本仓 daemon 是同进程直起、固定 TCP 8807、无 stamp、无 generation、无生命周期锁。**这正是 OS-93 那次「多个 daemon 竞听 8807 导致页面拿到 489KB 混合包」的根因**——OpenDesign 用 stamp+generation 从结构上排除了这类问题。

---

### ③ 插件运行时只做「适配」，不做「执行」

`@open-design/plugin-runtime` 800 行的模块分段暴露了它的设计：

```
parsers/frontmatter.ts     ｜ parsers/manifest.ts
parsers/marketplace.ts     ｜ adapters/agent-skill.ts
adapters/claude-plugin.ts  ｜ merge.ts
digest.ts ｜ validate.ts ｜ resolve.ts ｜ pipeline-fallback.ts ｜ strategy-package.ts
```

意思是：把各种**异构生态**（Agent Skill 的 SKILL.md、Claude Plugin 的 .claude-plugin、市场清单）**归一成同一份 PluginManifest**，然后由 `validate` 检查能力白名单：

```js
KNOWN_CAPABILITIES = ["prompt:inject","fs:read","fs:write","mcp","subprocess","bash","network","connector"]
```

**它不执行插件**——执行交给 sidecar。适配层与执行层彻底分开。

**对照 OpenStory**：本仓 `suites.mjs` / `skills.mjs` / `genres.mjs` / `runtimes.mjs` 各管一摊，没有统一的 manifest 归一化，也没有能力白名单。

---

### ④ AG-UI 协议适配器：把内部事件翻译成标准协议

`@open-design/agui-adapter` 只有 118 行，但它是**对外兼容性的关键**：

```js
encodeOdEventForAgui(event) {
  message_chunk → { kind: "agent.message", text, done }
  tool_call     → { kind: "tool_call", toolName, args, callId, status, result }
  state_update  → { kind: "state_update", path, value }
  run_started   → { kind: "run.lifecycle", status: "started" }
  end           → { ... }
}
```

内部事件模型私有，出口处翻译成 AG-UI（Agent-User Interaction Protocol）标准。**这样前端可以换成任何支持 AG-UI 的客户端，而不动内部实现。**

**对照 OpenStory**：本仓 SSE / 流式事件直接由 `daemon.mjs` 拼字符串推给 `app.js`，无协议层。换前端就得改后端。

---

### ⑤ 注册表协议：插件分发的完整契约

`@open-design/registry-protocol` 150 行的 zod schema 定义了插件市场：

```
RegistryBackendKind: github | http | local | db
RegistryTrust:       official | trusted | restricted
RegistryEntry:       name(author/slug) + version + source + dist + integrity + manifestDigest
RegistrySignature:   github-oidc | cosign | minisign | custom
RegistryVersion:     version + yanked + yankedAt + yankReason + deprecated
```

注意 `integrity` + `manifestDigest` + `signature` 三件套——**插件要签名才能装**。

**对照 OpenStory**：本仓 skills 就是从磁盘目录读 SKILL.md，无签名、无完整性校验、无版本概念。

---

## 3. 四层边界对照表

| 层 | OpenDesign | OpenStory 现状 | 差距 |
|---|---|---|---|
| **契约** | `@open-design/contracts` 19,344 行 / 108 段，zod，纯函数 | `contracts.mjs` 1,160 行，手写校验，混端点表 | 体量 6%；未按域切；无 schema 库 |
| **进程** | `@open-design/sidecar` 2,791 行：stamp / generation / 生命周期锁 / named pipe | `daemon.mjs` 直接 `createServer().listen(8807)` | **无进程治理**（OS-93 竞听事故根因） |
| **平台** | `@open-design/platform` 1,082 行：command/process/fs/http/toolchain | 各模块直接 `node:fs` | 无平台抽象层 |
| **插件** | `plugin-runtime` 800 行：统一 manifest ＋ 能力白名单 ＋ 签名校验 | suites/skills/genres/runtimes 各一摊 | 无统一契约 |
| **协议出口** | `agui-adapter` 118 行：内部事件 → AG-UI | 直接拼 SSE 字符串 | 无协议层 |
| **数据面** | `resources/open-design/` 154 设计系统 + skills + agent-runtimes | 库目录（正文/拆解/世界书…） | 形态不同，不可比 |

---

## 4. 最值得抄的三件事（按性价比排序）

### 第一件：sidecar 式的进程治理（解决真实事故）

OpenStory 的 OS-93 事故——多 daemon 抢 8807，页面拿到混合包、卡片全点不了——在 OpenDesign 的架构下**结构上不可能发生**，因为：

- 启动前抢 `lifecycle-lock`
- 起来后写 `stamp`（pid + port + generation）
- 客户端只认 stamp 里的端口，不假设 8807
- 重启 generation +1，旧客户端连接自动作废

**改动量**：`daemon.mjs` 加约 120 行（stamp 读写 + 锁 + generation），前端 `api()` 改成从 `/api/health` 拿端口。不改协议、不改业务。

### 第二件：契约按域切 + 用 schema 库

现在 `contracts.mjs` 1,160 行是一张平表，99 个端点的校验手写。OpenDesign 用一个 zod schema 库把「校验」变成声明式，同时按 108 个源码段分域、导出成 76 个 npm 子路径。

**改动量**：中（要引 zod，或自写等价的最小 schema）。收益是**加端点变成加声明，不是加 if**。

### 第三件：AG-UI 式协议出口

本仓 SSE 事件格式写死在 `daemon.mjs` 里。抽出 118 行适配层，内部事件模型就能自由演化。

---

## 5. 明确不建议抄的

- **Next.js**。OpenDesign 用 Next.js 是因为它要做 Web 产品＋桌面壳双轨。OpenStory 零构建依赖是刻意选择（作者口径「完全本地」），换 Next.js 会引入 141 MB 构建产物和整套 SSR 概念。
- **better-sqlite3 / node-pty / sharp 这些原生依赖**。本仓目前只有 sharp + transformers，已经够重了。
- **154 个设计系统包的规模**。那是产品面，不是架构面。
- **插件签名体系**。OpenStory 目前没有第三方插件分发需求，做签名是替不存在的场景付成本。

---

## 6. 与内核解耦规划的关系

两件事正交，可以并行：

| | 内核解耦（decouple-pinax-core-20261122.md） | OpenDesign 对标 |
|---|---|---|
| 解决什么 | **向上**：OpenStory 与 Pinax 的依赖边界 | **向内**：OpenStory 自己的分层质量 |
| 核心动作 | 收缩 vendor 闭包、adapter 收敛、漂移检测 | sidecar 治理、契约分域、协议出口 |
| 影响行数 | core 12,551 → 约 4,300 | 新增约 300 行，重构 contracts |
| 风险 | 中（第 2 步需跨仓确认） | 低（纯增量） |

**建议顺序**：先做内核解耦第 1 步（章节号自持，风险最低），再做 sidecar 进程治理（解决真实痛点），最后才是契约分域（收益长期但改动面大）。

---

## 附：实测数据出处

| 数字 | 出处 |
|---|---|
| contracts 19,344 行 / 108 段 / 25 dist 文件 / 76 exports | `contracts/package.json` + `dist/` 逐文件 `wc -l` |
| sidecar 2,791 行 | `@open-design/sidecar/dist/index.mjs` 68,983 B + `supervisor.mjs` 35,589 B |
| platform 1,082 行 | `@open-design/platform/dist/` |
| plugin-runtime 800 行 | `@open-design/plugin-runtime/dist/index.mjs` |
| agui-adapter 118 行 | `@open-design/agui-adapter/dist/index.mjs` |
| registry-protocol 150 行 | `@open-design/registry-protocol/dist/schemas.mjs` |
| web standalone 141 MB | `du -sh resources/open-design-web-standalone/apps/web` |
| 154 个设计系统 | `ls resources/open-design/design-systems \| wc -l` |
| 能力白名单 8 项 | `plugin-runtime/dist/index.mjs:524` `KNOWN_CAPABILITIES` |
| sidecar 导出 38 项 | `sidecar/dist/index.mjs:1772` |
