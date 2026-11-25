/**
 * OpenStory API 契约——世界书域（世界书笔记索引与图谱/条目图片资产与生图/旧目录迁入/同源同步检查）（OS-130 契约分域）。
 *
 * 本文件是仓根 contracts.mjs 的reference域分片：只含本域端点形状，条目自 contracts.mjs
 * 逐字迁入（路径/method/请求响应形状/错误码未动一字）。纯数据零依赖——不 import 任何模块。
 * 聚合（ENDPOINTS/ENDPOINT_LIST）、错误码词表（API_ERROR_CODES）与校验函数
 * （endpointFor/validateRequest/validateResponse/errorEnvelope/normalize*）仍在仓根 contracts.mjs。
 * 改本域端点的形状只改这里，聚合入口自动跟随，daemon 与测试无感。
 */
export const referenceEndpoints = {
  referenceGet: {
    method: 'GET',
    path: '/api/reference',
    // 世界书载体索引（OS-44）：扫描 世界书/ 目录，解析每篇的 frontmatter／标签／双链。
    // 不落盘（每次重建，避免两份真相）。标签清单一并返回（带计数与描述）。
    // currentChapter（OS-96）：给了＝notes 只回 firstChapter≤该章的词条（防剧透筛选）
    request: { query: { root: 'string', currentChapter: 'integer?' } },
    response: { ok: 'true', notes: 'array', tags: 'array', tagNotes: 'object', stats: 'object', filtered: 'boolean?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  referenceGraphGet: {
    method: 'GET',
    path: '/api/reference/graph',
    // 世界书图谱：节点=世界书/标签/章节产物/条目(只读)，边权 link=2 / mention=min(n,3) / tag=1。
    // 单向原则：边只从世界书出发指向产物，正文不反向进入世界书的上下文。
    request: { query: { root: 'string' } },
    response: { ok: 'true', nodes: 'array', edges: 'array', tags: 'array', stats: 'object' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  referenceNoteGet: {
    method: 'GET',
    path: '/api/reference/note',
    // 单篇世界书：返回原文＋解析后的 frontmatter／标签／双链＋双段反链（linked / unlinked）。
    request: { query: { root: 'string', path: 'string' } },
    response: { ok: 'true', note: 'object', backlinks: 'object' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  referenceAssetGet: {
    method: 'GET',
    path: '/api/reference/asset',
    // 世界书条目的图片本体（OS-75）：path 相对库根，只放行 世界书/ 下图片扩展名。
    // 成功响应是二进制流（image/png 等），不是 JSON——前端 <img> 直挂。
    request: { query: { root: 'string', path: 'string' } },
    response: { ok: 'true' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'NOT_FOUND', 'INVALID_ENTRY', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  referenceImageGenerate: {
    method: 'POST',
    path: '/api/reference/image',
    // 世界书条目生图（OS-75）：按条目名＋描述生成设定图，落
    // 世界书/<条目目录>/assets/<条目名>.png，并把相对路径回填进该条目的 frontmatter cover/images。
    // 后端走全局配置 image 块（OpenAI 兼容 或 ComfyUI）；stylePrompt 缺省＝「2D彩漫风格」。
    request: {
      body: {
        root: 'string',
        path: 'string',
        prompt: 'string?',
        stylePrompt: 'string?',
        size: 'string?',
        kind: 'string?'
      }
    },
    response: { ok: 'true', path: 'string', imagePath: 'string', frontmatter: 'object', chars: 'number' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'AGENT_UPSTREAM_ERROR', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  referenceAbsorb: {
    method: 'POST',
    path: '/api/reference/absorb',
    // 旧目录迁入世界书（OS-48 / G8b）：只接受 大纲/构思/资料/世界书，逐文件搬进 世界书/<原名>/。
    // 兼容输入中的旧世界书载体条目走这里归入 OpenStory 世界书目录。
    // 显式动稿：目标已存在＝skip 不覆盖；目标原子写＋源文件挪进 .history（.deleted-<ts>，可逆）。
    // 返回 moved（含备份路径）与 skipped（带原因），绝不自动调用——前端弹窗确认后才发。
    request: { body: { root: 'string', dirs: 'array' } },
    response: { ok: 'true', moved: 'array', skipped: 'array' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  syncCheck: {
    method: 'POST',
    path: '/api/sync/check',
    // OS-107 同源版本检查 ＋ 外部变更检测（POST：检查动作会刷新 .openstory/sync-state.json 快照）。
    // 一次读盘回答两件事：①故事源 fact 的 revision 与兄弟 wiki 的 derivedFrom.factRevision 是否同源
    // （wikiStale）、世界书笔记最新 mtime；②正文文件的 hash/mtime 与 changelog 对照，
    // 捞出「改了但变更日志里没记录」的文件（绕过写通道的外部改动）。
    // 无故事源数据时 factRevision=0、wiki 无派生档，不报错。
    request: { body: { root: 'string' } },
    response: { ok: 'true', sameSource: 'object', external: 'object', factRevision: 'integer' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
  },
}
