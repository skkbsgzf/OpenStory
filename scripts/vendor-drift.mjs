#!/usr/bin/env node
/**
 * OS-126 解耦④ 上游漂移检测 —— core/** 与 vendor/contracts 的 vendor 指纹锚
 * （OS-132 升级：manifest 双段化——pinaxNext ＋ pinaxCore；新增「上游已移位」信息档。）
 *
 * 背景：core/pinax/** 逐字 vendor 自 Pinax-next@70a4f44，vendor/contracts/** 逐字收编自
 * @pinax/core 0.16.0（＝pinax-core e56a0bc）——上游改动本仓原本无感知。本脚本给 vendor
 * 文件留 sha256 指纹锚（core/.vendored-manifest.json，双段），逐文件比对：
 *   · [本仓被改]   当前内容 ≠ 锚 —— vendor 文件不许在本仓改，改动应发生在上游再同步；
 *   · [上游已变]   上游同位置内容 ≠ 锚 —— 上游在锚之后动过，该决定是否重同步；
 *   · [清单缺项]   锚管辖树下出现锚外新文件 —— 锚过时，重跑 snapshot；
 *   · [上游已移位] 锚里有、本仓还在、上游已无此文件 —— 信息级，**不影响退出码**
 *                  （OS-132：本仓有意携带而上游不携带，如 enrich/{metrics,pseudoChapters}.mjs）；
 *   · [跳过]       上游缺失**且本仓也没有** —— 本仓已删，不计漂移。
 * exit 1 只由 本仓被改／上游已变／清单缺项 任一非空触发（维持 OS-126 口径）。
 *
 * 双段（OS-132）：
 *   pinaxNext：core/pinax ↔ D:/Pinax-next（映射规则不变：core/pinax/<X> ↔ 上游 <X>），
 *              原始字节哈希（两仓同为 CRLF 检出，逐字节同源）。
 *   pinaxCore：vendor/contracts ↔ D:/Pinax-core/src/domain（contracts/<X> ↔ src/domain/<X>），
 *              锚 upstreamCommit=e56a0bc；哈希口径＝**剥 VENDORED 出处头＋行尾归一化**后 sha256——
 *              收编文件带出处头注释而上游裸正文没有（stripVendoredHeader），tgz 载体是 LF、
 *              上游 Windows 检出是 CRLF（normalize），两者都会让原始字节比对恒误报。
 * 旧 manifest 结构兼容读：单段 {generatedAt, upstreamCommit, files} 视为 pinaxNext 段，
 * pinaxCore 段当空（readSections）。
 *
 * 用法：
 *   node scripts/vendor-drift.mjs snapshot   生成/重生成双段 core/.vendored-manifest.json
 *   node scripts/vendor-drift.mjs check      两段逐文件比对，漂移 → exit 1
 *   npm run vendor:check                     等价于 check
 *
 * 退出码：0＝一致（上游已移位/跳过只报信息）；1＝检出漂移（本仓被改/上游已变/清单缺项任一非空）；
 * 2＝用法错误或锚不存在。
 * 环境变量：PINAX_NEXT_ROOT（默认 D:/Pinax-next）、PINAX_CORE_ROOT（默认 D:/Pinax-core）。
 * 排除：锚自身与 core/VENDORED.md（本仓自有文档）、vendor/contracts/PROVENANCE.md（同理由）。
 * 零依赖：node:fs / node:crypto / node:path（node:url 仅用于 main 模块判定）。
 * 比对逻辑拆为纯函数（compareManifest/checkSection/readSections 等），护栏测试见
 * test/vendorDrift.test.mjs（临时目录喂入）。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const UPSTREAM_COMMIT = '70a4f44'
const UPSTREAM_ROOT = process.env.PINAX_NEXT_ROOT || 'D:/Pinax-next'
/** pinaxCore 段锚：@pinax/core 0.16.0 ＝ pinax-core e56a0bc（见 vendor/contracts/PROVENANCE.md）。 */
const PINAX_CORE_UPSTREAM_COMMIT = 'e56a0bc'
const PINAX_CORE_ROOT = process.env.PINAX_CORE_ROOT || 'D:/Pinax-core'
const REPO_ROOT = path.dirname(path.dirname(path.resolve(process.argv[1] || import.meta.url)))
const CORE_ROOT = path.join(REPO_ROOT, 'core')
const VENDOR_ROOT = path.join(REPO_ROOT, 'vendor')
const MANIFEST_REL = '.vendored-manifest.json'
const MANIFEST_ABS = path.join(CORE_ROOT, MANIFEST_REL)
/** snapshot 遍历与 check 缺项扫描共用的排除名单（相对段本地根的 posix 路径）。 */
const SKIP_FILES = new Set([MANIFEST_REL, 'VENDORED.md'])
/** pinaxCore 段排除：出处文档（本仓自有，非逐字 vendor）。 */
const SKIP_CONTRACTS = new Set(['contracts/PROVENANCE.md'])

