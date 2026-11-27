import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const source = readFileSync(resolve(REPO, '.github/workflows/ci.yml'), 'utf-8')

function scalar(text) {
  if (text.startsWith('"')) return JSON.parse(text)
  if (text.startsWith("'")) return text.slice(1, -1).replace(/''/gu, "'")
  if (text === 'null' || text === '~') return null
  if (text === 'true') return true
  if (text === 'false') return false
  if (/^-?\d+(?:\.\d+)?$/u.test(text)) return Number(text)
  return text
}

function splitPair(text) {
  const match = /^([^:]+):(?:\s+(.*))?$/u.exec(text)
  if (!match) return null
  return { key: scalar(match[1].trim()), value: match[2] ?? '' }
}

function parseYamlSubset(text) {
  const records = []
  const lines = text.replace(/\r\n?/gu, '\n').split('\n')
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]
    if (raw.includes('\t')) throw new Error(`第 ${index + 1} 行不许用 tab 缩进`)
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue
    const indent = raw.match(/^ */u)[0].length
    records.push({ indent, content: raw.slice(indent), raw, line: index + 1 })
  }

  function parseBlock(index, indent) {
    if (records[index]?.content.startsWith('- ')) return parseSequence(index, indent)
    return parseMapping(index, indent)
  }

  function parseMapping(index, indent) {
    const output = {}
    while (index < records.length && records[index].indent === indent && !records[index].content.startsWith('- ')) {
      const record = records[index]
      const pair = splitPair(record.content)
      assert.ok(pair, `第 ${record.line} 行不是合法 mapping`)
      if (Object.hasOwn(output, pair.key)) throw new Error(`第 ${record.line} 行重复键：${pair.key}`)
      index++
      if (pair.value === '') {
        if (index < records.length && records[index].indent > indent) {
          const child = parseBlock(index, records[index].indent)
          output[pair.key] = child.value
          index = child.after
        } else {
          output[pair.key] = null
        }
      } else if (pair.value === '|') {
        const block = []
        const blockIndent = records[index]?.indent
        while (index < records.length && records[index].indent > indent) {
          block.push(records[index].raw.slice(Math.min(blockIndent, records[index].indent)))
          index++
        }
        output[pair.key] = `${block.join('\n')}\n`
      } else {
        output[pair.key] = scalar(pair.value)
      }
      if (index < records.length && records[index].indent > indent && pair.value !== '|' && pair.value !== '') {
        throw new Error(`第 ${records[index].line} 行缩进没有对应父键`)
      }
    }
    return { value: output, after: index }
  }

  function parseSequence(index, indent) {
    const output = []
    while (index < records.length && records[index].indent === indent && records[index].content.startsWith('- ')) {
      const record = records[index]
      const rest = record.content.slice(2)
      const pair = splitPair(rest)
      index++
      if (!pair) {
        output.push(scalar(rest))
        continue
      }
      const item = {}
      if (pair.value === '') {
        if (index < records.length && records[index].indent > indent) {
          const child = parseBlock(index, records[index].indent)
          item[pair.key] = child.value
          index = child.after
        } else {
          item[pair.key] = null
        }
      } else {
        item[pair.key] = scalar(pair.value)
      }
      while (index < records.length && records[index].indent > indent) {
        const child = parseBlock(index, records[index].indent)
        assert.ok(child.value && typeof child.value === 'object' && !Array.isArray(child.value), `第 ${records[index].line} 行应为 mapping`)
        Object.assign(item, child.value)
        index = child.after
      }
      output.push(item)
    }
    return { value: output, after: index }
  }

  if (!records.length) throw new Error('工作流为空')
  const parsed = parseBlock(0, records[0].indent)
  assert.equal(parsed.after, records.length, 'YAML 还有未解析内容')
  return parsed.value
}

