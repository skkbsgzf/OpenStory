// vendor 推演引擎到 core/pinax/fact/（OS-29）
import fs from 'node:fs'
import path from 'node:path'

const SOURCE = 'D:/Pinax-next'
const TARGET = 'D:/OpenStory/core/pinax'
const SEEDS = [
  'next/fact/usecases/deduce/turn.js',
  'next/fact/usecases/deduce/candidates.js',
  'next/fact/usecases/deduce/settle.js',
  'next/fact/usecases/deduce/opening.js',
  'next/fact/usecases/deduce/sessionState.js',
  'next/fact/usecases/factPack.js',
  'next/fact/usecases/hypothesis.js',
  'next/fact/domain/aliases.js',
  'next/fact/domain/stableId.js',
  'next/fact/domain/vocabulary.js',
  'next/fact/domain/validity.js',
  'next/fact/domain/pediaSchema.js'
]
const IMPORT_RE = /(?:import\s|export\s)[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/gu

const seen = new Set()
const queue = [...SEEDS]
const external = new Set()

while (queue.length) {
  const rel = queue.shift()
  if (seen.has(rel)) continue
  seen.add(rel)
  const abs = path.join(SOURCE, rel)
  let code
  try {
    code = fs.readFileSync(abs, 'utf-8')
  } catch {
    console.log('MISSING', rel)
    continue
  }
  const target = path.join(TARGET, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, code)
  for (const match of code.matchAll(IMPORT_RE)) {
    const spec = match[1] || match[2]
    if (!spec) continue
    if (spec.startsWith('node:') || !spec.startsWith('.')) { external.add(spec); continue }
    const resolved = path.relative(SOURCE, path.resolve(path.dirname(abs), spec)).replaceAll('\\', '/')
    if (/^(next|server|electron|shared)\//u.test(resolved)) {
      if (!seen.has(resolved)) queue.push(resolved)
    } else {
      external.add(spec)
    }
  }
}
console.log('vendored:', seen.size)
if (external.size) console.log('external:', [...external].join(', '))
