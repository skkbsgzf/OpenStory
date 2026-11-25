/**
 * OS-196 G1：本机模块根的信任表 I/O（机器级，不属于任何库）。
 *
 * 落点固定：%LOCALAPPDATA%/OpenStory/openstory/module-roots.json。
 * 只有显式登记过的根才会被枚举；本文件是这张表唯一的读写口，
 * 契约与扫描逻辑在 src/protocol/localModuleContract.mjs / localModuleBoundary.mjs。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { atomicWriteFile } from '../protocol/hostWrite.mjs'
import { courtyardPath } from '../protocol/courtyard.mjs'
import {
  MODULE_ROOTS_SCHEMA, contentDigest, emptyModuleRoots, normalizeModuleRoots,
  normalizeRootPreview, sha256Hex
} from '../protocol/localModuleContract.mjs'
import { describeBoundaryViolation, scanModuleImportGraph } from '../protocol/localModuleBoundary.mjs'
import { validateModuleManifest } from '../protocol/moduleManifest.mjs'

const text = (value) => String(value ?? '')
const MAX_SCAN_FILES = 200

export function moduleRootsPath(env = process.env) {
  return courtyardPath(env, 'openstory', 'module-roots.json')
}

/** 读信任表：坏档按空表＋warning 处理，绝不因为一张坏表挡住 daemon。 */
export function readRootsTable(env = process.env) {
  const path = moduleRootsPath(env)
  if (!path) return { ok: false, path: '', roots: [], warnings: [{ code: 'MODULE_ROOTS_NO_COURTYARD', message: '找不到本机院子，信任表不可用' }] }
  let raw = null
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (error) {
    const missing = error?.code === 'ENOENT'
    return {
      ok: false,
      path,
      roots: [],
      warnings: missing ? [] : [{ code: 'MODULE_ROOTS_UNREADABLE', message: `信任表读不了，按空表处理：${text(error?.message || error)}` }]
    }
  }
  const normalized = normalizeModuleRoots(raw)
  return { ok: normalized.ok, path, roots: normalized.roots, warnings: normalized.warnings }
}

/** 写信任表：原子写；目录不存在先建（机器级路径，由 courtyard 锚定）。 */
export async function writeRootsTable(table, env = process.env) {
  const path = moduleRootsPath(env)
  if (!path) return { ok: false, message: '找不到本机院子，信任表无法落盘' }
  const next = { schema: MODULE_ROOTS_SCHEMA, roots: table?.roots ?? [] }
  mkdirSync(dirname(path), { recursive: true })
  await atomicWriteFile(path, `${JSON.stringify(next, null, 2)}\n`)
  return { ok: true, path, table: next }
}

/** 仅登记用的路径规整：必须绝对路径且是真实存在的目录。 */
export function normalizeRootPath(value) {
  const raw = text(value).trim()
  if (!raw || !isAbsolute(raw)) return { ok: false, message: '模块根必须是绝对路径' }
  const path = resolve(raw)
  try {
    if (!statSync(path).isDirectory()) return { ok: false, message: '模块根不是目录' }
  } catch {
    return { ok: false, message: '模块根目录不存在' }
  }
  return { ok: true, path }
}

