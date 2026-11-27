# 多局会话与扮演域

一个事实书下可以有主会话与多个分局，`activeId` 指向当前激活会话。会话工具负责容器读写；推演节点推进与多角色扮演是两种不同引擎，不能混用。

## 会话工具

| 工具 | 必填参数 | 用途与边界 | 最低确认 |
|---|---|---|---|
| `openstory_sessions` | `root` | 列主线与分局、激活指针；`bookId` 可选 | read |
| `openstory_session_get` | `root` | 读会话全文；`bookId/sessionId` 可选，省略 sessionId 用 activeId | read |
| `openstory_session_new` | `root` | 新建空会话并设为激活；`bookId/title` 可选 | create |
| `openstory_session_switch` | `root,sessionId` | 激活已有会话；`bookId` 可选 | create |
| `openstory_session_delete` | `root,sessionId` | 非破坏删除，标记为 `.deleted`；最后一局不能删 | restore |
| `openstory_session_put` | `root,session` | 用完整 session 对象覆盖会话，先备份；不是补丁 | create |

## 多局管理

```text
1. openstory_fact_books {root}                → 定位 bookId
2. openstory_sessions {root,bookId}           → activeId / sessions
3. openstory_session_get {root,bookId,sessionId?} → 读当前或指定局
4. openstory_session_new {root,bookId,title?,confirm:"create"}
5. openstory_session_switch {root,bookId,sessionId,confirm:"create"}
6. openstory_sessions {root,bookId}           → 回读 activeId
```

删除使用 `confirm:'restore'`，且最后一局不可删。日常推进不要用 `openstory_session_put` 做小补丁：先选对应细粒度动作，只有明确需要完整替换会话对象时才整存。

## 推演 turn

`openstory_roleplay_turn` 推进推演会话的一回合，实际调用 `/api/deduce/turn`：

```text
openstory_roleplay_turn {
  root, bookId?, sessionId?,
  choiceId? / customText?, regenerate?,
  confirm:"create"
}
```

可从候选 `choiceId` 选择，也可给自定义 `customText`；`regenerate:true` 只重写最后一拍。它保存会话状态，是 create 级写调用。模型不可用时返回 `AGENT_NOT_CONFIGURED` 或上游错误，不伪造成功。

## 多角色扮演

| 工具 | 必填参数 | 用途与可选输入 | 最低确认 |
|---|---|---|---|
| `openstory_roleplay_opening` | `root,pov` | 主持人＋演员生成开场；`bookId/premise/openingDetail/chapterLimit` 可选 | create |
| `openstory_roleplay_scene_turn` | `root,pov,playerAction` | 主持人裁决→角色成文→收束；`bookId/sessionId/premise/chapterLimit/activation` 可选 | create |

这两个工具调用真实多角色扮演引擎并保存 roleplay 会话节点，需要可用模型；无模型或空回包必须明确失败。它们不是 `openstory_deduce_present`，也不是 `openstory_roleplay_turn`。区别详见 [deduce.md](deduce.md)。

## 会话动作

| 工具 | 必填参数 | 用途与边界 | 最低确认 |
|---|---|---|---|
| `openstory_roleplay_archive` | `root` | 把当前会话缓存区归档为扮演目录下的 md；`bookId/sessionId/title` 可选 | create |
| `openstory_roleplay_export` | `root` | 导出当前会话为扮演目录下的 md；`bookId/sessionId/title` 可选 | create |
| `openstory_roleplay_promote` | `root,nodeId` | 把节点转成正文章节，复用章节写通道并备份；`bookId/sessionId/title` 可选 | create |
| `openstory_roleplay_pending` | `root,pendingId` | 结算已存在待确认卡：`action` 为 `write` 或 `dismiss`；`bookId/sessionId` 可选 | create |
| `openstory_roleplay_branch` | `root,fromNodeId` | 从节点新建分支会话，保留节点与分叉溯源；`bookId/sessionId` 可选 | create |

`pending` 的 `write` 是单条 upsert 进 fact，不整份替换；它只结算既有卡，不创建待确认卡，重复 `pendingId` 返回 `NOT_FOUND`。`promote` 会写正文，空正文会被拒；不自动 absorb。归档与导出返回 `path/words`，写后应回读文件确认。
