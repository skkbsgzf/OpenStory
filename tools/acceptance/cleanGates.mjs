/**
 * 开源分发清洁门禁（甲-4）：只对「开源白名单」内文件执行四条 grep 规则。
 *
 * 白名单/排除表见 docs/DISTRIBUTION.md；精确豁免串见 test/fixtures/clean-gates-allowlist.json。
 * 豁免只按字符串值生效：命中的 token 必须是某个登记值的子串，且该登记值出现在同一行。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const PUBLISH_INCLUDE_DIRS = Object.freeze([
  'src', 'public', 'test', 'tools', 'genres', 'samples', 'styles', 'runtimes', 'suites', 'docs/mcp'
])

export const PUBLISH_INCLUDE_FILES = Object.freeze([
  'README.md', 'AGENTS.md', 'ARCHITECTURE.md', 'LICENSE', 'package.json',
  'docs/DEMO.md', 'docs/ACCEPTANCE.md', 'docs/UI-KIT.md', 'docs/PUBLISHING.md', 'docs/DISTRIBUTION.md'
])

export const PUBLISH_EXCLUDE_PREFIXES = Object.freeze([
  'skills/', 'knowledge-packs/', 'docs/workorders/', 'docs/plan/', 'docs/adr/',
  'docs/kb-eval/', 'docs/samples/', 'tools/acceptance/out/', 'tools/acceptance/cleanGates.mjs',
  'test/fixtures/clean-gates-allowlist.json',
  'node_modules/', '.git/', '.cache/'
])

const TEXT_EXT = /\.(?:mjs|js|cjs|json|md|html|css|yaml|yml|txt)$/u

export const CLEAN_RULES = Object.freeze([
  {
    id: 'S5.1',
    label: '盘符路径',
    description: '[A-Za-z]:[/\\](Users|Qbook|OpenStory|Pinax|_openstory|D盘)',
    regex: /[A-Za-z]:[/\\](?:Users|Qbook|OpenStory|Pinax|_openstory|D盘)/giu
  },
  {
    id: 'S5.2',
    label: '私人名',
    description: 'Qbook|Pinax(-e2e)?|hy4flash|dsv4flash|CodeBuddy|Qoder|WorkBuddy',
    regex: /Qbook|Pinax(?:-e2e)?|hy4flash|dsv4flash|CodeBuddy|Qoder|WorkBuddy/giu
  },
  {
    id: 'S5.3',
    label: '源机用户名',
    description: 'C:\\Users\\Administrator',
    regex: /C:\\Users\\Administrator/giu
  },
  {
    id: 'S5.4',
    label: '凭据模式',
    description: 'sk-[A-Za-z0-9]{8,}|api[_-]?key\\s*[:=]\\s*["\'][^"\']{6}',
    regex: /sk-[A-Za-z0-9]{8,}|api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/giu
  }
])

function isExcluded(rel) {
  return PUBLISH_EXCLUDE_PREFIXES.some((prefix) => rel.startsWith(prefix))
}

function walk(dir, prefix, out) {
  let entries
  try {
    entries = readdirSync(join(REPO, dir))
  } catch {
    return
  }
  for (const name of entries) {
    const rel = `${prefix}${name}`
    const full = join(REPO, rel)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      if (!isExcluded(`${rel}/`)) walk(rel, `${rel}/`, out)
    } else if (TEXT_EXT.test(name) && !isExcluded(rel)) {
      out.add(rel)
    }
  }
}

/** 开源白名单文件清单（可复用于打包脚本）。 */
export function publishFiles() {
  const files = new Set(PUBLISH_INCLUDE_FILES.filter((rel) => !isExcluded(rel)))
  for (const dir of PUBLISH_INCLUDE_DIRS) walk(dir, `${dir}/`, files)
  return [...files].sort()
}

/** 读取精确豁免串；文件缺失/坏档时抛出，避免门禁静默放行。 */
export function loadAllowlist(path = 'test/fixtures/clean-gates-allowlist.json') {
  const doc = JSON.parse(readFileSync(join(REPO, path), 'utf-8'))
  if (doc?.schema !== 'openstory.clean-gates-allowlist/v1' || !Array.isArray(doc.entries)) {
    throw new Error(`豁免表形状不对：${path}`)
  }
  return doc.entries.map((entry) => String(entry))
}

function allowed(match, line, allowlist) {
  const token = match.toLowerCase()
  return allowlist.some((entry) => entry.toLowerCase().includes(token) && line.toLowerCase().includes(entry.toLowerCase()))
}

/** 四条规则逐文件逐行扫描；返回每条规则的命中明细。 */
export function auditCleanGates() {
  const allowlist = loadAllowlist()
  const files = publishFiles()
  const rules = CLEAN_RULES.map((rule) => ({ ...rule, hits: [] }))
  for (const rel of files) {
    const lines = readFileSync(join(REPO, rel), 'utf-8').split('\n')
    lines.forEach((line, index) => {
      for (const rule of rules) {
        rule.regex.lastIndex = 0
        for (const match of line.matchAll(rule.regex)) {
          if (allowed(match[0], line, allowlist)) continue
          rule.hits.push({ file: rel, line: index + 1, match: match[0], text: line.trim().slice(0, 160) })
        }
      }
    })
  }
  return { files, rules, allowlist }
}
