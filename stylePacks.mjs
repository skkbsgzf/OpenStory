/**
 * OpenStory 风格包加载（OS-5）——色板从「内置三套」变「目录加载」。
 *
 * 一套皮＝一个 JSON 文件：`{ id, name, description, tokens: { '--bg': …, … } }`。
 * daemon 合并两个目录（后者按 id 覆盖前者）：
 *   1) 内置 `openstory/styles/`（随仓走的三套）；
 *   2) 本机 `%LOCALAPPDATA%/PinaxNext/openstory/styles/`（作者/社区/Agent 丢文件即上新）。
 *
 * 防注入两条硬口径：
 *   · token 名限 `--kebab`（`/^--[a-z0-9-]+$/i`）；
 *   · token 值禁 `{ } < > @ ;`（值只进 CSS 声明，出现这些字符＝包不合法，整包跳过＋warning）。
 * 坏档/坏名不拖垮清单：跳过＋warning，工作台摆人话。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdir, readFile } from 'node:fs/promises'

const HERE = dirname(fileURLToPath(import.meta.url))

function text(value) {
  return String(value ?? '')
}

export function builtinStylesDir() {
  return join(HERE, 'styles')
}

export function defaultUserStylesDir(env = process.env) {
  const base = text(env.LOCALAPPDATA || env.APPDATA).trim()
  return base ? join(base, 'PinaxNext', 'openstory', 'styles') : ''
}

const TOKEN_KEY = /^--[a-z0-9-]{1,48}$/iu
const TOKEN_FORBIDDEN = /[{}<>@;]/u

/** 单包规整：id/name/tokens 合法才收；问题随 warning 报，不抛。 */
export function normalizeStylePack(raw, { source, file } = {}) {
  const where = `${source}·${text(file)}`
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, warning: { code: 'STYLE_PACK_SHAPE', file: where, message: `风格包不是对象：${where}` } }
  }
  const id = text(raw.id).trim()
  const name = text(raw.name).trim()
  if (!/^[\w-]{1,40}$/u.test(id)) {
    return { ok: false, warning: { code: 'STYLE_PACK_ID', file: where, message: `风格包 id 非法（只许字母数字-_，≤40 字）：${where}` } }
  }
  if (!name) {
    return { ok: false, warning: { code: 'STYLE_PACK_NAME', file: where, message: `风格包缺 name：${where}` } }
  }
  const rawTokens = raw.tokens && typeof raw.tokens === 'object' && !Array.isArray(raw.tokens) ? raw.tokens : {}
  const tokens = {}
  for (const [key, value] of Object.entries(rawTokens)) {
    if (!TOKEN_KEY.test(key)) {
      return { ok: false, warning: { code: 'STYLE_PACK_TOKEN_KEY', file: where, message: `风格包 token 名要形如 --kebab（${key}）：${where}` } }
    }
    const tokenValue = text(value)
    if (tokenValue.length > 200 || TOKEN_FORBIDDEN.test(tokenValue)) {
      return { ok: false, warning: { code: 'STYLE_PACK_TOKEN_VALUE', file: where, message: `风格包 token 值非法（禁 { } < > @ ;，≤200 字）：${where} · ${key}` } }
    }
    tokens[key] = tokenValue
  }
  if (!tokens['--accent'] || !tokens['--bg']) {
    return { ok: false, warning: { code: 'STYLE_PACK_TOKEN_MIN', file: where, message: `风格包至少要有 --bg 和 --accent：${where}` } }
  }
  return {
    ok: true,
    pack: {
      id,
      name,
      description: text(raw.description).trim(),
      source,
      tokens
    }
  }
}

/**
 * 合并加载：按目录顺序，后面的目录按 id 覆盖前面的（本机覆盖内置）。
 * 目录不存在＝跳过（内置目录缺失才记 warning——本机目录本来可能还没有）。
 */
export async function loadStylePacks(dirs = []) {
  const warnings = []
  const byId = new Map()
  for (const [index, dir] of dirs.entries()) {
    if (!text(dir).trim()) continue
    let names
    try {
      names = await readdir(dir)
    } catch (error) {
      if (index === 0) {
        warnings.push({ code: 'STYLES_DIR_MISSING', dir, message: `内置风格目录不在：${dir}` })
      }
      continue
    }
    const source = index === 0 ? '内置' : '本机'
    for (const name of names.filter((item) => item.toLowerCase().endsWith('.json') && !item.includes('.tmp-'))) {
      let raw
      try {
        raw = JSON.parse(await readFile(join(dir, name), 'utf-8'))
      } catch (error) {
        warnings.push({ code: 'STYLE_PACK_UNREADABLE', file: `${source}·${name}`, message: `风格包读不了/不是 JSON：${source}·${name}（${text(error?.message || error)}）` })
        continue
      }
      const normalized = normalizeStylePack(raw, { source, file: name })
      if (!normalized.ok) {
        warnings.push(normalized.warning)
        continue
      }
      byId.set(normalized.pack.id, normalized.pack)
    }
  }
  return { styles: [...byId.values()], warnings }
}
