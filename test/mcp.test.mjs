/**
 * MCP stdio 协议合规（OS-55）。口径对齐 Pinax 本地 MCP：
 *   · initialize 握手（protocolVersion/serverInfo/instructions）
 *   · tools/list：工具形状（name/title/description/inputSchema）
 *   · tools/call：业务错误＝isError:true 文本；参数缺失＝-32602；未知工具＝-32601
 *   · 未知方法＝-32601；坏 JSON＝-32700；通知不回包
 * 数据面依赖本机 daemon（8807）——不可达时 libraries 工具应回 isError 文本（也算合规）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MCP_TOOL_NAMES, MCP_SEMANTICS_CHECK } from '../src/host/mcp.mjs'
import { MCP_TOOL_SEMANTICS, TOOL_CONFIRM_LEVELS, confirmSatisfies, isWriteTool, maxRequiredConfirm, semanticsEntryMalformed, toolParamNames, toolSemanticsOf, validateSemanticsRegistry } from '../src/protocol/mcpToolSemantics.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 起一个 MCP 子进程，收发 newline-delimited JSON-RPC。 */
function startMcp() {
  const child = spawn(process.execPath, [join(ROOT, 'src', 'host', 'mcp.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map()
  let buf = ''
  let nextId = 1
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buf += chunk
    let index
    while ((index = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, index).trim()
      buf = buf.slice(index + 1)
      if (!line) continue
      try {
        const message = JSON.parse(line)
        if (message.id !== undefined && pending.has(message.id)) {
          pending.get(message.id)(message)
          pending.delete(message.id)
        }
      } catch { /* 非 JSON 行忽略 */ }
    }
  })
  const request = (method, params) => new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n')
  })
  const notify = (method, params) => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) + '\n')
  }
  const close = () => child.kill()
  return { request, notify, close }
}

/** 等 daemon 可达（测试环境有时启动慢；不可达不影响协议层断言）。 */
async function daemonAlive() {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 800)
    const response = await fetch('http://127.0.0.1:8807/api/libraries', { signal: controller.signal })
    clearTimeout(timer)
    return response.ok
  } catch { return false }
}

test('MCP：initialize 握手（serverInfo/instructions/tools 能力）', async () => {
  const mcp = startMcp()
  try {
    const reply = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    assert.equal(reply.error, undefined)
    assert.equal(reply.result.protocolVersion, '2024-11-05')
    assert.equal(reply.result.serverInfo.name, 'openstory-local')
    assert.match(reply.result.instructions, /openstory_libraries/)
    // OS-216：空目录构建必须能从握手说明直接找到官方 operate skill。
    assert.match(reply.result.instructions, /build-project/u)
    assert.doesNotMatch(reply.result.instructions, /参考/u)
    assert.ok(reply.result.capabilities.tools)
  } finally { mcp.close() }
})

