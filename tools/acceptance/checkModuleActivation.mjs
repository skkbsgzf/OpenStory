#!/usr/bin/env node
/** C6 动态激活实测：真实调用全部 entry.activate，并核对贡献没有越过 manifest 声明。 */
import { activateModules } from '../../src/host/moduleLoader.mjs'
import { CAPABILITY_SNAPSHOT, MODULE_MANIFESTS } from '../../src/protocol/modules.mjs'
import { MODULE_IMPLEMENTATIONS } from '../../src/protocol/capabilityImplementations.mjs'

const issues = []
const kernels = MODULE_MANIFESTS.filter((manifest) => manifest.class === 'kernel')
for (const manifest of kernels) {
  const implementation = MODULE_IMPLEMENTATIONS[manifest.id]
  if (!implementation) issues.push(`${manifest.id}: 未进入统一 MODULE_IMPLEMENTATIONS 注册表`)
  else for (const capability of manifest.capabilities ?? []) {
    const surface = implementation[capability.id]
    if (!surface || !Object.values(surface).some((value) => typeof value === 'function')) {
      issues.push(`${manifest.id}: ${capability.id} 注册实现缺少函数句柄`)
    }
  }
}

let activated = []
try {
  const result = await activateModules({ snapshot: CAPABILITY_SNAPSHOT })
  activated = result.activated
  const expected = MODULE_MANIFESTS.filter((manifest) => manifest.entry && CAPABILITY_SNAPSHOT.enabled?.[manifest.id])
  if (activated.length !== expected.length) issues.push(`激活数量 ${activated.length} != 应激活 ${expected.length}`)
  for (const manifest of expected) {
    const item = activated.find((entry) => entry.id === manifest.id)
    if (!item) { issues.push(`${manifest.id}: 未激活`); continue }
    const contribution = item.contribution
    const declaredCapabilities = new Set((manifest.capabilities ?? []).map((entry) => entry.id))
    for (const id of Object.keys(contribution.capabilities ?? {})) {
      if (!declaredCapabilities.has(id)) issues.push(`${manifest.id}: 贡献未声明能力 ${id}`)
    }
    if (manifest.class === 'kernel') {
      for (const id of declaredCapabilities) {
        if (!contribution.capabilities?.[id]) issues.push(`${manifest.id}: 声明能力 ${id} 未由 activate 返回`)
      }
    }
    const declaredEndpoints = new Set(manifest.endpoints ?? [])
    for (const id of Object.keys(contribution.handlers ?? {})) {
      if (!declaredEndpoints.has(id)) issues.push(`${manifest.id}: 贡献未声明端点 ${id}`)
    }
    const declaredPages = new Set((manifest.pages ?? []).map((page) => page.id))
    for (const id of Object.keys(contribution.pages ?? {})) {
      if (!declaredPages.has(id)) issues.push(`${manifest.id}: 贡献未声明页面 ${id}`)
    }
    if (manifest.class === 'workbench') {
      for (const id of declaredPages) {
        if (!contribution.pages?.[id]) issues.push(`${manifest.id}: 声明页面 ${id} 未由 activate 返回`)
      }
    }
    const declaredSettings = new Set((manifest.settings ?? []).map((setting) => setting.key))
    for (const id of Object.keys(contribution.settingsConsumers ?? {})) {
      if (!declaredSettings.has(id)) issues.push(`${manifest.id}: 贡献未声明设置消费者 ${id}`)
    }
    for (const requirement of manifest.requires ?? []) {
      if (!item.resolved.some((resolved) => resolved.id === requirement.id && resolved.range.min >= requirement.min)) {
        issues.push(`${manifest.id}: activate 未解析 hard requires ${requirement.id}@${requirement.min}`)
      }
    }
  }
} catch (error) {
  issues.push(`动态激活失败：${error?.stack || error?.message || error}`)
}

process.stdout.write(`${JSON.stringify({ ok: issues.length === 0, manifests: MODULE_MANIFESTS.length, kernels: kernels.length, activated: activated.length, issues }, null, 2)}\n`)
process.exitCode = issues.length === 0 ? 0 : 1
