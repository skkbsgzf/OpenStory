/**
 * OS-193 K2：deduce 内核消费 fact 能力的唯一句柄口。
 *
 * `deduce/activate(context)` 在装载期 `context.resolve('fact.store'|'fact.pack'|'fact.domain')`
 * 取句柄并存进本文件的闭包；引擎函数只从这里拿句柄，不静态 import 任何 fact 实现文件。
 *
 * OS-195b：删去「回落登记表」兜底——句柄没注入就明确报错，不许有第二套静态入口。
 * 独立单测若直接调引擎端子，须先经本文件的 setFactHandles 注入同一份能力面句柄。
 */
let handles = null

export function setFactHandles({ store, pack, domain } = {}) {
  handles = Object.freeze({ store, pack, domain })
}

function missing(name) {
  throw new Error(`factPort 未注入 fact.${name} 句柄（deduce.activate 必须先执行）`)
}

/** 引擎端子用：fact 域原语（sha1Hex/stableEntryId/FACT_SCHEMA 取值/createAliasIndex/buildFactPack…）。 */
export function getFact() {
  if (!handles?.domain) missing('domain')
  return handles.domain
}

/** 封装层用：fact 存储协议（createFactFileStore/writeFactFile/readFactWiki）。 */
export function getFactStore() {
  if (!handles?.store) missing('store')
  return handles.store
}

/** 封装层用：fact 包投影。 */
export function getFactPack() {
  if (!handles?.pack) missing('pack')
  return handles.pack
}
