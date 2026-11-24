# OS-158 · 浏览器端存储清零——任何端口打开都是同一份设置

| 项 | 值 |
|---|---|
| 批次 | 段 B⁺·推送前整备（作者 2026-11-24 裁定：git push 之前做完） |
| 对应 | 作者原话：「所有浏览器缓存都被干掉，不管是在任何端口打开项目都是一份设置」 |
| 依赖 | 无 |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/acceptance/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 低 |
| 状态 | 待派 |

## 目标

浏览器里不再存任何状态。设置只有一份，在磁盘上；换端口、换浏览器、清了缓存，打开同一个项目都是同一份。

## 主 agent 审计到的事实

- 全前端只剩**一处**真用法：皮肤选择。`public/app.js:11881` 写 `localStorage.setItem('openstory-skin', id)`、`:12008` 读；当初留下的理由是「要在没有库时也生效」。
- 另有 6 处注释仍写着「per-library localStorage」（`:1192` 临时会话、`:1547`、`:2543`、`:3415`、`:6174`、`:7307`）——逐个核实是真用法还是过时注释。
- 浏览器存储按「源（协议＋主机＋端口）」隔离：`:8807` 存的皮肤，`:8810` 读不到。**这正是「换端口就不是同一份设置」的根因。**

## 任务

1. **全量审计**（证据贴进报告）：`public/**` 的 js／mjs／html 里搜 `localStorage`、`sessionStorage`、`indexedDB`、`document.cookie`、`caches.open`、`CacheStorage`、`serviceWorker`，以及方括号写法 `localStorage['…']`。每一处归类：真用法／过时注释／字符串字面量。
2. **皮肤进服务端**：
   - 存机器级偏好文件（没开库也要能用），落本机院子；位置写进 `AGENTS.md` 第 10 条落盘表；
   - 新增一对端点（读／写机器级界面偏好），契约照现有分域登记（端点计数递增属合法更新）；
   - 开机取数要在首屏渲染之前完成，**不许出现「先默认皮肤再闪一下」**——做法你来定（例如在 `app.js` 之前先取一次），写明理由；
   - **不做旧值迁移**：跨源的存储本来也清不到，升级后皮肤回缺省一次，报告里写明这一点。
3. **注释清账**：那 6 处注释改成事实（现在存在哪）。
4. **门禁**：验收新增一项「前端零浏览器存储」——扫 `public/**`（js／mjs／html），命中上面任一关键字即红，允许清单为空。只增不减。
5. **HTTP 缓存**：确认 html／js／css 仍是 `no-store`（OS-93c 的口径）；门禁里若没有这条断言，补上。

## 不做

- 不改库内 `ui-state` 的任何键与语义；不动内核；不改 Host API。
- 不做旧 `localStorage` 值的迁移（理由见任务 2）。

## 验收

- `node --test test/*.test.mjs` 全绿（只增不减）。
- `node tools/acceptance/acceptance.mjs` 全绿（新增一项）。
- **反证**：在某个 `public` 文件里临时写一行 `localStorage`，门禁必须红；贴输出后删掉。
- `public/app.js` 行数不增。
- 收尾跑 `npm run arch:stats` 回写。

## 浏览器验收（主 agent 做）

两个端口（`8807` 与一个临时端口）各开一次，改皮肤后另一端刷新应一致；清掉浏览器存储后仍是同一份。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁真的落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件，越界的不提交。
- 测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库，也不要改本机库清单。
- 遇到门禁不可能通过、规格互相矛盾、或必须删／放宽既有测试才能过——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）

**结论：通过。2026-11-24 由接手 agent 施工＋验收。**

- 状态：已提交（提交号见看板）；测试 592 例（590 过 / 0 挂 / 2 跳，较基线 586 增 6）；门禁 21 过 / 0 挂 / 0 警（较基线 19 增 S3.4 / S3.5）；app.js 12,466 行（不增）；架构统计已回写（端点 101→103）。
- **服务端落盘**：新增 `src/services/uiPreferences.mjs`——皮肤落 `%LOCALAPPDATA%/PinaxNext/openstory/ui-preferences.json`（与 agent-config 同院），路径只此一处解析、env 注入隔离；新增 `GET/PUT /api/ui-preferences` 两端（system 域，契约 101→103），无库也可读写、原子写、非法 id 400。
- **前端**：`setSkin()` 写改走 PUT（失败不影响本次生效）；`bootStyles()` 读改走 GET；启动改 `;(async () => { await bootStyles(); boot() })()`——皮肤先于首屏 render 取到，杜绝闪一下（app.js 是普通 defer 脚本，不能用顶层 await，故用 IIFE 包裹）。无关键节点新增，行数靠合并注释回收，仍 12,466。
- **注释清账**：工单点名的 6 处＋另 5 处（共 11 处 app.js 注释）＋`analysisModules.mjs:9` 一处，字面 `localStorage` 全清，语义按「库内 ui-state / 服务端 ui-preferences」改写。
- **门禁新增**：S3.4 前端零浏览器存储（递归扫 public/** 的 js/mjs/html，命中 `localStorage|sessionStorage|indexedDB|document.cookie|caches.open|CacheStorage|serviceWorker` 即红，注释也算命中，允许清单空）；S3.5 静态资源 no-store 断言（补 OS-93c 口径，daemon 静态资源与 sendJson 均 no-store）。
- **反证**：临时在 `public/app.js` 追加一行 `localStorage.setItem(...)`，S3.4 命中 1 处、门禁 19 过 / 2 挂；删掉后 21/0/0。已按要求贴输出并还原。
- **冒烟**：临时 LOCALAPPDATA 起 daemon（端口 18807，不碰真机），PUT `skin:ink` → 磁盘 `ui-preferences.json` 内容为 `{"skin":"ink"}` → GET 两次均为 `ink`。证明皮肤唯一真源在服务端磁盘，浏览器源（端口/缓存）不再影响设置。
- **文档**：AGENTS.md 第 9/10 条改口径并补落盘表一行；`docs/UX-STRUCTURE.md` 页签状态改指库内 ui-state；ARCHITECTURE.md 生成段回写。

**LIMITATIONS**：未做真浏览器双端口目视冒烟——环境无浏览器自动化，改以服务端磁盘唯一真源的 HTTP 冒烟等价验证（结论一致：换端口/清缓存不影响）。按作者立宪，浏览器端「不闪一下」已在启动顺序上保证（await bootStyles 先于 boot 的 render），但未做逐帧目视确认。
