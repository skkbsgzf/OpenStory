/**
 * OS-142 Host API：内核 plumber 转供叶子（fork 点专用）。
 *
 * 面向对象：projectDoc.mjs／importAdapter.mjs 两个 OS-123 fork 点——它们的函数体逐字
 * 拷贝自 vendor（「除 import 重指向外逐字未动」纪律），不能改成 `fact.ok(...)` 的命名
 * 空间取用形状，所以这里按原名转供，函数体保持逐字不动。
 * 其他任何模块都不许用这三个名字——新模块一律走 index.mjs 的 fact 命名空间
 * （ok/fail/writeFileAtomic 都在 fact 里），本叶子只为 fork 点的 import 重指向存在。
 *
 * OS-152：管道三件已影子复制进 src/kernel/，本叶子改从自持件直取；转出名字与实现对象不变。
 *
 * 循环引用说明：OS-152 前本文件经单点适配器与 projectDoc/importAdapter 四角成环；改指
 * src/kernel/{errors,atomicWrite}.mjs 两个叶子后**环已断**（协议层只向下取内核件）。
 * 既有装载序护栏（test/decoupleStep2/Step3 ＋ test/hostApi.test.mjs 反方向子进程冒烟）保留，
 * 它们测的是装配顺序，不是环。
 */
export { ok, fail } from '../kernel/errors.mjs'
export { writeFileAtomic } from '../kernel/atomicWrite.mjs'
