/**
 * 推演引擎出口（OS-155）——扮演模块自己的确定性推演端子。
 *
 * 八件引擎（opening/turn/settle/candidates/fronts/patchChannel/sceneContext/sessionState）
 * 自上游推演链平移到本目录（OS-155，扩展名 `.js`→`.mjs`，逻辑逐字未改；
 * 出处见 docs/kernel-provenance.md）。
 * import 只改两处：fact 域原语与 factPack 改从协议层 `src/protocol/factDomain.mjs` 取。
 * 它们**不再属于内核**：推演是产品引擎（产生会话状态与新条目），不是只读派生。
 *
 * 导出面与上游推演适配组逐名对齐（四个端子，名字一字不改；出处同上）：
 *   openDeduceSession / presentTurn / applyDirectorAction / settleChoice
 * 同种子同事实包＝同一拍；返回内存会话对象，落盘由调用方经写通道完成。
 */

export { openDeduceSession } from './opening.mjs'
export { presentTurn, applyDirectorAction } from './turn.mjs'
export { settleChoice } from './settle.mjs'
