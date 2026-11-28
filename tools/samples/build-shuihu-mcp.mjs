/**
 * OS-217：《水浒传》MCP-only clean-room 构建器。
 *
 * 证明的不是「模型从零理解公版小说」，而是「受控配方内容从空目录经真实 MCP 工具
 * 建库、落盘、回读、导出」的全链路。业务内容只来自 shuihu-recipe.mjs；本脚本自身
 * 只创建临时目录、隔离配置、daemon/MCP 子进程、审计与报告，绝不直接 writeFile 业务稿件。
 *
 * 用法：
 *   node tools/samples/build-shuihu-mcp.mjs --out <空目录> [--audit <jsonl>] [--report <json>]
 *   node tools/samples/build-shuihu-mcp.mjs --omit-tool openstory_fact_entries_import  # 负向：必须红
 *
 * 隔离：port:0 daemon、临时 LOCALAPPDATA/APPDATA/preferences、假文本上游；不连接 8807，
 * 不读作者真库。假上游只验证多角色扮演的协议/落盘，不被标记为真实模型语义验收。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startDaemon } from '../../src/host/daemon.mjs'
import { SHUIHU_RECIPE, semanticDigest } from './shuihu-recipe.mjs'

const DEFAULT_RECIPE = SHUIHU_RECIPE

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MCP_ENTRY = join(REPO, 'src', 'host', 'mcp.mjs')

const REQUIRED_TOOLS = Object.freeze([
  'openstory_library_create', 'openstory_library_diagnose', 'openstory_libraries',
  'openstory_suites', 'openstory_suite_enable', 'openstory_suite_settings',
  'openstory_habits_put', 'openstory_habits_read',
  'openstory_reference_write_note', 'openstory_reference_read_note', 'openstory_reference_index',
  'openstory_fact_entries_import', 'openstory_fact_books', 'openstory_fact_entries',
  'openstory_novel_write_chapter', 'openstory_novel_read_chapter', 'openstory_novel_list_chapters',
  'openstory_script_to_fact', 'openstory_script_from_fact',
  'openstory_session_put', 'openstory_session_get', 'openstory_session_new', 'openstory_session_switch', 'openstory_sessions',
  'openstory_assets', 'openstory_asset_put', 'openstory_asset_read',
  'openstory_exchange_export', 'openstory_exchange_import', 'openstory_files', 'openstory_plugins',
  'openstory_roleplay_opening', 'openstory_roleplay_scene_turn', 'openstory_ui_state'
])

function hashText(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function parameterSummary(args) {
  const out = {}
  for (const [key, value] of Object.entries(args ?? {})) {
    if (key === 'text' || key === 'dataBase64' || key === 'playerAction' || key === 'prompt') {
      out[key] = { chars: String(value ?? '').length, sha256: hashText(value) }
    } else if (key === 'entries' || key === 'notes' || key === 'session' || key === 'values' || key === 'habits') {
      out[key] = { sha256: hashText(JSON.stringify(value)), kind: Array.isArray(value) ? 'array' : typeof value }
    } else {
      out[key] = value
    }
  }
  return out
}

function stableValue(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stableValue)
  const out = {}
  for (const key of Object.keys(value).sort()) {
    if (['createdAt', 'updatedAt', 'generated_at', 'projectId', 'savedAt', 'activeId', 'sessionId'].includes(key)) continue
    out[key] = stableValue(value[key])
  }
  return out
}

class McpClient {
  constructor(port, audit, omitted = new Set()) {
    this.omitted = omitted
    this.audit = audit
    this.seq = 0
    this.pending = new Map()
    this.buffer = ''
    this.stderr = ''
    this.exited = false
    this.child = spawn(process.execPath, [MCP_ENTRY], {
      cwd: REPO,
      env: { ...process.env, OPENSTORY_PORT: String(port), LOCALAPPDATA: process.env.LOCALAPPDATA, APPDATA: process.env.APPDATA },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk })
    this.child.stdout.on('data', (chunk) => this.#onData(chunk))
    this.child.on('exit', () => { this.exited = true })
  }

  #onData(chunk) {
    this.buffer += chunk
    let index
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      let message
      try { message = JSON.parse(line) } catch {
        this.audit.push({ type: 'bad-stdout', line: line.slice(0, 500) })
        continue
      }
      if (message.id !== undefined && this.pending.has(message.id)) {
        this.pending.get(message.id)(message)
        this.pending.delete(message.id)
      }
    }
  }

  request(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP 超时：${method}`))
      }, 120000)
      this.pending.set(id, (message) => { clearTimeout(timer); resolveRequest(message) })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  async call(name, args = {}, { confirm } = {}) {
    if (this.omitted.has(name)) throw new Error(`MCP_TOOL_UNAVAILABLE · 负向探针故意移除 ${name}`)
    const callArgs = confirm ? { ...args, confirm } : { ...args }
    const started = Date.now()
    const reply = await this.request('tools/call', { name, arguments: callArgs })
    const result = reply.result
    const text = result?.content?.[0]?.text ?? ''
    const code = result?.isError ? String(text).split(' · ')[0] : (reply.error?.code ? `RPC_${reply.error.code}` : 'OK')
    this.audit.push({
      seq: this.audit.length + 1,
      tool: name,
      params: parameterSummary(callArgs),
      rpcError: reply.error?.code ?? null,
      isError: result?.isError === true,
      code,
      durationMs: Date.now() - started
    })
    if (reply.error) throw new Error(`RPC_${reply.error.code} · ${reply.error.message}`)
    if (!result || result.isError) throw new Error(text || `${name} 返回空结果`)
    return JSON.parse(text)
  }

  async close() {
    if (this.exited) return
    this.child.kill()
    await new Promise((done) => this.child.once('exit', done))
  }
}

async function startFakeUpstream() {
  const server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      if (req.url !== '/v1/chat/completions') {
        res.writeHead(404).end()
        return
      }
      // 固定文本只证明协议与落盘；不是真实模型语义。
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '洪信按住殿门，黑烟从门缝里涌出，散作百十道金光。' } }]
      }))
    })
  })
  await new Promise((done, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', done)
  })
  return {
    port: server.address().port,
    close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()) })
  }
}

function parseArgv(argv) {
  const out = { out: '', audit: '', report: '', omit: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') out.out = argv[++index] ?? ''
    else if (arg === '--audit') out.audit = argv[++index] ?? ''
    else if (arg === '--report') out.report = argv[++index] ?? ''
    else if (arg === '--omit-tool') out.omit.push(argv[++index] ?? '')
    else throw new Error(`未知参数：${arg}`)
  }
  return out
}

export async function buildShuihuWithMcp(options = {}) {
  const recipe = options.recipe ?? DEFAULT_RECIPE
  const omitted = new Set(options.omittedTools ?? [])
  const base = options.baseDir ?? await mkdtemp(join(tmpdir(), 'openstory-os217-'))
  const root = options.root ?? join(base, '水浒传')
  const appData = join(base, 'appdata')
  const preferencesPath = join(base, 'preferences.json')
  const agentConfigPath = join(appData, 'OpenStory', 'openstory', 'agent-config.json')
  const audit = []
  const snapshot = {}
  let daemon = null
  let upstream = null
  let mcp = null
  let failure = null

  await mkdir(root, { recursive: true })
  await mkdir(dirname(agentConfigPath), { recursive: true })
  await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [] }, null, 2), 'utf8')

  try {
    upstream = await startFakeUpstream()
    await writeFile(agentConfigPath, JSON.stringify({
      text: {
        endpoint: `http://127.0.0.1:${upstream.port}/v1/chat/completions`,
        model: 'os217-fake-upstream',
        apiKey: '',
        runtime: '',
        reasoningEffort: '',
        chineseReasoning: true
      }
    }, null, 2), 'utf8')

    daemon = await startDaemon({
      port: 0,
      preferencesPath,
      agentConfigPath,
      env: { ...process.env, LOCALAPPDATA: appData, APPDATA: appData },
      logger: { log() {} }
    })
    mcp = new McpClient(daemon.port, audit, omitted)
    const init = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'os217', version: '1' } })
    if (init.error) throw new Error(`initialize 失败：${JSON.stringify(init.error)}`)
    const listed = await mcp.request('tools/list')
    const names = new Set((listed.result?.tools ?? []).map((tool) => tool.name))
    for (const name of REQUIRED_TOOLS) {
      if (!names.has(name)) throw new Error(`MCP_TOOL_MISSING · tools/list 缺 ${name}`)
    }
    snapshot.toolNames = [...names].sort()

    const created = await mcp.call('openstory_library_create', {
      path: root, name: recipe.name, primaryCarrier: recipe.primaryCarrier
    }, { confirm: 'create' })
    if (resolve(created.root) !== resolve(root)) throw new Error(`建库 root 不一致：${created.root}`)
    snapshot.library = stableValue(created.document)
    await mcp.call('openstory_library_diagnose', { root })
    const libraries = await mcp.call('openstory_libraries', {})
    if (!libraries.libraries.some((item) => resolve(item.path) === resolve(root))) throw new Error('libraries 未读回新建库')

    const suites = await mcp.call('openstory_suites', { root })
    const writing = suites.suites.find((item) => item.id === 'writing')
    if (!writing) throw new Error('找不到写作套件')
    await mcp.call('openstory_suite_enable', { id: 'writing', enabled: true, root }, { confirm: 'create' })
    await mcp.call('openstory_suite_settings', { id: 'writing', values: { newChapterTitle: '第{N}章', deduceBranches: 2 }, root }, { confirm: 'create' })
    snapshot.suiteState = (await mcp.call('openstory_suites', { root })).suites.find((item) => item.id === 'writing')
    await mcp.call('openstory_ui_state', { root, state: recipe.uiState }, { confirm: 'create' })
    const initialPlugins = await mcp.call('openstory_plugins', { root })
    snapshot.uiState = stableValue({
      modules: (initialPlugins.modules ?? []).map((item) => ({ id: item.id, class: item.class, enabled: item.enabled, status: item.status })),
      capabilities: initialPlugins.capabilityReport,
      slots: initialPlugins.slots ?? []
    })

    await mcp.call('openstory_habits_put', { root, habits: recipe.habits }, { confirm: 'create' })
    snapshot.habits = stableValue(await mcp.call('openstory_habits_read', { root }))

    for (const note of recipe.notes) {
      await mcp.call('openstory_reference_write_note', { root, file: note.path, text: note.text }, { confirm: 'create' })
      const read = await mcp.call('openstory_reference_read_note', { root, path: note.path })
      if (read.note?.text !== note.text && read.text !== note.text) throw new Error(`世界书回读不一致：${note.path}`)
    }
    const referenceIndex = await mcp.call('openstory_reference_index', { root })
    if (referenceIndex.notes.length < recipe.notes.length) throw new Error('世界书索引数量不足')
    snapshot.reference = { count: referenceIndex.notes.length, digest: semanticDigest(referenceIndex.notes.map((n) => ({ path: n.path, title: n.title, tags: n.tags }))) }

    // 剧本互转先走一遍，wiki 作为受控派生骨架随 fact 导入；derivedFrom 由内核按写后 revision 覆盖。
    const converted = await mcp.call('openstory_script_to_fact', { root, text: recipe.script.text, bookId: recipe.bookId, domain: recipe.domain })
    if (!converted.entries.length) throw new Error('剧本互转没有产出条目')
    const factWritten = await mcp.call('openstory_fact_entries_import', {
      root, bookId: recipe.bookId, title: recipe.name,
      entries: recipe.facts, wiki: recipe.wiki ?? converted.wiki, operationId: 'os217-shuihu-facts-v1'
    }, { confirm: 'create' })
    const factBooks = await mcp.call('openstory_fact_books', { root })
    const factBook = factBooks.books.find((item) => item.bookId === recipe.bookId)
    if (!factBook || factBook.revision !== factWritten.revision) throw new Error('fact book revision 回读不一致')
    const factEntries = await mcp.call('openstory_fact_entries', { root, bookId: recipe.bookId, limit: '100' })
    if (factEntries.entries.length !== recipe.facts.length) throw new Error('fact 条目回读数量不一致')
    snapshot.fact = { revision: factEntries.revision, digest: semanticDigest(stableValue(factEntries.entries)) }

    // 多章配方（OS-230 前 10 回）走 chapters[]；旧单章配方仍用 chapter，回归 digest 不变。
    const chapterInputs = recipe.chapters ?? [recipe.chapter]
    for (const item of chapterInputs) {
      await mcp.call('openstory_novel_write_chapter', { root, file: item.path, text: item.text }, { confirm: 'create' })
      const written = await mcp.call('openstory_novel_read_chapter', { root, file: item.path })
      if (written.text !== item.text) throw new Error(`正文回读不一致：${item.path}`)
    }
    // 剧本同理：多回配方走 scripts[]；旧单本配方仍用 script，回归 digest 不变。
    const scriptInputs = recipe.scripts ?? [recipe.script]
    for (const item of scriptInputs) {
      await mcp.call('openstory_novel_write_chapter', { root, file: item.path, text: item.text }, { confirm: 'create' })
      const written = await mcp.call('openstory_novel_read_chapter', { root, file: item.path })
      if (written.text !== item.text) throw new Error(`剧本回读不一致：${item.path}`)
    }
    snapshot.chapter = { path: recipe.chapter?.path ?? chapterInputs[0].path, sha256: hashText(chapterInputs[0].text) }
    snapshot.chapters = chapterInputs.map((item) => ({ path: item.path, sha256: hashText(item.text) }))
    snapshot.script = { path: (recipe.script ?? scriptInputs[0]).path, sha256: hashText(scriptInputs[0].text) }
    snapshot.scripts = scriptInputs.map((item) => ({ path: item.path, sha256: hashText(item.text) }))

    await mcp.call('openstory_session_put', { root, bookId: recipe.bookId, session: recipe.session }, { confirm: 'create' })
    const mainSession = await mcp.call('openstory_session_get', { root, bookId: recipe.bookId, sessionId: 'main' })
    if (mainSession.session?.nodes?.length !== recipe.session.nodes.length) throw new Error(`主会话回读不一致：期望 ${recipe.session.nodes.length} 节点`)
    // session_put 只恢复会话结构，不会把 archived 元数据对应的归档正文重新物化。
    // 完整配方若带归档记录，必须再经 MCP 归档一次，避免样本丢功能文件。
    if (recipe.session.archived?.length) {
      const archived = await mcp.call('openstory_roleplay_archive', { root, bookId: recipe.bookId, sessionId: 'main' }, { confirm: 'create' })
      const archiveText = await readFile(join(root, archived.path), 'utf8')
      if (!archiveText.trim()) throw new Error('MCP 归档文件为空')
      snapshot.archive = { path: archived.path, words: archived.words, sha256: hashText(archiveText) }
    }
    const branch = await mcp.call('openstory_session_new', { root, bookId: recipe.bookId, title: 'MCP 分局' }, { confirm: 'create' })
    await mcp.call('openstory_session_switch', { root, bookId: recipe.bookId, sessionId: 'main' }, { confirm: 'create' })
    const sessions = await mcp.call('openstory_sessions', { root, bookId: recipe.bookId })
    if (!sessions.sessions.some((item) => item.id === branch.sessionId)) throw new Error('分局未出现在会话清单')
    snapshot.session = { main: stableValue(mainSession.session), sessionCount: sessions.sessions.length }

    // 多角色扮演只走假上游协议/落盘正证；报告明确 semanticModelVerified:false。
    const opening = await mcp.call('openstory_roleplay_opening', { root, bookId: recipe.bookId, pov: '洪信' }, { confirm: 'create' })
    const sceneTurn = await mcp.call('openstory_roleplay_scene_turn', {
      root, bookId: recipe.bookId, sessionId: branch.sessionId, pov: '洪信', playerAction: '推开殿门'
    }, { confirm: 'create' })
    if (!opening.feedback || !sceneTurn.feedback) throw new Error('假上游扮演协议没有产出 feedback')
    snapshot.roleplayProtocol = { openingChars: opening.feedback.length, turnChars: sceneTurn.feedback.length, fakeUpstream: true }

    for (const asset of recipe.assets) {
      await mcp.call('openstory_asset_put', { root, bookId: recipe.bookId, path: asset.path, dataBase64: asset.dataBase64 }, { confirm: 'create' })
      const read = await mcp.call('openstory_asset_read', { root, bookId: recipe.bookId, path: asset.path })
      if (read.dataUrl !== `data:${read.mediaType};base64,${asset.dataBase64}`) throw new Error(`素材字节回读不一致：${asset.path}`)
    }
    const assets = await mcp.call('openstory_assets', { root, bookId: recipe.bookId })
    if (assets.characters.length < 1 || assets.scenes.length < 1 || assets.bgm.length < 1) throw new Error('三类素材未全部回读')
    snapshot.assets = stableValue(assets)

    const exported = await mcp.call('openstory_exchange_export', {
      root, bookId: recipe.bookId, format: 'pedia/v1', save: true
    }, { confirm: 'create' })
    if (!exported.file) throw new Error('exchange save 未返回文件路径')
    const files = await mcp.call('openstory_files', { root, dir: '导入导出' })
    if (!files.files.some((item) => item.file === exported.file)) throw new Error('exchange 文件未出现在 MCP 文件清单')
    const importText = JSON.stringify(exported.entries)
    const dryRun = await mcp.call('openstory_exchange_import', {
      root, bookId: recipe.bookId, format: 'pedia/v1', text: importText, dryRun: true
    }, { confirm: 'create' })
    if (!dryRun.dryRun || dryRun.written) throw new Error('exchange dryRun 不是零写入')
    snapshot.exchange = { file: exported.file, entries: exported.entries.length, lost: exported.lost.length, dryRunErrors: dryRun.errors.length }

    const plugins = await mcp.call('openstory_plugins', { root })
    if (!Array.isArray(plugins.modules) || !plugins.moduleGraph) throw new Error('plugins 投影缺 modules/moduleGraph')
    snapshot.plugins = { modules: plugins.modules.length, graphNodes: plugins.moduleGraph?.nodes?.length ?? 0 }

    // 业务树只读核验：允许直接读文件做 digest，但本脚本从未直接写业务文件。
    const factRaw = JSON.parse(await readFile(join(root, '故事源', `${recipe.bookId}.json`), 'utf8'))
    const wikiRaw = JSON.parse(await readFile(join(root, '故事源', `${recipe.bookId}.wiki.json`), 'utf8'))
    if (wikiRaw.derivedFrom?.factRevision !== factRaw.revision) throw new Error('fact/wiki revision 不一致')
    snapshot.factWikiRevision = { fact: factRaw.revision, wiki: wikiRaw.derivedFrom.factRevision }

    const digest = semanticDigest(stableValue(snapshot))
    const semanticSummary = {
      facts: snapshot.fact,
      ...(recipe.chapters ? { chapters: snapshot.chapters } : {}),
      reference: snapshot.reference,
      chapter: snapshot.chapter,
      script: snapshot.script,
      ...(recipe.scripts ? { scripts: snapshot.scripts } : {}),
      session: snapshot.session,
      archive: snapshot.archive,
      assets: snapshot.assets,
      exchange: snapshot.exchange,
      factWikiRevision: snapshot.factWikiRevision
    }
    return {
      ok: true,
      root,
      digest: semanticDigest(stableValue(semanticSummary)),
      fullDigest: digest,
      snapshot,
      audit,
      stats: { calls: audit.length, tools: names.size, fakeUpstream: true, semanticModelVerified: false }
    }
  } catch (error) {
    failure = error
    return {
      ok: false,
      root,
      error: { code: error?.code || 'BUILD_FAILED', message: String(error?.message || error) },
      audit,
      stats: { calls: audit.length, fakeUpstream: true, semanticModelVerified: false }
    }
  } finally {
    if (mcp) await mcp.close()
    if (daemon) await daemon.close()
    if (upstream) await upstream.close()
    if (options.cleanup !== false && (failure || !options.keep)) await rm(base, { recursive: true, force: true })
  }
}

async function main(argv) {
  const args = parseArgv(argv)
  const base = await mkdtemp(join(tmpdir(), 'openstory-os217-cli-'))
  const root = args.out ? resolve(args.out) : join(base, '水浒传')
  const result = await buildShuihuWithMcp({
    baseDir: base,
    root,
    omittedTools: args.omit,
    keep: Boolean(args.out),
    cleanup: false
  })
  if (args.audit) {
    await mkdir(dirname(args.audit), { recursive: true })
    await writeFile(args.audit, `${result.audit.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8')
  }
  if (args.report) {
    await mkdir(dirname(args.report), { recursive: true })
    await writeFile(args.report, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  }
  console.log(JSON.stringify({
    ok: result.ok,
    root: result.root,
    digest: result.digest,
    error: result.error,
    stats: result.stats,
    audit: args.audit || '(未指定 --audit)',
    report: args.report || '(未指定 --report)'
  }, null, 2))
  if (!result.ok) {
    if (!args.out) await rm(base, { recursive: true, force: true })
    process.exitCode = 1
  } else if (!args.out) {
    await rm(base, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
