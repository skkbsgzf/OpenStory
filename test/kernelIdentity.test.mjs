/**
 * OS-157 内核身份与公开面护栏（node:test，零依赖）。
 *
 * ① 身份串 `openstory-kernel@1` 字面量锁定（与 openstory-suite@2／openstory-module@2
 *    同一命名法），唯一真源是 src/kernel/identity.mjs；
 * ② `src/kernel/index.mjs` 的公开面逐键锁定——防之后悄悄长出新的跨层耦合边
 *    （新增任何出口都必须先改这里的快照）。OS-195b：host-api@2 已退役，身份不再
 *    经第二套协议入口转出。
 *
 * 跑法：node --test test/kernelIdentity.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { KERNEL_ID, KERNEL_VERSION, KERNEL_NAME } from '../src/kernel/identity.mjs'
import * as kernel from '../src/kernel/index.mjs'

test('内核身份常量：openstory-kernel@1（字面量＋版本＋中文名）', () => {
  assert.equal(KERNEL_ID, 'openstory-kernel@1')
  assert.equal(KERNEL_VERSION, 1)
  assert.equal(KERNEL_NAME, 'OpenStory 内核')
  assert.equal(kernel.KERNEL_ID, KERNEL_ID)
  assert.equal(kernel.KERNEL_VERSION, KERNEL_VERSION)
  assert.equal(kernel.KERNEL_NAME, KERNEL_NAME)
})

test('身份常量只在内核公开面出现（host-api@2 已退役，不再有第二出口）', async () => {
  const identity = await import('../src/kernel/identity.mjs')
  assert.equal(identity.KERNEL_ID, KERNEL_ID)
  assert.equal(identity.KERNEL_VERSION, KERNEL_VERSION)
  assert.equal(identity.KERNEL_NAME, KERNEL_NAME)
})

test('src/kernel/ 公开面逐键锁定（新增出口必须先改本快照）', () => {
  assert.deepEqual(Object.keys(kernel).sort(), [
    'KERNEL_ID', 'KERNEL_NAME', 'KERNEL_VERSION',
    'fail', 'ok', 'writeFileAtomic'
  ])
  for (const fn of ['ok', 'fail', 'writeFileAtomic']) assert.equal(typeof kernel[fn], 'function')
})
