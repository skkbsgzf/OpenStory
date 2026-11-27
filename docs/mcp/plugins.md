# 插件投影与界面状态域

这两个工具用于检查模块/能力图，以及经宿主事务写库界面状态。它们不提供任意模块加载、代码执行或旁路状态写入口。

## 工具

| 工具 | 必填参数 | 用途与边界 | 最低确认 |
|---|---|---|---|
| `openstory_plugins` | — | 读插件、模块、`moduleGraph`、`slots`、套件状态与能力报告；`root` 可选 | read |
| `openstory_ui_state` | `root,state` | 合并写入库 ui-state（模块开关、界面选择、排版等），经宿主能力图事务校验并备份 | create |

## 模块投影

```text
openstory_plugins {root}
  → plugins / modules / moduleGraph / slots / 套件状态 / 能力报告
```

带 `root` 按该库状态投影，省略则读本机/默认投影。它是只读检查口，不触发模块启停或旧库升级。建库、套件配置或 ui-state 写入后，用它核对模块归属、能力图与槽位降级情况。

本机模块报告中的 `gate/rejections/warnings` 是实际装载闸的结果；工具只呈现报告，不为失败模块伪造可用状态。

## 合并写 ui-state

```text
1. openstory_plugins {root}                     → 核对当前模块图
2. openstory_ui_state {root,state:{...},confirm:"create"}
3. openstory_plugins {root}                     → 回读投影
```

`state` 是要合并进 ui-state 的键值对象，**不是整份替换**。宿主会按能力图候选事务校验，并保留备份；不能借它绕过模块治理或写任意机器级文件。

套件启停与设置仍用 `openstory_suite_enable` / `openstory_suite_settings`，不要混写套件状态文件。模块停用后相关端点可能返回 `MODULE_DISABLED`，能力缺失返回 `PLUGIN_DEGRADED`；以 `openstory_plugins` 的真实报告为准。
