import * as chapters from './chapters.mjs'
import * as chapterWrite from './chapterWrite.mjs'

export const proseCapability = Object.freeze({
  'prose.write': Object.freeze({
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
  return { capabilities: proseCapability }
}
