/**
 * OS-160：样例库配置生成器（可重跑，零依赖）。
 *
 * 工单硬要求：样例库自带的配置文件必须是**真实运行路径产出**，不许手写 JSON 冒充。
 * 做法：把样例库拷到临时目录 → 按真实 API 的函数签名调 writeUiState / saveSuiteSettings /
 * setSuiteEnabled（路径解析、原子写、schema 校验全走产品代码）→ 把产出的两个配置文件
 * 复制回样例库，只保留点名文件，不把日志/历史/时间戳带回去。
 *
 * 用法：node tools/samples/generate-sample-config.mjs
 * 幂等：重跑产出同样的业务形状（updatedAt 是运行事实，重跑会更新——这是「真跑过」的证据）。
 */
import { mkdtempSync, copyFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeUiState } from '../../src/protocol/libState.mjs'
import { saveSuiteSettings, setSuiteEnabled } from '../../src/services/suites.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SAMPLE = join(REPO, 'samples', '水浒传')
const BUILTIN_SUITES = join(REPO, 'suites')
const dirs = [BUILTIN_SUITES]

function text(value) { return String(value ?? '') }
function fail(message) { console.error('生成失败：' + message); process.exit(1) }
if (!existsSync(SAMPLE)) fail('样例库不存在：' + SAMPLE)

const base = mkdtempSync(join(tmpdir(), 'os160-sample-'))
const tempRoot = join(base, 'sample-lib')
try {
  // 只需要一个空的临时库根：三个写入函数都按 root 解析路径，不读任何稿件。
  // 不拷整个样例库（里面有 mp3/png 二进制，没必要且拖慢）。
  mkdirSync(tempRoot, { recursive: true })

  // ① 界面状态：真实 writeUiState（原子写＋备份＋changelog，全走产品代码）
  const ui = await writeUiState(tempRoot, {
    hiddenTabs: [],
    moduleEnabled: {},
    agentCollapsed: false,
    selectedTab: '正文'
  })
  if (!ui.ok) fail('写 ui-state 失败：' + ui.message)

  // ② 套件配置：真实 saveSuiteSettings（按 writing 套件 schema 归一＋校验）＋启停
  const saved = await saveSuiteSettings(dirs, '', 'writing', {
    newChapterTitle: '第{N}章',
    deduceBranches: 2
  }, tempRoot)
  if (!saved.ok) fail('写套件设置失败：' + saved.message)
  const enabled = await setSuiteEnabled(dirs, '', 'writing', true, tempRoot)
  if (!enabled.ok) fail('设套件启停失败：' + enabled.message)

  // ③ 只把点名的两个运行产物复制回样例库（副本里的 .history/.pinax/log 一律不带回）
  const generated = [
    [join(tempRoot, '.pinax', 'ui-state.json'), join(SAMPLE, '.pinax', 'ui-state.json')],
    [join(tempRoot, '.openstory', 'plugins', 'suite-state.json'), join(SAMPLE, '.openstory', 'plugins', 'suite-state.json')]
  ]
  for (const [from, to] of generated) {
    if (!existsSync(from)) fail('运行路径没产出：' + from)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    console.log('已生成：' + to.replace(REPO.replaceAll('\\', '/') + '/', ''))
  }

  // ④ 回读自检：确认样例库里这两个文件是可解析 JSON 且业务值对
  const uiState = JSON.parse(readFileSync(generated[0][1], 'utf-8'))
  const suiteState = JSON.parse(readFileSync(generated[1][1], 'utf-8'))
  if (text(uiState.selectedTab) !== '正文' || suiteState.suites?.writing?.values?.newChapterTitle !== '第{N}章') {
    fail('回读自检不通过：产出的配置内容不对')
  }
  console.log('✓ 样例库配置由真实路径产出并回读通过')
} finally {
  rmSync(base, { recursive: true, force: true })
}
