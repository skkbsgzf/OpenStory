# OS-150 · 架构文档数字改脚本生成，门禁比对

| 项 | 值 |
|---|---|
| 批次 | 段 A·立规矩 |
| 对应条目 | 遗留项（文档漂移）；服务第二批 G9f「README/ARCHITECTURE 锚点数字同批更新」 |
| 依赖 | 无 |
| 允许改动 | `scripts/arch-stats.mjs`、`package.json`（只许加 `scripts` 里的一条命令）、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`tools/acceptance/**`、`test/**`、`docs/**` |
| 风险 | 低 |
| 状态 | 待派 |

## 目标

`ARCHITECTURE.md` 里的分层行数与文件数两天内漂了三次（每批新增文件都会漂，且靠人手回填）。
根治：数字由脚本生成，门禁比对，人不再手填。

## 动工前必读

- `ARCHITECTURE.md`：所有写了「N 文件 / N 行」的地方，以及 L1–L7 分层表。
- `README.md` 里引用了同一批数字的行。
- `tools/acceptance/acceptance.mjs` 现有 16 项检查的写法（`check(...)` 的签名与用法）。
- `package.json` 的 `scripts` 段。

## 任务

1. **新增 `scripts/arch-stats.mjs`**（零依赖）：
   - 默认模式：按约定目录扫描，输出一份稳定的 markdown 表（层／目录／文件数／行数；另列 `public/app.js` 行数、端点数、测试文件数）。输出必须确定（同仓同状态两次运行逐字相同）。
   - `--check` 模式：取出 `ARCHITECTURE.md` 里两个标记之间的生成段落，与脚本输出逐字比对；不一致则退出码 1 并打印差异。
2. **`ARCHITECTURE.md`**：把现有的手写数字表放进标记段落（`<!-- arch-stats:start -->` … `<!-- arch-stats:end -->`）。
   标记之外的叙述里不再出现会漂的行数与文件数，改成引用「见生成表」。数字一律来自脚本输出。
3. **`package.json`**：加 `"arch:stats": "node scripts/arch-stats.mjs"`。只是脚本命令，不是依赖；`version`、`dependencies`、`devDependencies` 一个字不许动。
4. **门禁**：`tools/acceptance/acceptance.mjs` 新增一项「架构文档数字与实测一致」（调用 `--check`；只增不减）。
5. **`AGENTS.md`**：补一句「改了文件结构或行数之后跑 `npm run arch:stats` 回写文档，门禁会比对」。
6. `README.md` 里引用同一批数字的地方同步（改成不写具体数字、指向架构文档，或纳入生成段落——二选一，写明理由）。

## 不做

- 不动 `core/**`、`vendor/**`、`src/**`、`public/**`。
- 不引任何依赖、不加构建步骤。

## 验收

- `node --test test/*.test.mjs` 全绿（只增不减）。
- `node tools/acceptance/acceptance.mjs` 全绿（本单后 17 项；若 OS-148/149 已各加一项则相应更多）。
- 反证实验：手动把 `ARCHITECTURE.md` 生成段落里的一个数字改坏，门禁必须红；把输出贴进交付说明，然后改回。
- 连续跑两次 `node scripts/arch-stats.mjs` 输出逐字相同（把两次的哈希贴进交付说明）。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁真的落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件，越界的不提交。
- 遇到门禁不可能通过、规格互相矛盾、或必须删／放宽既有测试才能过——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
