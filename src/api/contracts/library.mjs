/**
 * OpenStory API 契约——库域（库清单/形态诊断/建库/导入预览与执行/载体修缺）（OS-130 契约分域）。
 *
 * 本文件是仓根 contracts.mjs 的library域分片：只含本域端点形状，条目自 contracts.mjs
 * 逐字迁入（路径/method/请求响应形状/错误码未动一字）。纯数据零依赖——不 import 任何模块。
 * 聚合（ENDPOINTS/ENDPOINT_LIST）、错误码词表（API_ERROR_CODES）与校验函数
 * （endpointFor/validateRequest/validateResponse/errorEnvelope/normalize*）仍在仓根 contracts.mjs。
 * 改本域端点的形状只改这里，聚合入口自动跟随，daemon 与测试无感。
 */
export const libraryEndpoints = {
  libraries: {
    method: 'GET',
    path: '/api/libraries',
    request: { query: {} },
    response: {
      ok: 'true',
      libraries: 'array',
      warnings: 'array',
      preferencesPath: 'string?',
      defaultRoot: 'string?'
    },
    errors: []
  },

  libraryDiagnose: {
    method: 'GET',
    path: '/api/library/diagnose',
    // 库形态四件套（exists/dirEmpty/旧元数据目录诊断/project）＋ A-5 verdict。
    request: { query: { root: 'string' } },
    response: { ok: 'true', shape: 'object', verdict: 'object' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY']
  },

  libraryCreate: {
    method: 'POST',
    path: '/api/library/create',
    // primaryCarrier 缺省＝空壳（needsPrimary:true）。成功即登记进自持清单（新院 libraries.json）。
    request: { body: { path: 'string', name: 'string', primaryCarrier: 'string?' } },
    response: {
      ok: 'true',
      root: 'string',
      document: 'object',
      enabled: 'array?',
      needsPrimary: 'boolean',
      registered: 'object'
    },
    errors: ['INVALID_ENTRY', 'PATH_ESCAPE', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },

  libraryScan: {
    method: 'POST',
    path: '/api/library/scan',
    // 导入预览：planImport 只读源目录、不落盘。sourcePath 必须绝对且存在（源在库外是导入的本意）。
    request: { body: { root: 'string', sourcePath: 'string' } },
    response: { ok: 'true', plan: 'object' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'PATH_ESCAPE']
  },

  libraryImport: {
    method: 'POST',
    path: '/api/library/import',
    // 执行导入：runImport 按计划落盘到目标库标准目录（只新增不覆盖；源目录永远只读）。
    request: { body: { root: 'string', sourcePath: 'string' } },
    response: { ok: 'true', report: 'object' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'PATH_ESCAPE', 'WRITE_PROTOCOL_IO_FAILED']
  },

  libraryPrimary: {
    method: 'POST',
    path: '/api/library/primary',
    // 修「缺主模块」：依赖闭包装不齐＝拒绝；expectedRevision 给了就按乐观并发闸（STALE_REVISION→REVISION_MISMATCH）。
    request: { body: { root: 'string', primaryCarrier: 'string', expectedRevision: 'integer?' } },
    response: { ok: 'true', document: 'object', enabled: 'array?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'REVISION_MISMATCH', 'WRITE_PROTOCOL_IO_FAILED']
  },

  // OS-221：迁移状态与备份的**专用只读**观测（不再拿整个 /api/plugins 代替）。
  // 两个端点都不接受任何写入参数：状态里 DATA_VERSION_AHEAD 只作为 dataAhead 字段报告，
  // 不返回 409；坏 journal/缺备份/哈希不符/回滚未完成作为类型化 issues 如实呈现。
  // 备份端点只列库内相对路径与哈希，不提供任意路径下载。
  libraryMigrationStatusGet: {
    method: 'GET',
    path: '/api/library/migration-status',
    request: { query: { root: 'string' } },
    response: {
      ok: 'true',
      spec: 'string',
      root: 'string',
      checkedAt: 'string',
      status: 'string',
      healthy: 'boolean',
      upgrade: 'object',
      legacyPresent: 'boolean',
      journals: 'array',
      dataVersions: 'array',
      dataAhead: 'array',
      failures: 'array',
      rolledBack: 'array',
      rollbackErrors: 'array',
      running: 'array',
      pending: 'array',
      backupPaths: 'array',
      issues: 'array',
      writes: 'boolean'
    },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY']
  },

  libraryMigrationBackupsGet: {
    method: 'GET',
    path: '/api/library/migration-backups',
    // 只读：列升级/能力备份目录、逐文件 sha256/大小、与 journal 记录哈希的核对结果。
    // 可选 backup 只接受库内相对路径（.history/…）用于「只看一份」，永远不做磁盘任意读。
    request: { query: { root: 'string', backup: 'string?' } },
    response: {
      ok: 'true',
      spec: 'string',
      root: 'string',
      checkedAt: 'string',
      healthy: 'boolean',
      historyDir: 'string',
      backups: 'array',
      issues: 'array',
      writes: 'boolean'
    },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'MIGRATION_BACKUP_PATH_INVALID']
  },

  /* ===== OS-222：diagnose→plan→confirm→apply→status/backup verify ===== */

  libraryUpgradeDiagnose: {
    method: 'GET',
    path: '/api/library/upgrade-diagnose',
    // 只读诊断：旧库升级＋能力迁移的只读判定，零写入、不跑迁移、不建备份。
    request: { query: { root: 'string' } },
    response: { ok: 'true', spec: 'string', root: 'string', section: 'object', writes: 'boolean' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY']
  },

  libraryUpgradePlan: {
    method: 'POST',
    path: '/api/library/upgrade-plan',
    // 只读计划：登记内存中的 planId 供 apply 复核；零写入、不跑迁移/备份。
    request: { body: { root: 'string' } },
    response: { ok: 'true', plan: 'object', planId: 'string', writes: 'boolean' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY']
  },

  libraryUpgradeApply: {
    method: 'POST',
    path: '/api/library/upgrade-apply',
    // 显式动稿：必须 planId + confirm:true；服务端重算计划核对 root/文件/迁移器摘要，
    // 复用既有 journal/备份/回滚，绝不提供 shell/fs 直写捷径。
    request: { body: { root: 'string', planId: 'string', confirm: 'boolean', operationId: 'string?' } },
    response: {
      ok: 'true', spec: 'string', root: 'string', planId: 'string', outcome: 'string',
      libraryUpgrade: 'object?', capabilityMigrations: 'array?', journals: 'array', backups: 'array',
      rolledBack: 'boolean', rollbackErrors: 'array', message: 'string'
    },
    errors: [
      'NO_LIBRARY', 'INVALID_ENTRY', 'CONFIRM_REQUIRED', 'PLAN_REQUIRED', 'PLAN_NOT_FOUND',
      'PLAN_ROOT_MISMATCH', 'PLAN_STALE', 'DATA_VERSION_AHEAD', 'MIGRATION_FAILED', 'LIBRARY_UPGRADE_FAILED'
    ]
  },
}
