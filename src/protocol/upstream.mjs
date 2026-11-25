/**
 * OS-142 Host API：上游模型通道转供叶子。
 *
 * 把 agent.runtime 内核件的对话通道按原名转出，模块层（如推演 prose 转写）
 * 经此取用，不许直引 src/services/**：
 *   · resolveChatUpstream(config, context) —— 按配置选上游（endpoint/runtime kit/cli）
 *   · chatCompleteViaUpstream({ upstream, system, user, maxTokens, temperature, cwd })
 *       → { ok, text, … }；上游不可达/非 2xx 返回 AGENT_UPSTREAM_ERROR 一类失败对象，
 *         不冒充模型回答（OS-4 口径）
 *   · resolveUpstreamSafe({ context })     —— 容错版选路：没配上游给 { ok:false,
 *         code:AGENT_NOT_CONFIGURED }，不抛
 *
 * 纯通道语义：本叶子不落盘；真正的模型输出落盘由调用方经协议层写通道完成
 * （hostWrite/正文协议）。网络超时/上游错误码语义以 chatUpstream 原文件为准。
 */
import { KERNEL_CAPABILITIES as K } from './capabilityImplementations.mjs'

// OS-195a：兼容叶已删；本叶子经唯一静态入口取 agent.runtime 句柄，仍不落盘、不复制实现。
export const resolveChatUpstream = (...args) => K.agentRuntime.resolveChatUpstream(...args)
export const chatCompleteViaUpstream = (...args) => K.agentRuntime.chatCompleteViaUpstream(...args)
export const resolveUpstreamSafe = (...args) => K.agentRuntime.resolveUpstreamSafe(...args)
