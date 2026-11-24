# 工单交接说明（给 workbuddy / 后续执行者）

> **接手进度更新（2026-11-24，接手 agent 回填）**：HANDOFF 写就时的待办已推进——
> **OS-157 验收补齐**（独立复核 8/8 确认，`PINAX_KB_WATCH` 遗留收口）；
> **段 B⁺ 三张全部施工＋验收完成**：OS-158（`7aabd9d`）、OS-159（`bc8122f`）、OS-160（`ab854be`）；
> **段 C 五张全部完成**：OS-161（`510366b`/`46f220e`/`569d6f7`）、OS-162（`21259fc`）、
> OS-163（`1410567`）、OS-164（`79ec0f9`）、OS-165（`db4da00`）；
> **段 D 两张已验收**：OS-166（本机院子双院分家＋首启只拷贝迁移）、OS-167
> （库清单自持 `libraries.json`＋旧 Pinax 清单只读勾选导入），真实院子/真库均未触碰。
> 当前测试 678 例（676 过 / 2 跳）、门禁 23 过 / 0 挂 / 0 警、`app.js` 11,886 行、端点 107。
> **作者最新口径：跑完再 push**——只剩 OS-168 总收口，完成后统一推送，中途不 push。
> 下文是当初的交接原文（派单方式、踩坑预告、搁置项明细），仍供后续接手者参考。
>
> 主 agent（本会话）额度吃紧，验收工作暂时搁置。本文件是**接手所需的全部信息**：
> 剩下的工单在哪、怎么派、每张单要注意什么、还有哪些不走工单的遗留。
> 体系全貌见 [`docs/plan/workorder-system-20261124.md`](../plan/workorder-system-20261124.md)，实时状态见 [`BOARD.md`](BOARD.md)。

## 1. 现在的真实状态（2026-11-24 晚）

- 分支 `main`，工作树干净；提交**未推送**（作者下令才 push）。
- 测试 586 例（584 过 / 2 条件跳过）、验收门禁 19 项、水浒 10/10、新建 13/13。
- `core/`、`vendor/`、`pinaxAdapter` **已从仓里消失**；Host API = `host-api@2`（五键）；内核在 `src/kernel/`（身份 `openstory-kernel@1`）。
- 错误码已去 `PINAX_` 前缀（`src/kernel/errors.mjs` 25 条值无前缀；对照表 `docs/error-code-rename.md`）。
- **OS-157 已提交（`ce14075`）但主 agent 的验收记录尚未写**——验收搁置，见 §5。

## 2. 剩下要派的工单（全部已写好，文件在 `docs/workorders/`）

| 顺序 | 工单 | 文件 | 风险 | 一句话 |
|---|---|---|---|---|
| 1 | OS-158 | `OS-158-no-browser-storage.md` | 低 | 浏览器端存储清零（皮肤进服务端）＋门禁 |
| 2 | OS-159 | `OS-159-root-layout.md` | 中 | 仓根不散落 .mjs、文档入 `docs/`、`scripts/` 并入 `tools/` |
| 3 | OS-160 | `OS-160-sample-hidden-data.md` | 中 | 样例库自带隐藏数据与插件配置；套件状态库级化 |
| 4 | OS-161 | `OS-161-modules-habits-source-artifacts.md` | 中 | 习惯／故事源／产物中心升格模块插件 |
| 5 | OS-162 | `OS-162-exchange-module.md` | 中 | 导入导出模块＋NovelPedia 适配器 |
| 6 | OS-163 | `OS-163-core-chapters-script.md` | 中 | 正文／剧本升核心模块（不可停用） |
| 7 | OS-164 | `OS-164-core-worldbook-roleplay.md` | 中 | 世界书／扮演升核心模块＋世界书目录归属 |
| 8 | OS-165 | `OS-165-module-coverage.md` | 低 | 模块覆盖面门禁＋模块闸审计＋台账 |
| 9 | OS-166 | `OS-166-courtyard-rename.md` | **高** | 本机院子改名＋首启迁移（只拷贝不删） |
| 10 | OS-167 | `OS-167-library-manifest.md` | **高** | 库清单分家＋导入 Pinax 清单 |
| 11 | OS-168 | `OS-168-final-archive.md` | 低 | 总收口：路线归档、文档同步、总复核清单 |

顺便：作者 2026-11-24 更新口径为「**跑完再 push**」——OS-158~160 虽是原先的「push 前整备」，
但现在不中途推送；OS-161~168 全部验收通过后统一 push。

## 3. 怎么派（一条命令一张单）

```bash
cd D:/OpenStory
node .zcode/os-batch-runner.mjs \
  --plan <plan.json> --status <status.json> \
  --model hy4flash --rounds 2
```

`plan.json` 形状（**`allow` 是硬约束，越界即返工；迁移类单必须带 `tools/acceptance/**` 与 `core/.vendored-manifest.json`**）：

