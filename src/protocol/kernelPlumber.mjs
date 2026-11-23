/**
 * OS-142 Host API：内核 plumber 转供叶子（fork 点专用）。
 *
 * 面向对象：projectDoc.mjs／importAdapter.mjs 两个 OS-123 fork 点——它们的函数体逐字
 * 拷贝自 vendor（「除 import 重指向外逐字未动」纪律），不能改成 `fact.ok(...)` 的命名
 * 空间取用形状，所以这里按原名转供，函数体保持逐字不动。
 * 其他任何模块都不许用这三个名字——新模块一律走 index.mjs 的 fact 命名空间
 * （ok/fail/writeFileAtomic 都在 fact 里），本叶子只为 fork 点的 import 重指向存在。
 *
 * 循环引用说明：本文件 → pinaxAdapter → projectDoc/importAdapter → 本文件。
 * 本文件只有 re-export 声明、没有模块求值期读取，任何装载序都安全
 * （两侧装载序护栏：test/decoupleStep2.test.mjs ＋ test/decoupleStep3.test.mjs ＋
 * test/hostApi.test.mjs 反方向子进程冒烟）。
 */
export { ok, fail, writeFileAtomic } from '../kernel/pinaxAdapter.mjs'
