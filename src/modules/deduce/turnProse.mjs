/**
 * 推演回合层胶水（OS-61 P2/OS-82/OS-62，OS-141 daemon 拆分落位）——
 * 「结算桥接＋叙述体成文＋戏剧候选 llmPort」的共享实现，推演域 handler（fact 域）共用。
 *
 *   · bridgeDeduceCandidates：deducePresent 把本拍候选存在 state.lastTurn.candidates，
 *     而 deduceSettle 的 choose 读的是 state.lastCandidates——两者从没接上。这里在结算前
 *     把 lastTurn 的候选同步进 lastCandidates（同一份数据、同一套 id，不是伪造候选）。
 *   · generateTurnProse / turnProsePrompt：这一拍的正文草稿——复用 enrich 的 llmPort 手法
 *     （OS-58），endpoint/cli/dsh 三路都收敛到单发单收。模型不可用/调用失败/回空＝
 *     { prose:'', proseError:'模型不可用' }，绝不伪造正文。
 *   · buildDeduceLlmPort：推演戏剧候选的 llmPort（OS-82）——没配模型返回 null，
 *     vendor 的 dramaCandidates 对 null/异常自己兜底。
 * 全仓只此一份定义；handler 一律从这里 import，不许复制。
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'
import { deduceStatePath } from './deduceEngine.mjs'
import { chatCompleteViaUpstream, resolveUpstreamSafe } from '../../protocol/upstream.mjs' // OS-142：上游模型通道经协议层叶子转出（模块纪律：modules 不直引 services）
import { text } from '../../protocol/authorize.mjs' // OS-142：宿主文本归一经协议层叶子转出（模块纪律：modules 不直引 host）

/** 读旧引擎推演状态（.openstory/deduce/<bookId>.json）——桥接用，只读。 */
export function readLegacyDeduceState(root, bookId) {
  try {
    const path = deduceStatePath(root, bookId)
    if (!existsSync(path)) return null
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export async function bridgeDeduceCandidates(root, bookId, sessionId = '') {
  const path = deduceStatePath(root, bookId, sessionId)
  if (!existsSync(path)) return { ok: false, code: 'NOT_FOUND', message: '还没有推演会话：先呈现一拍' }
  let state
  try { state = JSON.parse(readFileSync(path, 'utf-8')) } catch {
    return { ok: false, code: 'INVALID_ENTRY', message: '推演会话文件读不了：重新开局再试' }
  }
  const presented = Array.isArray(state?.lastTurn?.candidates) ? state.lastTurn.candidates : []
  if (!presented.length) return { ok: false, code: 'INVALID_ENTRY', message: '这一拍没有候选：先呈现一拍' }
  if (JSON.stringify(state.lastCandidates ?? null) === JSON.stringify(presented)) return { ok: true }
  state.lastCandidates = presented
  try {
    const backupPath = join(dirname(path), '.history', `${basename(path)}.bak-${Date.now()}`)
    await mkdir(dirname(backupPath), { recursive: true })
    await writeFile(backupPath, readFileSync(path))
    await atomicWriteFile(path, JSON.stringify(state, null, 2))
  } catch (error) {
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `推演会话写入失败：${text(error?.message || error)}` }
  }
  return { ok: true }
}

/** 一拍的字数（与 deduceSession.nodeWords 同口径）：有正文算正文，没正文算候选摘要。 */
export function turnNodeWords(node) {
  const prose = text(node?.prose)
  if (prose.trim()) return prose.length
  return (Array.isArray(node?.candidates) ? node.candidates : [])
    .reduce((sum, candidate) => sum + text(candidate?.text).length, 0)
}

/** 成文 system 提示：小说叙述体——与推演提议体（DEDUCE_DRAMA_SYSTEM_PROMPT）绝不共用。 */
const DEDUCE_PROSE_SYSTEM = '你是世界本身——推演主持人的叙述声。用小说叙述体对玩家说话：玩家就是 POV 角色本人，一律称「你」——写你看到什么、听到什么、身体有什么感受，其他角色做了什么、说了什么，世界发生了什么变化（OS-92：文字是世界给玩家的反馈，不是角色的第一人称自述）。玩家刚拍板的行动照写过程与直接后果，但不要替玩家决定下一步行动或内心盘算。细节具体，对话自然贴人物。只输出这一拍的反馈（200–400 字），不要标题、不要候选列表、不要解释、不要 markdown 围栏。'

function turnProsePrompt(node, previousProse) {
  const scene = node?.scene ?? {}
  const candidates = Array.isArray(node?.candidates) ? node.candidates : []
  const chosen = candidates.find((candidate) => candidate.id === text(node?.choiceId))
  const lines = [
    '【当前局面】',
    `在场：${text(scene.who) || '未标记'}`,
    `地点：${text(scene.where) || '未标记'}`,
    `张力：${text(scene.tension) || '平缓'}`,
    `钩子：${text(scene.hook) || '无'}`,
    `【本拍选定】${text(chosen?.text) || text(node?.choiceId)}`
  ]
  const others = candidates.filter((candidate) => candidate.id !== text(node?.choiceId) && candidate.text)
  if (others.length) lines.push(`【其他候选（参照，不要写成选项）】${others.map((candidate) => candidate.text).join('；')}`)
  const tail = text(previousProse).trim().slice(-200)
  if (tail) lines.push(`【上一拍正文结尾（自然衔接，不要重复）】……${tail}`)
  lines.push('把这一拍写成 200–400 字的小说正文。')
  return lines.join('\n')
}

export async function generateTurnProse({ context, root, node, previousProse }) {
  const upstream = await resolveUpstreamSafe({ context })
  const out = await chatCompleteViaUpstream({
    upstream,
    system: DEDUCE_PROSE_SYSTEM,
    user: turnProsePrompt(node, previousProse),
    maxTokens: 1500,
    temperature: 0.7,
    cwd: root
  })
  if (out.error || !out.text) return { prose: '', proseError: '模型不可用' }
  return { prose: out.text, proseError: '' }
}

/** OS-82：推演戏剧候选的 llmPort——从全局文本模型配置构建；没配模型返回 null
 *  （vendor 的 dramaCandidates 对 null/异常自己兜底：戏剧层缺席不阻塞必然/命运）。 */
export async function buildDeduceLlmPort({ context }) {
  const upstream = await resolveUpstreamSafe({ context })
  if (!upstream) return null
  return {
    complete: async ({ system = '', maxTokens = 400 } = {}) => {
      // OS-90/91 游玩口径：vendor 提议器产出第三人称剧情走向，玩家要的是「我这个角色
      // 现在怎么做」的眼前情境分支选项。本 port 只服务戏剧候选，追加游玩指令。
      const playSystem = `${system}\n游玩口径：每条 text 一律写成 POV 角色第一人称的行动选择（「我现在怎么做」），基于眼前的情境给分支——像「前面有一座山，是进山还是绕行」「遇到一个人，是上前搭话还是默默观察」。动作要具体、当下、可执行，以动词开头；每条之间方向明显不同；不要第三人称剧情梗概，不要替世界写结果——世界怎么回应由下一拍决定。`
      const out = await chatCompleteViaUpstream({ upstream, system: playSystem, maxTokens })
      if (out.error) throw new Error(out.error)
      return { text: out.text ?? '' }
    }
  }
}
