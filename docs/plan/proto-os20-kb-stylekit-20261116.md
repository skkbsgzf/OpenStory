# 工单 OS-20/21 · 本地知识库（WeKnora Lite）＋ StyleKit 协议与设计包

> 作者 2026-11-16 指示：①本地项目级知识库，部署 WeKnora，把本地文档/skill/近期拆书工程放进去；
> ②设计「知识库→stylekit 协议」与「stylekit 设计包」。
> 承接：`docs/BLUEPRINT-creative-kits-20261116.md`（L2 风格层／L4 装配层）。

## 0. 环境实况（先记，影响部署路径）

| 项 | 状态 |
|---|---|
| Docker / docker compose | **不可用**（未安装） |
| WSL2 | 有内核（2.6.3）但**无发行版** |
| Go | **未安装** |
| C 编译器 | msys2 的 `gcc`（ucrt64）在 |
| Node | v24.14.0 |
| Python | 3.12.10 |
| D 盘空余 | 53G |

→ 结论：走 **WeKnora Lite 单二进制**（零依赖：SQLite＋内存队列，默认只本机、免注册），
需要 `CGO_ENABLED=1 go build -tags sqlite_fts5`（官方 `scripts/package-lite.sh` 口径）。
Docker Compose 全量版需要先装 Docker Desktop，本单不做。

## 1. OS-20 · WeKnora Lite 本机部署

1. 源码已克隆：`D:\weknora`（v0.9.0，`git clone --depth 1`）。
2. Go 工具链：阿里云镜像下载 `go1.23.12.windows-amd64.zip` → `D:\tools\go`（winget 与 go.dev 均因网络不可用）。
   *注：WeKnora go.mod 要求 go 1.26.0；若 1.23 编译被拒，改用最新镜像版本再建。*
3. 构建：`CGO_ENABLED=1 go build -tags "sqlite_fts5" -o WeKnora-lite.exe ./cmd/...`；
   PATH 里带 msys2 `ucrt64\bin`（gcc）。
4. 配置：`.env.lite`（复制 `.env.lite.example`）——填空模型/embedding 端点（OpenAI 兼容或 Ollama）；
   Lite 默认只本机监听。
5. 启动验证：`GET /api/v1/knowledge-bases` 返回 200；Web UI 打开；
   用 1–2 个真实文档跑一次「入库→检索」，证明链路通。
6. 入库规划（作者资料的实际归位）：
   - `拆解/*.json` → 每本书一个 collection（条目逐条成文档，带 layer/章节元信息）；
   - `*.wiki.json` → 聚合视图（或由拆解派生，不重复入库）；
   - Pinax `next/skills/*`（7 个 SKILL.md）→ 整包 `craft` collection；
   - 作者指定目录的笔记/教程 → 按目录分 collection；
   - **正文原文默认不入库**（版权与体量），作者显式选择才入且标 `role:"exemplar"`。

## 2. OS-21 · StyleKit 协议与设计包

协议全文：`docs/STYLEKIT-PROTOCOL-20261116.md`；货架协议：`stylekits/PROTOCOL.md`。
本单已完成的**代码部分**：`kbAdapter.mjs`（KB 唯一边界，三能力＋mock/weknora 双后端＋真实 API 对齐）。

后续批次（不在本单）：
- stylekit 装载器与货架（`stylekits/*.json` 发现/规整/本机覆盖）；
- 三层选择器 UI（题材标签 → 文风参数 → 剧情风格）；
- 装配器（fact/instruction 分块＋守卫＋优先级链仲裁＋检索预算）；
- 现有 `styles/`（纯 tokens）→ stylekit 迁移（降级子集关系已在协议里写明）。

## 3. 验收

- [ ] `WeKnora-lite.exe` 能在本机启动，`/api/v1/knowledge-bases` 200。
- [ ] 至少一个真实 collection 入库成功，`POST /api/v1/knowledge-search` 有命中。
- [ ] `kbAdapter` 用真实 baseUrl 跑通 listCollections/query（用真 KB 替换 mock 的一次实测）。
- [ ] 协议文档两份入仓（已完成）；测试 110 例全绿（已完成）。

## 4. 边界

- 不做 Docker Compose 全量版（需先装 Docker Desktop）；不做多空间/RBAC；
- 不做文档解析引擎矩阵（Lite 只有 Simple 解析）；
- 原文语料入库必须作者显式操作（版权纪律）。
