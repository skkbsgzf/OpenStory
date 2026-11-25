/**
 * 聊天上游解析（OS-9/OS-82，OS-141 daemon 拆分落位）——「文本模型在哪、怎么调」的唯一解析层。
 *
 * 三种上游收敛到同一次「单发单收」（chatCompleteViaUpstream）：
 *   · endpoint  → HTTP chat/completions（保留：本机 sidecar 一类也算 endpoint，但不是主路径）
 *   · cli       → 一次性子进程（cli-bridge.runCliChat），stdout 即回包
 *   · dsh-cli   → 一 run 一进程（dsh-cli.runDshStdio），收 delta 拼成回包
 * 活动 kit 优先（sidecar 拉起/endpoint 直连），不可达且 Pi 有配置＝兜底＋notice；
 * 无 kit 或选了 Pi＝走 daemon 本机端点配置。凭据只在本机，不回显。
 * 全仓只此一份定义；handler 一律从这里 import，不许复制。
 */
import { API_ERROR_CODES } from '../../protocol/apiErrors.mjs'
import { configTextBlock, configAgentBlock, loadConfigV2, text } from './config.mjs'
import { loadRuntimeKitFacts } from '../../protocol/shelfManifests.mjs'
import { probeRuntimeKit, ensureSidecar } from './runtimeSidecar.mjs'
import { resolveDshRun } from './dsh-bridge.mjs'
import { runCliChat } from './cli-bridge.mjs'
import { runDshStdio } from './dsh-cli.mjs'

/**
 * 上游解析（OS-9）：活动 kit 优先（sidecar 拉起/endpoint 直连），不可达且 Pi 有配置＝兜底＋notice；
 * 无 kit 或选了 Pi＝走 daemon 本机端点配置。凭据只在本机，不回显。
 */
function piUpstream(config) {
  const textBlock = configTextBlock(config)
  const endpoint = text(textBlock.endpoint).trim()
  if (!endpoint) {
    return { ok: false, code: API_ERROR_CODES.AGENT_NOT_CONFIGURED, message: '还没配置模型端点：点 Agent 列右上角的齿轮，填 OpenAI 兼容端点，或选一个运行时套件' }
  }
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, code: API_ERROR_CODES.INVALID_ENTRY, message: '模型端点只支持 http/https' }
    }
  } catch {
    return { ok: false, code: API_ERROR_CODES.INVALID_ENTRY, message: `配置的模型端点不是有效 URL：${endpoint}` }
  }
  return {
    ok: true,
    url: endpoint,
    headers: textBlock.apiKey ? { authorization: `Bearer ${textBlock.apiKey}` } : {},
    // 模型：对话模型优先，留空回落到 Agent 默认档（「OpenStory 默认模型」）
    model: text(textBlock.model || configAgentBlock(config).defaultModel).trim(),
    runtimeName: 'Pi 兜底'
  }
}

function fallbackToPi(config, reason) {
  const pi = piUpstream(config)
  if (pi.ok) return { ...pi, notice: `${reason}——本次用 Pi 兜底` }
  return { ok: false, code: API_ERROR_CODES.AGENT_UPSTREAM_ERROR, message: `${reason}，且 Pi 兜底也没有可用端点（${pi.message}）` }
}

