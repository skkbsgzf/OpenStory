# OS-214 · 剧本与扮演服务端原语

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 A |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | OS-211 |
| 允许改动 | `src/modules/script/**`、`src/modules/roleplay/**`、`src/modules/deduce/**`、`src/modules/fact/**`、`src/api/contracts/fact.mjs`、`src/api/handlers/fact.mjs`、`test/**`、相关文档与数字锚 |
| 风险 | 高——跨工作面服务端能力 |
| 状态 | 待施工 |

## 目标

把目前只在前端纯函数或 UI 控制器中的剧本互转、多局与扮演关键动作补成可经 HTTP/MCP 调用的服务端能力。

## 任务

1. 剧本↔fact 互转：复用 `public/scriptFact.mjs` 的确定性算法，下沉为服务端共享实现；新增契约端点与 fact 写通道，禁止浏览器私有逻辑成为唯一生产路径。
2. 多局/会话：list/new/switch/delete/get/put；最后一局拒删、删除留档、显式 root/bookId/sessionId。
3. 扮演/推演动作：turn/archive/export/promote/pending/branch、素材盘点与单素材读取、推演生图；复用现有 handlers，不复制实现。
4. 需要模型的动作保持现有 agent.runtime 能力与假上游测试；模型不可用返回明确错误，不伪造成功。
5. 明确每个写操作的备份/留痕与幂等语义；会话、fact、正文之间转正保持 revision 与日志正确。

## 验收

- 新端点全部经真实临时 daemon HTTP 验证，响应过契约；模块停用/缺能力/参数错有明确错误。
- 剧本互转前后内容 digest 与 fact 条目可回读；重复 operationId 不重复写入。
- 多局、最后一局拒删、转正、pending dismiss/write、素材路径越界均有成功与负向。
- 不新增 MCP 工具（包装在 OS-215）；全量测试、验收、数字锚全绿。
- 不 push。
