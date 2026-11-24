# OpenStory 改进路线清单（第二批）2026-11-23 —— 原文照录

> **来源**：作者 2026-11-24 在对话中贴入，主 agent 逐字照录入仓，作为第二批的唯一原文依据。
> 粘贴时表格被压平成行、文末「启动时机总表」的代码块内容丢失（原文处留有「代码块」字样），其余一字未改。
> 主 agent 对本清单的事实核对与工单化，见 [`workorder-system-20261124.md`](workorder-system-20261124.md)；
> 各单状态见 [`docs/workorders/BOARD.md`](../workorders/BOARD.md)。

## 执行结果（OS-168 收口回填，2026-11-24）

> 逐条按原文编号核；「提交」列取该事项落地/收口的主提交，前置同类提交见工单验收记录。
> 全部条目已做，无「部分/未做」残留；原文照录部分不改，结果集中在这里。

| 编号 | 原文事项 | 结果 | 工单 | 提交 |
|---|---|---|---|---|
| G8a | 五层命名单一真源表 | 已做：`NAMING_TABLE` 为唯一真源，页签/日志层回表 | OS-148 | `b2a296c` |
| G8b | 「世界书」目录归属＋参考补建＋白名单 | 已做：目录名冻结、`世界书/` 为载体兼容输入、absorb 进 `参考/`、新库骨架建 `参考/` | OS-164 | `79ec0f9` |
| G8c | acceptance 锚点＋落盘表补推演容器 | 已做：CORE_TABS 强检查、AGENTS 第 10 条补 `推演/` | OS-149 | `d6bc106` |
| G8d | 拆解→故事源改名并入命名表 | 已做：ad-hoc 改名收敛到注册表 | OS-148 | `b2a296c` |
| G8e | echo-kit 标 fixture 不再进作者可见列表 | 已做：货架保留、测试不变、UI 过滤 | OS-149 | `d6bc106` |
| G9a | errors/atomicWrite 自有＋F6 原子写收敛 | 已做：F6 先于本批（OS-138），管道件影子迁移 OS-152，收尾 OS-157 | OS-152／157 | `5c3a887`／`ce14075` |
| G9b | enrich 两件自有 | 已做：wikiDerive/factPack/enrich 进 `src/kernel/` | OS-154 | `bc24c3b` |
| G9c | deduce 链三件自有＋llmPort | 已做：8 件归扮演模块引擎目录，Host API 降 @2 | OS-155 | `f11743f` |
| G9d | factFileStore 自有 | 已做：写协议进 `src/kernel/fact`，金样+直测照绿 | OS-156 | `ae01987` |
| G9e | 传递依赖清点、core 退役 | 已做：`core/` 13→0 文件全删 | OS-156 | `ae01987` |
| G9f | vendor 纪律整体退役 | 已做：manifest/漂移检测/vendor 脚本/文档段全退，`core/`、`vendor/` 消失 | OS-157 | `ce14075` |
| G10a | 本机院子改名＋首启只拷贝迁移 | 已做：新院 `OpenStory`，旧院冻结保留，跳 `*.tmp-*`/`daemon.lock` | OS-166 | `cf24bfe` |
| G10b | 库清单分家＋设置页导入 Pinax 清单 | 已做：新院 `libraries.json` 自持，旧清单只读勾选导入，互认靠库内 `project.json` | OS-167 | `e282e8e` |
| G10c | 运行态归口纪律 | 已做：套件状态库级化（OS-160）＋AGENTS 第 10 条补规则（OS-166） | OS-160／166 | `ab854be`／`cf24bfe` |

---

范围：承接第一批（F1-F7 安全护航 ＋ G1-G7 插件化重构，已派发执行中）。 第二批＝三个追加批次：G8 命名归一 · G9 内核自有化 · G10 品牌分家，全部源自 2026-11-23 晚间三场调研（命名审计 / pinaxAdapter 查证 / 数据面盘点＋作者裁定）。 配套总图见《OpenStory 目标架构图.md》；本文各批次明细在《OpenStory 改进路线清单.md》批次 7/8/9 同步维护。

## 批次 7 —— 命名归一（G8）

背景一句话：同一概念在 磁盘目录 / UI 页签 / changelog 模块 / 契约域 / MCP 名 五层各有一名、无单一真源，已产生三处真实索引断裂（「参考」目录被 UI 叫「世界书」且新建库只建「世界书/」不建「参考/」；acceptance.mjs:267 CORE_TABS 三个锚点失真；AGENTS.md OS-89 落盘表缺 推演/ 容器）。

```
# 事项                                   代价            启动时机
G8a 立「五层命名单一真源表」（概念 id → 目录名/页签/changelog 模块/契约域/MCP 名/落盘位置，六列），
    进 AGENTS.md 硬规则＋PUBLISHING 检查项；新增命名必须先改表               半天           立即
G8b 裁定「世界书」目录归属：目录名冻结（参考/ 不迁移）；世界书/ 定义为 Pinax 载体兼容输入
    （建库后自动补建 参考/ 或走 absorb）；UI 图谱/摘要 label 统一二选一
    （现状：左栏「参考图谱」vs 右栏「世界书图谱」两个名字）；
    importAdapter.mjs:57 白名单补 参考                                   半天＋建库逻辑   等 G5（目录消费进插件 manifest 时一并声明）
G8c 修 acceptance.mjs CORE_TABS 为真实页签名（产物/正文/扮演/设置…）；AGENTS.md 落盘表补 推演/ 行    10 分钟   立即
G8d daemon.mjs:802 的 拆解→故事源 ad-hoc 改名并入 G8a 命名表，显示层改名只剩一处来源          顺手           随 G8a
G8e runtimes/echo-kit（回声参考套件＝OS-18 骨架模板＋测试夹具，非产品功能）manifest 加 fixture:true——
    货架保留、测试不变、UI 运行时选择列表不再展示（不改名不删除）                10 分钟         立即
```

