/**
 * 本机院子唯一路径来源（OS-166 / G10a＋G10c，品牌分家；OS-189 退役旧院克隆）。
 *
 * 院子＝%LOCALAPPDATA%/OpenStory/，归 OpenStory；首次解析只负责「没有就建」。
 * 本机其余目录一律不读、不写、不删（含历史遗留目录与其中可能存在的标记文件）。
 * env 注入是测试隔离的唯一手段：夹具一律传临时 LOCALAPPDATA，绝不碰真实院子。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const COURTYARD_DIR = 'OpenStory'

/** 本机院子所在的父目录：LOCALAPPDATA 优先、APPDATA 兜底；两者都没有返回空串（如实，不猜路径）。 */
export function courtyardBase(env = process.env) {
  return String(env?.LOCALAPPDATA || env?.APPDATA || '').trim()
}

/** 新院不存在就建，已存在原样返回。同步实现，所有 defaultXxxPath() 仍是同步函数。 */
export function ensureCourtyard(base) {
  const home = String(base ?? '').trim()
  if (!home) return { created: false, reason: 'no-base' }
  const target = join(home, COURTYARD_DIR)
  try {
    if (existsSync(target)) return { created: false, reason: 'target-exists' }
    mkdirSync(target, { recursive: true })
    return { created: true, reason: 'created' }
  } catch (error) {
    return { created: false, reason: `error:${error?.code || error?.message || error}` }
  }
}

/**
 * 新院根：`LOCALAPPDATA` 优先、`APPDATA` 兜底；两者都没有返回空串，并由
 * ensureCourtyard('') 给出 `no-base` 可观测原因——绝不静默回落到猜出来的路径。
 */
export function courtyardRoot(env = process.env) {
  const base = courtyardBase(env)
  if (!base) return ''
  ensureCourtyard(base)
  return join(base, COURTYARD_DIR)
}

/** 新院下的路径：courtyardPath(env, 'openstory', 'agent-config.json')。 */
export function courtyardPath(env, ...segments) {
  const root = courtyardRoot(env)
  return root ? join(root, ...segments.map((part) => String(part ?? ''))) : ''
}
