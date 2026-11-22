#!/usr/bin/env node
/**
 * OS-126 解耦④ 上游漂移检测 —— core/** 的 vendor 指纹锚
 *
 * 背景：core/pinax/** 逐字 vendor 自 Pinax-next@70a4f44，上游改动本仓原本无感知。
 * 本脚本给 vendor 文件留 sha256 指纹锚（core/.vendored-manifest.json），逐文件比对三类：
 *   · [本仓被改]  当前内容 ≠ 锚 —— vendor 文件不许在本仓改，改动应发生在上游再同步；
 *   · [上游已变]  D:/Pinax-next 同位置内容 ≠ 锚 —— 上游在 70a4f44 之后动过，该决定是否重同步；
 *   · [清单缺项]  core/** 下出现锚外新文件 —— 锚过时，重跑 snapshot。
 * 上游已无此文件＝本仓有意删除（如 OS-123 删掉的 server 层）→ [跳过]，不算漂移。
 *
 * 用法：
 *   node scripts/vendor-drift.mjs snapshot   生成/重生成 core/.vendored-manifest.json
 *   node scripts/vendor-drift.mjs check      比对并输出三类清单，漂移 → exit 1
 *   npm run vendor:check                     等价于 check
 *
 * 退出码：0＝一致；1＝检出漂移（本仓被改/上游已变/清单缺项任一非空）；2＝用法错误或锚不存在。
 * 映射：core/pinax/<X> ↔ 上游 <X>（next/X、server/Y、electron/Z 通用一条前缀规则）。
 * 排除：锚自身与 core/VENDORED.md（本仓自有文档，非逐字 vendor，随解耦批次正常追加）。
 * 零依赖：node:fs / node:crypto / node:path（node:url 仅用于 main 模块判定）。
 * 比对逻辑拆为纯函数（compareManifest 等），护栏测试见 test/vendorDrift.test.mjs（临时目录喂入）。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const UPSTREAM_COMMIT = '70a4f44'
const UPSTREAM_ROOT = process.env.PINAX_NEXT_ROOT || 'D:/Pinax-next'
const REPO_ROOT = path.dirname(path.dirname(path.resolve(process.argv[1] || import.meta.url)))
const CORE_ROOT = path.join(REPO_ROOT, 'core')
const MANIFEST_REL = '.vendored-manifest.json'
const MANIFEST_ABS = path.join(CORE_ROOT, MANIFEST_REL)
/** snapshot 遍历与 check 缺项扫描共用的排除名单（相对 core/ 的 posix 路径）。 */
const SKIP_FILES = new Set([MANIFEST_REL, 'VENDORED.md'])

/* ---------- 纯函数（test/vendorDrift.test.mjs 直接喂临时目录） ---------- */

/** Buffer → sha256 hex。 */
export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** 递归列 core 下文件，返回排序后的 posix 相对路径；SKIP_FILES 的两项不列。 */
export function listCoreFiles(root, skip = SKIP_FILES) {
  const out = []
  ;(function walk(dir, prefix) {
    // 字节序排序（localeCompare 随区域设置漂移，锚键序须跨机器可复现）
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name
      if (skip.has(rel)) continue
      if (ent.isDirectory()) walk(path.join(dir, ent.name), rel)
      else if (ent.isFile()) out.push(rel)
    }
  })(root, '')
  return out
}

/** {相对路径: sha256}：对 root 下给定 rel 列表逐文件哈希（文件须存在）。 */
export function hashFiles(root, rels) {
  const out = {}
  for (const rel of rels) out[rel] = sha256(fs.readFileSync(path.join(root, rel)))
  return out
}

/** 本仓 vendor 相对路径 → 上游相对路径：core/pinax/<X> ↔ 上游 <X>；无映射返回 null。 */
export function toUpstreamRel(rel) {
  return rel.startsWith('pinax/') ? rel.slice('pinax/'.length) : null
}

/** 上游对照哈希表（按本仓 rel 键）：上游缺文件＝null（check 视为本仓已删，跳过）。 */
export function hashUpstream(upstreamRoot, coreRels) {
  const out = {}
  for (const rel of coreRels) {
    const upRel = toUpstreamRel(rel)
    const abs = upRel === null ? null : path.join(upstreamRoot, upRel)
    out[rel] = abs !== null && fs.existsSync(abs) ? sha256(fs.readFileSync(abs)) : null
  }
  return out
}

