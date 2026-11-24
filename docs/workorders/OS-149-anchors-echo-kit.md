# OS-149 · 验收锚点强检查＋落盘表补行＋echo-kit 隐身（G8c＋G8e）

| 项 | 值 |
|---|---|
| 批次 | 段 A·立规矩（第二批路线 批次 7） |
| 对应条目 | G8c、G8e |
| 依赖 | 无（可与 OS-148 并行阅读，但施工串行） |
| 允许改动 | `src/**`、`public/**`、`runtimes/echo-kit/manifest.json`、`test/**`、`tools/acceptance/**`、`AGENTS.md`、`ARCHITECTURE.md`、`docs/**` |
| 风险 | 低 |
| 状态 | 待派 |

## 目标

两件小事：验收门禁里的「核心页签可达」检查现在是纸面检查，改成真的；回声参考套件是测试夹具，不该出现在作者可见的运行时列表里。
另补一行落盘表。

## 动工前必读

- `tools/acceptance/acceptance.mjs` 第 374–379 行（`CORE_TABS` 与 S4.1 检查）。
- `public/views/registry.mjs` 的 `TAB_REGISTRY`（条目上的 `core`、`retired`、`label`、`render`）与 `public/app.js` 的 `VIEW_RENDERERS`。
- `runtimes/echo-kit/manifest.json`、`src/services/runtimes.mjs`（货架装载与形状校验，`category` 的校验方式可参照）。
- 设置页运行时货架与 Agent 运行时选择列表的渲染处（`public/app.js` 里搜 `runtimes`）。
- `AGENTS.md` 第 10 条落盘位置表；`src/modules/deduce/` 与扮演相关端点实际把会话、导出、素材写到哪里。

## 任务

### G8c

1. **S4.1 改强**。现状：`CORE_TABS = ['正文', '世界书', '习惯', '拆解', '推演', '参考']`，判定方式是「在 `app.js` 或 `index.html` 里搜得到这个子串」——任何注释里出现就算过。
   改为对注册表的真实检查：从 `public/views/registry.mjs` 取 `core: true` 且未退场的条目，逐条断言
   a) 它的 `label` 就是页签栏渲染所用的名字（注册表本身即来源，直接 import 模块取值，不要读源码文本）；
   b) 它的 `render` 注册名在 `app.js` 的 `VIEW_RENDERERS` 里有对应键（这一条读源码文本匹配即可）；
   c) `viewScope(view)` 不是 null。
   检查项的文字列出真实页签名。
   注意：注册表里 `core: true` 的六条是 产物／正文／世界书／剧本／故事源／扮演（OS-143 定的顶栏可达面），与旧 `CORE_TABS` 不同。**以注册表为准。**
   若你认为「习惯」也该在可达面里，写进交付说明，不要自行加。
2. **落盘表补行**。`AGENTS.md` 第 10 条的落盘位置表缺「`推演/` 容器」一行：补上，位置按实测写准（会话、导出、素材各落在哪，看代码，不要猜）。

### G8e

3. `runtimes/echo-kit/manifest.json` 加 `"fixture": true`。
4. `src/services/runtimes.mjs` 识别可选的 `fixture` 字段（缺省 `false`，形状校验只收布尔）。货架接口照常返回它，既有测试不变。
5. 设置页的运行时货架与 Agent 的运行时选择列表，不渲染 `fixture: true` 的套件。过滤写成纯函数并配测试。
   `app.js` 是增量冻结的：过滤逻辑放进 `public/views/` 或既有叶子模块，`app.js` 只留接线。
6. **不改名、不删除、不移动** echo-kit。

## 不做

- 不改注册表里条目的 `core` 标记（要改先问）。
- 不动 `core/**`、`vendor/**`、`package.json`；不引任何依赖。
- 不动 `runtimes/` 下除 `echo-kit/manifest.json` 以外的文件。

## 验收

- `node --test test/*.test.mjs` 全绿（只增不减）。
- `node tools/acceptance/acceptance.mjs` 全绿；S4.1 的检查文字已换成真实页签名。
- 做一次反证：临时把注册表里某个核心条目的 `render` 改成一个没注册的名字，S4.1 必须变红；把输出贴进交付说明，然后改回。
- `public/app.js` 行数不增（当前 12,477）。
- 浏览器里「设置 → 引擎与存储」的运行时列表不再出现「回声参考套件」——你没法开浏览器，这一条留给主 agent 验收，你只保证纯函数测试覆盖了过滤。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁真的落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件，越界的不提交。
- 测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库。
- 遇到门禁不可能通过、规格互相矛盾、或必须删／放宽既有测试才能过——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
