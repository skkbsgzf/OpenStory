# OpenStory UX 结构清单（全局一致性规范）

> 这是交付标准四（UX 跳转层级 / 插件页面结构）的唯一事实源。
> 新功能落地前对照本清单；机械检查在 `tools/acceptance/acceptance.mjs` 的 S4 节。
> 口径对齐 OpenDesign：设计令牌单一真源（tokens.css / :root）＋组件约定＋跳转 ≤2 层。

## 一、页签层级（全局 ≤2 层）

```
顶栏
├─ 库选择器（下拉）
├─ 页签排（一级入口，全部可达；顺序与显示名来自 /api/plugins.slots.tab 投影）
│   ├─ 产物 / 正文 / 世界书 / 剧本 / 故事源 / 日志 / 习惯 / 扮演
│   ├─ 第三方工作台：module:<模块id>/<页面id>（manifest pages[].kind:'iframe'）
│   └─ 设置（宿主自有，固定排在模块页签之后）
└─ 页内子页签 / 工具行（二级）
    ├─ 扮演：引擎模式 ⇄ 剧情树（子页签）
    ├─ 世界书：全库图谱（默认）⇄ 笔记详情（点击进入）
    ├─ 正文：分析面板（右上 ⏱）＋ 左右浮层模块
    └─ 右栏 / 设置区 / 宿主动作：由 slot 投影决定是否出现（analysis/imagegen/knowledge/exchange）
```

**规则**
1. 任何新功能的入口必须能在顶栏页签或页内子页签两步内到达；超过两层的入口是违规。
2. **页签不是前端名单**：顺序、名称、模块归属只来自 manifest 的 `pages[]`／`slots[]`；
   `TAB_REGISTRY` 只登记渲染行为。新增内置页签＝manifest 加位置＋（需要时）行为表加一行。
   模块显示名的权威只有 manifest 的 `name`／`pages[].label`（经 `/api/plugins` 投影下发）；
   命名表只管目录名／日志模块名／契约域／MCP 前缀，不再存模块页签名（宿主设置页例外）。
3. 页签可被 × 收起（作者手动 `hiddenTabs`，落库内 `.openstory/ui-state.json`）；
   收起的页签在「+」菜单里从同一份投影勾回。模块停用不走 `hiddenTabs`，直接让投影消失。
4. 投影拉不到时页签栏显示「拿不到工作台清单」，**不退回硬编码名单**。
5. 浮层（左右栏模块、Agent 列）**不算层级**——它们是并行的附庸视图，不是导航节点。

**设置页层级（OS-204：两大域七项）**

```
顶栏页签「设置」
├─ 本体设置：外观 / 引擎与存储 / 关于
└─ 插件中心：插件治理台 / 面板 / 全部套件 / 本机模块
```

1. 整张导航只在一处定义：`public/views/settingsViews.mjs` 的 `SETTINGS_NAV`；旧分区深链经同文件
   `SETTINGS_REDIRECT` 一张表收敛，不再散落在渲染分支里。`app.js` 不再持有 `SETTINGS_GROUPS`。
2. 左右栏 8 个面板的开关独立成「面板」一节，仍写库内 `moduleHidden`；套件详情不再嵌「工作台模块」小节。
3. 治理台、全部套件、本机模块三处只经 `loadPlugins()` 一个装载函数取数——`/api/plugins` 已带
   货架四键，前端不再请求套件端点；写完套件状态/设置也统一回载再渲染。
4. 导航项不按套件逐条铺行；套件清单只在「全部套件」主面按六组排，主从两栏照旧。
5. 「关于」页的版本号取自 `/api/health.appVersion`，取不到显示「未知」，不写死。

## 二、浮层宪法（OS-48，不可协商）

1. 左栏（`ref-col`）/ 右栏（`analyze-col`）/ Agent 列是**绝对定位浮层**，不挤占正文流；
   正文恒居中。禁止 `.with-analyze` 式魔法数 padding 回潮（门禁 S3.2 机械检查）。
2. 浮层内容 = 卡片堆叠：`.ref-mod` / `.analyze-sec`，一律 `surface-card + shadow-card`，
   无明显框线（类纸）。阴影在卡片上，不在栏容器上（OS-49）。
3. 开关就地生效，不整页重绘。

## 三、组件约定（CSS 单一真源 = index.html `:root` 令牌）

| 语义 | 约定 | 令牌/类 |
|---|---|---|
| 卡片面 | 中性面，比画布深一档 | `--surface-card`（color-mix 派生）+ `--shadow-card` |
| 关闭（模块卡） | 圆形幽灵按钮 | `.rm-x` / `.rm-toggle` |
| 关闭（整页） | 页头 × | `.page-close`（icon-btn 家族） |
| 错误 / 加载 | 统一提示条 | `.error-box` / `.loading` |
| 主色 / 危险 / 成功 | 语义令牌，禁止裸色值 | `--accent` / `--danger` / `--ok` |
| 金色强调（图例/徽标） | 令牌 | `--gold`（本批新增） |
| 圆角 / 阴影 | 令牌 | `--radius(-md/-lg)` / `--shadow(-card/-float)` |

**规则**：样式表令牌定义区（`:root` 及暗色覆盖块）之外不得出现裸色值；
新颜色先进 `:root`，再引用。设计令牌包导出见 `design-system/`（OpenDesign 范式）。

## 四、跳转一致性

1. 节点/链接跳转统一走 `go(view)`；图谱节点点击 → 信息卡按钮跳转，点空白复位。
2. 参考单向性在 UX 层的体现：正文里 `[[链接]]` 只做显示跳转，不反向注入参考上下文。
3. 跨模块跳转都落在**已有页签**上，不为跳转新建孤儿页面。

## 五、新功能接入 checklist（合入前过一遍）

- [ ] 入口 ≤2 层（顶栏页签 / 页内子页签）
- [ ] 页签/卡片/动作位来自 `/api/plugins.slots` 投影；前端没有第二份页签名单或顺序
- [ ] 卡片用 surface-card + rm-toggle/rm-x，关闭按钮不做旁路实现
- [ ] 颜色全部走令牌；新令牌已进 `:root` 与 `design-system/tokens.css`
- [ ] 浮层不挤压正文；正文恒居中
- [ ] 功能有 MCP 工具面（S1 标准）且 `docs/mcp/*.md` 已同步
- [ ] `node tools/acceptance/acceptance.mjs` 全绿