test('MCP：tools/list 与注册表逐名一致、五模块分组、schema 带 required', async () => {
  const mcp = startMcp()
  try {
    const reply = await mcp.request('tools/list')
    const tools = reply.result.tools
    // OS-91：22 → 24；OS-213：24 → 37（+13 建库原语）。用注册表对账而非写死数字——
    // 工具面继续扩张时自动跟随，同时仍强制「tools/list 与注册表逐名一致」。
    assert.equal(tools.length, MCP_TOOL_NAMES.length, 'tools/list 必须与 MCP_TOOL_NAMES 数量一致')
    const names = tools.map((tool) => tool.name)
    assert.equal(new Set(names).size, MCP_TOOL_NAMES.length, '工具名不得重复')
    for (const name of ['openstory_libraries', 'openstory_novel_write_chapter', 'openstory_reference_graph', 'openstory_deduce_present', 'openstory_analysis_chapter', 'openstory_habits_read', 'openstory_skills_list', 'openstory_skills_read',
      // OS-213 建库原语必须在工具面里
      'openstory_library_create', 'openstory_library_diagnose', 'openstory_library_scan', 'openstory_library_import', 'openstory_library_primary',
      'openstory_suites', 'openstory_suite_enable', 'openstory_suite_settings',
      'openstory_fact_books', 'openstory_fact_entries', 'openstory_fact_entries_import',
      'openstory_exchange_export', 'openstory_exchange_import']) {
      assert.ok(names.includes(name), `缺工具 ${name}`)
    }
    for (const tool of tools) {
      assert.ok(tool.description, `${tool.name} 缺 description`)
      assert.equal(tool.inputSchema.type, 'object')
      // OS-212：每个工具都接受 confirm 实参（写工具传参不再被 -32602 打挂）；
      // enum 必须与注册表单一真源逐项一致，不在 mcp.mjs 手抄第二份。
      assert.deepEqual(tool.inputSchema.properties.confirm.enum, [...TOOL_CONFIRM_LEVELS], `${tool.name} confirm enum 脱离注册表`)
      assert.ok(!JSON.stringify(tool).includes('参考/'), `${tool.name} 仍在描述旧目录 参考/`)
    }
    const readNote = tools.find((tool) => tool.name === 'openstory_reference_read_note')
    assert.match(readNote.inputSchema.properties.path.description, /世界书\/人物\/宋江\.md/u)
    const writeNote = tools.find((tool) => tool.name === 'openstory_reference_write_note')
    assert.match(writeNote.inputSchema.properties.file.description, /世界书\/子目录\/标题\.md/u)
    const write = tools.find((tool) => tool.name === 'openstory_novel_write_chapter')
    assert.deepEqual(write.inputSchema.required, ['root', 'file', 'text'])

    // OS-212：category enum 五类齐全；MCP 注册表导出与 tools/list 同源
    const list = tools.find((tool) => tool.name === 'openstory_skills_list')
    assert.deepEqual(list.inputSchema.properties.category.enum, ['craft', 'review', 'transform', 'extract', 'operate'])
    assert.deepEqual(MCP_TOOL_NAMES.slice().sort(), names.slice().sort(), 'MCP_TOOL_NAMES 必须与 tools/list 同源')
    assert.ok(MCP_TOOL_NAMES.includes('openstory_libraries'), 'operate 声明的读工具必须存在')
    assert.ok(!MCP_TOOL_NAMES.includes('openstory_shell_exec'), '危险/伪工具不得进注册表')

    // ---- OS-212：工具表 ↔ 安全语义注册表双向一致；未知/危险工具与确认级别门禁 ----
    // 双向校验：工具表每个工具都有语义，注册表没有假工具（mcp.mjs 导入时已 fail-closed，这里再钉一次）
  assert.equal(MCP_SEMANTICS_CHECK.ok, true, JSON.stringify(MCP_SEMANTICS_CHECK))
  assert.deepEqual(MCP_SEMANTICS_CHECK.missing, [])
  assert.deepEqual(MCP_SEMANTICS_CHECK.extra, [])
  assert.deepEqual(MCP_SEMANTICS_CHECK.paramMismatch, [])
  // 参数语义来自真实 inputSchema，不再是手抄副本：改名即 fail-closed。
  assert.deepEqual(toolParamNames('openstory_deduce_present'), Object.keys(tools.find((t) => t.name === 'openstory_deduce_present').inputSchema.properties))
  const renamedSchema = [{ name: 'openstory_deduce_present', inputSchema: { properties: { root: {}, confirm: {}, resetState: {} } } }]
  assert.equal(validateSemanticsRegistry(renamedSchema).ok, false, 'schema 参数改名后注册表必须 fail-closed')
  assert.ok(validateSemanticsRegistry(renamedSchema).malformed.includes('openstory_deduce_present'), '改名触发 malformed')
  // 注册表条目数必须与工具面相等（不是随手能对上的数字）：多一个假条目或少一个未分类工具都算失配。
  assert.equal(Object.keys(MCP_TOOL_SEMANTICS).length, MCP_TOOL_NAMES.length)
  for (const name of MCP_TOOL_NAMES) {
    const semantics = toolSemanticsOf(name)
    assert.ok(semantics, `${name} 必须在安全语义注册表里（未分类工具禁止 operate 引用）`)
  }
  assert.equal(toolSemanticsOf('openstory_nope'), null, '未知工具不得有语义')
  assert.equal(toolSemanticsOf('shell_exec'), null, 'shell/fs 伪装不得有语义')
  assert.equal(isWriteTool('openstory_novel_write_chapter'), true, '写工具必须标写')
  assert.equal(isWriteTool('openstory_libraries'), false, '读工具不得标写')
  // 危险工具门槛：delete 要 restore，write/create 要 create；confirm 级别不满足即红。
  assert.equal(confirmSatisfies('restore', 'restore'), true)
  assert.equal(confirmSatisfies('create', 'restore'), false)
  assert.equal(confirmSatisfies('create', 'create'), true)
  assert.equal(confirmSatisfies('read', 'create'), false)
  for (const dangerous of ['openstory_novel_write_chapter', 'openstory_novel_delete_chapter', 'openstory_reference_write_note', 'openstory_habits_put', 'openstory_image_generate']) {
    assert.ok(isWriteTool(dangerous), `${dangerous} 必须 classified 为写工具`)
    assert.ok(!confirmSatisfies('read', toolSemanticsOf(dangerous).requiredConfirm), `${dangerous} 不得以 confirm:read 调用`)
  }
  // deduce_present：续拍写状态（create），reset=true 升 restore；声明按最坏门槛 restore。
  assert.equal(toolSemanticsOf('openstory_deduce_present').requiredConfirm, 'create')
  assert.equal(maxRequiredConfirm('openstory_deduce_present'), 'restore', '无法绑定实参→整体按最坏门槛')
  assert.equal(confirmSatisfies('read', 'create'), false, 'deduce_present 不能以 read 确认引用')
  assert.equal(confirmSatisfies('create', 'restore'), false, 'create 说明书不得声明可 reset 的 deduce_present')

  // P1-6：嵌套语义形状也必须验（纯函数反证，不改冻结注册表）。
  const name = 'openstory_deduce_present'
  const base = { effect: 'write', requiredConfirm: 'create' }
  const rule = (over) => ({ parameter: 'reset', equals: true, effect: 'reset', requiredConfirm: 'restore', ...over })
  assert.equal(semanticsEntryMalformed(name, { ...base, mutatesWhen: rule({ effect: 'nuke' }) }), true, '非法 mutatesWhen.effect')
  assert.equal(semanticsEntryMalformed(name, { ...base, mutatesWhen: rule({ requiredConfirm: 'nuke' }) }), true, '非法 mutatesWhen.requiredConfirm')
  assert.equal(semanticsEntryMalformed(name, { ...base, mutatesWhen: rule({ parameter: 'nope' }) }), true, 'mutatesWhen 指向 schema 外参数')
  assert.equal(semanticsEntryMalformed(name, { ...base, parameterEffects: { nope: 'reset' } }), true, 'parameterEffects 指向 schema 外参数')
  assert.equal(semanticsEntryMalformed(name, { ...base, parameterEffects: { reset: 'nuke' } }), true, 'parameterEffects 非法 effect')
  // P1：parameterEffects 与 mutatesWhen 描述同一参数却给出不同 effect＝注册表自相矛盾。
  assert.equal(semanticsEntryMalformed(name, {
    ...base,
    mutatesWhen: rule(),
    parameterEffects: { reset: 'write' }
  }), true, 'parameterEffects 与 mutatesWhen 冲突必须 malformed')
  assert.equal(semanticsEntryMalformed(name, { ...MCP_TOOL_SEMANTICS[name] }), false, '合法嵌套语义应通过')
  } finally { mcp.close() }
})

