# OS-208 验收记录（监督线独立施工，2026-11-26）

**结论：通过。** 页面矩阵 22 个唯一 API＋必要功能端点 11 组测试全绿。

## 交付

- `test/pageApiSmoke.test.mjs`：页面矩阵每个 `requiredApi` 的真实 HTTP 成功用例＋响应契约；两库 root 隔离；未授权 root、缺参、路径越界负向。
- `test/pageNecessaryApi.test.mjs`：日志写入/读取/单条/恢复/安全备份、草稿 upsert/read/list/delete、Agent DSH models/session/picks、任务过滤/取消/清理、机器偏好、目录、KB 配置/测试、同步检查。
- 修复 4 个真实产品缺陷：
  1. `src/api/handlers/chapters.mjs`：日志恢复漏导入 `resolveInsideRoot`，必现 500；
  2. `src/host/http.mjs`：`ALREADY_SETTLED` 未映射 HTTP 状态，重复取消返回 500；
  3. `src/modules/knowledge/handlers.mjs`：`kbConfigGet` 缺契约声明的 `masked` 字段；
  4. `src/api/contracts/agent.mjs`：`agentPicksGet.explicit` 类型写成不存在的 `true|false`，改 `boolean`，外部形状不变。

## 实测

- `node --test test/pageApiSmoke.test.mjs test/pageNecessaryApi.test.mjs`：11/11。
- 全量：919 例／917 过／2 跳过／0 挂。
- 验收：29/0/0；arch check、number anchors 全绿。
- 反证：移除日志恢复的 `resolveInsideRoot` import，日志恢复用例立刻红（exit=1）。
- 8807 未动；所有夹具临时库＋临时 `LOCALAPPDATA`。

## 测试语义校正（不改产品行为）

- 草稿 module/id 是既有“归一化”语义（非法分隔符被清洗），测试改为断言落盘安全而非误期望 400。
- 皮肤 id 合法规则是 `[\w-]{1,64}`，未知但合法的 id 会保存；非法字符用例才拒绝。
- `正文` 不是保留目录名（`.openstory/.history/node_modules` 才是），已存在目录按幂等成功。
- 同步响应是 `sameSource.wikiStale` / `external.externalChanges`，按真实契约断言。

## 限制

- MCP 全工具数据面与 41 模块端点逐一停用/恢复在 OS-209。
