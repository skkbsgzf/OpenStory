# 第五批总验收（2026-11-26，监督线独立施工）

**结论：通过。** 作者要求「每个页面需要有对应的前端可视测试，以及后端必要功能的测试」已按页面矩阵、真实 Chromium、真实临时 daemon HTTP 与 MCP 子进程四层落地。

## 一、工单与提交

| 工单 | 内容 | 提交 |
|---|---|---|
| OS-206 | 临时 daemon fixture、页面矩阵、零依赖 CDP 客户端、浏览器 smoke 与报告 schema | `963d4a8` |
| OS-207 | 34 个真实 Chromium 页面场景、窄屏、页内视图、弹层、降级、治理交互、第三方 iframe | `5888f45` |
| OS-208 | 22 个页面必需 API＋必要后端功能真实 HTTP；修 4 个产品缺陷 | `435fe64` |
| OS-209 | 41 模块端点停用恢复、24 MCP 工具隔离链路、扮演关键动作、本机运行期契约 | `5993357` |
| OS-210 | CI 隔离 E2E＋独立浏览器 job、报告完整性硬门禁、文档与数字锚 | `cc2ea1e` |

规划提交：`0ffa6c6`；看板提交：`0ed5f42`。五张工单与总记录均在仓内，**未 push、未 tag**。

## 二、六句出口条件逐句核对

### 1. 页面矩阵覆盖所有顶层页、七设置分区与主要页内视图，缺一页即红 —— 通过

- 34 个场景，矩阵从 `/api/plugins.slots`、`TAB_REGISTRY`、`SETTINGS_NAV` 派生并交叉校验。
- 覆盖库管理/新建/导入/修复、8 个工作台页、7 个设置分区、世界书图谱、故事源三形态、扮演叙事流/剧情树/Agent、2 个弹层，以及没开库治理、能力图点选、停用确认、2 个降级场景、第三方 iframe。
- 运行前校验矩阵完整性，报告校验页面集合精确等于矩阵，缺页/重复页/未知页均非零。

### 2. 浏览器 smoke 全部页面通过，manifest 无 fail/manual，截图齐全非空 —— 通过

- **34/34 场景通过，0 fail、0 manual、0 skip。**
- **47 个 viewport 记录**：1500×980 主视口，关键页补 675px/420px。
- **34 张真实 PNG 截图**，全部 >1KB 且通过 PNG 头校验。
- 无 console.error、pageerror、非预期 HTTP 错误、横向溢出；关键 disabled/ARIA/展开状态在矩阵动作中断言。
- 证据：`D:\Pinax-e2e\.zcode\tmp\os210-browser-final2\manifest.json`（本批运行产物，不入 git）。

### 3. 页面必需 API 与关键写入/治理/MCP 全绿，负向与幂等有明确断言 —— 通过

- OS-208：22 个唯一页面 API 真实 HTTP 200＋响应契约；日志/草稿/Agent/任务/偏好/目录/KB/同步必要功能；两库隔离、未授权 root、缺参、路径越界负向。
- OS-209：41/41 模块端点逐一「停用→409 `MODULE_DISABLED`→恢复→不再 409」；24/24 MCP 工具有成功映射或明确负向；章节/世界书/习惯写备份；参数错类型/枚举/额外参数 -32602；EOF 与 stdout 纯净。
- 扮演：多局管理、最后一局拒删、导出、转正、pending dismiss/write、重复卡 404、opening/turn 假上游、空事实包拒绝。
- 本机模块：合法 JSON 放行，缺字段/错类型/非 JSON 发车前拒绝；模块根确认门、路径门、重复根、移除清理、静态宿主路径越界。

### 4. CI 两个 job 全绿，失败产物可下载 —— 结构通过，远端待 push 后由 GitHub 执行

- `gates`：Node 24、两轮单测、验收、架构核对、隔离全栈 E2E。
- `browser-smoke`：Ubuntu、系统 Chromium、Node 24、完整页面矩阵＋报告完整性二次校验。
- 两 job 均 `if: always()` 上传日志；浏览器 artifact 含 manifest、run.log、console/pageerror 记录与截图，保留 7 天。
- `verify-ci-workflow.mjs` 本地结构校验通过。**未 push，故不声称 GitHub Actions 已运行。**

### 5. 既有测试只增不减，门禁只增不减，`app.js` 不增，外部名不变 —— 通过

- 全量：**930 例／928 过／2 跳过／0 挂**；2 个跳过均为既有条件跳过。
- 验收：**29/0/0**；端点 **108**；测试文件 **122**；`app.js` **10,044 行**（上限 10,500）。
- `package.json` 版本仍 **0.2.0**，依赖未改；manifest、端点路径、24 个 MCP 工具名未改。
- 原浏览器报告测试保留，新增 skip、非 PNG、路径越界与 CI 结构反证；无放宽断言。

### 6. 8807、作者真库、真实 `%LOCALAPPDATA%` 全程未动 —— 通过

- 本批所有测试使用系统临时目录、临时库、临时 `LOCALAPPDATA/APPDATA`、`port:0` daemon、假上游与临时 Chromium profile。
- 未连接或重启 8807；未读取 `D:/Projects/**`；未打开或升级作者真库。

## 三、关键实测命令

```bash
npm test                                           # 930 / 928 pass / 2 skip / 0 fail
node tools/acceptance/acceptance.mjs               # 29 / 0 / 0
node tools/arch-stats.mjs --check                  # 通过
node tools/number-anchors.mjs --check              # 通过
node tools/verify/verify-ci-workflow.mjs           # 通过
node tools/verify/verify-os172-e2e.mjs             # 水浒 10/10＋新建/半成品 13/13
node tools/verify/page-browser-smoke.mjs --out <临时目录>
node tools/verify/verify-page-report.mjs <临时目录>  # 34/34、47 viewport、34 PNG
node --test test/browserSmokeArtifacts.test.mjs     # 2/2 反证
```

## 四、产品修复与测试编排修复

- OS-208 修 4 个真实缺陷：日志恢复漏 import 导致 500；重复取消任务 500；KB 配置缺 `masked`；Agent picks 契约非法类型。
- OS-209 加固 MCP JSON Schema 子集参数校验与本机模块 JSON 响应契约。
- OS-210 修浏览器测试事件串页：每视口重置错误收集，页末留事件回合，末视口保留关键交互和截图。

## 五、边界与后续

- 本批**只提交，不 push**；工作树干净。
- CI 的远端双 job 结果需作者下令 push 后观察；本地已完成等价结构验证与全部门禁执行。
- 生产 daemon PID 12736（8807）保持原状；Cloudflare 检视报告与临时报告服务属上一项内部检视工作，不在本批操作范围。
