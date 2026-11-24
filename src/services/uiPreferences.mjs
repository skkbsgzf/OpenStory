/**
 * 机器级界面偏好（OS-158）——只存皮肤这类「没有库也要生效」的纯渲染偏好。
 *
 * 与库内 ui-state（.pinax/ui-state.json，随库走）分工：
 *   · 库内 ui-state＝跟稿子走的界面状态（页签/模块开关/选中项），换机器靠库文件复原；
 *   · 本机 ui-preferences＝不随库走的机器级偏好，落本机院子（%LOCALAPPDATA%/PinaxNext/openstory/）。
 *
 * 落这一份的理由：浏览器存储按「协议＋主机＋端口」隔离，:8807 存的皮肤 :8810 读不到——
 * 这正是「换个端口就不是同一份设置」的根因。放到服务端本机文件后，任何端口打开同一项目
 * 读的是同一份偏好；清浏览器缓存也不影响。
 *
 * 不做旧 localStorage 值迁移：跨源的旧值本来也清不到，升级后皮肤回缺省一次（工单裁定）。
 * 零 npm 依赖；路径解析只此一处（defaultUiPreferencesPath），测试用 env 注入隔离。
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from '../protocol/hostWrite.mjs'

function text(value) {
  return String(value ?? '')
}

/** 机器级偏好文件：与 agent-config.json 同一院子。env 注入便于测试隔离。 */
export function defaultUiPreferencesPath(env = process.env) {
  const base = text(env.LOCALAPPDATA || env.APPDATA).trim()
  return base ? join(base, 'PinaxNext', 'openstory', 'ui-preferences.json') : ''
}

/** 皮肤 id 归一：只认 [\w-]，长度 ≤64；其它值回退缺省。 */
export function normalizeSkin(value) {
  const skin = text(value).trim()
  return /^[\w-]{1,64}$/u.test(skin) ? skin : ''
}

/** 读机器级偏好；文件不存在／坏档都回空对象（缺省皮肤由前端 styles 列表兜底）。 */
export function readUiPreferences(preferencesPath) {
  const target = text(preferencesPath).trim()
  if (!target || !existsSync(target)) return { preferences: {}, error: '' }
  try {
    const raw = JSON.parse(readFileSync(target, 'utf-8'))
    const skin = normalizeSkin(raw?.skin)
    return { preferences: skin ? { skin } : {}, error: '' }
  } catch (error) {
    return { preferences: {}, error: text(error?.message || error) }
  }
}

/** 写皮肤偏好：未知键丢弃（只认 skin），原子写；空值＝清除回缺省。 */
export async function writeUiSkin(preferencesPath, skin) {
  const target = text(preferencesPath).trim()
  if (!target) return { ok: false, code: 'NO_PREFERENCES_PATH', message: '找不到 LOCALAPPDATA，无处落界面偏好' }
  const value = normalizeSkin(skin)
  if (text(skin).trim() && !value) return { ok: false, code: 'INVALID_SKIN', message: '皮肤 id 非法（只许字母数字下划线连字符，≤64 字符）' }
  const current = readUiPreferences(target).preferences
  const next = { ...current }
  if (value) next.skin = value
  else delete next.skin
  try {
    await mkdir(dirname(target), { recursive: true })
    await atomicWriteFile(target, JSON.stringify(next, null, 2))
  } catch (error) {
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `界面偏好写入失败：${text(error?.message || error)}` }
  }
  return { ok: true, preferences: next }
}