const workflow = parseYamlSubset(source)
assert.equal(workflow.name, 'OpenStory CI')
assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push', 'workflow_dispatch'])
assert.equal(workflow.permissions.contents, 'read')
const job = workflow.jobs.gates
assert.equal(job['runs-on'], 'ubuntu-latest')
const steps = job.steps
assert.ok(steps.some((step) => step.uses === 'actions/setup-node@v4' && step.with?.['node-version'] === '24'))
const tests = steps.find((step) => step.name === 'Run tests twice')
assert.equal((tests.run.match(/npm test/gu) || []).length, 2)
assert.ok(steps.some((step) => step.run?.includes('node tools/acceptance/acceptance.mjs')))
assert.ok(steps.some((step) => step.run?.includes('node tools/arch-stats.mjs --check')))
const e2e = steps.find((step) => step.run?.includes('node tools/verify/verify-os172-e2e.mjs'))
assert.ok(e2e, 'gates 必须运行隔离的全栈 E2E')
assert.match(e2e.run, /set -o pipefail/u)
assert.ok(!/8807|OPENSTORY_PORT/u.test(e2e.run), '隔离 E2E 不得依赖 8807')
const ciStructure = steps.find((step) => step.run?.includes('node tools/verify/verify-ci-workflow.mjs'))
assert.ok(ciStructure, 'gates 必须运行 CI workflow 结构自检')
const mcpBuild = steps.find((step) => step.run?.includes('node tools/verify/verify-mcp-build-e2e.mjs'))
assert.ok(mcpBuild, 'gates 必须运行 MCP-only clean-room 构建链')
assert.match(mcpBuild.run, /verify-mcp-build-e2e\.mjs --out/u)
assert.match(mcpBuild.run, /set -o pipefail/u)
assert.ok(!/8807|OPENSTORY_PORT/u.test(mcpBuild.run), 'MCP clean-room 不得依赖 8807')
const upgradeE2e = steps.find((step) => step.run?.includes('node tools/verify/verify-upgrade-e2e.mjs'))
assert.ok(upgradeE2e, 'gates 必须运行独立升级迁移 E2E')
assert.match(upgradeE2e.run, /verify-upgrade-e2e\.mjs --out/u)
assert.match(upgradeE2e.run, /set -o pipefail/u)
assert.ok(!/8807|OPENSTORY_PORT/u.test(upgradeE2e.run), '升级迁移 E2E 不得依赖 8807')
const upload = steps.find((step) => step.name === 'Upload gate logs')
assert.equal(upload.if, 'always()')
assert.equal(upload.uses, 'actions/upload-artifact@v4')
for (const step of steps) {
  if (step.run?.includes('tee ')) assert.ok(step.run.includes('set -o pipefail'), `${step.name} 的 tee 管线必须保留失败退出码`)
}

const browser = workflow.jobs['browser-smoke']
assert.ok(browser, '必须存在独立 browser-smoke job')
assert.equal(browser['runs-on'], 'ubuntu-latest')
const browserSteps = browser.steps
assert.ok(browserSteps.some((step) => step.uses === 'actions/setup-node@v4' && step.with?.['node-version'] === '24'))
const chromium = browserSteps.find((step) => step.name === 'Install Chromium')
assert.match(chromium?.run ?? '', /apt-get install[^\n]*chromium/u)
assert.match(chromium.run, /chromium --version/u)
const smoke = browserSteps.find((step) => step.name === 'Run page browser smoke')
assert.match(smoke?.run ?? '', /page-browser-smoke\.mjs --out/u)
assert.match(smoke.run, /verify-page-report\.mjs/u)
assert.match(smoke.run, /set -o pipefail/u)
assert.ok(!/--page(?:\s|$)/u.test(smoke.run), 'CI 浏览器 smoke 必须跑完整页面矩阵')
const browserUpload = browserSteps.find((step) => step.name === 'Upload page report and screenshots')
assert.equal(browserUpload.if, 'always()')
assert.equal(browserUpload.uses, 'actions/upload-artifact@v4')
assert.match(browserUpload.with?.path ?? '', /openstory-browser-smoke/u)
assert.ok(browserSteps.some((step) => step.if === 'failure()' && step.run?.includes('::error')), '浏览器失败必须有注解')
console.log('✓ CI workflow YAML 子集解析与结构校验通过（Node 24／两轮测试／验收／arch／隔离 E2E／独立浏览器矩阵与报告产物）')
