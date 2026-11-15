# 工单 OS-18 · Agent 多运行时（CLI 嫁接＋DSH 原生＋Pi 默认）

> 作者 2026-11-16 指示：**先把 agent 搞定。参考 opendesign 的代码，提供多种 cli 服务，
> 原生支持 dsh，默认提供 pi。** 前一批：独立建仓（D:\OpenStory @67336e6）。执行方式：仓内直写。

## 0. 对照 OpenDesign 的运行时接入

| od | 本单 |
|---|---|
| agent-runtimes/*.tgz（可插拔运行时资源） | 三类内置 kit 进 `runtimes/` 货架（CLI×3＋DSH×1），用户目录可覆盖 |
| sidecar 拉起＋探活 | sidecar 语义复用；**新增 CLI 嫁接**（一次性子进程）与 **DSH 适配**（探测式端点） |
| 用户在货架选运行时 | 设置页运行时货架分组（Pi 默认／DSH／CLI）＋状态标 |

## 1. kit 协议扩展（`openstory-runtime-kit@1` 向后兼容追加）

新增两个可选字段：
- `category`: `native`（默认）｜`cli`｜`dsh`——货架分组用；
- `probe`: `{ cmd, args }`——安装探测（可执行在 PATH 上？版本？），结果进货架 status：
  `installed:true/false`、`version`。CLI kit 必须声明 probe；sidecar/endpoint 可选。

**`kind:"cli"`**（新增）：不走 sidecar，daemon 用一次性子进程嫁接——每次对话：
`spawn(probe.cmd, [...cliArgs, prompt])` → 收集 stdout → 以 OpenAI 兼容 SSE 回吐（整段一片，
首块即以 `data:{choices:[{delta:{content}}]}` 帧＋`[DONE]`）；超时（默认 120s）kill 并如实报错。
对话历史拼进 prompt（system 守则＋最近 24 条，沿用既有 buildUpstreamMessages 口径）。

## 2. 内置四个 kit

| kit | kind | 说明 |
|---|---|---|
| `cli-codebuddy` | cli | CodeBuddy CLI（`codebuddy -p <prompt> --output-format text`，可配额外参数/模型） |
| `cli-qoder` | cli | Qoder CLI（`qoder -p <prompt>`） |
| `cli-claude` | cli | Claude Code CLI（`claude -p <prompt>`） |
| `dsh` | dsh | **DSH 原生**：探测 DSH Desktop（env `DSH_STUDIO_STATE`/studio-plugin-state/9230 inspector），chat 端点可配（默认 OpenAI 兼容桥 `/v1/chat/completions`）；不可达如实报「DSH 未运行/端点未配」，不伪造 |

四个 manifest 的 probe 都只是「可执行在不在」——**没装就标 missing**（货架如实摆，选中则报错）；
Pi（kind:pi）保持默认兜底，status 按 endpoint 是否配置。

## 3. daemon

- `runtimes.mjs`：`normalizeRuntimeKit` 认 `category`/`probe`/`kind:"cli"`（cliArgs、timeoutMs、
  model 可配）；`probeRuntimeKit(kit)` 结果缓存（60s）。
- `cli-bridge.mjs`（新）：`runCliChat(kit, messages)` → `{ok, text}`｜`{ok:false, message}`；
  spawn 用 `shell:false`，超时 kill 树；stdout 空＝如实报「CLI 无输出」。
- `dsh-bridge.mjs`（新）：`detectDsh()`（env/studio-plugin-state/9230 HTTP 探活）→ `{running, endpoint?, source}`；
  `resolveDshChat(kit)` 给出 chat URL 或不可用原因。
- `handleAgentChat`：`kind:"cli"` 走 cli-bridge（会话落档/卡机制不变）；`kind:"dsh"` 走 dsh-bridge
  （不可达且 Pi 有配置＝兜底＋notice；无配置＝AGENT_UPSTREAM_ERROR 如实报）。
- 货架响应加 `category`/`probe`/`probeResult`；`PUT /api/agent/runtime` 校验放宽到新 kind。

## 4. 工作台

运行时节分组：**Pi（默认）｜DSH 原生｜CLI 服务**；每张卡带状态标（Pi=已配置/未配置；
DSH=运行中/未运行；CLI=已安装 vX/未安装）＋「探测」说明。选中不可用 kit 时 composer 提示原因。

## 5. 验收

- [ ] 测试 ≥ 6：probe 单测（假可执行/不存在）；cli-bridge 端到端（假 CLI 脚本→SSE 回吐）；
      超时 kill；dsh detect（无 env 未运行）；货架分组字段；契约计数不变（38）。
- [ ] curl 证据：/api/agent/runtimes 含三组与 probeResult；选 cli kit（假 CLI）→ chat 出回声。
- [ ] 两屏截图：运行时货架分组／CLI 选中对话。
- [ ] 测试全绿（79+新增）。

## 6. 边界（不做）

- 不做 CLI 的流式增量（一次性收 stdout——CLI 本身多为批式）；不做 DSH 会话协议逆向
  （桥接端点可配，DSH 侧写成 OpenAI 兼容桥即可接）；CLI 凭据走 CLI 自身配置（本仓不存）。
