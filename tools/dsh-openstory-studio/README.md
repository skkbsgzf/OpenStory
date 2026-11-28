# OpenStory 小说工作台（DSH 插件）

把本机 OpenStory 工作台作为 DSH 的原生面板接进来：DSH 会话留在左边主区，
OpenStory 在右侧栏停靠——写作时左边继续对话，右边就是稿子。
同一 bundle 的第二行还把 **OpenStory 的 MCP server（24 工具）**挂进 DSH，
DSH 会话里的 Agent 因此能直接读章节、写回正文（走 daemon 的 `.history` 备份与 diff/log）。

## 它做什么

OpenStory 的工作面不是静态页面，而是 **daemon + 单页应用**：

```text
node src/host/daemon.mjs --port=8807  →  http://127.0.0.1:8807（只监听回环）
        └─ public/ 单页工作台（正文/世界书/扮演/故事源/剧本/设置…）
```

本插件做两件事：

1. **宿主侧（index.mjs）**：DSH 运行期间确保这个 daemon 活着——后台探活、
   必要时拉起、15s 看护、插件卸载时只回收自己拉起的进程；已有手工
   `npm start` 起的 daemon 则直接接管、不杀。
2. **客户端（client.js）**：把 `http://127.0.0.1:8807/` 以 iframe 呈现为：
   - 左栏底部动作按钮 **OpenStory**（`sidebar.footer.action`）→ 在右侧栏打开
     OpenStory（`sidebarRight.openTab`），**主区 DSH 会话不动**；
   - 右侧栏标签页类型 `openstory`（`sidebarRightTabs` + `sidebar.right.pane.tab`），
     可分栏、可收起；右侧栏自己的「全屏」按钮可把工作台放大到整窗；
     右侧栏 guide 页里也有一张 OpenStory 卡片。
   - 面板以 `?embed=1` 打开，OpenStory 进入**嵌入模式**：收掉它自带的 Agent 栏
     左列（`html.os-embed`），因为左侧已经是 DSH 原本的会话——不会出现两条
     Agent 栏，工作台也拿回这部分宽度。独立在浏览器打开时行为不变。
   - 编辑器里的 **「添加到 Agent / 润笔 / 发给 Agent」在嵌入模式下接到 DSH**：
     选段通过 postMessage 交给本插件，由它调用 DSH 注入的
     `inputActions.insertQuote`，作为**引用块放进 DSH 当前会话的输入框**
     （「润笔」会跟一句「润笔这段，要求：」）。独立打开时仍走 OpenStory 自己的 Agent。
   - **引用带来源**：插入时附一行 `〔来源：OpenStory ·《库》· 正文/NNN-….md · 第 N 段 · root=…〕`。
     DSH 会话同时挂着 OpenStory MCP（`mcp__openstory__*` 24 工具，见 `cordis.patch.yml`
     的 `mcp-openstory` 行），模型据此知道该用哪个 root/文件去 `openstory_novel_read_chapter`
     读全文、以及能不能写回；写回仍会先备份原稿进 `.history`。

## 安装

在 DSH 的 **Plugins → Add plugin** 里选本目录，或让 agent 用 `plugin_manager`
`install_bundle` 指向本目录。安装后刷新 DSH 页面；左栏 Settings 上方出现
OpenStory 按钮即成功。

## 配置（可选）

插件行可带 `config`（宿主侧读取，未声明 schema，全部可选）：

| 键 | 默认 | 说明 |
|---|---|---|
| `projectDir` | 本目录上两级（OpenStory 仓库根） | daemon 所在仓库；`daemon.mjs` 必须存在 |
| `port` | `8807` | daemon 端口；客户端固定连 8807，改端口需同步改 client.js |
| `root` | 空 | 传给 daemon 的 `--root=<库路径>`，空＝由工作台里选库 |
| `nodeBin` | 自动探测 | 启动 daemon 用的 Node 可执行文件 |
| `autoStart` | `true` | daemon 不在线时是否自动拉起 |
| `reapOnDispose` | `true` | 插件卸载时是否回收自己拉起的 daemon |
| `dshProfile` | 空 | 传给 daemon 的 `DSH_PROFILE`；空＝不透传宿主 profile，保持 OpenStory 单独运行时的行为 |
| `readyTimeoutMs` | `30000` | 等 daemon 就绪的上限 |
| `watchdogIntervalMs` | `15000` | 看护间隔 |

环境变量覆盖：`OPENSTORY_PROJECT_DIR` / `OPENSTORY_PORT` / `OPENSTORY_ROOT` / `OPENSTORY_NODE`。

> MCP 行（`cordis.patch.yml` 的 `mcp-openstory`）用 `!!js` 取 `OPENSTORY_NODE` /
> `OPENSTORY_PROJECT_DIR`，缺省 `node` + 当前工作目录；仓库或 Node 搬家时改这两行即可。

## 排障

- 日志：`~/.dsh/logs/openstory-studio.log`（daemon 的 stdout/stderr 也在里面）
- 状态：`~/.dsh/openstory/studio-plugin-state.json`（宿主/daemon pid，用于多宿主占有）
- 右侧栏显示「OpenStory 暂未响应」：先看日志里 daemon 是否启动失败（缺 node、端口被占、
  依赖未装 `npm install`），再点面板上的「重试」。

## 边界

- 插件只负责进程与呈现，不改 OpenStory 的任何业务数据；写操作仍走 OpenStory 自己的
  daemon 契约、diff/log 与 `.history` 备份。
- 面板 iframe 与 daemon 同源（127.0.0.1:8807），OpenStory 的落盘/草稿/UI 状态规则不变。
- 右侧栏宽度有限（默认 480～675px）：工作台已按 OS-114 窄面板约束适配——正文纸面
  有 320px 可读下限（`--doc-read-min`）、≤1000px 时参考资料/分析浮层不再挤压正文、
  参考资料左栏默认收起（页头「参考资料」开合）；需要整窗时用右侧栏的「全屏」。
- 多个 DSH 宿主（桌面端 + web 端）同时加载时，用 state 文件里的 hostPid 做单一占有者裁决。
