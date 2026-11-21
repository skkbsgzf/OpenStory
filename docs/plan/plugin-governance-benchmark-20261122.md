# 插件治理：DSH 与 Obsidian 的可借鉴点（2026-11-22）

> 作者问：「在插件治理上，dsh 或者 Obsidian 有没有什么可以借鉴的」
>
> 两个来源都读了实际代码：
> - **DSH**：`D:/OpenDesign/resources/open-design/agent-runtimes/deepseek-harness/open-design-dsh-runtime-0.1.0.tgz`（OpenDesign 把 DSH 当可下载 runtime 包，内含 `cordis.patch.yml` ＋ 严格 JSONL 协议）
> - **Obsidian**：`AppData/Local/Programs/obsidian/resources/obsidian.asar`（`app.js` 3.7 MB，已抽出文本 grep 过 API 符号）

---

## 1. 先说结论

**两家走的是完全相反的两条路，而 OpenStory 现在两头不靠。**

| | DSH / Cordis | Obsidian | OpenStory 现状 |
|---|---|---|---|
| 治理模型 | **依赖注入 + 声明式 patch** | **运行时 API + 生命周期钩子** | 各自 spec 校验，无统一治理 |
| 插件形态 | 一个 npm 包 + yml 声明 | 一个 main.js + manifest.json | 目录 + frontmatter |
| 组合方式 | `inject:` 声明依赖，容器按拓扑加载 | 插件主动 `register*` 挂到宿主 | 无 |
| 失败处理 | 容器不提供依赖 → 插件不加载 | try/catch → 错误卡片，应用继续 | warnings 数组，继续 |
| 能力约束 | 依赖即能力（拿到 ctx 才有） | 无白名单，全 API 开放 | `capabilities` 声明但只校验文件存在 |

---

## 2. DSH / Cordis：声明式 patch + 依赖注入

### 2.1 一个 runtime 包长什么样

`cordis.patch.yml` 全文就 16 行：

```yaml
- id: system-prompt
  config:
    persona: >-
      You are a coding and design agent running for OpenDesign. ...

- id: hmr
  disabled: true

- insert:
    - id: open-design-startup
      name: '@open-design/dsh-runtime/startup'

    - id: open-design-runtime
      name: '@open-design/dsh-runtime'
      inject: [openDesignStartup]
```

**没有一行命令式代码**——全是「改哪个已有插件、加哪个新插件、依赖谁」。

### 2.2 依赖注入怎么工作

`dist/types/startup.d.ts` 暴露了机制：

```ts
export const name = 'open-design-startup'
export const inject: string[]                                    // 空数组＝无依赖，最先加载
export const OPEN_DESIGN_STARTUP_SERVICE = 'openDesignStartup'

declare module '@deepseek-ai/cordis' {
  interface Context { openDesignStartup?: OpenDesignStartupValues }  // 类型声明合并
}

export function apply(ctx: Context): void                          // 唯一入口
```

关键三点：
1. **插件只导出一个 `apply(ctx)`**——不自己管生命周期，容器调它
2. **`inject` 声明依赖**——容器按拓扑排序加载；依赖没就绪，这个插件根本不会 `apply`
3. **服务通过 ctx 暴露**——`ctx.openDesignStartup` 就是上一个插件放进去的值，类型靠 module augmentation 合并

### 2.3 协议边界被压到极小

`protocol.d.ts` 只有 20 行有效定义：

```ts
PROTOCOL_VERSION = 1
CAPABILITIES = { session_resume: true, session_cancel: true, structured_events: true }
HostCommand = ExecuteCommand | CancelCommand
```

两类命令（执行/取消）、三种能力（恢复/取消/结构化事件）。**OpenDesign 只通过这个 JSONL stdio 协议驱动 DSH，不碰 DSH 内部。**

### 2.4 最值得抄的一条：`patch` 而不是 `override`

OpenDesign 不 fork dsh-base，而是**在它上面打一层 patch**。好处：
- 上游 dsh 升级，patch 大概率还能用（只改 id/config/disabled）
- OpenDesign 自己的东西全在 `insert:` 里，一眼能看出「哪些是我的」
- `disabled: true` 能关掉不需要的上游插件（示例里关掉了 `hmr`）

