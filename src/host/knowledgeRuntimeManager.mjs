/**
 * 本地 RAG 运行时管理（OS-233）——HyperGraphRAG venv 的检测、安装与配置。
 *
 * 定位：这是**宿主能力**，不属于任何知识库资产。运行时装在机器级院子
 * （`%LOCALAPPDATA%/OpenStory/openstory/knowledge-runtime/`），所有库共用一份；
 * 每个知识库的索引仍落在自己的源目录之外（见 knowledge-runtime/staging）。
 *
 * 纪律：
 *   · 不下载模型权重——embedding 默认走仓内已有的本地 transformers.js 服务；
 *   · HyperGraphRAG 源码必须匹配 runtime-source.json 的 commit 与 tree hash；
 *   · 安装是长任务，走全局任务中心（jobCenter），进度可在任务球看到；
 *   · 任何一步失败如实返回缺失项，不假装可用。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { courtyardPath } from '../protocol/courtyard.mjs'

const RUNTIME_DIR = 'knowledge-runtime'
const VENV_DIR = 'venv'
const SOURCE_DIR = 'src'
const CONFIG_FILE = 'runtime-config.json'

/** 仓根：本文件在 src/host/ 下，上溯两层。 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const text = (value) => String(value ?? '')

/** 运行时根（机器级院子下）。 */
export function runtimeRootPath(env = process.env) {
  return courtyardPath(env, RUNTIME_DIR)
}

export function venvPythonPath(env = process.env) {
  const base = runtimeRootPath(env)
  if (!base) return ''
  return join(base, VENV_DIR, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python')
}

export function workerPath(repoRoot = REPO_ROOT) {
  return join(text(repoRoot), 'tools', 'knowledge-runtime', 'worker.py')
}

export function configPath(env = process.env) {
  const base = runtimeRootPath(env)
  return base ? join(base, CONFIG_FILE) : ''
}

/** 读配置：缺文件回默认（embedding=local，llm 未配）。 */
export async function readRuntimeConfig(env = process.env) {
  const path = configPath(env)
  const fallback = {
    embedding: { provider: 'local', model: 'Xenova/bge-small-zh-v1.5', endpoint: 'http://127.0.0.1:8808' },
    llm: { provider: '', module: '', factory: '' }
  }
  if (!path) return { ok: true, config: fallback, path: '' }
  try {
    const raw = JSON.parse(await readFile(path, 'utf-8'))
    return { ok: true, config: { ...fallback, ...raw }, path }
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, config: fallback, path }
    return { ok: false, code: 'RUNTIME_CONFIG_CORRUPT', message: `运行时配置不是合法 JSON：${text(error?.message || error)}`, config: fallback, path }
  }
}

/** 写配置（整份覆盖，只落机器级院子，不进任何库）。 */
export async function writeRuntimeConfig(next, env = process.env) {
  const path = configPath(env)
  if (!path) return { ok: false, code: 'NO_COURTYARD', message: '找不到本机院子，无法保存运行时配置' }
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
  return { ok: true, path, config: next }
}

/** 探测一个可用的系统 python（安装 venv 用）。只探常见名，不扫任意路径。 */
async function findPython() {
  const candidates = process.platform === 'win32'
    ? ['py', 'python', 'python3']
    : ['python3', 'python']
  for (const name of candidates) {
    const ok = await new Promise((resolve) => {
      const child = spawn(name, ['--version'], { stdio: 'ignore', windowsHide: true })
      child.on('error', () => resolve(false))
      child.on('exit', (code) => resolve(code === 0))
      setTimeout(() => { try { child.kill() } catch { /* ignore */ } resolve(false) }, 5000)
    })
    if (ok) return name
  }
  return ''
}

async function dirSize(path) {
  let total = 0
  const walk = async (dir) => {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else { try { total += (await stat(full)).size } catch { /* ignore */ } }
    }
  }
  await walk(path)
  return total
}

/**
 * 运行时状态：给设置页显示「装没装、缺什么」。
 * @returns {Promise<{ok:boolean, state:'missing'|'partial'|'ready'|'broken', python:string, worker:string, venvBytes:number, config:object, missing:string[]}>}
 */
export async function runtimeStatus({ repoRoot, env = process.env } = {}) {
  const venvPython = venvPythonPath(env)
  const worker = workerPath(repoRoot)
  const config = await readRuntimeConfig(env)
  const missing = []
  const venvExists = Boolean(venvPython) && existsSync(venvPython)
  const workerExists = existsSync(worker)
  const sourceDir = runtimeRootPath(env) ? join(runtimeRootPath(env), SOURCE_DIR) : ''
  const sourceExists = Boolean(sourceDir) && existsSync(sourceDir)
  if (!venvExists) missing.push('venv（未安装 HyperGraphRAG 运行时）')
  if (!workerExists) missing.push(`worker.py（缺 ${worker}）`)
  if (!sourceExists) missing.push('HyperGraphRAG 源码快照')
  const venvBytes = sourceDir ? await dirSize(runtimeRootPath(env)) : 0
  const state = missing.length === 0 ? 'ready' : (venvExists || sourceExists || workerExists ? 'partial' : 'missing')
  return {
    ok: true,
    state,
    python: venvPython,
    worker,
    venvDir: runtimeRootPath(env),
    venvBytes,
    config: config.config,
    configPath: config.path,
    configError: config.ok ? '' : config.message,
    missing
  }
}

/**
 * 安装前置检查：不下载、不写盘，只回答「能不能装、要多少空间、装哪」。
 */
export async function runtimeInstallPlan({ repoRoot, env = process.env } = {}) {
  const python = await findPython()
  const lockPath = join(text(repoRoot), 'tools', 'knowledge-runtime', 'requirements.lock')
  let packageCount = 0
  try {
    packageCount = (await readFile(lockPath, 'utf-8')).split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')).length
  } catch { /* lock 缺了下面会报 */ }
  const blockers = []
  if (!python) blockers.push('系统里找不到 python / python3（安装 venv 需要）')
  if (!existsSync(lockPath)) blockers.push(`依赖锁定文件缺失：${lockPath}`)
  if (!courtyardPath(env)) blockers.push('找不到本机院子，无法确定安装位置')
  return {
    ok: true,
    canInstall: blockers.length === 0,
    blockers,
    python,
    target: runtimeRootPath(env),
    packageCount,
    // torch 是最大头（约 2GB）；其余合计几百 MB。给出量级让用户先判断。
    estimatedBytes: 2_400_000_000,
    note: '依赖含 torch（约 2GB），首次安装耗时取决于网络。模型权重不在这里下载——embedding 默认用仓内本地 transformers.js（约 25MB）。',
    // 安装不代跑：2GB 下载 + 编译环境差异太大，由作者在自己的终端执行。
    // 这里给出一条可直接复制的命令，路径都已解析好。
    command: blockers.length
      ? ''
      : `node tools/knowledge-runtime/install-runtime.py --python "${python}" --source <HyperGraphRAG 本地 checkout> --venv "${join(runtimeRootPath(env), VENV_DIR)}" --wheelhouse <离线轮子目录> --requirements tools/knowledge-runtime/requirements.lock --runtime-source tools/knowledge-runtime/runtime-source.json`,
    docs: 'docs/protocol/knowledge-library.md'
  }
}

/** 安装任务的 label，供 jobCenter 使用。 */
export function installJobLabel() {
  return '安装本地 RAG 运行时（HyperGraphRAG venv）'
}

export { findPython }
