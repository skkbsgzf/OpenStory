#!/usr/bin/env node
/**
 * OpenStory daemon 入口垫片（OS-140 布局归一）。
 *
 * 布局宪法：仓根只允许「入口、包描述、文档」——daemon 的实现在 `src/host/daemon.mjs`，
 * 本文件只做转发。两件事：
 *   ① `export * from` 实现文件——历史调用方（约 24 个测试文件与工具）按 `'../daemon.mjs'`
 *      import `startDaemon`/`acquireDaemonLock` 等符号，垫片必须原样再出口；
 *   ② 只有被 node 直接执行时才调 main()——纯 import（测试/工具）不得启动服务。
 *      判定：`resolve(process.argv[1]) === fileURLToPath(import.meta.url)`。
 * CLI 启动逻辑（参数解析/单实例锁/信号处理）收在实现文件的 `main(argv)`，本文件零业务逻辑。
 *
 * 用法：`node daemon.mjs [--port=8807] [--root=<库路径>] [--preferences=<next-preferences.json>]`
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export * from './src/host/daemon.mjs'

import { main } from './src/host/daemon.mjs'

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

if (isMain) main(process.argv.slice(2))