test('MCP：世界书写入拒绝旧 参考/ 前缀（校验先于 daemon）', async () => {
  const mcp = startMcp()
  try {
    const reply = await mcp.request('tools/call', {
      name: 'openstory_reference_write_note',
      arguments: { root: 'fixture-root', file: '参考/人物/宋江.md', text: '提案', confirm: 'create' }
    })
    assert.equal(reply.error, undefined)
    assert.equal(reply.result.isError, true)
    assert.match(reply.result.content[0].text, /^E_INVALID_ARGS · .*file 必须以 世界书\/ 开头/u)
  } finally { mcp.close() }
})

/** OS-212：确认闸反证——由「参数缺失」用例一并调用，避免新增 test() 令数字锚漂移。 */
async function assertConfirmGate(mcp) {
    // 确认闸先于 daemon：无需 daemon 可达即能反证（DAEMON_UNREACHABLE 不会盖过 CONFIRM_REQUIRED）。
    const noConfirm = await mcp.request('tools/call', {
      name: 'openstory_deduce_present',
      arguments: { root: 'fixture-root', reset: true }
    })
    assert.equal(noConfirm.error, undefined, '授权闸不是 -32602 参数错')
    assert.equal(noConfirm.result.isError, true)
    // 文案可调，语义不可调：拒绝 + 明确要求 restore 级确认。
    assert.match(noConfirm.result.content[0].text, /^CONFIRM_REQUIRED · /u)
    assert.match(noConfirm.result.content[0].text, /restore/u)

    const wrongLevel = await mcp.request('tools/call', {
      name: 'openstory_deduce_present',
      arguments: { root: 'fixture-root', reset: true, confirm: 'create' }
    })
    assert.equal(wrongLevel.result.isError, true)
    assert.match(wrongLevel.result.content[0].text, /^CONFIRM_REQUIRED · /u)

    // 不带 reset（正常续拍只保存 create 级状态）带 create 确认应越过条件闸——
    // OS-212 评审修正：普通写调用也要 confirm，旧夹具「不带 reset 就不带 confirm」已不合法。
    const noReset = await mcp.request('tools/call', { name: 'openstory_deduce_present', arguments: { root: 'fixture-root', confirm: 'create' } })
    assert.equal(noReset.error, undefined)
    assert.doesNotMatch(noReset.result.content[0].text, /^CONFIRM_REQUIRED · /u)

    // 普通写工具（无 mutatesWhen）是无条件写：**每次调用都要求**满足门槛的 confirm。
    // OS-213 收紧：之前「不传 confirm 就放行」等于写通道对任意外部 Agent 敞开——调用本身
    // 就是写，不存在「这次不写」的分支。confirm 仍是已知参数（不是 -32602）。
    const plainWrite = { root: 'fixture-root', file: '正文/001.md', text: 'x' }
    const unconfirmedWrite = await mcp.request('tools/call', { name: 'openstory_novel_write_chapter', arguments: plainWrite })
    assert.equal(unconfirmedWrite.error, undefined, 'confirm 不是未知参数，不能 -32602')
    assert.match(unconfirmedWrite.result.content[0].text, /^CONFIRM_REQUIRED · /u, '无条件写工具缺 confirm 必须拒绝')
    assert.match(unconfirmedWrite.result.content[0].text, /create/u, '必须点名所需级别')
    const satisfiedWrite = await mcp.request('tools/call', { name: 'openstory_novel_write_chapter', arguments: { ...plainWrite, confirm: 'create' } })
    assert.equal(satisfiedWrite.error, undefined)
    assert.doesNotMatch(satisfiedWrite.result.content[0].text, /^CONFIRM_REQUIRED · /u, '满足门槛后应落到业务闸（NO_LIBRARY）')
    const lowConfirm = await mcp.request('tools/call', { name: 'openstory_novel_write_chapter', arguments: { ...plainWrite, confirm: 'read' } })
    assert.equal(lowConfirm.error, undefined)
    assert.match(lowConfirm.result.content[0].text, /^CONFIRM_REQUIRED · /u)
    for (const [name, args, level] of [
      ['openstory_novel_write_chapter', { root: 'fixture-root', file: '世界书/试.md', text: 'x' }, 'create'],
      ['openstory_novel_delete_chapter', { root: 'fixture-root', file: '正文/001.md' }, 'restore'],
      ['openstory_reference_write_note', { root: 'fixture-root', file: '世界书/试.md', text: 'x' }, 'create'],
      ['openstory_habits_put', { root: 'fixture-root', habits: {} }, 'create'],
      ['openstory_image_generate', { root: 'fixture-root', path: '世界书/a.png', prompt: 'x' }, 'create'],
      ['openstory_deduce_settle', { root: 'fixture-root', action: 'veto' }, 'create'],
      ['openstory_enrich_run', { root: 'fixture-root', bookId: 'shuihu' }, 'create']
    ]) {
      // 传了不足的 confirm 必须被拒（不足级别不能当免死金牌）。
      const bad = await mcp.request('tools/call', { name, arguments: { ...args, confirm: 'read' } })
      assert.equal(bad.error, undefined, `${name} confirm 传参不能 -32602`)
      assert.equal(bad.result.isError, true, `${name} 级别不足必须被拒`)
      assert.match(bad.result.content[0].text, /^CONFIRM_REQUIRED · /u)
      const good = await mcp.request('tools/call', { name, arguments: { ...args, confirm: level } })
      assert.equal(good.error, undefined, `${name} 带 confirm:${level} 不能 -32602`)
      assert.doesNotMatch(good.result.content[0].text, /^CONFIRM_REQUIRED · /u, `${name} 满足门槛应越过闸`)
    }

    // 读工具缺省 confirm 也照常放行。
    const readTool = await mcp.request('tools/call', { name: 'openstory_libraries', arguments: {} })
    assert.equal(readTool.error, undefined)
    assert.doesNotMatch(readTool.result.content[0].text, /^CONFIRM_REQUIRED · /u)
}