/* ---------- 纯函数（test/vendorDrift.test.mjs 直接喂临时目录） ---------- */

/** Buffer → sha256 hex。 */
export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** Buffer → 行尾归一化（CRLF/CR → LF）后 sha256 hex。pinaxCore 段专用：tgz 是 LF、上游 Windows 检出是 CRLF。 */
export function hashText(buf) {
  const normalized = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n'), 'utf8')
  return sha256(normalized)
}

/**
 * 去收编出处头（pinaxCore 段专用）：若首个块注释含 VENDORED 标记则整块剥掉
 * （连同紧随的空行），让「出处头注释＋逐字正文」能与上游裸正文逐字节对上；
 * 无标记（如上游文件自己的文档头）原样返回。
 */
export function stripVendoredHeader(buf) {
  const text = buf.toString('utf8')
  const head = /^\/\*[\s\S]*?\*\//.exec(text)
  if (!head || !head[0].includes('VENDORED')) return buf
  return Buffer.from(text.slice(head[0].length).replace(/^(?:\r?\n)+/, ''), 'utf8')
}

/** 按段口径哈希：先剥出处头（可选），再行尾归一化（可选）。 */
function hashBySection(buf, { normalize = false, stripVendoredHeader: strip = false } = {}) {
  const body = strip ? stripVendoredHeader(buf) : buf
  return normalize ? hashText(body) : sha256(body)
}

/** 递归列 root 下文件，返回排序后的 posix 相对路径；skip 名单不列。 */
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

/**
 * 段管辖树遍历：root 不存在返回 []；prefix 非空时只保留该前缀下的文件
 * （pinaxNext prefix=''＝全树，维持 OS-126「core/** 锚外新文件即缺项」口径；
 *  pinaxCore prefix='contracts/'＝只管 vendor/contracts，vendor/core 的 tgz 凭证不入锚）。
 */
export function listSectionFiles(root, { prefix = '', skip = SKIP_FILES } = {}) {
  if (!fs.existsSync(root)) return []
  const all = listCoreFiles(root, skip)
  return prefix ? all.filter((rel) => rel.startsWith(prefix)) : all
}

/** {相对路径: sha256}：对 root 下给定 rel 列表逐文件哈希（文件须存在）。 */
export function hashFiles(root, rels, normalize = false, stripVendoredHeader = false) {
  const out = {}
  for (const rel of rels) {
    out[rel] = hashBySection(fs.readFileSync(path.join(root, rel)), { normalize, stripVendoredHeader })
  }
  return out
}

/** 本仓 vendor 相对路径 → 上游相对路径：core/pinax/<X> ↔ 上游 <X>；无映射返回 null。 */
export function toUpstreamRel(rel) {
  return rel.startsWith('pinax/') ? rel.slice('pinax/'.length) : null
}

/** pinaxCore 段映射：contracts/<X> ↔ pinax-core src/domain/<X>；无映射返回 null。 */
export function toUpstreamRelContracts(rel) {
  return rel.startsWith('contracts/') ? rel.slice('contracts/'.length) : null
}

/** 上游对照哈希表（按本仓 rel 键）：上游缺文件＝null（check 视为本仓已删或已移位）。 */
export function hashUpstream(upstreamRoot, rels, { mapRel = toUpstreamRel, normalize = false, stripVendoredHeader = false } = {}) {
  const out = {}
  for (const rel of rels) {
    const upRel = mapRel(rel)
    const abs = upRel === null ? null : path.join(upstreamRoot, upRel)
    out[rel] = abs !== null && fs.existsSync(abs)
      ? hashBySection(fs.readFileSync(abs), { normalize, stripVendoredHeader })
      : null
  }
  return out
}