```json
{ "batches": [ {
  "id": "OS-161",
  "title": "OS-161：<提交标题>",
  "ticket": "D:/OpenStory/docs/workorders/OS-161-modules-habits-source-artifacts.md",
  "allow": ["src/**", "public/**", "test/**", "tools/acceptance/**", "docs/**", "ARCHITECTURE.md", "AGENTS.md"],
  "mustPass": ["test/tabRegistry.test.mjs"]
} ] }
```

编排器已内置的闸（2026-11-24 补）：
- 开工前：工作树干净、编排器自身无未提交改动、全量测试基线绿；
- 施工后：范围检查 → 五道门禁（测试／验收／水浒／新建／vendor）→ 红线测试逐个报；
- **provider 限流或空结果直接停线不提交**（CodeBuddy 撞 429 时退出码仍是 0、result 是空串）；
- **只改了工单归档不算实质改动**，不提交；
- 本批改了后端会**先重启 daemon 再跑 e2e**（防旧进程假绿）；
- 门禁脚本与 daemon 入口按候选路径解析（OS-159 挪动脚本后仍可用）。

## 4. 每张单的踩坑预告

- **OS-159（挪文件）**：`package.json` 的 `start`／`mcp`、门禁 `arch-stats` 调用、测试里的 `../daemon.mjs`、文档里的启动命令，四处要一起改；改完一定要用新命令真起一次 daemon。
- **OS-160（套件状态库级化）**：样例库里的配置要**用脚本跑真实路径生成**，不许手写 JSON 冒充；不提交日志/历史/凭据/本机绝对路径（有洁净门禁拦）。
- **OS-163 / OS-164（核心模块）**：`public/views/registry.mjs` 条目上的 `core` 是**页签可达面**，与模块级 `core:true` 是两件事，别互相改写；`app.js` 只许减不许增。
- **OS-166 / OS-167（动真实数据）**：所有验证必须用**临时 `LOCALAPPDATA` 注入**，绝不碰真实的 `%LOCALAPPDATA%\PinaxNext\`、`%LOCALAPPDATA%\OpenStory\` 与 `D:/Projects/**`；OS-166 只拷贝不删旧院。
- **所有单**：收尾必须跑 `npm run arch:stats`（否则 S0.2 红）；`core/**`、`vendor/**` 已不存在，任何单都不该再出现它们。

## 5. 主 agent 搁置的验收（接手者第一件事）—— **已完成，见 OS-157 工单验收记录**

1. **OS-157 验收**（提交 `ce14075`）：已亲验通过的部分——`core/`、`vendor/`、`pinaxAdapter` 三个路径都已消失；Host API 五键（`enrich/factStore/fail/ok/writeFileAtomic`）；码值无前缀、对照表 27 行；两条金样测试照绿（`decoupleStep2` 7/7、`decoupleStep3` 9/9）；门禁 S2.4 已改口径为「`src/**` 无 core 路径说明符」。
   **还差**：独立复核（建议 `deepseek-v4-pro` 或 `glm-5.3`，探针已确认可用）＋ 浏览器冒烟（进库／正文／世界书／扮演）＋ 把验收记录写进 `OS-157-kernel-retire.md` 与看板。
2. **顺带发现的遗留**：`test/kb-health.test.mjs:86` 仍传 `PINAX_KB_WATCH` 环境变量——产品代码里已无人读它，属于测试自己在用一个废弃名字，应改成新名或删除（小改动，可并入 OS-158）。

## 6. 不走工单的挂账（已入 `docs/LEGACY-ITEMS.md`）

| 事项 | 说明 |
|---|---|
| NovelPedia 真实数据复验 | 适配器按规范实测（ADR 附录取证）；NovelPedia 写入器落地后要用真实产物复验一次 |
| RAG 导出 | 只有规划，无代码 |
| 无自动化 UI 测试 | 候选做法：假 DOM 冒烟（OS-147 的探针思路产品化） |
| 模块闸无 root 的兜底 | **OS-165 已审结、无残留**：41 个独占端点契约全带 root，MCP 不显式给 root 就不判定，daemon 的「默认库＞第一条」兜底对独占端点不可达；详见 `docs/LEGACY-ITEMS.md`【已裁定】 |
| 「设置键→消费者」守卫表空跑 | 机制有效，暂无可登记键 |
| 上游 fact 内核不再跟进 | 转自有后成立；互认靠既有金样测试 |

## 7. 作者侧待办

| 事项 | 说明 |
|---|---|
| git push | **段 B⁺（OS-158~160）做完后由作者下令**；目前未推送 |
| 打 tag | 是否要 `v0.3.0` 之类的版本 tag，作者定 |
| 桌面端开新库 | 作者原话已把验收标准改为「内部代码质量」，此项降为可选 |

## 8. 工作纪律（对任何执行者都适用）

- `core/**`、`vendor/**` 已删，任何工单都不许再引入；
- 零 npm 依赖、零构建；
- 测试一律临时夹具库，**绝不碰 `D:/Projects/**`**；
- 不执行 git 写操作（提交由编排器做），不动 `.zcode/`；
- 既有测试只许新增或等价加强，不许删除／skip／放宽；
- 遇到门禁不可能通过或规格矛盾——停下来如实上报，不要绕过。