---

## 3. Obsidian：运行时 API + 生命周期钩子

### 3.1 API 面（从 app.js grep 出的真实符号）

| 符号 | 出现次数 | 作用 |
|---|---|---|
| `registerView` | 41 | 注册自定义视图类型 |
| `addChild` | 101 | 挂载子组件（Component 生命周期树） |
| `loadData` / `saveData` | 41 / 66 | 插件自己的数据持久化 |
| `onUserEnable` | 13 | 用户启用时回调（延迟初始化） |
| `registerEditorExtension` | 6 | 扩展 CodeMirror |
| `registerInterval` | 5 | 定时任务（自动随插件卸载清理） |
| `registerMarkdownPostProcessor` | 2 | 渲染后处理 |

### 3.2 生命周期管理

```
loadPlugin(pluginId) → 成功则 plugin.onload()
                    → 失败则 console.error + 显示错误卡片（应用不崩）
disablePlugin(pluginId) → plugin.onunload()
enablePluginAndSave() → enablePlugin() + 持久化到 communityPlugins
```

**关键设计：`Component` 生命周期树。** 插件里所有 `register*` 都自动挂到插件自己的 Component 上；卸载时子树整体销毁——**插件作者不需要手写清理逻辑**。

### 3.3 manifest 校验

```json
{ "id", "name", "version", "minAppVersion", "description",
  "author", "authorUrl", "isDesktopOnly" }
```

从代码里 grep 到的校验点：`minAppVersion`（2 处）、`isDesktopOnly`（2 处）、`fundingUrl`（4 处）。

**注意 `isDesktopOnly`**——因为 Obsidian 移动端 API 不全，插件必须声明自己能不能在移动端跑。

### 3.4 能力约束：几乎没有

Obsidian **没有能力白名单**。插件拿到的是完整 `App` 对象，能读能写能发网络请求。治理靠的是：
- 社区审核（官方市场）
- 用户手动确认「第三方插件有风险」
- 没有签名、没有沙箱（Electron renderer 里直接跑）

**这是 Obsidian 最大的弱点**，不是优点。

---

## 4. OpenStory 现状：三套 spec 并列，缺统一治理

### 4.1 已有的三套

| spec | 文件 | 形态 | 有版本 | 有 sha256 |
|---|---|---|---|---|
| `openstory-suite@2` | `suites.mjs` | 目录 + manifest，可声明 settings/pages/services | ✅ | ❌ |
| `openstory-skill@1` | `skills.mjs` | Markdown + frontmatter | ✅ | ❌ |
| `openstory-runtime-kit@1` | `runtimes.mjs` | 目录 + kit manifest | ✅ | ✅ |

### 4.2 已有的优点（比 Obsidian 强的地方）

`suites.mjs` 的 `normalizeCapabilities` 已经在做**能力声明 + 落地校验**：

```js
caps.settings = { mode: 'schema' | 'page', ... }   // 设置页：schema 描述 or 自带 HTML
caps.pages    = [{ id, title, entry }]              // 自带页面，且校验文件真实存在
caps.services = [{ id, description }]               // 后台服务
```

`bad()` 有 20 处错误码（`SUITE_CAPS_SHAPE` / `SUITE_CAPS_ENTRY_MISSING` / `SUITE_CAPS_MODE` …），**比 Obsidian 严谨**。

### 4.3 缺的三件事

| 缺口 | 后果 | 该学谁 |
|---|---|---|
| **三套 spec 无统一视图** | 设置页要分三处看；「我现在装了什么」没有单一答案 | DSH（一个 patch 就是全部声明） |
| **无 `minOpenStoryVersion`** | 老版本装上新插件，跑到不认识的字段才炸 | Obsidian（`minAppVersion`） |
| **无依赖声明** | 套件 A 需要套件 B，只能靠文档口头约定 | DSH（`inject: [...]`） |

---

## 5. 建议：抄三件，不抄两件

### 抄第一件：统一清单视图（学 DSH 的「一份声明」）

现在用户装插件要先知道它是 suite / skill / runtime-kit。改为**一个 `plugins.mjs` 汇总三套**：

