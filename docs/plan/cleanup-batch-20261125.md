# 清账批规划（第三批·E 批）：D 批遗留清零

> **作者裁定（2026-11-25）**：「对于整个 D 批内的遗留问题项，规划好之后安排 CodeBuddy CLI 协助完成，不接受妥协。待定里面的几个 Pinax 业务必须全部退役。」
> 问题来源：D 批验收记录 [`OS-185-188-batch-d-acceptance.md`](../workorders/OS-185-188-batch-d-acceptance.md)（§二必修、§三成色、§四分类、§五小问题）。
> 施工走 CodeBuddy CLI（`hy4flash`）；主 agent 只写单、盯门禁、验收。通用纪律见 [`COMMON-RULES.md`](../workorders/COMMON-RULES.md)。

## 1. 完成的标准（七句全部成立才算收口）

1. **Pinax 的运行时关联为零**：产品代码里的旧名只剩两类——一次性升级（`src/protocol/libraryUpgrade.mjs`）与出处注释。
2. **旧库的一次性升级在作者真库上不改错、不漏改**：路径改写只认库根首段与已知运行态前缀；旧数据键在升级时抬升；失败如实回滚并报告。
3. **分类表逐行落地**：一个正名、一个 slug、一个页面 id，三者相同；「日志」在册；五类货架都是能力图里的一等套件。
4. **微内核名副其实**：内核件只经能力句柄被消费，端点实现归插件并经 `activate()` 登记，`src/protocol/` 的转供叶清零，门禁量的是真实静态耦合而不是定义出来的零。
5. **D 批四个机制都有生产调用方**：覆盖路由与回退链、迁移器（失败安全阀生效）、套件统一 manifest、slot 编排（前端消费）。
6. **第三方可执行模块装载开放**：按 ADR 0003 §四逐门验收（信任门、身份门、边界门、切换门、失败门、回退门）。
7. **作者要过目的文档与实现一致**：ADR 0002／0003、协议、README、ARCHITECTURE、AGENTS、台账。

## 2. 工单与顺序

| 序 | 工单 | 一句话 | 风险 | 依赖 |
|---|---|---|---|---|
| 1 | [OS-188a](../workorders/OS-188a-batch-d-fixes.md) | 旧库升级补强：路径改写锚定、旧关系扩展键抬升、旧临时文件残留归档、解析失败入报告 | 中 | — |
| 2 | [OS-189](../workorders/OS-189-pinax-retire.md) | Pinax 残留业务全部退役（院子克隆、旧清单读、导入识别、旧前缀、LICENSE、过时指引、门禁收紧） | 中 | 188a |
| 3 | [OS-190](../workorders/OS-190-classify-complete.md) | 分类补齐：`imagegen`／`knowledge` 两个 slug、页面 id＝slug、「日志」立 manifest、套件归属统一 | 中 | 189 |
| 4 | [OS-191](../workorders/OS-191-graph-migration-consistency.md) | 能力图与迁移框架自洽：校验对齐、回退语义、journal 补全、可执行扫描改白名单 | 低 | 188a |
| 5 | [OS-192](../workorders/OS-192-shelves-manifest2.md) | 货架全面升格：五类货架进能力图、漫剧套件去可执行页、legacy 套件协议与过渡脚手架退役 | 中高 | 190 |
| 6 | [OS-193](../workorders/OS-193-kernel-handles.md) | 内核件归位与句柄化：`services/` 里的内核代码搬进模块，内核之间只经能力句柄，转供叶清零 | 高 | 191 |
| 7 | [OS-194](../workorders/OS-194-handlers-to-plugins.md) | 端点实现归插件：handler 搬进所属模块、经 `activate()` 登记，daemon 按库快照分派 | 高 | 193 |
| 8 | [OS-195](../workorders/OS-195-boundary-gates.md) | 边界收口：工作台之间与宿主、服务去直连；`protocol` 只留底座契约；门禁改量真实耦合 | 高 | 194 |
| 9 | [OS-196](../workorders/OS-196-dynamic-loading.md) | 动态装载开放：本机模块根——信任门、身份门、边界门、切换门、失败门 | 高 | 195 |
| 10 | [OS-197](../workorders/OS-197-migration-wiring.md) | 迁移器接线：生产调用点、失败安全阀、回退保护（回退门） | 中高 | 196 |
| 11 | [OS-198](../workorders/OS-198-slots-wiring.md) | slot 编排接线：前端消费 manifest 的 slot 投影；第三方工作台的页面 | 高 | 192、194、196 |
| 12 | [OS-199](../workorders/OS-199-docs-settle.md) | 文档与门禁收口：ADR、协议、README、ARCHITECTURE、AGENTS、台账对齐；数字锚扩到 README | 低 | 全部 |

## 3. 派发轮次

| 轮 | 工单 | 说明 |
|---|---|---|
| 1 | OS-188a → OS-189 | 都动「旧库升级」与「旧名」，连着做；作者明令的两件事最先落地 |
| 2 | OS-190 → OS-191 → OS-192 | 改名在前，后续工单不再背旧 id |
| 3 | OS-193 | 内核归位，金样测试全程不动 |
| 4 | OS-194 | 端点归属，端点数与对外契约名不变 |
| 5 | OS-195 | 边界与门禁 |
| 6 | OS-196 | 开门 |
| 7 | OS-197 → OS-198 | 回退门＋slot 接线 |
| 8 | OS-199 | 收口 |

每轮之间由监督线验收：机器门禁＋针对性探针＋读关键改动；不过就出返工单，不带病往下走。

## 3a. 作者知情即可、可随时否决的两个产品取舍

1. **删除「漫剧」占位套件**（OS-192）：它的设置页是可执行孤岛、两个设置项没有任何消费者——按「不凭空许诺」「不许死设置项」的既有裁定处理。若要保留这条产品线，另立一张带真供给的单。
2. **第三方工作台的页面走同源 iframe**（OS-198）：页面入口来自已登记模块根里的模块，与「登记即信任」一致；内置页面仍用内置视图。

## 4. Pinax 退役边界（写死）

**保留**：(a) `src/protocol/libraryUpgrade.mjs`——作者五个真库的出口，必须认得旧名；(b) 出处注释与 `README` 致谢段、`docs/kernel-provenance.md`——作者裁定出处声明保留。

**全部退役**：首启从旧院克隆配置；库清单旧形状 `recentProjects` 的兼容读与 `imported-pinax` 归一；导入适配器直接拿旧目录名判项目；运行时对旧临时文件前缀的回收；`LICENSE` 里指向已不存在目录的 vendor 表述；指向 `core/pinax` 的过时指引；以及谱系门禁里为这些残留开的白名单。

## 5. 每张单的出口

机器门禁全绿（测试、验收、数字锚、架构统计、隔离 e2e）＋本单红线测试＋工单里点名的反证；新机制贴出生产调用点；`VERIFIED` 只写实跑过的东西。

## 5.5 收口（2026-11-25 晚）

19 张单（12 主单＋7 张段内返工）全部已验收；总验收记录见 [`docs/workorders/OS-cleanup-final-acceptance.md`](../workorders/OS-cleanup-final-acceptance.md)。

## 6. 停线条件

- 任一单让金样测试（`decoupleStep2`／`decoupleStep3`）变红而无法等价恢复——停线，上报作者。
- 施工方提出需要放宽门禁、加白名单、删测试才能过——停线。
- 涉及作者真库数据语义且工单没有写明——停线问清再动。
