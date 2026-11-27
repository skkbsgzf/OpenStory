/**
 * knowledge 端点 handler（OS-194 从 src/api/handlers/system.mjs 归位）。
 * 真源就地取用（knowledgeHealth/knowledgeAdapter/knowledgeRouter 都是本模块文件），
 * HTTP 管线与契约词汇经 context.host 注入。
 */
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { defaultKbConfigPath, loadKbConfig, maskApiKey } from './knowledgeAdapter.mjs'
import { collectKbStatus, kbServiceState, probeServices } from './knowledgeHealth.mjs'
import { resolveCollections } from './knowledgeRouter.mjs'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'

export function createHandlers({ host }) {
  const { apiErrors, sendError, sendJson, text } = host

  async function kbConfigGet(ctx) {
    const { res, context } = ctx
    const configPath = defaultKbConfigPath(context.env ?? process.env)
    const loaded = await loadKbConfig(configPath)
    const config = loaded.config ?? {}
    // 密钥只回尾号掩码；短密钥（≤8）全掩码，绝不回显前缀。
    return sendJson(res, 200, {
      ok: true,
      configPath,
      masked: true,
      config: {
        backend: text(config.backend) || 'weknora',
        baseUrl: text(config.baseUrl) || 'http://127.0.0.1:8080',
        apiKeyMasked: maskApiKey(config.apiKey),
        spaceId: text(config.spaceId),
        collections: config.collections && typeof config.collections === 'object' ? config.collections : {}
      },
      ...(loaded.ok ? {} : { configError: loaded.code === 'KB_CONFIG_CORRUPT' ? 'KB 配置不可读或已损坏；请先修复原文件' : loaded.message })
    })
  }

  async function kbConfigPut(ctx) {
    const { res, request, context } = ctx
    const configPath = defaultKbConfigPath(context.env ?? process.env)
    // 写前校验：坏 JSON/不可读一律 KB_CONFIG_CORRUPT，绝不以空对象覆盖原字节。
    const loaded = await loadKbConfig(configPath)
    if (!loaded.ok) return sendError(res, apiErrors.KB_CONFIG_CORRUPT, loaded.message)
    const current = loaded.config ?? {}
    // apiKey 传 __KEEP__ ＝保留原值（前端不回传明文）
    const incomingKey = text(request.apiKey)
    const apiKey = incomingKey === '__KEEP__' ? text(current.apiKey) : incomingKey
    const next = {
      ...current,
      backend: text(request.backend) || text(current.backend) || 'weknora',
      baseUrl: text(request.baseUrl) || text(current.baseUrl) || 'http://127.0.0.1:8080',
      apiKey,
      spaceId: request.spaceId !== undefined ? text(request.spaceId) : text(current.spaceId),
      collections: request.collections && typeof request.collections === 'object'
        ? request.collections
        : (current.collections ?? {})
    }
    try {
      await mkdir(dirname(configPath), { recursive: true })
      await atomicWriteFile(configPath, JSON.stringify(next, null, 2))
    } catch {
      return sendError(res, apiErrors.WRITE_PROTOCOL_IO_FAILED, '知识库配置写入失败；原配置未被覆盖')
    }
    // 写后立刻重探
    await probeServices({ weknoraUrl: next.baseUrl, weknoraApiKey: next.apiKey }).catch(() => {})
    const status = await collectKbStatus({ configPath, services: kbServiceState, resolveCollections })
    return sendJson(res, 200, { ok: true, status })
  }

  async function kbTest(ctx) {
    const { res, request, context } = ctx
    const configPath = defaultKbConfigPath(context.env ?? process.env)
    const loaded = await loadKbConfig(configPath)
    if (!loaded.ok) return sendError(res, apiErrors.KB_CONFIG_CORRUPT, loaded.message)
    const saved = loaded.config ?? {}
    const baseUrl = text(request.baseUrl) || text(saved.baseUrl) || 'http://127.0.0.1:8080'
    const apiKey = text(request.apiKey) && text(request.apiKey) !== '__KEEP__' ? text(request.apiKey) : text(saved.apiKey)
    await probeServices({ weknoraUrl: baseUrl, weknoraApiKey: apiKey }).catch(() => {})
    const status = await collectKbStatus({ configPath, services: kbServiceState, resolveCollections })
    return sendJson(res, 200, {
      ok: true,
      weknora: kbServiceState.weknora ?? { up: false },
      embedding: kbServiceState.embedding ?? { up: false },
      collections: status.collections ?? []
    })
  }

  async function kbStatusGet(ctx) {
    const { res, context } = ctx
    const status = await collectKbStatus({
      configPath: defaultKbConfigPath(context.env ?? process.env),
      services: kbServiceState.lastCheck ? kbServiceState : null,
      resolveCollections
    })
    return sendJson(res, 200, status)
  }

  return { kbConfigGet, kbConfigPut, kbTest, kbStatusGet }
}
