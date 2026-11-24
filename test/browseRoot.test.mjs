/**
 * OS-119：目录浏览器默认根与「上次选择」记忆。
 *
 * 作者口径：「默认目录始终选择用户 C 盘的 openstory project，不用每次都从头选」
 * ——所以这里锁三条语义：
 *   1. 空 path ＝ 默认根（%USERPROFILE%/OpenStory，不存在自动建），不是列盘符
 *   2. 只有 remember:true 才写「上次选择」；纯浏览不留痕
 *   3. 任何位置都回带 defaultRoot，前端才能给「⌂ 默认目录」一键入口
 */
import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

let base = ''

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'os119-browse-'))
})

after(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('defaultBrowseRoot / browseMemoryPath', () => {
  it('默认根＝用户目录下的 OpenStory（始终是那个，不跟上次逛到哪）', async () => {
    const { defaultBrowseRoot } = await import('../src/host/daemon.mjs')
    assert.equal(defaultBrowseRoot({ USERPROFILE: 'C:\\Users\\x' }), join('C:\\Users\\x', 'OpenStory'))
  })

  it('没有 USERPROFILE 时退 HOME；都没有则为空（不瞎猜路径）', async () => {
    const { defaultBrowseRoot } = await import('../src/host/daemon.mjs')
    assert.equal(defaultBrowseRoot({ HOME: 'D:\\home' }), join('D:\\home', 'OpenStory'))
    assert.equal(defaultBrowseRoot({}), '')
  })

  it('记忆落本机偏好（LOCALAPPDATA/OpenStory/openstory），不在库内也不在浏览器存储', async () => {
    const { browseMemoryPath } = await import('../src/host/daemon.mjs')
    assert.equal(browseMemoryPath({ LOCALAPPDATA: 'C:\\L' }), join('C:\\L', 'OpenStory', 'openstory', 'fs-browse.json'))
    assert.equal(browseMemoryPath({ APPDATA: 'C:\\R' }), join('C:\\R', 'OpenStory', 'openstory', 'fs-browse.json'))
    assert.equal(browseMemoryPath({}), '')
  })
})

describe('fsBrowse 端点的记忆语义（真起 daemon）', () => {
  let daemon = null
  let port = 0
  const home = () => join(base, 'home')
  const appdata = () => join(base, 'appdata')
  const slash = (value) => String(value ?? '').replaceAll('\\', '/')

  before(async () => {
    const { startDaemon } = await import('../src/host/daemon.mjs')
    // 隔离到临时目录：不动真实用户偏好，也不碰任何已有库
    await mkdir(appdata(), { recursive: true })
    await mkdir(home(), { recursive: true })
    daemon = await startDaemon({
      port: 0,
      preferencesPath: join(base, 'prefs.json'),
      env: { ...process.env, LOCALAPPDATA: join(base, 'appdata'), USERPROFILE: join(base, 'home') },
      logger: { log: () => {} }
    })
    port = await Promise.resolve(daemon.port)
  })

  after(async () => {
    if (daemon) await daemon.close()
  })

  const post = async (body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/fs/browse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    return { status: response.status, body: await response.json() }
  }

  it('空 path＝默认根，且目录被自动建出来', async () => {
    const { status, body } = await post({})
    assert.equal(status, 200)
    assert.equal(body.isDefaultRoot, true)
    assert.equal(slash(body.defaultRoot), slash(join(home(), 'OpenStory')))
    assert.equal(slash(body.path), slash(join(home(), 'OpenStory')))
    assert.ok(existsSync(join(home(), 'OpenStory')), '默认根应被创建')
  })

  it('remember:true 才写记忆；纯浏览不改记忆', async () => {
    const remembered = await post({ path: appdata(), remember: true })
    assert.equal(remembered.status, 200)
    assert.equal(slash(remembered.body.lastPicked), slash(appdata()))

    const browsed = await post({ path: home() })
    assert.equal(slash(browsed.body.lastPicked), slash(appdata()), '纯浏览不该覆盖记忆')
  })

  it('记忆跨请求可读：空 path 时回带上次选择', async () => {
    const { body } = await post({})
    assert.equal(slash(body.lastPicked), slash(appdata()))
  })

  it('非默认位置也回带 defaultRoot，前端才能给「⌂ 默认目录」入口', async () => {
    const { body } = await post({ path: home() })
    assert.equal(body.isDefaultRoot, false)
    assert.equal(slash(body.defaultRoot), slash(join(home(), 'OpenStory')))
  })

  it('不存在的目录如实报 NOT_FOUND（不静默兜底）', async () => {
    const { status, body } = await post({ path: join(base, 'nope') })
    assert.equal(status, 404)
    assert.equal(body.ok, false)
  })
})
