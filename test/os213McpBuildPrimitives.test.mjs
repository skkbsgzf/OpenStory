/**
 * OS-213：MCP 建库原语（库/套件/fact/exchange）真实 daemon 映射与负向。
 *
 * 跑法：node --test test/os213McpBuildPrimitives.test.mjs
 *
 * 断言口径：每个新工具都要有「真实临地 daemon 成功回读」＋「参数/业务负向」两类证据。
 * 只验 tools/list 里出现过不算——那只能证明工具表对齐，证明不了它接对了端点。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { withTempDaemon } from './helpers/tempDaemon.mjs'

function startMcp(port) {
  const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'host', 'mcp.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, OPENSTORY_PORT: String(port) }
  })
  const pending = new Map()
  let buf = '', stderr = ''
  let nextId = 1
  let exited = false
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.stdout.on('data', (chunk) => {
    buf += chunk
    let index
    while ((index = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, index).trim()
      buf = buf.slice(index + 1)
      if (!line) continue
      const message = JSON.parse(line)
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message)
        pending.delete(message.id)
      }
    }
  })
  child.on('exit', () => { exited = true })
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP 超时 ${method}`)) }, 30000)
    pending.set(id, (message) => { clearTimeout(timer); resolve(message) })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`)
  })
  return {
    request,
    close: async () => { if (!exited) { child.kill(); await new Promise((done) => child.once('exit', done)) } },
    stderr: () => stderr
  }
}

const callRaw = (mcp, name, args) => mcp.request('tools/call', { name, arguments: args })
const payload = (result) => JSON.parse(result.content[0].text)

test('OS-213：建库原语在临时 daemon 上真实成功，且负向拒绝', async () => {
  await withTempDaemon(async (fx) => {
    const mcp = startMcp(fx.daemon.port)
    try {
      await mcp.request('initialize', { protocolVersion: '2024-11-05' })

      /* ---- 库：diagnose 只读 ---- */
      const diagnose = payload((await callRaw(mcp, 'openstory_library_diagnose', { root: fx.root })).result)
      assert.ok(diagnose.shape, 'diagnose 必须返回 shape')
      assert.ok(diagnose.verdict, 'diagnose 必须返回 verdict')

      /* ---- 库：create 真建，libraries 能读回 ---- */
      const fresh = await mkdtemp(join(tmpdir(), 'os213-create-'))
      try {
        // 缺 confirm 的 create 必须被确认闸拦（写工具门槛 create）
        const noConfirm = await callRaw(mcp, 'openstory_library_create', { path: fresh, name: 'OS213 新库' })
        assert.equal(noConfirm.result.isError, true, '写工具缺 confirm 必须拒绝')
        assert.match(noConfirm.result.content[0].text, /CONFIRM_REQUIRED/u)

        const created = payload((await callRaw(mcp, 'openstory_library_create', { path: fresh, name: 'OS213 新库', confirm: 'create' })).result)
        assert.equal(resolve(created.root), resolve(fresh), '建库返回的 root 应是库根')
        assert.ok(created.document, '建库必须返回 project.json 文档')
        // 读回：libraries 里应能看到刚建的库
        const libraries = payload((await callRaw(mcp, 'openstory_libraries', {})).result)
        assert.ok(libraries.libraries.some((item) => resolve(item.path) === resolve(fresh)),
          '新建的库必须出现在 libraries 里')
        // 负向：已存在非空库再建应报错（业务错误信封，不是崩溃）
        const duplicate = await callRaw(mcp, 'openstory_library_create', { path: fresh, name: '重复', confirm: 'create' })
        assert.equal(duplicate.result.isError, true, '重复建库必须报业务错误')

        /* ---- 库：primary 切主载体 ---- */
        const { CARRIERS } = await import('../src/modules/storage/projectDoc.mjs')
        const scriptCarrier = Object.keys(CARRIERS).find((id) => id.endsWith('script'))
        const primary = payload((await callRaw(mcp, 'openstory_library_primary', { root: fresh, primaryCarrier: scriptCarrier, confirm: 'create' })).result)
        assert.ok(primary.document, 'primary 必须返回更新后的文档')
        // 负向：不存在的载体必须拒
        const badPrimary = await callRaw(mcp, 'openstory_library_primary', { root: fresh, primaryCarrier: '不存在的载体', confirm: 'create' })
        assert.equal(badPrimary.result.isError, true, '未知主载体必须拒绝')
      } finally {
        await rm(fresh, { recursive: true, force: true })
      }

      /* ---- 库：scan / import（用临时源目录） ---- */
      const source = await mkdtemp(join(tmpdir(), 'os213-src-'))
      try {
        const { writeFile } = await import('node:fs/promises')
        await writeFile(join(source, '第一章.md'), '# 第一章\n\n旧稿内容。\n', 'utf-8')
        const scan = payload((await callRaw(mcp, 'openstory_library_scan', { root: fx.root, sourcePath: source })).result)
        assert.ok(scan.plan, 'scan 必须返回计划')
        // 负向：不存在的源目录要报业务错误
        const badScan = await callRaw(mcp, 'openstory_library_scan', { root: fx.root, sourcePath: join(source, '不存在') })
        assert.equal(badScan.result.isError, true, '不存在的源目录必须拒绝')
      } finally {
        await rm(source, { recursive: true, force: true })
      }

      /* ---- 套件：list / enable / settings ---- */
      const suites = payload((await callRaw(mcp, 'openstory_suites', { root: fx.root })).result)
      assert.ok(Array.isArray(suites.suites) && suites.suites.length > 0, '必须列出套件')
      const targetSuite = suites.suites[0]
      // 负向：未知套件 id 必须拒
      const badSuite = await callRaw(mcp, 'openstory_suite_enable', { id: '不存在的套件', enabled: true, root: fx.root, confirm: 'create' })
      assert.equal(badSuite.result.isError, true, '未知套件必须拒绝')
      // 正向：启停往返（停用再启用，读回状态一致）
      const disabled = payload((await callRaw(mcp, 'openstory_suite_enable', { id: targetSuite.id, enabled: false, root: fx.root, confirm: 'create' })).result)
      assert.equal(disabled.enabled, false)
      const reenabled = payload((await callRaw(mcp, 'openstory_suite_enable', { id: targetSuite.id, enabled: true, root: fx.root, confirm: 'create' })).result)
      assert.equal(reenabled.enabled, true)
      // 负向：设置值形状错（数组不是对象）——协议层 schema 声明 type:object，
      // 因此由 JSON-RPC -32602 拦下（不是业务信封）。断言「拒绝」而非指定层。
      const badSettings = await callRaw(mcp, 'openstory_suite_settings', { id: targetSuite.id, values: [], root: fx.root, confirm: 'create' })
      assert.ok(badSettings.error || badSettings.result?.isError === true, 'values 非对象必须被拒（协议层或业务层）')

      /* ---- fact：books / entries / import ---- */
      const books = payload((await callRaw(mcp, 'openstory_fact_books', { root: fx.root })).result)
      assert.ok(Array.isArray(books.books), 'fact books 必须是数组')
      const bookId = books.books[0]?.id ?? books.books[0]?.bookId
      if (bookId) {
        const entries = payload((await callRaw(mcp, 'openstory_fact_entries', { root: fx.root, bookId })).result)
        assert.equal(entries.bookId, bookId)
        assert.ok(Array.isArray(entries.entries))
        assert.ok(Number.isInteger(entries.revision), 'entries 必须带 revision')
        // 负向：不存在的 bookId 要报业务错误
        const badEntries = await callRaw(mcp, 'openstory_fact_entries', { root: fx.root, bookId: '不存在的事实书' })
        assert.equal(badEntries.result.isError, true, '未知 bookId 必须拒绝')
      }
      // 负向：import 传非法条目（短 id，必被 schema 拦）→ 整份拒绝、零写入
      const badImport = await callRaw(mcp, 'openstory_fact_entries_import', {
        root: fx.root, bookId: bookId ?? 'testbook', entries: [{ id: 'x' }], confirm: 'create'
      })
      assert.equal(badImport.result.isError, true, '非法条目必须整份拒绝')
      // 负向：缺 confirm 的 import 必须被确认闸拦
      const noConfirmImport = await callRaw(mcp, 'openstory_fact_entries_import', { root: fx.root, bookId: 'testbook', entries: [] })
      assert.equal(noConfirmImport.result.isError, true)
      assert.match(noConfirmImport.result.content[0].text, /CONFIRM_REQUIRED/u)

      /* ---- exchange：export 读/写条件语义 + import dryRun ---- */
      if (bookId) {
        // export 缺省（save 省略）＝纯读，不需要 confirm
        const exported = payload((await callRaw(mcp, 'openstory_exchange_export', { root: fx.root, bookId, format: 'jsonl' })).result)
        assert.equal(exported.bookId, bookId)
        assert.ok(Array.isArray(exported.entries))
        assert.ok(Array.isArray(exported.lost), 'export 必须回报 lost（格式装不下的字段）')
        assert.equal(exported.file, undefined, 'save 缺省不得落盘')
        // export save=true 是条件写：缺 confirm 必须拒
        const saveNoConfirm = await callRaw(mcp, 'openstory_exchange_export', { root: fx.root, bookId, format: 'jsonl', save: true })
        assert.equal(saveNoConfirm.result.isError, true, 'save:true 必须要求 confirm')
        assert.match(saveNoConfirm.result.content[0].text, /CONFIRM_REQUIRED/u)
      }
      // import dryRun:true＝零写入。pedia 条目要带 v3 必填的 provenance/fingerprint，
      // 否则转换后校验不过（那测的就不是 dryRun 语义而是坏数据了）。
      const { stableEntryId } = await import('../src/modules/fact/fact/domain/index.mjs')
      const probeName = 'OS-213 导入探针'
      const pediaEntry = {
        schema: 'pedia/v1',
        id: stableEntryId({ layer: 'plot', domain: '测试', slot: '', name: probeName }),
        layer: 'plot', name: probeName, domain: '测试',
        provenance: { mode: 'analyze', book: 'testbook', book_id: 'testbook', chapters: [1], scenes: [], extractor: 'os213-probe' },
        fingerprint: { vec: null, metrics: {} },
        events: [{ index: 1, who: '甲', channel: 'perceive', content: '一条探针。' }]
      }
      const dry = payload((await callRaw(mcp, 'openstory_exchange_import', {
        root: fx.root, bookId: bookId ?? 'testbook', format: 'jsonl', text: JSON.stringify(pediaEntry), dryRun: true, confirm: 'create'
      })).result)
      assert.equal(dry.dryRun, true)
      assert.ok(Array.isArray(dry.errors))
      assert.equal(dry.written, undefined, 'dryRun 不得写盘')
      // 负向：dryRun 也要 confirm（缺省即真写，注册表整体按写工具——宁严不宽）
      const dryNoConfirm = await callRaw(mcp, 'openstory_exchange_import', {
        root: fx.root, bookId: bookId ?? 'testbook', format: 'jsonl', text: JSON.stringify(pediaEntry), dryRun: true
      })
      assert.equal(dryNoConfirm.result.isError, true, '即使 dryRun 也要求 confirm（缺省即写）')
      // 负向：import 缺 confirm 且非 dryRun → 拒（整体按写工具）
      const importNoConfirm = await callRaw(mcp, 'openstory_exchange_import', {
        root: fx.root, bookId: bookId ?? 'testbook', format: 'jsonl', text: JSON.stringify(pediaEntry)
      })
      assert.equal(importNoConfirm.result.isError, true, '非 dryRun 导入必须要求 confirm')
      // 负向：未知 format 要报业务错误
      const badFormat = await callRaw(mcp, 'openstory_exchange_import', {
        root: fx.root, bookId: bookId ?? 'testbook', format: '不存在的格式', text: JSON.stringify(pediaEntry), dryRun: true
      })
      assert.equal(badFormat.result.isError, true, '未知格式必须拒绝')
    } finally {
      await mcp.close()
    }
  })
})

