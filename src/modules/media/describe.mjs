const text = (value) => String(value ?? '')

const TARGET_GUIDES = Object.freeze({
  character: '这是一个角色。写他的外形与气质：身形/衣着的具体质感、面容里最抓人的一处、姿态透出的性格。',
  scene: '这是一个场景。写氛围：光线从哪来、空气里有什么、什么地方冷、什么地方暖。',
  creature: '这是一个非人形象（怪物/异兽）。写它的体量与压迫感：尺度对比、不该有的细节、让人不敢直视的那一处。',
  item: '这是一个道具。写质感与来历感：材质、磨损、拿在手里的分量。'
})

export function visionPrompt({ imagePath, target = 'character', focus = '', habitContext = '' }) {
  return [
    '你有 read_image 工具。先读这张图，然后用文学语言写一段可直接进小说正文的白描。',
    '',
    `图片路径：${imagePath}`,
    '',
    '硬规矩：',
    '1. 只写看得见、能推理的。图上没有的身份/来历/情绪成因不编。',
    '2. 动词优先于形容词：「袍角扫过门槛」而不是「他穿着很长的袍子」。',
    '3. 不要写构图（「左侧是…」），换成小说里能出现的说法。',
    '4. 不要写风格词（「2D彩漫风格」），那是生图提示词不是正文。',
    '5. 150–300 字，只输出白描正文，不要标题、不要解释、不要 markdown 围栏。',
    '',
    TARGET_GUIDES[target] || '写这个画面的文学白描。',
    text(focus).trim() ? `\n这次特别留意：${text(focus).trim()}` : '',
    text(habitContext).trim() ? `\n作者习惯（必须遵守）：${text(habitContext).trim()}` : ''
  ].filter(Boolean).join('\n')
}

/**
 * media.describe@1：拥有识图提示词、DSH 调用与白描输出。
 * runtime 是显式注入的调用端口；media 不 import agent.runtime，也不反向依赖它。
 */
export async function describeImage({ imagePath, root = '', vision, target = 'character', focus = '', habitContext = '', env = {}, runtime } = {}) {
  if (!vision?.enabled) return { ok: false, error: '识图没启用——设置 · 模型 · 识图里打开开关并选模型' }
  if (typeof runtime?.runDshStdio !== 'function' || typeof runtime?.dshModelSelection !== 'function') {
    return { ok: false, error: '识图运行时不可用：缺少 agent.runtime 调用端口' }
  }
  const modelSelection = runtime.dshModelSelection(text(vision.model))
  const profile = text(vision.profile || env.DSH_PROFILE || 'openstory').trim()
  let collected = ''
  const run = await runtime.runDshStdio({
    dshCmd: env.DSH_CLI || 'dsh',
    profile,
    cwd: root,
    prompt: visionPrompt({ imagePath, target, focus, habitContext }),
    ...(modelSelection ? { model: modelSelection } : {}),
    inactivityMs: 180_000,
    timeoutMs: 600_000,
    onText: (piece) => { collected += piece }
  })
  if (!run.ok) return { ok: false, error: `DSH 识图失败：${text(run.message || run.code || 'unknown')}` }
  const out = text(collected || run.text || '').trim()
  if (!out) return { ok: false, error: 'DSH 子 agent 没有返回文本（模型可能不支持读图）' }
  return {
    ok: true,
    text: out,
    chars: out.length,
    ...(modelSelection ? { model: `${modelSelection.provider}/${modelSelection.id}` } : {})
  }
}
