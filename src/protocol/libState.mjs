/**
 * 库内状态存储（OS-89）——界面状态与未保存草稿的唯一真源。
 *
 * 作者立宪（AGENTS.md 第 8/9/11 条）：
 *   「所有内容必须放在本地……绝对不能放在任何浏览器缓存里」
 *   「未落盘的数据（用户还没保存、推演中的拍）都要落到本地」
 *
 * 提供两个东西：
 *   · ui-state.json —— 界面状态（页签开关、模块插拔、选中项、剧本偏好…）
 *   · drafts/<module>/<id>.json —— 未保存的编辑草稿
 *
 * 两者都：原子写（tmp+rename）、写前 .history 备份、变更记入 changelog。
 * 零依赖，可单测。
 */
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { recordChange } from './changelog.mjs'
import { LOG_MODULES, namingEntry } from './naming.mjs'
import { atomicWriteFile } from './hostWrite.mjs'

const text = (value) => String(value ?? '')

/** 库内固定位置（AGENTS.md 第 9 条表）。 */
export const UI_STATE_PATH = `${namingEntry('libraryStorage').metadataDir}/ui-state.json`
export const DRAFT_DIR = `${namingEntry('libraryStorage').metadataDir}/drafts`

/** 模块名归一：防路径穿越。 */
export function safeModule(raw) {
  const cleaned = text(raw).trim().replace(/[\\/:*?"<>|]/gu, '').slice(0, 40)
  return cleaned || 'misc'
}

/** 草稿 id 归一（同上）。 */
export function safeId(raw) {
  const cleaned = text(raw).trim().replace(/[\\/:*?"<>|]/gu, '_').slice(0, 120)
  return cleaned || 'default'
}

function uiStateAbs(root) {
  return join(root, ...UI_STATE_PATH.split('/'))
}

function draftAbs(root, module, id) {
  return join(root, ...DRAFT_DIR.split('/'), safeModule(module), `${safeId(id)}.json`)
}

/** 写前备份到同目录 .history（与稿件同一可逆语义）。 */
async function backupBefore(abs, stamp) {
  if (!existsSync(abs)) return null
  const backup = join(dirname(abs), '.history', `${abs.split(/[\\/]/u).pop()}.bak-${stamp}`)
  await mkdir(dirname(backup), { recursive: true })
  await copyFile(abs, backup)
  return backup
}

// OS-138：原子写归一 hostWrite.atomicWriteFile（fsync＋rename＋目录 fsync）；建目录留在本封装
async function atomicWrite(abs, content) {
  await mkdir(dirname(abs), { recursive: true })
  await atomicWriteFile(abs, content)
}

/* ---------- 界面状态 ---------- */

/**
 * 读界面状态。文件不存在＝空对象（首次打开库），不是错误。
 * @returns {Promise<{ok:boolean, state:object}>}
 */
export async function readUiState(root) {
  const abs = uiStateAbs(root)
  if (!existsSync(abs)) return { ok: true, state: {} }
  try {
    const raw = await readFile(abs, 'utf-8')
    const parsed = JSON.parse(raw)
    return { ok: true, state: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} }
  } catch {
    // 坏档不阻断界面——回空状态，让作者能继续用（原始坏文件仍在盘上）
    return { ok: true, state: {}, corrupted: true }
  }
}

/**
 * 浅合并写界面状态。只写变化的键，未给的键保持原值。
 * @returns {Promise<{ok:boolean, state?:object, backup?:string, code?:string, message?:string}>}
 */
export async function writeUiState(root, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, code: 'INVALID_ENTRY', message: 'state 必须是对象' }
  }
  const abs = uiStateAbs(root)
  const current = (await readUiState(root)).state
  const next = { ...current, ...patch }
  // 删键约定：值为 null ＝删除该键（方便前端收回某项偏好）
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
  }
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  try {
    const backup = await backupBefore(abs, stamp)
    await atomicWrite(abs, `${JSON.stringify(next, null, 2)}\n`)
    // 记日志（界面状态也属于「修改」，作者要能看到谁动了什么）
    await recordChange({
      root, module: LOG_MODULES.uiState, file: UI_STATE_PATH, op: existsSync(abs) ? 'update' : 'create',
      before: JSON.stringify(current), after: JSON.stringify(next), actor: 'author'
    })
    return { ok: true, state: next, ...(backup ? { backup: backup.split(/[\\/]/u).slice(-3).join('/') } : {}) }
  } catch (error) {
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `界面状态写入失败：${text(error?.message || error)}` }
  }
}