function walkCodeFiles(dir, relative = '', out = []) {
  if (out.length >= MAX_SCAN_FILES) return out
  let entries = []
  try {
    entries = readdirSync(join(dir, relative), { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (out.length >= MAX_SCAN_FILES) break
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const rel = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) walkCodeFiles(dir, rel, out)
    // JSON 数据依赖也进内容摘要（OS-196a）：改 data.json 必须让整图摘要变。
    else if (/\.(?:mjs|js|cjs|json|css|txt)$/u.test(entry.name)) {
      try {
        out.push({ path: rel.replaceAll('\\', '/'), source: readFileSync(join(dir, relative, entry.name), 'utf-8') })
      } catch { /* 读不了的文件按缺失处理，由 import 图扫描点名 */ }
    }
  }
  return out
}

/**
 * 枚举一个根里的候选模块（不做任何装载）。
 * 每个子目录＝一个模块；坏 manifest／套件／越界 import 都出预览项，标状态与原因。
 */
export function inspectRoot(path, { registeredModules = [] } = {}) {
  const modules = []
  const warnings = []
  let entries = []
  try {
    entries = readdirSync(path, { withFileTypes: true })
  } catch (error) {
    return { modules, warnings: [{ code: 'MODULE_ROOT_UNREADABLE', message: `模块根读不了：${text(error?.message || error)}` }] }
  }
  const registered = new Map(registeredModules.map((item) => [text(item?.id).trim(), item]))
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const moduleDir = join(path, entry.name)
    const manifestPath = join(moduleDir, 'module.manifest.json')
    if (!existsSync(manifestPath)) continue
    let rawText = ''
    let raw = null
    try {
      rawText = readFileSync(manifestPath, 'utf-8')
      raw = JSON.parse(rawText)
    } catch (error) {
      modules.push({
        id: entry.name, name: entry.name, version: '', class: '', status: 'invalid', gate: 'identity',
        reason: `manifest 读不了：${text(error?.message || error)}`, manifestSha256: '', contentSha256: '',
        capabilities: [], requires: [], supplies: []
      })
      continue
    }
    const checked = validateModuleManifest(raw, { dirName: entry.name })
    if (!checked.ok) {
      modules.push({
        id: entry.name, name: text(raw?.name).trim() || entry.name, version: text(raw?.version).trim(), class: text(raw?.class).trim(),
        status: 'invalid', gate: 'identity', reason: checked.errors.join('；'), manifestSha256: sha256Hex(rawText), contentSha256: '',
        capabilities: [], requires: [], supplies: []
      })
      continue
    }
    const manifest = checked.manifest
    const base = {
      id: manifest.id, name: manifest.name, version: manifest.version, class: manifest.class ?? '',
      manifest,
      selfBuiltin: raw.builtin === true,
      manifestSha256: sha256Hex(rawText), contentSha256: '',
      capabilities: (manifest.capabilities ?? []).map((item) => item.id),
      requires: (manifest.requires ?? []).map((item) => item.id),
      supplies: (manifest.supplies ?? []).map(text)
    }
    // 套件照旧只许数据：本机根里发现 suite 直接跳过，不进入可执行层。
    if (manifest.class === 'suite') {
      modules.push({ ...base, status: 'skipped', gate: 'trust', reason: '本机模块根不装载套件（套件只许数据）' })
      continue
    }
    const files = walkCodeFiles(moduleDir)
    const scanned = scanModuleImportGraph(files, { entry: manifest.entry ?? 'index.mjs' })
    if (!scanned.ok) {
      modules.push({ ...base, status: 'invalid', gate: 'boundary', reason: scanned.violations.map(describeBoundaryViolation).join('；'), visited: scanned.visited })
      continue
    }
    const contentSha256 = contentDigest(scanned.visited)
    const previous = registered.get(manifest.id)
    const contentChanged = Boolean(previous && previous.contentSha256 && previous.contentSha256 !== contentSha256)
    const manifestChanged = Boolean(previous && previous.manifestSha256 && previous.manifestSha256 !== base.manifestSha256)
    modules.push({
      ...base, status: 'ok', gate: '', reason: '', contentSha256,
      contentChanged, manifestChanged,
      registeredContentSha256: previous?.contentSha256 ?? '',
      registeredManifestSha256: previous?.manifestSha256 ?? '',
      files: scanned.visited
    })
  }
  modules.sort((left, right) => left.id.localeCompare(right.id))
  return { modules, warnings }
}

/** 预览（作者点确认前）：只读、不写表、不装载。 */
export function previewRoot(value, env = process.env) {
  const located = normalizeRootPath(value)
  if (!located.ok) return { ok: false, path: text(value).trim(), modules: [], warnings: [{ code: 'MODULE_ROOT_PATH_INVALID', message: located.message }], risk: '' }
  const inspected = inspectRoot(located.path)
  const preview = normalizeRootPreview({ path: located.path, ...inspected })
  return { ok: true, ...preview }
}

/** 登记（必须已确认）：覆盖同路径旧表项，重复登记＝显式刷新。 */
export async function addRoot(value, env = process.env) {
  const located = normalizeRootPath(value)
  if (!located.ok) return { ok: false, code: 'INVALID_ENTRY', message: located.message }
  const current = readRootsTable(env)
  const inspected = inspectRoot(located.path)
  const record = {
    path: located.path,
    registeredAt: new Date().toISOString(),
    modules: inspected.modules.filter((item) => item.status === 'ok').map((item) => ({
      id: item.id, name: item.name, version: item.version, class: item.class,
      manifestSha256: item.manifestSha256, contentSha256: item.contentSha256,
      registeredAt: new Date().toISOString(),
      capabilities: item.capabilities, requires: item.requires
    }))
  }
  const roots = [...current.roots.filter((item) => resolve(item.path) !== located.path), record]
    .sort((left, right) => left.path.localeCompare(right.path))
  const written = await writeRootsTable({ roots }, env)
  if (!written.ok) return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: written.message }
  return { ok: true, path: located.path, roots, warnings: [...current.warnings, ...inspected.warnings] }
}

/** 移除登记的根：回到内置层（坏的信任表也允许移除，按路径匹配）。 */
export async function removeRoot(value, env = process.env) {
  const raw = text(value).trim()
  if (!raw) return { ok: false, code: 'INVALID_ENTRY', message: '模块根路径非法' }
  const path = resolve(raw)
  const current = readRootsTable(env)
  const roots = current.roots.filter((item) => resolve(item.path) !== path)
  const written = await writeRootsTable({ roots }, env)
  if (!written.ok) return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: written.message }
  return { ok: true, path, roots, warnings: current.warnings }
}
