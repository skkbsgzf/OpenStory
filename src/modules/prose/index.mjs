import * as chapters from './chapters.mjs'
import * as chapterWrite from './chapterWrite.mjs'
import * as guard from './factGuard.mjs'

export const proseCapability = Object.freeze({
  'prose.write': Object.freeze({
    // OS-195b：FACT-FIRST 写前守卫归 prose.write——读事实经 fact.store/fact.pack 句柄。
    CONTEXT_SOURCE: guard.CONTEXT_SOURCE,
    factHealth: guard.factHealth,
    loadFactContext: guard.loadFactContext,
    loadFactDerived: guard.loadFactDerived,
    buildFactPackView: guard.buildFactPackView,
    PROSE_DIRECT_READS: guard.PROSE_DIRECT_READS,
    allowProseDirectRead: guard.allowProseDirectRead,
    resetProseAudit: guard.resetProseAudit,
    setFactGuardHandles: guard.setFactGuardHandles,
    sanitizeChapterTitle: chapters.sanitizeChapterTitle,
    parseChapterName: chapters.parseChapterName,
    chapterFileName: chapters.chapterFileName,
    readChapter: chapters.readChapter,
    listChapters: chapters.listChapters,
    nextChapterNumber: chapters.nextChapterNumber,
    createChapter: chapters.createChapter,
    renameChapter: chapters.renameChapter,
    deleteChapter: chapters.deleteChapter,
    historyBackupPath: chapterWrite.historyBackupPath,
    // OS-211：写边界判定（载体目录白名单）——章节端点与宿主回写共用同一份口径。
    CARRIER_WRITE_DIRS: chapterWrite.CARRIER_WRITE_DIRS,
    assertCarrierWrite: chapterWrite.assertCarrierWrite,
    assertGuardedTextWrite: chapterWrite.assertGuardedTextWrite,
    HISTORY_KEEP_DEFAULT: chapterWrite.HISTORY_KEEP_DEFAULT,
    resolveHistoryKeepPerFile: chapterWrite.resolveHistoryKeepPerFile,
    pruneHistoryBackups: chapterWrite.pruneHistoryBackups,
    mapWriteErrorCode: chapterWrite.mapWriteErrorCode,
    moduleOfPath: chapterWrite.moduleOfPath,
    writeChapterWithBackup: chapterWrite.writeChapterWithBackup
  })
})

export async function activate(context) {
  context.resolve('base.write', { min: 1 })
  context.resolve('base.naming', { min: 1 })
  // OS-195b：内核之间只经句柄——装载期把 fact.store/fact.pack 注入写前守卫。
  const store = context.resolve('fact.store', { min: 3 })
  const pack = context.resolve('fact.pack', { min: 1 })
  guard.setFactGuardHandles({ store, pack })
  return { capabilities: proseCapability }
}
