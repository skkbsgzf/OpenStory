/**
 * knowledge 端点 handler（OS-194 从 src/api/handlers/system.mjs 归位）。
 * 真源就地取用（knowledgeHealth/knowledgeAdapter/knowledgeRouter 都是本模块文件），
 * HTTP 管线与契约词汇经 context.host 注入。
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { defaultKbConfigPath } from './knowledgeAdapter.mjs'
import { collectKbStatus, kbServiceState, probeServices } from './knowledgeHealth.mjs'
import { resolveCollections } from './knowledgeRouter.mjs'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'

export function createHandlers({ host }) {
  const { apiErrors, sendError, sendJson, text } = host

  async function kbConfigGet(ctx) {
    const { res, context } = ctx
    const configPath = defaultKbConfigPath(context.env ?? process.env)
    let config = {}
    let error = ''
    try {
      if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch (err) { error = text(err?.message || err) }
    // 密钥只回掩码：sk-abc…xyz
    const rawKey = text(config.apiKey)
    const masked = rawKey ? `${rawKey.slice(0, 6)}…${rawKey.slice(-4)}` : ''
    return sendJson(res, 200, {
      ok: true,
      configPath,
      masked: true,
      config: {
        backend: text(config.backend) || 'weknora',
        baseUrl: text(config.baseUrl) || 'http://127.0.0.1:8080',
        apiKeyMasked: masked,
        spaceId: text(config.spaceId),
        collections: config.collections && typeof config.collections === 'object' ? config.collections : {}
      },
      ...(error ? { configError: error } : {})
    })
  }

  async function kbConfigPut(ctx) {
    const { res, request, context } = ctx
    const configPath = defaultKbConfigPath(context.env ?? process.env)
    let current = {}
    try { if (existsSync(configPath)) current = JSON.parse(readFileSync(configPath, 'utf-8')) } catch { current = {} }
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
    } catch (err) {
      return sendError(res, apiErrors.WRITE_PROTOCOL_IO_FAILED, `知识库配置写入失败：${text(err?.message || err)}`)
    }
    // 写后立刻重探
    await probeServices({ weknoraUrl: next.baseUrl, weknoraApiKey: next.apiKey }).catch(() => {})
    const status = await collectKbStatus({ configPath, services: kbServiceState, resolveCollections })
    return sendJson(res, 200, { ok: true, status })
  }

  async function kbTest(ctx) {
    const { res, request, context } = ctx
    const configPath = defaultKbConfigPath(context.env ?? process.env)
    let saved = {}
    try { if (existsSync(configPath)) saved = JSON.parse(readFileSync(configPath, 'utf-8')) } catch { saved = {} }
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
