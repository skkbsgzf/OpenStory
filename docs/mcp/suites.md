# 套件域

套件为写作、编剧等任务提供货架配置。套件启停与设置不同于模块启停：套件状态落在库的 `.openstory/plugins/suite-state.json`；模块归属、启停与能力图由 `openstory_plugins` 投影，不能把套件开关当成模块开关。

## 工具

| 工具 | 必填参数 | 用途与边界 | 最低确认 |
|---|---|---|---|
| `openstory_suites` | — | 列套件、状态、设置与覆盖；`root` 可选 | read |
| `openstory_suite_enable` | `id,enabled` | 启用/停用套件；`root` 可选，省略则改本机默认 | create |
| `openstory_suite_settings` | `id,values` | 合并写入套件设置，只覆盖传入键；`root` 可选 | create |

## 读取与选择

```text
openstory_suites
  → 不带 root：读本机默认
  → 带 root：读该库启停状态、设置与本机覆盖
```

先取真实套件 `id`，再调用启停或设置。回读 `openstory_suites` 确认状态；涉及模块能力是否可用时再读 `openstory_plugins`。

## 启停套件

```text
openstory_suite_enable {id,enabled:true,root?,confirm:"create"}
openstory_suites {root?} → 核对 enabled 与 settings
```

带 `root` 改该库状态，省略 `root` 改本机默认。启停即时反映到模块投影，但**不代替**模块治理；不要用它绕过停用检查或伪造能力可用。

## 写套件设置

```text
openstory_suite_settings {id,values:{...},root?,confirm:"create"}
openstory_suites {root?} → 回读设置
```

`values` 是键值对象，只覆盖传入键，不是整份替换。典型用途是配置写作套件的新建章节默认标题。只写工具 schema 与套件定义接受的键，不借设置对象塞入任意状态或凭据。
