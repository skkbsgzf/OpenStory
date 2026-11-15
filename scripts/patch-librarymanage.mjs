#!/usr/bin/env node
// 一次性补丁：libraryManage 的注册表 bootstrap 换成 manifests-only 底座。
import fs from 'node:fs'

let src = fs.readFileSync('libraryManage.mjs', 'utf-8')
src = src
  .split("import { createRegistry, createProject, initBareProject } from './core/pinax/next/index.mjs'")
  .join("import { createRegistry, createProject, initBareProject } from './core/index.mjs'")
  .split("import { loadBuiltInCarrierPlugins } from './core/pinax/next/carriers/index.mjs'")
  .join("import { createCarrierRegistry } from './core/carrierBootstrap.mjs'")

const OLD = `      const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
      const plugins = await loadBuiltInCarrierPlugins()
      for (const plugin of plugins) {
        const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
        if (installed && installed.ok === false) {
          throw new Error(\`载体装不上：\${plugin.manifest?.id ?? '?'}（\${text(installed.error?.message || installed.error)}）\`)
        }
      }`
const NEW = `      const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
      // 底座只装清单声明（OpenStory 不调载体工具实现）；实现层随各业务套件上线。
      const boot = await createCarrierRegistry()
      if (boot.skipped.length) {
        throw new Error(\`载体清单装不上：\${boot.skipped.map((item) => \`\${item.id}（\${item.reason}）\`).join(' / ')}\`)
      }
      for (const [manifest] of boot.registry.manifests()) {
        registry.install(manifest, {}, {})
      }`

if (!src.includes(OLD)) {
  console.error('PATCH TARGET NOT FOUND — 手工检查 getCarrierRegistry')
  process.exit(1)
}
src = src.split(OLD).join(NEW)

// createCarrierRegistry 内部已建自己的 registry 并装好清单——直接复用它的 registry，避免二次安装。
src = src
  .split(`      const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
      // 底座只装清单声明（OpenStory 不调载体工具实现）；实现层随各业务套件上线。
      const boot = await createCarrierRegistry()
      if (boot.skipped.length) {
        throw new Error(\`载体清单装不上：\${boot.skipped.map((item) => \`\${item.id}（\${item.reason}）\`).join(' / ')}\`)
      }
      for (const [manifest] of boot.registry.manifests()) {
        registry.install(manifest, {}, {})
      }`)
  .join(`      // 底座只装清单声明（OpenStory 不调载体工具实现）；实现层随各业务套件上线。
      const { registry } = await createCarrierRegistry()`)

fs.writeFileSync('libraryManage.mjs', src, 'utf-8')
console.log('patched')