export async function resolveChatUpstream(config, context) {
  const textBlock = configTextBlock(config)
  const activeKitId = text(textBlock.runtime).trim()
  if (!activeKitId) return piUpstream(config)
  const { kits } = loadRuntimeKitFacts(context.runtimesDirs)
  const kit = kits.find((item) => item.id === activeKitId)
  if (!kit) return fallbackToPi(config, `运行时套件 ${activeKitId} 不在货架上了`)
  const headers = kit.apiKey ? { authorization: `Bearer ${kit.apiKey}` } : {}
  if (kit.kind === 'endpoint') {
    return { ok: true, url: `${kit.url}${kit.chatPath}`, headers, model: kit.model, runtimeName: kit.name }
  }
  if (kit.kind === 'cli') {
    // CLI 嫁接：不走 HTTP——上游是一次性子进程（handleAgentChat 里 execute）
    const probed = await probeRuntimeKit(kit)
    if (probed.installed !== true) {
      return fallbackToPi(config, `CLI 不可用：${kit.name}（${probed.message ?? '未安装'}）`)
    }
    return { ok: true, execute: 'cli', kit, model: kit.model, runtimeName: kit.name }
  }
  if (kit.kind === 'dsh') {
    const run = await resolveDshRun(kit, { env: context.env })
    if (!run.ok) return fallbackToPi(config, `DSH 不可用：${run.message}`)
    // 推理深度（OS-39）：kit manifest / 本机配置里给了才发；不给＝用 DSH 自己的默认档
    const reasoningEffort = text(kit.reasoningEffort || textBlock.reasoningEffort).trim()
    // 模型（S4）：设置页选的 DSH 模型（provider/id）优先；没选＝用 kit manifest 的缺省档
    const model = text(textBlock.model || configAgentBlock(config).defaultModel).trim() || kit.model
    if (run.mode === 'cli') {
      // CLI stdio（od 协议）：一 run 一进程
      return { ok: true, execute: 'dsh-cli', dshRun: run, kit, model, reasoningEffort, runtimeName: kit.name }
    }
    return { ok: true, url: run.url, headers, model, runtimeName: kit.name }
  }
  const up = await ensureSidecar(kit, { env: context.env })
  if (!up.ok) return fallbackToPi(config, `运行时 ${kit.name} 起不来（${up.message}）`)
  return { ok: true, url: `http://127.0.0.1:${up.port}${kit.chatPath}`, headers, model: kit.model, runtimeName: kit.name }
}

/** 三通道对话补全（cli / dsh-cli / http）——返回 { text } 或 { error }，不抛。
 *  OS-82：从 generateTurnProse 抽出来共用——推演「戏剧」候选（llmPort.complete）与
 *  成文走同一份上游解析与通道，不引入第二套模型配置。剥代码围栏对 prose 与 JSON 提议都无害。 */
export async function chatCompleteViaUpstream({ upstream, system, user = '', maxTokens = 1500, temperature = 0.7, cwd = '' }) {
  if (!upstream?.ok) return { error: '模型不可用' }
  const prompt = user ? `${system}\n\n${user}` : system
  try {
    let raw = ''
    if (upstream.execute === 'cli') {
      const run = await runCliChat(upstream.kit, [{ role: 'user', content: prompt }], { model: upstream.model })
      if (!run.ok) throw new Error(run.message)
      raw = text(run.text)
    } else if (upstream.execute === 'dsh-cli') {
      let collected = ''
      const result = await runDshStdio({
        dshCmd: upstream.dshRun.dshCmd,
        profile: upstream.dshRun.profile,
        ...(cwd ? { cwd } : {}),
        prompt,
        ...(upstream.reasoningEffort ? { reasoningEffort: upstream.reasoningEffort } : {}),
        inactivityMs: 180_000,
        timeoutMs: 600_000,
        onText: (piece) => { collected += piece }
      })
      if (!result.ok) throw new Error(result.message || result.code || 'unknown')
      raw = text(collected || result.text || '')
    } else {
      const response = await fetch(upstream.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...upstream.headers },
        body: JSON.stringify({
          model: upstream.model,
          messages: [{ role: 'system', content: system }, ...(user ? [{ role: 'user', content: user }] : [])],
          max_tokens: maxTokens,
          temperature,
          stream: false
        }),
        signal: AbortSignal.timeout(180_000)
      })
      if (!response.ok) throw new Error(`LLM HTTP ${response.status}`)
      const data = await response.json()
      raw = text(data.choices?.[0]?.message?.content ?? '')
    }
    const out = raw.replace(/^```[^\n]*\n/u, '').replace(/\n```$/u, '').trim()
    if (!out) return { error: '模型返回为空' }
    return { text: out }
  } catch (error) {
    return { error: text(error?.message || error) || '模型不可用' }
  }
}

/** 解析全局文本模型上游（读不到/没配返回 null）。 */
export async function resolveUpstreamSafe({ context }) {
  try {
    const { config } = await loadConfigV2(context.agentConfigPath)
    const upstream = await resolveChatUpstream(config, context)
    return upstream?.ok ? upstream : null
  } catch { return null }
}
