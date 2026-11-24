/**
 * OS-142 Host API：API 错误码词表转供叶子。
 *
 * 转出 src/api/contracts.mjs 的 API_ERROR_CODES（冻结对象）：NO_LIBRARY / PATH_ESCAPE /
 * NOT_FOUND / INVALID_ENTRY / REVISION_MISMATCH / WRITE_PROTOCOL_* / AGENT_* /
 * FORBIDDEN_ORIGIN / UNSUPPORTED_MEDIA_TYPE / MODULE_DISABLED（OS-144）/ FACT_EMPTY（OS-150a）/
 * FACT_UNREADABLE、AGENT_RUNTIME_FIXTURE（OS-150b）。
 *
 * 模块层（src/modules/**）构建响应失败对象时从这里取码，不许直引 src/api/**——
 * 错误码是与前端/API 消费方共享的契约词汇，改名字等于破坏 host-api@1 面
 * （真要动先升版本，见 src/protocol/README.md 版本约定）。只读，不落盘。
 */
export { API_ERROR_CODES } from '../api/contracts.mjs'
