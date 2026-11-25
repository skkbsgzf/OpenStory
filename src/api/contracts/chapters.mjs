/**
 * OpenStory API 契约——正文域（正文读写删除/章节清单与新建重命名/变更日志/编辑草稿）（OS-130 契约分域）。
 *
 * 本文件是仓根 contracts.mjs 的chapters域分片：只含本域端点形状，条目自 contracts.mjs
 * 逐字迁入（路径/method/请求响应形状/错误码未动一字）。纯数据零依赖——不 import 任何模块。
 * 聚合（ENDPOINTS/ENDPOINT_LIST）、错误码词表（API_ERROR_CODES）与校验函数
 * （endpointFor/validateRequest/validateResponse/errorEnvelope/normalize*）仍在仓根 contracts.mjs。
 * 改本域端点的形状只改这里，聚合入口自动跟随，daemon 与测试无感。
 */
export const chaptersEndpoints = {
  chapterGet: {
    method: 'GET',
    path: '/api/chapter',
    request: { query: { root: 'string', file: 'string' } },
    response: { ok: 'true', name: 'string', text: 'string', chars: 'integer' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  chapterPut: {
    method: 'PUT',
    path: '/api/chapter',
    request: { body: { root: 'string', file: 'string', text: 'string' } },
    // FACT-FIRST：写入后如实回报事实链健康度（stale=正文比事实链新），UI 据此提示重跑。
    response: { ok: 'true', chars: 'integer', savedAt: 'string', backup: 'string?', factStale: 'boolean?', factEntries: 'integer?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  chaptersGet: {
    method: 'GET',
    path: '/api/chapters',
    // 章节清单：文件名 NNN-标题.md／第N章… 解析（parseChapterNumber 同源），无号=null 排尾，字数现算。
    request: { query: { root: 'string', dir: 'string' } },
    response: { ok: 'true', chapters: 'array', warnings: 'array?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  chaptersCreate: {
    method: 'POST',
    path: '/api/chapters',
    // 新建章节：自动下一号（最大+1 三位补零）＋标题安全化；title 缺省时由写作套件的
    // 「新建章节默认标题」补（套件停用且无标题＝拒绝）；目录不存在自动建；空文件落盘。
    request: { body: { root: 'string', dir: 'string', title: 'string?' } },
    response: { ok: 'true', chapter: 'object' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  chaptersRename: {
    method: 'POST',
    path: '/api/chapters/rename',
    // 保号重命名：只换标题段；目标已存在拒绝。
    request: { body: { root: 'string', file: 'string', title: 'string' } },
    response: { ok: 'true', chapter: 'object', previousFile: 'string?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  chapterDelete: {
    method: 'DELETE',
    path: '/api/chapter',
    // 非破坏删除：挪进同目录 .history/<file>.deleted-<时间戳>。
    request: { query: { root: 'string', file: 'string' } },
    response: { ok: 'true', backup: 'string' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  changeLogGet: {
    method: 'GET',
    path: '/api/log',
    // OS-89：模块自检索变更日志（AGENTS.md 第 10 条）。
    // 每个模块加载时调一次，拿自己相关的近期修改（含 unified diff）。
    // module 缺省＝跨模块概览；file 缺省＝该模块全部文件。
    request: { query: { root: 'string', module: 'string?', file: 'string?', limit: 'string?' } },
    response: { ok: 'true', entries: 'array', truncated: 'boolean' },
    errors: ['NO_LIBRARY']
  },

  changeLogSummary: {
    method: 'GET',
    path: '/api/log/summary',
    // 每模块最近一条变更（库总览用）。
    request: { query: { root: 'string' } },
    response: { ok: 'true', modules: 'array' },
    errors: ['NO_LIBRARY']
  },

  changeLogEntry: {
    method: 'GET',
    path: '/api/log/entry',
    // OS-90：读单条变更的完整记录（含完整 diff）——日志卡点开就用它。
    request: { query: { root: 'string', module: 'string', at: 'string', afterHash: 'string' } },
    response: { ok: 'true', entry: 'object' },
    errors: ['NO_LIBRARY', 'NOT_FOUND']
  },

  changeLogRestore: {
    method: 'POST',
    path: '/api/log/restore',
    // OS-90：把某个文件恢复到某次变更之前的状态。
    // 先给当前内容做一次备份（保证这次恢复本身也可回退），再从该次变更记下的 backup 拷回。
    request: { body: { root: 'string', module: 'string', at: 'string', afterHash: 'string' } },
    response: { ok: 'true', file: 'string', restoredFrom: 'string', safetyBackup: 'string?' },
    errors: ['NO_LIBRARY', 'NOT_FOUND', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
  },

  draftGet: {
    method: 'GET',
    path: '/api/draft',
    // OS-89：未保存的编辑草稿落库内 .openstory/drafts/<module>/<id>.json。
    // 作者还没点保存的内容也必须落本地（AGENTS.md 第 11 条）。
    request: { query: { root: 'string', module: 'string', id: 'string?' } },
    response: { ok: 'true', draft: 'object?', drafts: 'array?' },
    errors: ['NO_LIBRARY', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  draftPut: {
    method: 'PUT',
    path: '/api/draft',
    // 存草稿：给 module＋id 就 upsert；给 module 不给 id 就列全部（见 draftGet）。
    // 删除＝text 传空且 delete:true。
    request: { body: { root: 'string', module: 'string', id: 'string', text: 'string?', meta: 'object?', delete: 'boolean?' } },
    response: { ok: 'true', draft: 'object?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
  },
}