```js
// 输出统一形状，不改变三种 spec 的落盘格式
listAllPlugins({ suitesDirs, skillsDirs, runtimesDirs })
→ [{ kind:'suite'|'skill'|'runtime', id, version, enabled, capabilities, source }]
```

设置页只调这一个接口。**不动现有三套加载器**，纯增量约 80 行。

### 抄第二件：`minOpenStoryVersion`（学 Obsidian）

三个 spec 各加一个字段：

```yaml
minOpenStoryVersion: '0.2.0'
```

加载时比对 `package.json` 的 version，太老就拒绝并给出人话（「这个套件需要 OpenStory 0.2.0，你是 0.1.0」）。

**理由**：这是唯一能防住「用户装了新插件、应用跑到一半崩」的机制，Obsidian 用它扛住了 6 年。

### 抄第三件：套件间依赖声明（学 DSH 的 inject）

`suites.mjs` 现在有 `capabilities.services`，但没有「我依赖谁」。加一个：

```yaml
requires: ['openstory.suite.kb-retrieval']   # 依赖的套件 id 列表
```

加载时做拓扑排序，缺依赖就**不启用**（不是报错崩掉，是标灰 + 说清楚缺谁）。

**这一条可以直接复用 DSH 的思路**：容器不提供依赖 → 插件不加载，但应用照常运行。

---

### 不抄第一件：Obsidian 的无白名单 API

Obsidian 插件能直接 `require('fs')`、读写任意文件、发任意网络请求。它靠社区审核兜底，代价是**历史上出过多次恶意插件事件**。

OpenStory 已经有 `capabilities` 声明位，应该往**白名单**方向走，而不是学 Obsidian 放开。

### 不抄第二件：Cordis 的 `apply(ctx)` 全量改造

DSH 的依赖注入要求插件改成 `apply(ctx)` 形态、通过 `ctx` 拿服务、靠 module augmentation 做类型。这是一次**破坏性 API 改造**，现有 30+ 个套件全要重写。

**当前不值得**：OpenStory 的套件绝大多数是「声明配置 + 提供提示词/页面」，不需要复杂服务注入。等到出现「套件 A 必须调用套件 B 的能力」这种真实需求时再说。

---

## 6. 落地顺序

| 步 | 内容 | 改动量 | 风险 |
|---|---|---|---|
| 1 | 三个 spec 加 `minOpenStoryVersion` + 加载时比对 | ~40 行 | 低（缺字段＝不校验，向后兼容） |
| 2 | `plugins.mjs` 统一清单（只读聚合） | ~80 行 | 低（纯增量） |
| 3 | `suites.mjs` 加 `requires` + 拓扑排序 | ~60 行 | 中（要测循环依赖） |
| 4 | 能力白名单（把 `services` 从「描述」升级为「声明要什么」） | ~100 行 | 中（要定白名单种类） |

前三步做完，插件治理就从「三套各管一摊」变成「一份声明 + 版本闸 + 依赖闸」，而这正是 DSH 与 Obsidian 各自最强的那部分。

---

## 附：实测出处

| 结论 | 依据 |
|---|---|
| DSH runtime 是 tgz + sha256 | `open-design/agent-runtimes/deepseek-harness/manifest.json` |
| patch 16 行、含 `insert`/`inject`/`disabled` | 解包后 `package/cordis.patch.yml` |
| 插件只导 `apply(ctx)` + `inject` | `package/dist/types/startup.d.ts` |
| 协议只有 2 命令 3 能力 | `package/dist/types/protocol.d.ts` |
| Obsidian API 符号与次数 | `obsidian.asar` → `app.js` 3,728,534 B，grep 统计 |
| Obsidian manifest 字段 | 同上，`minAppVersion`/`isDesktopOnly`/`fundingUrl` grep |
| Obsidian 无能力白名单 | app.js 中无 `KNOWN_CAPABILITIES` 类结构；插件直接拿 `App` |
| OpenStory 三套 spec | `suites.mjs:19` / `skills.mjs:21` / `runtimes.mjs:21` |
| `capabilities` 已做落地校验 | `suites.mjs:84-124 normalizeCapabilities` |