验收：新库「世界书」页签不再空转；samples 与新建库目录形态一致；验收锚点与 UI 一致；echo-kit 不出现在作者可见列表。

## 批次 8 —— 内核自有化：pinaxAdapter 与 core/pinax vendor 退役（G9）

背景一句话：作者裁定 pinaxAdapter 是临时适配器，不是内核——60 行里 projectMeta/projectImport 两组转引的本来就是自持文件（OS-123/124）；真正 import core/ 的只有 8 个文件（factFileStore、deduce 链三件、enrich 两件、errors/atomicWrite），却拖着 24 文件 4,332 行 vendor＋一整门永久盯防税。核心洞察：兼容的锚是落盘格式金样（decoupleStep2 逐字段冻结），不是 vendor 代码——自有代码产出同样格式，互认分毫不损；且 vendor 禁改条款正在锁死 schema 演化（G7/G8 都要动内核，这是临时架构的复利债）。

摘除路线（从叶子到核心，每步独立提交）：

```
# 事项                                   验收                                            启动时机
G9a errors.mjs/atomicWrite.mjs 摘为 src/kernel/ 自有；顺手完成 F6 原子写收敛（全仓统一走这一份）
                                                                            直测覆盖；vendor 清单除名 2 项            与 G1/G2 并行
G9b enrich 两件（pseudoChapters/metrics）摘为自有
                                                                            补直测（现无）；因果图三指标口径用金样/行为断言锁死    与 G1/G2 并行
G9c deduce 链三件（opening/turn/settle）摘为自有
                                                                            直测＋「同种子同事实包＝同一拍」行为锁；
                                                                            顺势整理 llmPort 接口（解掉 11-18 路线图 P2 悬案）   与 G1/G2 并行
G9d factFileStore 摘为自有（最后摘：写协议核心，依赖最深）
                                                                            decoupleStep2 金样照绿＋factGuard 三定律照绿＋
                                                                            新增写协议直测全绿                         等 F2（写端点直测护航）且 G7 ADR 已出
G9e 传递依赖清点：24 个 vendor 文件里未被 8 文件触达的直接删除；core/ 目录若摘空整体退役
                                                                            core/ 消失或只剩真实必需                   G9a-d 后
G9f vendor 纪律整体退役：vendored-manifest.json、vendorDrift.test（16 用例）、scripts/vendor-*.mjs、
    PUBLISHING 的 VENDORED.md 段、ARCHITECTURE L2/L3 合并为「自有内核」一层
                                                                            npm run vendor:check 删除；README/ARCHITECTURE 锚点数字同批更新   G9e 后
```

与 G3 的衔接：G3（Host API）落地时 pinaxAdapter 文件消失，五组出口并入 src/kernel/ 的 Host API 私有实现层；门禁 S2.4 演变为「唯一 import core 的地方是 src/kernel/」直至「无 core 可 import」。

## 批次 9 —— 品牌分家（G10）

背景一句话：本机数据院与 Pinax 桌面共住 %LOCALAPPDATA%\PinaxNext\，作者裁定分家。分家原则：品牌（院子/清单/叙事）归 OpenStory；引擎照用不改名（G9 另行退役）；互认靠库内文件、不靠本机清单。

```
# 事项                                   代价            启动时机
G10a 本机院子改名 %LOCALAPPDATA%\PinaxNext\ → %LOCALAPPDATA%\OpenStory\；
     首启检测旧院子→一次性拷贝导入＋留迁移标记（不删旧院，Pinax 桌面继续用）       1 天           等 G5（与插件加载器重写同批，路径解析反正重写）
G10b 库清单分家：next-preferences.json → libraries.json 自持＋设置页「导入 Pinax 清单」入口；
     互认改走库内 .pinax/project.json；--preferences 参数与 root 白名单来源同步改    1 天           等 G5，随 G10a
G10c 归口纪律：新增运行态一律 .openstory/、不再进 .pinax/（旧库现状冻结不迁移）；
     OS-89 落盘位置表补此规则；kb-config/fs-browse 随新院                        半天            随 G10a
```

验收：旧机用户无感升级；Pinax 桌面不受影响（继续用旧院）；金样库在 Pinax 桌面照常打开（互认靠库内 project.json，不靠本机清单）。

### 启动时机总表（第二批 vs 第一批在途节点）

（原文此处为一个代码块，粘贴时内容丢失。）

立即可派（不依赖第一批）：
- G8a 真源表 → G8d（随 a）→ G8c 锚点修正 → G8e echo-kit 隐身

可与第一批 G1/G2 并行：
- G9a plumber → G9b enrich → G9c deduce（每步独立提交）

等第一批节点：
- G9d factFileStore ← 等 F2 直测护航 + G7 ADR 出结论
- G8b 世界书目录裁定 / G10a-c 品牌分家 ← 等 G5 插件加载器重写（同批）
- G9e → G9f vendor 退役 ← 等 G9a-d 全绿

### 红线（第二批新增，第一批红线继续有效）

- 金样不动：G9 每一步，decoupleStep2.test.mjs 金样必须照绿——它是 Pinax 互认的唯一锚，断金样＝断双壳一稿。
- 旧院不删：G10a 迁移只拷贝不删除，Pinax 桌面的数据安全不由 OpenStory 负责。
- 旧库不迁移：G8/G10 全部「新数据走新规」，不回头迁移既有库目录（磁盘兼容优先）。
- 每步可独立提交：G9 六步各带测试与 vendor 清单更新，禁止一口气大爆炸。
