/**
 * OS-158 机器级界面偏好（皮肤）用例（node:test）。
 *
 * 钉死三件事：
 *   ① 路径只一处解析，跟随 LOCALAPPDATA/OpenStory/openstory/ui-preferences.json（env 注入隔离）；
 *   ② 读写走真文件、原子写、坏档回落、皮肤 id 校验——不碰浏览器存储、不碰作者真库；
 *   ③ 契约层真的注册了 /api/ui-preferences 的 GET/PUT 两端（前端全靠它换端口同一份）。
 *
 * 跑法：node --test test/uiPreferences.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultUiPreferencesPath,
  normalizeSkin,
  readUiPreferences,
  writeUiSkin
} from '../src/host/uiPreferences.mjs'
import { ENDPOINTS, endpointFor } from '../src/api/contracts.mjs'

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'os158-pref-'))
  const env = { LOCALAPPDATA: base, APPDATA: '' }
  return { base, env, target: defaultUiPreferencesPath(env), cleanup: () => rmSync(base, { recursive: true, force: true }) }
}

test('默认路径：跟随 LOCALAPPDATA/OpenStory/openstory，且 APPDATA 兜底', () => {
  const f = fixture()
  try {
    assert.equal(f.target.replaceAll('\\', '/').endsWith('/OpenStory/openstory/ui-preferences.json'), true)
    assert.equal(defaultUiPreferencesPath({ LOCALAPPDATA: '', APPDATA: 'C:/fallback' }).replaceAll('\\', '/'),
      'C:/fallback/OpenStory/openstory/ui-preferences.json'.replaceAll('\\', '/'))
  } finally { f.cleanup() }
})

test('皮肤 id 校验：合法 [\w-] 保留，空串清空，非法/超长回空', () => {
  assert.equal(normalizeSkin('coral'), 'coral')
  assert.equal(normalizeSkin('dark-blue_2'), 'dark-blue_2')
  assert.equal(normalizeSkin(''), '')
  assert.equal(normalizeSkin('has space'), '')
  assert.equal(normalizeSkin('../escape'), '')
  assert.equal(normalizeSkin('x'.repeat(65)), '')
})

test('读：文件不存在／坏档都回空偏好，不抛', () => {
  const f = fixture()
  try {
    assert.deepEqual(readUiPreferences(f.target), { preferences: {}, error: '' })
    mkdirSync(join(f.base, 'OpenStory', 'openstory'), { recursive: true })
    writeFileSync(f.target, '{ 坏档', 'utf-8')
    const bad = readUiPreferences(f.target)
    assert.deepEqual(bad.preferences, {})
    assert.notEqual(bad.error, '')
  } finally { f.cleanup() }
})

test('写→读往返：原子落盘、未知键丢弃；空值清除回缺省', async () => {
  const f = fixture()
  try {
    const first = await writeUiSkin(f.target, 'ink')
    assert.equal(first.ok, true)
    assert.deepEqual(first.preferences, { skin: 'ink' })
    assert.equal(existsSync(f.target), true)
    assert.deepEqual(JSON.parse(readFileSync(f.target, 'utf-8')), { skin: 'ink' })
    // 无关键不该进来
    writeFileSync(f.target, JSON.stringify({ skin: 'ink', noise: 'x' }), 'utf-8')
    const second = await writeUiSkin(f.target, 'coral')
    assert.deepEqual(second.preferences, { skin: 'coral' })
    assert.equal(JSON.parse(readFileSync(f.target, 'utf-8')).noise, undefined)
    // 空值＝清除
    const cleared = await writeUiSkin(f.target, '')
    assert.deepEqual(cleared.preferences, {})
    assert.deepEqual(readUiPreferences(f.target).preferences, {})
  } finally { f.cleanup() }
})

test('非法皮肤 id 被拒，不写盘', async () => {
  const f = fixture()
  try {
    const result = await writeUiSkin(f.target, '../bad')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'INVALID_SKIN')
    assert.equal(existsSync(f.target), false)
  } finally { f.cleanup() }
})

test('契约：GET/PUT /api/ui-preferences 已注册，method 与 path 正确', () => {
  assert.equal(endpointFor('GET', '/api/ui-preferences'), 'uiPreferencesGet')
  assert.equal(endpointFor('PUT', '/api/ui-preferences'), 'uiPreferencesPut')
  assert.equal(ENDPOINTS.uiPreferencesGet.request.query && Object.keys(ENDPOINTS.uiPreferencesGet.request.query).length, 0)
  assert.equal(Object.hasOwn(ENDPOINTS.uiPreferencesPut.request.body, 'skin'), true)
})