/**
 * 纯比对：锚 × 当前哈希 × 上游哈希 → 六类清单（均按路径排序）。
 *   same / localChanged / upstreamChanged / missingFromManifest / movedAway / skipped
 *   · 上游无此文件且本仓也没有 → skipped（本仓已删，不计漂移）；
 *   · 上游无此文件但本仓还在 → movedAway（上游已移位，信息级，不影响 ok）；
 *   · 本仓已删而上游仍在 → localChanged（本仓被改的一种）；
 *   · 当前 ≠ 锚 → localChanged；上游 ≠ 锚 → upstreamChanged（两条件独立，可同时命中）；
 *   · 当前树里有、锚里没有 → missingFromManifest（清单缺项）。
 * ok＝localChanged、upstreamChanged、missingFromManifest 全空（movedAway/skipped 不计入）。
 */
export function compareManifest(manifestFiles, current, upstream) {
  const same = []
  const localChanged = []
  const upstreamChanged = []
  const skipped = []
  const missingFromManifest = []
  const movedAway = []
  for (const rel of Object.keys(current)) {
    if (!(rel in manifestFiles)) missingFromManifest.push({ rel, detail: '锚外新文件，锚过时' })
  }
  for (const [rel, base] of Object.entries(manifestFiles)) {
    const up = upstream[rel] ?? null
    if (up === null) {
      const cur = current[rel] ?? null
      if (cur === null) skipped.push({ rel, detail: '上游缺失且本仓也已删，不计漂移' })
      else movedAway.push({ rel, detail: '上游已无此文件、本仓仍在——信息级不计漂移' })
      continue
    }
    const cur = current[rel] ?? null
    const localDrift = cur === null || cur !== base
    const upDrift = up !== base
    if (cur === null) localChanged.push({ rel, detail: '本仓已删而上游仍在' })
    else if (localDrift) localChanged.push({ rel, detail: '当前内容与指纹不符' })
    if (upDrift) upstreamChanged.push({ rel, detail: '上游内容与指纹不符（锚之后动过）' })
    if (!localDrift && !upDrift) same.push({ rel, detail: '' })
  }
  const byRel = (a, b) => a.rel.localeCompare(b.rel)
  same.sort(byRel)
  localChanged.sort(byRel)
  upstreamChanged.sort(byRel)
  skipped.sort(byRel)
  missingFromManifest.sort(byRel)
  movedAway.sort(byRel)
  return {
    ok: localChanged.length === 0 && upstreamChanged.length === 0 && missingFromManifest.length === 0,
    same,
    localChanged,
    upstreamChanged,
    missingFromManifest,
    skipped,
    movedAway,
  }
}

/**
 * manifest 结构兼容读（OS-132）：
 *   · 新双段结构 {generatedAt, sections:{pinaxNext,pinaxCore}} → 原样规整（缺段当空）；
 *   · 旧单段结构 {generatedAt, upstreamCommit, files} → pinaxNext 段，pinaxCore 段当空。
 */
export function readSections(manifest) {
  const m = manifest && typeof manifest === 'object' ? manifest : {}
  const part = (sec) =>
    sec && typeof sec === 'object'
      ? { upstreamCommit: sec.upstreamCommit ?? null, files: sec.files && typeof sec.files === 'object' ? sec.files : {} }
      : { upstreamCommit: null, files: {} }
  if (m.sections && typeof m.sections === 'object') {
    return { generatedAt: m.generatedAt ?? null, sections: { pinaxNext: part(m.sections.pinaxNext), pinaxCore: part(m.sections.pinaxCore) } }
  }
  return {
    generatedAt: m.generatedAt ?? null,
    sections: { pinaxNext: part({ upstreamCommit: m.upstreamCommit, files: m.files }), pinaxCore: part(null) },
  }
}

/* ---------- 段配置与段驱动 ---------- */

/** 两段配置：本地根 ↔ 上游根、锚提交、管辖前缀、排除名单、映射函数、哈希口径。 */
const SECTIONS = {
  pinaxNext: {
    key: 'pinaxNext',
    title: 'core/pinax ↔ Pinax-next',
    localRoot: CORE_ROOT,
    upstreamRoot: UPSTREAM_ROOT,
    upstreamCommit: UPSTREAM_COMMIT,
    prefix: '',
    skip: SKIP_FILES,
    mapRel: toUpstreamRel,
    normalize: false,
  },
  pinaxCore: {
    key: 'pinaxCore',
    title: 'vendor/contracts ↔ pinax-core src/domain',
    localRoot: VENDOR_ROOT,
    upstreamRoot: path.join(PINAX_CORE_ROOT, 'src', 'domain'),
    upstreamCommit: PINAX_CORE_UPSTREAM_COMMIT,
    prefix: 'contracts/',
    skip: SKIP_CONTRACTS,
    mapRel: toUpstreamRelContracts,
    normalize: true,
    stripVendoredHeader: true,
  },
}