/**
 * 纯比对：锚 × 当前哈希 × 上游哈希 → 五类清单（均按路径排序）。
 *   same / localChanged / upstreamChanged / missingFromManifest / skipped
 *   · 上游无此文件（null）→ skipped，不算漂移；
 *   · 本仓已删而上游仍在 → localChanged（本仓被改的一种）；
 *   · 当前 ≠ 锚 → localChanged；上游 ≠ 锚 → upstreamChanged（两条件独立，可同时命中）；
 *   · 当前树里有、锚里没有 → missingFromManifest（清单缺项）。
 * ok＝localChanged、upstreamChanged、missingFromManifest 全空。
 */
export function compareManifest(manifestFiles, current, upstream) {
  const same = []
  const localChanged = []
  const upstreamChanged = []
  const skipped = []
  const missingFromManifest = []
  for (const rel of Object.keys(current)) {
    if (!(rel in manifestFiles)) missingFromManifest.push({ rel, detail: '锚外新文件，锚过时' })
  }
  for (const [rel, base] of Object.entries(manifestFiles)) {
    const up = upstream[rel] ?? null
    if (up === null) {
      skipped.push({ rel, detail: '上游已无此文件＝本仓已删，不计漂移' })
      continue
    }
    const cur = current[rel] ?? null
    const localDrift = cur === null || cur !== base
    const upDrift = up !== base
    if (cur === null) localChanged.push({ rel, detail: '本仓已删而上游仍在' })
    else if (localDrift) localChanged.push({ rel, detail: '当前内容与指纹不符' })
    if (upDrift) upstreamChanged.push({ rel, detail: '上游内容与指纹不符（70a4f44 之后动过）' })
    if (!localDrift && !upDrift) same.push({ rel, detail: '' })
  }
  const byRel = (a, b) => a.rel.localeCompare(b.rel)
  same.sort(byRel)
  localChanged.sort(byRel)
  upstreamChanged.sort(byRel)
  skipped.sort(byRel)
  missingFromManifest.sort(byRel)
  return {
    ok: localChanged.length === 0 && upstreamChanged.length === 0 && missingFromManifest.length === 0,
    same,
    localChanged,
    upstreamChanged,
    missingFromManifest,
    skipped,
  }
}

/* ---------- CLI ---------- */

function cmdSnapshot() {
  const rels = listCoreFiles(CORE_ROOT)
  const files = hashFiles(CORE_ROOT, rels)
  const manifest = { generatedAt: new Date().toISOString(), upstreamCommit: UPSTREAM_COMMIT, files }
  fs.writeFileSync(MANIFEST_ABS, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`已写 core/${MANIFEST_REL}：${rels.length} 个文件，upstreamCommit=${UPSTREAM_COMMIT}`)
  return 0
}

function cmdCheck() {
  if (!fs.existsSync(MANIFEST_ABS)) {
    console.error(`指纹锚 core/${MANIFEST_REL} 不存在——先跑 node scripts/vendor-drift.mjs snapshot`)
    return 2
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_ABS, 'utf-8'))
  const current = hashFiles(CORE_ROOT, listCoreFiles(CORE_ROOT))
  const upstream = hashUpstream(UPSTREAM_ROOT, Object.keys(manifest.files))
  const r = compareManifest(manifest.files, current, upstream)
  console.log(`vendor 漂移检测 · 锚 upstreamCommit=${manifest.upstreamCommit} generatedAt=${manifest.generatedAt}`)
  for (const f of r.same) console.log(`[一致] ${f.rel}`)
  for (const f of r.localChanged) console.log(`[本仓被改] ${f.rel}（${f.detail}）`)
  for (const f of r.upstreamChanged) console.log(`[上游已变] ${f.rel}（${f.detail}）`)
  for (const f of r.missingFromManifest) console.log(`[清单缺项] ${f.rel}（${f.detail}）`)
  for (const f of r.skipped) console.log(`[跳过] ${f.rel}（${f.detail}）`)
  console.log(
    `小结：一致 ${r.same.length}｜本仓被改 ${r.localChanged.length}｜上游已变 ${r.upstreamChanged.length}` +
    `｜清单缺项 ${r.missingFromManifest.length}｜跳过 ${r.skipped.length} → exit ${r.ok ? 0 : 1}`,
  )
  return r.ok ? 0 : 1
}

function main(argv) {
  const cmd = argv[2]
  if (cmd === 'snapshot') return cmdSnapshot()
  if (cmd === 'check') return cmdCheck()
  console.error('用法：node scripts/vendor-drift.mjs <snapshot|check>')
  return 2
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) process.exit(main(process.argv))
