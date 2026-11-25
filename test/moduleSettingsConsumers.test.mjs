/**
 * OS-146：模块设置项的「消费者表」守卫。
 *
 * 复核口径（作者定）：**界面上出现的每个设置项必须有真实消费者**——改了不生效的输入框
 * 一律不许留在设置页。于是把「键 → 消费者文件:符号」显式列成一张表：
 *   · manifest 声明了新键、表里没有 → 红（先想清楚谁读这个值，再决定要不要这个键）；
 *   · 表里有项、源文件里找不到那个符号 → 红（消费者被删了，键成了死配置）；
 *   · 表里有项、manifest 已经不声明这个键 → 红（表在说瞎话，删掉这一项）。
 *
 * 当前为空：OS-146 把 7 个死设置项（analysis 2 个 / comfyui 4 个 / kb 3 个里的 2 个 +
 * kb.autoTest）全删了——生图/识图的真源是 agent-config.json 的 image/vision，
 * 知识库的真源是 kb-config.json（/api/kb/config），右栏卡片勾选是 ui-state 的 analyzeEnabled
 * 数组。三者的设置页只剩「启用开关」（modules.enabled.<id>，闸口在用）＋指路行。
 *
 * 跑法：node --test test/moduleSettingsConsumers.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODULE_MANIFESTS } from '../src/protocol/modules.mjs'
import { LEGACY_SETTING_MIGRATIONS } from '../public/views/settingsAggregation.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 模块设置键 → 消费者（文件 + 符号）。键写成 `<moduleId>:<setting key>`。
 * 新增模块设置项时必须在这里登记；没有消费者就别加这个键。
 * @type {Readonly<Record<string, string>>}
 */
const SETTING_CONSUMERS = Object.freeze({
  // 目前三个模块都没有「有真实消费者」的自报设置项（见文件头）。新增时按这个形状登记：
  // 'demo:demo.flag': 'src/modules/demo/demoGate.mjs:isDemoFlagOn'
})

test('模块设置项消费者表：manifest 声明的每个键都必须在表里，且消费者符号真的在源文件里', () => {
  for (const manifest of MODULE_MANIFESTS) {
    for (const setting of manifest.settings ?? []) {
      const composite = `${manifest.id}:${setting.key}`
      const consumer = SETTING_CONSUMERS[composite]
      assert.ok(consumer, `${composite} 没有消费者登记——改了不生效的设置项不许留在界面上（OS-146）`)
      const [rel, symbol] = consumer.split(':')
      assert.ok(rel && symbol, `${composite} 的消费者登记格式应为 "文件:符号"（现为 ${consumer}）`)
      const source = readFileSync(join(REPO, rel), 'utf-8')
      assert.ok(source.includes(symbol), `${composite} 登记的消费者 ${rel}:${symbol} 在源文件里找不到`)
    }
  }
})

test('模块设置项消费者表：不许留没有 manifest 声明的僵尸项，也不许迁到未声明的键', () => {
  const declared = new Set(MODULE_MANIFESTS.flatMap((manifest) => (manifest.settings ?? []).map((setting) => `${manifest.id}:${setting.key}`)))
  for (const composite of Object.keys(SETTING_CONSUMERS)) {
    assert.ok(declared.has(composite), `消费者表里的 ${composite} 已没有 manifest 声明——删掉这一项`)
  }
  // 迁移目标必须是声明过的键（否则就是往库里写没人读的死键）
  for (const rule of LEGACY_SETTING_MIGRATIONS) {
    assert.ok(declared.has(`${rule.moduleId}:${rule.key}`), `迁移目标 ${rule.moduleId}:${rule.key} 没在 manifest 里声明`)
  }
})