/** 单段比对驱动：段配置 × 段锚 → compareManifest 结果（check 与测试共用）。 */
export function checkSection(cfg, secPart) {
  const files = (secPart && secPart.files) || {}
  const rels = listSectionFiles(cfg.localRoot, cfg)
  const current = hashFiles(cfg.localRoot, rels, cfg.normalize, cfg.stripVendoredHeader)
  const upstream = hashUpstream(cfg.upstreamRoot, Object.keys(files), cfg)
  return compareManifest(files, current, upstream)
}

/* ---------- CLI ---------- */

function cmdSnapshot() {
  const sections = {}
  let total = 0
  for (const cfg of Object.values(SECTIONS)) {
    const rels = listSectionFiles(cfg.localRoot, cfg)
    const files = hashFiles(cfg.localRoot, rels, cfg.normalize, cfg.stripVendoredHeader)
    sections[cfg.key] = { upstreamCommit: cfg.upstreamCommit, files }
    total += rels.length
    console.log(
      `段 ${cfg.key}（${cfg.title}）：${rels.length} 个文件，upstreamCommit=${cfg.upstreamCommit}` +
      `${cfg.normalize || cfg.stripVendoredHeader ? '（剥出处头＋行尾归一化哈希）' : '（原始字节哈希）'}`,
    )
  }
  const manifest = { generatedAt: new Date().toISOString(), sections }
  fs.writeFileSync(MANIFEST_ABS, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`已写 core/${MANIFEST_REL}：两段共 ${total} 个文件`)
  return 0
}

function cmdCheck() {
  if (!fs.existsSync(MANIFEST_ABS)) {
    console.error(`指纹锚 core/${MANIFEST_REL} 不存在——先跑 node scripts/vendor-drift.mjs snapshot`)
    return 2
  }
  const manifest = readSections(JSON.parse(fs.readFileSync(MANIFEST_ABS, 'utf-8')))
  let exitCode = 0
  for (const cfg of Object.values(SECTIONS)) {
    const sec = manifest.sections[cfg.key] ?? { upstreamCommit: null, files: {} }
    console.log(`\nvendor 漂移检测 · 段 ${cfg.key}（${cfg.title}）锚 upstreamCommit=${sec.upstreamCommit ?? '（无锚）'} generatedAt=${manifest.generatedAt}`)
    if (!fs.existsSync(cfg.upstreamRoot)) {
      console.log(`  ⚠ 上游根不存在：${cfg.upstreamRoot}（该段全部按上游缺失处理）`)
    }
    const r = checkSection(cfg, sec)
    for (const f of r.same) console.log(`[一致] ${f.rel}`)
    for (const f of r.localChanged) console.log(`[本仓被改] ${f.rel}（${f.detail}）`)
    for (const f of r.upstreamChanged) console.log(`[上游已变] ${f.rel}（${f.detail}）`)
    for (const f of r.missingFromManifest) console.log(`[清单缺项] ${f.rel}（${f.detail}）`)
    for (const f of r.movedAway) console.log(`[上游已移位] ${f.rel}（${f.detail}）`)
    for (const f of r.skipped) console.log(`[跳过] ${f.rel}（${f.detail}）`)
    console.log(
      `小结 ${cfg.key}：一致 ${r.same.length}｜本仓被改 ${r.localChanged.length}｜上游已变 ${r.upstreamChanged.length}` +
      `｜清单缺项 ${r.missingFromManifest.length}｜上游已移位 ${r.movedAway.length}｜跳过 ${r.skipped.length}` +
      ` → ${r.ok ? '该段通过' : '该段漂移'}`,
    )
    if (!r.ok) exitCode = 1
  }
  console.log(`\n退出码 ${exitCode}：1＝本仓被改/上游已变/清单缺项任一非空；上游已移位与跳过只报信息`)
  return exitCode
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
