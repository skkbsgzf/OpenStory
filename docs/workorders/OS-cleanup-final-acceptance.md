# 清账批总验收记录（监督线，2026-11-25）

> 对象：清账批 12 张主单＋6 张段内返工单（OS-188a／189／190／190a／191／192／193／194／195／195a／195b／196／196a／197／197a／198／198a／199／199a）。
> 施工：CodeBuddy CLI（`hy4flash`）为主，OS-197／198／199 三张由作者改派 Qoder 完成（未及提交，监督线先打快照再落袋）。
> 口径：作者 2026-11-25 裁定「遗留全部做完，不接受妥协」「Pinax 业务全部退役」。

## 一、最终数字（`docs/number-anchors.json` 机器真源）

| 项 | 值 |
|---|---|
| 全量测试 | **845 例／843 过／0 挂／2 条件跳过**（两轮一致） |
| 验收门禁 | **29 过／0 挂／0 警** |
| 契约端点 | 108（41 模块独占＋67 宿主自有；宿主域端点 0） |
| 内置 manifest | 21（7 kernel＋12 workbench＋2 宿主组合面） |
| `app.js` | **10,107 行**（上限 10,500，只降不升） |
| 发布检查器（repo-publish） | **11/11 全绿** |
| 隔离 e2e | 水浒 10/10＋新建 13/13 全绿（临时 daemon，未碰 8807） |

## 二、七句完成口径逐句核（每句都有探针，脚本在 `D:\Pinax-e2e\.zcode\tmp\`）

1. **Pinax 运行时关联为零**：产品代码里 `pinax` 命中 20 处，全部是两类——一次性升级器 15 处（`src/protocol/libraryUpgrade.mjs`，作者旧库的出口）＋出处注释 5 处（`src/kernel/index.mjs`、`fact/enrich/*`、`fact/domain/vocabulary.js`、`storage/projectDoc.mjs`）；第三类 0 处。旧院克隆、旧清单 `recentProjects` 读、`imported-pinax`、运行时旧临时前缀回收、`LEGACY_*` 常量全部清零（OS-189）。
2. **旧库升级不改错不漏改**：`verify-os188a.mjs` 与 `accept-d-probes.mjs` B1 实测——嵌套同名段（`世界书/参考/…`、`扮演/推演/…`）原样；库根首段照改；旧关系扩展键抬升；`.pinax-tmp-` 归档；坏 JSON 进 `skipped`；失败注入回滚。
3. **分类表逐行落地**：21 份 manifest 页面 id＝slug＝`slots[].page`；12 个工作台正名逐个在册（含「日志」）；命名表显示名＝目录名＝日志模块名；前端行为表无页签名/目录/模块/顺序字段；Agent 栏显示名＝插件名（无 Pi-Agent）。
4. **内核只经能力句柄**：模块→别的模块静态 import 0；宿主→非宿主组合面模块 0（只对 `agentbar`／`library` 放行 3 条）；模块空壳 0；`src/protocol` 转供叶 0；实现登记表只被自身持有；`src/services` 只剩七个底座服务；protocol 34 个文件逐文件登记。
5. **D 批四个机制都有生产调用方**：覆盖路由＋回退链（`moduleRuntime` 快照路径）；迁移器（`libraryMigrations` 按库准备＋失败剔除＋解析层 `DATA_VERSION_AHEAD`）；套件统一 manifest（`loadShelfCapabilityManifests` 五类货架一个入口，48 项全进能力图）；slot 编排（`slotProjection` 下发＋前端 `projectedTabDefs` 消费）；`activate()` 生产调用点（`handlerTable.activateModules`）；钩子经同一张贡献表。
6. **第三方可执行模块按 ADR 0003 开门**：`verify-196a.mjs` 六场景全过（注释吞 import 被拒且标记未写／抢端点双方不 activate／依赖文件 v1→v2 生效／不许接管宿主端点／模块自带端点打通／本机钩子被取到）；静态扫描九例对抗全拒；边界门运行期强制（`module.registerHooks`），`engines` ≥22.15。
7. **文档与实现一致**：ADR 0002 两张表与 21 份 manifest 逐项一致（17 个能力 id／12 个工作台 requires）；README 仓结构表、ADR 0002／0003、协议文档、AGENTS、规划状态按实现改写（OS-199a 六处）；数字锚扩到 README；发布检查器 11/11。

## 三、收尾时监督线自己修的三处（不属于任何施工方的单）

| # | 问题 | 处置 |
|---|---|---|
| 1 | 空信任表时 `/api/plugins` 误报「当前 Node 不支持解析钩子」（实际 Node 24 支持，只是没装本机模块时钩子未注册） | 只在「有登记根却没装上」或「Node 不支持」时提示，两种情形分开报；补 `test/moduleBoundaryStatus.test.mjs` 两例 |
| 2 | 内置 suites 每次都被合成出来的「本机」那一遍报 `SUITE_BUILTIN_MISMATCH`（3 条噪音挂在每次 `/api/plugins`） | 双喂只保留匹配装载源那一遍的警告 |
| 3 | 发布检查器（`~/.zcode/skills/repo-publish`）把样例库自带的 `.openstory/{project.json,ui-state.json,plugins/suite-state.json}` 当运行残留——与 OS-160 作者裁定冲突 | 检查器改为按 OS-160 白名单放行这三件，其余运行态仍算残留；反证：塞一个 `.history/` 立刻变红 |

另修：协议文档与 README 里的函数名 `loadSuiteCapabilityManifests()` → 实际导出 `loadShelfCapabilityManifests()`（4 处）。

## 四、仍留给作者的

- **切换到新版**：先停 8807 旧 daemon 再用新版起；本机没有 `libraries.json`，升级后库清单为空、五个库要手动重加；每库首次打开时升级，库根留 `.retired-<时间戳>`，`.history/upgrade-<时间戳>/` 有完整备份；`水浒传`、`泄密的心` 走合并分支。
- **push 与 tag**：本地提交未推送（`origin/main` 仍 `4d8ad95`），推送与版本 tag 由作者下令；CI 跑在 `ubuntu-latest`，本机只在 Windows 验过，首跑有变数。
- **ADR 0002 §九**里的 D1–D8 已按「不接受妥协」全部实施并入档，过目即可。
- 保留的两个诊断噪音：`STYLES_DIR_MISSING`（临时院子里没有本机风格目录时的提示，真实机器上随 `%LOCALAPPDATA%/OpenStory/openstory/styles` 是否存在而出现）。