/* ---------- 编辑草稿 ---------- */

/**
 * 存草稿（upsert）。作者还没点保存的内容落在这里。
 * @returns {Promise<{ok:boolean, draft?:object, code?:string, message?:string}>}
 */
export async function saveDraft(root, { module, id, text: body = '', meta = null } = {}) {
  const mod = safeModule(module)
  const draftId = safeId(id)
  if (!mod) return { ok: false, code: 'INVALID_ENTRY', message: 'module 必填' }
  const abs = draftAbs(root, mod, draftId)
  const previous = existsSync(abs) ? JSON.parse(await readFile(abs, 'utf-8')) : null
  const record = {
    module: mod,
    id: draftId,
    text: text(body),
    chars: text(body).length,
    savedAt: new Date().toISOString(),
    ...(meta && typeof meta === 'object' ? { meta } : {})
  }
  try {
    await atomicWrite(abs, `${JSON.stringify(record, null, 2)}\n`)
    await recordChange({
      root, module: mod, file: `${DRAFT_DIR}/${mod}/${draftId}.json`,
      op: previous ? 'update' : 'create',
      before: previous ? text(previous.text) : '',
      after: record.text,
      actor: 'author',
      meta: { draft: true, ...(meta && typeof meta === 'object' ? meta : {}) }
    })
    return { ok: true, draft: record }
  } catch (error) {
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `草稿写入失败：${text(error?.message || error)}` }
  }
}

/** 读单份草稿；没有＝draft:null。 */
export async function loadDraft(root, module, id) {
  const abs = draftAbs(root, module, id)
  if (!existsSync(abs)) return { ok: true, draft: null }
  try {
    return { ok: true, draft: JSON.parse(await readFile(abs, 'utf-8')) }
  } catch {
    return { ok: true, draft: null, corrupted: true }
  }
}

/** 列某模块全部草稿（按保存时间新→旧）。 */
export async function listDrafts(root, module) {
  const dir = join(root, ...DRAFT_DIR.split('/'), safeModule(module))
  if (!existsSync(dir)) return { ok: true, drafts: [] }
  const out = []
  let names = []
  try { names = (await readdir(dir)).filter((name) => name.endsWith('.json')) } catch { names = [] }
  for (const name of names) {
    try {
      const parsed = JSON.parse(await readFile(join(dir, name), 'utf-8'))
      if (parsed && typeof parsed === 'object') out.push(parsed)
    } catch { /* 坏草稿跳过 */ }
  }
  out.sort((left, right) => text(right?.savedAt).localeCompare(text(left?.savedAt)))
  return { ok: true, drafts: out }
}

/** 删草稿（采纳后收口）。 */
export async function dropDraft(root, module, id) {
  const abs = draftAbs(root, module, id)
  if (!existsSync(abs)) return { ok: true, removed: false }
  try {
    const raw = await readFile(abs, 'utf-8')
    const parsed = JSON.parse(raw)
    await unlink(abs)
    await recordChange({
      root, module: safeModule(module), file: `${DRAFT_DIR}/${safeModule(module)}/${safeId(id)}.json`,
      op: 'delete', before: text(parsed?.text), after: '', actor: 'author', meta: { draft: true }
    })
    return { ok: true, removed: true }
  } catch (error) {
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `删草稿失败：${text(error?.message || error)}` }
  }
}
