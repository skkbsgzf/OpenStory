# 演示库 · 水浒传（MCP-only 重建）

OpenStory 的示例库（公版内容，可自由使用）。用库切换器 → 导入库 → 选本目录即可打开。

## 这个样本怎么来的

本目录**不是手搓业务文件**，而是由受版本控制的构建配方经真实 MCP 工具，从空目录重建：

```bash
node tools/verify/verify-mcp-build-e2e.mjs --out <临时目录>
node tools/samples/install-shuihu-sample.mjs --candidate <临时目录>
```

- 建库、套件、习惯、世界书、合法 fact、正文、剧本、会话/多局、归档、素材、exchange 导出
  全部来自 MCP 调用；构建脚本自身只创建隔离环境与审计文件。
- 77 次工具调用；语义 digest：`d620558b78389a6f8a71a428c10d76706ebc017d4b17f6502f309993a0d5c29f`。
- 7 条事实全部通过 `fact.data/v3`；主档与派生 wiki 的 revision 一致。
- 完整保留 18 篇世界书、6 节点会话、第 1 章归档、2 个角色立绘、1 个场景图与 BGM。
- 内容输入冻结在 `tools/samples/shuihu-input/`；非法旧 fact 主档没有复制，只保留合法重建配方。

## 已知边界

- 当前 clean-room 使用**假文本上游**验证多角色扮演的协议与落盘，不声称真实模型语义验收通过。
- 识图/生图/enrich 的真实模型能力仍需作者配置；样本不伪造这些结果。
- 安装器在替换前保留同盘旧样本备份，全部校验通过后才换入；失败可回滚。

## 可以试什么

1. 世界书：18 篇条目、标签树、双链、反链与图谱。
2. 正文：第一回纯净写作面、习惯命中、分析面板。
3. 故事源：7 条合法事实、剧情曲线、世界书关联与 wiki 派生。
4. 扮演：主线 6 节点、MCP 分局、第 1 章归档、角色/场景/BGM 素材。
5. 剧本与 exchange：剧本互转、`导入导出/shuihu-pedia.json` 可读回。

详细操作见 [`docs/DEMO.md`](../../docs/DEMO.md) 与 `skills/build-project/SKILL.md`。
