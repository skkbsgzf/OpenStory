# VENDORED — 底座抽取层出处

`core/pinax/` 下的 49 个文件**逐字 vendor** 自 [Pinax-next](https://github.com/skkbsgzf/Pinax-StoryHarness)
分支 `feat/pinax-electron-next`，提交 `70a4f44`（2026-11-15）。抽取方式＝递归追 import 闭包
（`scripts/vendor-core.mjs`），内部相对 import 原样保留——**这些文件在本仓不改**；
改动应发生在上游 Pinax-next，然后重跑 vendor 脚本同步。

## 映射

| 本仓 | 上游 |
|---|---|
| `core/pinax/next/**` | `next/**`（kernel/project/runtime/shell 底座面＋carriers 载体清单） |
| `core/pinax/server/**` | `server/**`（章节号解析＋世界书契约判定——导入适配的依赖） |
| `core/pinax/shared/**`、`core/pinax/electron/**` | 同名目录（闭包拉进的世界书/词库契约与 fs 耐久化） |
| `node_modules/@pinax/core` | 上游 npm 包 @pinax/core 0.16.0（载体的 domain/usecases 依赖；后续随底座升格处理） |

## 边界

- 载体**清单**（manifest.mjs）随底座走——OpenStory 只用 projectKind/dataDirs/依赖闭包做建库；
  载体**实现**（tools.mjs）不上底座（OpenStory 从不调用，registry.install 的 impl 传空）。
- `@pinax/core` 包是上游 pinax-core 抽包路线的既有产物（core README 禁 monorepo），
  本仓作为消费者依赖；底座升格时按同一模式把 core/pinax/ 逐步上收。