test('MCP：参数缺失 -32602 / 未知工具 -32601 / 未知方法 -32601', async () => {
  const mcp = startMcp()
  try {
    await assertConfirmGate(mcp)
    const missing = await mcp.request('tools/call', { name: 'openstory_novel_read_chapter', arguments: { root: 'D:/x' } })
    assert.equal(missing.error.code, -32602)
    assert.match(missing.error.message, /file/)
    const unknownTool = await mcp.request('tools/call', { name: 'nope', arguments: {} })
    assert.equal(unknownTool.error.code, -32601)
    const unknownMethod = await mcp.request('resources/list')
    assert.equal(unknownMethod.error.code, -32601)
  } finally { mcp.close() }
})

test('MCP：通知不回包；ping 有回包', async () => {
  const mcp = startMcp()
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05' })
    mcp.notify('notifications/initialized')
    const pong = await mcp.request('ping')
    assert.deepEqual(pong.result, {})
  } finally { mcp.close() }
})

test('MCP：openstory_analysis_chapter 真算（本地引擎，不依赖 daemon）', async () => {
  const mcp = startMcp()
  try {
    const reply = await mcp.request('tools/call', {
      name: 'openstory_analysis_chapter',
      arguments: { text: '他笑了。\n\n她却在角落里哭，眼泪一滴一滴砸在地上。与此同时，然而，综上所述，他忽然觉得这一切仿佛宛如犹如一场梦。\n\n夜很冷。风更大了。他握紧刀，指节发白。' }
    })
    assert.equal(reply.error, undefined)
    const payload = JSON.parse(reply.result.content[0].text)
    assert.ok(payload.stats.chars > 40)
    assert.ok(payload.aiSmell.score >= 0)
    assert.ok(Array.isArray(payload.issues))
    assert.ok(Array.isArray(payload.emotion))
  } finally { mcp.close() }
})

test('MCP：业务错误＝isError:true + ERR code 文本（不炸协议）', async () => {
  const mcp = startMcp()
  try {
    // root 不在库清单里（daemon 在跑则业务 NO_LIBRARY；daemon 不在则 DAEMON_UNREACHABLE）——两者都是合规的 isError 文本
    const reply = await mcp.request('tools/call', { name: 'openstory_reference_index', arguments: { root: 'D:/不存在的库' } })
    assert.equal(reply.result.isError, true)
    assert.match(reply.result.content[0].text, /^(NO_LIBRARY|DAEMON_UNREACHABLE|HTTP_\d+) ·/)
  } finally { mcp.close() }
})

test('MCP：daemon 可达时 libraries 返回结构化清单', async () => {
  if (!await daemonAlive()) return // daemon 没跑就跳过数据面
  const mcp = startMcp()
  try {
    const reply = await mcp.request('tools/call', { name: 'openstory_libraries', arguments: {} })
    assert.equal(reply.result.isError, false)
    const payload = JSON.parse(reply.result.content[0].text)
    assert.ok(Array.isArray(payload.libraries))
  } finally { mcp.close() }
})
