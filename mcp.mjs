#!/usr/bin/env node
/**
 * OpenStory MCP server 入口垫片（OS-140 布局归一）。
 *
 * 布局宪法：仓根只允许「入口、包描述、文档」——MCP server 的实现在 `src/host/mcp.mjs`，
 * 本文件只做转发。两件事：
 *   ① `export * from` 实现文件（目前出口 `main`；后续若测试需要工具表等符号也从这里走）；
 *   ② 只有被 node 直接执行时才调 main()——纯 import（测试/工具）不得挂 stdio 通道、
 *      不得写就绪 banner。判定：`resolve(process.argv[1]) === fileURLToPath(import.meta.url)`。
 *
 * 用法：`node mcp.mjs`（stdio JSON-RPC；OPENSTORY_PORT 指定 daemon 端口，默认 8807）
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export * from './src/host/mcp.mjs'

import { main } from './src/host/mcp.mjs'

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

if (isMain) main(process.argv.slice(2))
