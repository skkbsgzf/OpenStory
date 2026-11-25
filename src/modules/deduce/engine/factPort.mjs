/**
 * OS-193 K2：deduce 内核消费 fact 能力的唯一句柄口。
 *
 * `deduce/activate(context)` 在装载期 `context.resolve('fact.store'|'fact.pack'|'fact.domain')`
 * 取句柄并存进本文件的闭包；引擎函数只从这里拿句柄，不静态 import 任何 fact 实现文件。
 * 独立单测（金样 decoupleStep3 / deduceDeterminism）直接调引擎端子、不经过动态装载，
 * 此时回落到唯一静态入口 KERNEL_CAPABILITIES 的同一份实现——不是第二份实现，
 * 只是没有能力路由上下文时的等价基线。
 */
import { KERNEL_CAPABILITIES as K } from '../../../protocol/capabilityImplementations.mjs'

let handles = null

export function setFactHandles({ store, pack, domain } = {}) {
  handles = Object.freeze({ store, pack, domain })
}

/** 引擎端子用：fact 域原语（sha1Hex/stableEntryId/FACT_SCHEMA 取值/createAliasIndex/buildFactPack…）。 */
export function getFact() {
  return handles?.domain ?? K.factDomain
}

/** 封装层用：fact 存储协议（createFactFileStore/writeFactFile/readFactWiki）。 */
export function getFactStore() {
  return handles?.store ?? K.factStore
}

/** 封装层用：fact 包投影。 */
export function getFactPack() {
  return handles?.pack ?? K.factPack
}
