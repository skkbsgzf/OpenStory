import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEGACY_MODULE_SPEC, MODULE_SPEC, MODULES_DIR, migrateModuleManifest } from '../src/protocol/modules.mjs'

const args = process.argv.slice(2)
const write = args.includes('--write')
const check = args.includes('--check')
if (write && check) {
  console.error('--write 与 --check 不能同时使用')
  process.exit(2)
}

const items = []
let invalid = false
for (const entry of readdirSync(MODULES_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue
  const file = join(MODULES_DIR, entry.name, 'module.manifest.json')
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf-8'))
  } catch (error) {
    invalid = true
    items.push({ id: entry.name, ok: false, errors: [`manifest 读不了：${error?.message || error}`] })
    continue
  }
  const result = migrateModuleManifest(raw, { dirName: entry.name, builtin: true })
  if (!result.ok) invalid = true
  items.push({
    id: entry.name,
    ok: result.ok,
    from: raw.spec,
    to: result.candidate?.spec ?? raw.spec,
    changed: result.changed === true,
    inferredClass: result.report?.inferredClass ?? null,
    splitPending: result.report?.splitPending ?? '',
    droppedFields: result.report?.droppedFields ?? [],
    warnings: result.warnings ?? [],
    errors: result.errors ?? [],
    ...(result.ok && result.changed && write ? { file } : {})
  })
}

if (!invalid && write) {
  for (const item of items) {
    if (!item.changed) continue
    const result = migrateModuleManifest(JSON.parse(readFileSync(item.file, 'utf-8')), { dirName: item.id, builtin: true })
    writeFileSync(item.file, `${JSON.stringify(result.candidate, null, 2)}\n`, 'utf-8')
  }
}

const changed = items.filter((item) => item.changed)
const report = {
  mode: write ? 'write' : check ? 'check' : 'dry-run',
  from: LEGACY_MODULE_SPEC,
  to: MODULE_SPEC,
  total: items.length,
  changed: changed.length,
  invalid,
  items
}
console.log(JSON.stringify(report, null, 2))
if (invalid || (check && changed.length)) process.exit(1)
