/**
 * OS-194：模块 handler 的宿主工具注入口。
 *
 * handler 归位到 src/modules/<id>/ 后受 S2.1 约束（模块只许 node:/protocol/本模块），
 * 不能再静态 import src/api/** 与 src/host/**。这里把契约词汇与 HTTP/授权管线收成一只
 * 只读工具袋，由 src/host/moduleLoader.mjs 在 activate(context) 时注入 `context.host`，
 * 模块 handler 从闭包取用——实现仍只有一份（真实源文件），不复制、不另造口径。
 *
 * 内核能力不在这里：fact/deduce/prose/media/agent-runtime 一律经 context.resolve(id)
 * 取句柄（OS-193 K2），宿主工具袋只放非内核的宿主面与契约纯函数。
 */
import { API_ERROR_CODES, isPlainObject, validateRequest, validateResponse } from '../api/contracts.mjs'
import { sendError, sendJson, text, DEFAULT_PORT } from './http.mjs'
import { authorizeRoot, resolveInsideRoot } from './authorize.mjs'
import { suiteValue } from '../services/suites.mjs'
import { submitJob } from './jobCenter.mjs'

export const HOST_TOOLS = Object.freeze({
  apiErrors: API_ERROR_CODES,
  isPlainObject,
  validateRequest,
  validateResponse,
  sendError,
  sendJson,
  text,
  defaultPort: DEFAULT_PORT,
  authorizeRoot,
  resolveInsideRoot,
  suiteValue,
  submitJob
})
