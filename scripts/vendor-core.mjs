#!/usr/bin/env node
// 底座 vendor 脚本：从 D:\Pinax-next 递归追 import 闭包，按原路径结构镜像到 core/pinax/。
// 规则：next/X → core/pinax/next/X；server/Y → core/pinax/server/Y（内部相对 import 原样保留，零改动）。
import fs from 'node:fs'
import path from 'node:path'

const SOURCE = 'D:/Pinax-next'
const TARGET = 'D:/OpenStory/core/pinax'
const SEEDS = [
  'next/kernel/factFileStore.mjs',
  'next/kernel/wikiDerive.mjs',
  'next/kernel/errors.mjs',
  'next/kernel/capabilityGraph.mjs',
  'next/kernel/pluginRegistry.mjs',
  'next/kernel/pluginLoader.mjs',
  'next/kernel/projectSkeleton.mjs',
  'next/project/projectManifest.mjs',
  'next/project/createProject.mjs',
  'next/runtime/projectImportAdapter.mjs',
  'next/shell/library/wizardKit.mjs',
  'server/mcp/projectImport.js',
  'next/carriers/novel/manifest.mjs',
  'next/carriers/script/manifest.mjs',
  'next/carriers/outline/manifest.mjs',
  'next/carriers/notes/manifest.mjs',
  'next/carriers/worldbook/manifest.mjs',
  'next/carriers/dossier/manifest.mjs',
  'next/carriers/material/manifest.mjs',
  'next/carriers/comic/manifest.mjs',
  'next/carriers/video/manifest.mjs',
  'next/carriers/experience/manifest.mjs',
  'next/carriers/online/manifest.mjs'
]
const IMPORT_RE = /(?:import\s|export\s)[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/gu

const seen = new Set()
const queue = [...SEEDS]
const external = new Set()
const missing = []

function mapped(spec) {
  // 相对 spec 由当前文件解析；bare spec（@pinax/core 等）记录为外部依赖
  return null
}

while (queue.length) {
  const rel = queue.shift()
  if (seen.has(rel)) continue
  seen.add(rel)
  const abs = path.join(SOURCE, rel)
  let code
  try {
    code = fs.readFileSync(abs, 'utf-8')
  } catch {
    missing.push(rel)
    continue
  }
  const target = path.join(TARGET, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, code)
  for (const match of code.matchAll(IMPORT_RE)) {
    const spec = match[1] || match[2]
    if (!spec) continue
    if (spec.startsWith('node:') || !spec.startsWith('.')) {
      if (!spec.startsWith('node:')) external.add(spec)
      continue
    }
    const resolvedRel = path.relative(SOURCE, path.resolve(path.dirname(abs), spec)).replaceAll('\\', '/')
    if (resolvedRel.startsWith('next/') || resolvedRel.startsWith('server/') || resolvedRel.startsWith('electron/') || resolvedRel.startsWith('shared/')) {
      if (!seen.has(resolvedRel)) queue.push(resolvedRel)
    } else {
      external.add(spec)
    }
  }
}

console.log(`vendored ${seen.size} files → core/pinax/`)
if (missing.length) console.log('MISSING:\n' + missing.join('\n'))
if (external.size) console.log('外部（bare）依赖：\n' + [...external].join('\n'))
