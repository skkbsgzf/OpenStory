/**
 * fact 条目导入的唯一写通道（OS-162）：factEntriesImport（剧本/外部数据）与 exchange
 * 适配器（NovelPedia）共用这一份——不许复制第二份写逻辑。
 *
 * 写语义完全沿用 OS-78/107/135：内核 writeFactFile（原子写＋revision 自增＋operationId
 * 幂等＋写前重读复核）＋兄弟 wiki＋一次导入一条变更日志（before 写前补读、after 写后重读）。
 * 本文件只把 ctx/res 相关的授权与响应剥掉，核心写成纯服务函数，两种入口都调它。
 *
 * OS-211 wiki 派生基准：兄弟 wiki **只经 writeFactFile 的 patch.wiki 落盘**（不再另开
 * atomicWriteFile 第二路）。内核写完主档 revision＝N 时把 `derivedFrom.factRevision` 记成 N，
 * 于是成功写后 `derivedFrom.factRevision === document.revision` 恒成立；同一 operationId
 * 重放走内核幂等分支，主档与派生档都不再落盘（duplicate:true 如实回传）。
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as defaultFactStore from './factFileStore.mjs'
import { recordChange } from '../../../protocol/changelog.mjs'
import { LOG_MODULES, namingEntry } from '../../../protocol/naming.mjs'

const FACT_DIR = namingEntry('storysource').dir

function text(value) { return String(value ?? '') }

/**
 * 写 fact 条目（唯一实现）。
 * @param {object} input { root, bookId, entries, title?, wiki?, operationId? }
 * @returns {Promise<{ok:boolean, code?:string, message?:string, details?:object, bookId?, entries?, revision?, duplicate?, backup?, logError?, wikiError?}>}
 */
export async function writeFactEntries({ root, bookId, entries, title = '', wiki = null, operationId = '', factStore = defaultFactStore } = {}) {
  const id = text(bookId).trim()
  if (!id) return { ok: false, code: 'INVALID_ENTRY', message: 'bookId 必填' }
  const list = Array.isArray(entries) ? entries : null
  if (!list || !list.length) return { ok: false, code: 'INVALID_ENTRY', message: 'entries 必须是非空数组' }
  const opId = text(operationId).trim() || `fact-import-${id}-${Date.now().toString(36)}`

  let expectedRevision = null
  let beforeFactRaw = ''
  const documentPath = join(root, FACT_DIR, `${id}.json`)
  try {
    if (existsSync(documentPath)) {
      beforeFactRaw = await readFile(documentPath, 'utf-8')
      const existing = JSON.parse(beforeFactRaw)
      const rev = Number(existing?.revision)
      if (Number.isSafeInteger(rev) && rev >= 1) expectedRevision = rev
    }
  } catch { /* 读不到就当新建 */ }
  const documentExisted = existsSync(documentPath)

  const written = await factStore.writeFactFile({
    root, bookId: id,
    // OS-211：wiki 与主档同一笔写——derivedFrom.factRevision 由内核按新 revision 落，
    // 不再在这里自己算基准（旧实现用 written.revision 是后补的、且与主档可能错位）。
    patch: {
      book: { id, title: text(title).trim() || id },
      entries: list,
      ...(wiki && typeof wiki === 'object' ? { wiki } : {})
    },
    operationId: opId,
    ...(expectedRevision !== null ? { expectedRevision } : {})
  })
  if (!written.ok) {
    return { ok: false, code: written.code ?? 'WRITE_PROTOCOL_IO_FAILED', message: written.message ?? '写入故事源失败', details: written.details }
  }

  let factLogError = ''
  if (written.duplicate !== true) {
    try {
      const afterFactRaw = await readFile(join(root, FACT_DIR, `${id}.json`), 'utf-8')
      const logged = await recordChange({
        root, module: LOG_MODULES.storysource, file: `${FACT_DIR}/${id}.json`,
        op: documentExisted ? 'update' : 'create',
        before: beforeFactRaw, after: afterFactRaw, actor: 'author',
        meta: {
          bookId: id, operationId: opId, entryCount: list.length,
          ...(wiki && typeof wiki === 'object' ? { wikiTouched: true } : {}),
          ...(Number(written.revision) ? { revision: Number(written.revision) } : {})
        }
      })
      if (logged.ok === false) factLogError = logged.message
    } catch (error) {
      factLogError = `读回故事源档失败：${text(error?.message || error)}`
    }
  }

  return {
    ok: true, bookId: id, entries: list.length,
    ...(Number(written.revision) ? { revision: Number(written.revision) } : {}),
    ...(written.duplicate === true ? { duplicate: true } : {}),
    ...(written.backup ? { backup: written.backup } : {}),
    ...(factLogError ? { logError: factLogError } : {})
  }
}
