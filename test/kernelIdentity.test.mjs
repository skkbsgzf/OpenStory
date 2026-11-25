/**
 * OS-157 内核身份与公开面护栏（node:test，零依赖）。
 *
 * ① 身份串 `openstory-kernel@1` 字面量锁定（与 openstory-suite@2／openstory-module@1
 *    同一命名法），且由 Host API 直接导出，巡检脚本不必拖进整个装配；
 * ② `src/kernel/index.mjs` 的公开面逐键锁定——防之后悄悄长出新的跨层耦合边
 *    （新增任何出口都必须先改这里的快照，等同 Host API 的 SNAPSHOT 纪律）。
 *
 * 跑法：node --test test/kernelIdentity.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { KERNEL_ID, KERNEL_VERSION, KERNEL_NAME } from '../src/kernel/identity.mjs'
import * as kernel from '../src/kernel/index.mjs'
import { KERNEL_ID as HOST_KERNEL_ID } from '../src/protocol/index.mjs'

test('内核身份常量：openstory-kernel@1（字面量＋版本＋中文名）', () => {
  assert.equal(KERNEL_ID, 'openstory-kernel@1')
  assert.equal(KERNEL_VERSION, 1)
  assert.equal(KERNEL_NAME, 'OpenStory 内核')
  assert.equal(kernel.KERNEL_ID, KERNEL_ID)
  assert.equal(kernel.KERNEL_VERSION, KERNEL_VERSION)
  assert.equal(kernel.KERNEL_NAME, KERNEL_NAME)
})

test('Host API 直接导出同一身份（不属七命名空间成员）', () => {
  assert.equal(HOST_KERNEL_ID, 'openstory-kernel@1')
  assert.equal(HOST_KERNEL_ID, KERNEL_ID)
})

test('src/kernel/ 公开面逐键锁定（新增出口必须先改本快照）', () => {
  assert.deepEqual(Object.keys(kernel).sort(), [
    'KERNEL_ID', 'KERNEL_NAME', 'KERNEL_VERSION',
    'fail', 'ok', 'writeFileAtomic'
  ])
  for (const fn of ['ok', 'fail', 'writeFileAtomic']) assert.equal(typeof kernel[fn], 'function')
})