test('OS-213：新工具不给未授权 root 开口子（越权读同一道闸）', async () => {
  await withTempDaemon(async (fx) => {
    const mcp = startMcp(fx.daemon.port)
    try {
      await mcp.request('initialize', { protocolVersion: '2024-11-05' })
      const outside = await mkdtemp(join(tmpdir(), 'os213-outside-'))
      try {
        for (const [name, args] of [
          ['openstory_library_diagnose', { root: outside }],
          ['openstory_fact_books', { root: outside }],
          ['openstory_suites', { root: outside }],
          ['openstory_files', { root: outside }]
        ]) {
          const reply = await callRaw(mcp, name, args)
          assert.equal(reply.result.isError, true, `${name} 必须拒绝未登记 root`)
        }
      } finally {
        await rm(outside, { recursive: true, force: true })
      }
    } finally {
      await mcp.close()
    }
  })
})

test('OS-213：工具数与语义注册表逐名一致（新增工具不得漏分类）', async () => {
  const { MCP_TOOL_NAMES, MCP_SEMANTICS_CHECK } = await import('../src/host/mcp.mjs')
  const { toolSemanticsOf, isWriteTool } = await import('../src/protocol/mcpToolSemantics.mjs')
  assert.equal(MCP_SEMANTICS_CHECK.ok, true)
  for (const name of MCP_TOOL_NAMES) {
    assert.ok(toolSemanticsOf(name), `工具必须已分类：${name}`)
  }
  // 13 个新原语里，读/写必须分对：diagnose/scan/books/entries/suites 是读
  for (const name of ['openstory_library_diagnose', 'openstory_library_scan', 'openstory_fact_books', 'openstory_fact_entries', 'openstory_suites']) {
    assert.equal(isWriteTool(name), false, `${name} 应标为读`)
  }
  // create/import/primary/enable/settings/fact_entries_import/exchange_import 是写
  for (const name of ['openstory_library_create', 'openstory_library_import', 'openstory_library_primary',
    'openstory_suite_enable', 'openstory_suite_settings', 'openstory_fact_entries_import', 'openstory_exchange_import']) {
    assert.equal(isWriteTool(name), true, `${name} 应标为写`)
  }
})
