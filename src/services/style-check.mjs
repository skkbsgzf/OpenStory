/**
 * 指纹门禁（KB-ARCH P1）——对产出文本跑语言统计与结构检测，比对 style 包声明的硬指纹。
 *
 * runStyleCheck(text, packName) → {F, S, language:[…], structure:[…], pass}
 *   F = 语言指纹命中率（OK 项/总项）；S = 结构要素命中率；pass = F ≥ 0.6 且 S ≥ 0.5。
 * 口径与 tools/distill/language-dna.mjs 一致（句/段/标点/对话），结构用正则可判项。
 * 阈值来源：各 style 包 L1/L2 的「指纹自检」行，带宽 ±25–30%（是风格桶，不是精确复制）。
 */

const r1 = (n) => Number(n.toFixed(1))

export function measure(text) {
  const flat = String(text || '').split('\n').filter((l) => l.trim()).join('\n')
  const totalChars = flat.replace(/\s/g, '').length || 1
  const sentences = flat.split(/(?<=[。！？]|……)/).map((s) => s.replace(/\s/g, '')).filter(Boolean)
  const lens = sentences.map((s) => s.length)
  const paras = String(text || '').split('\n').map((p) => p.replace(/\s/g, '')).filter(Boolean)
  const count = (ch) => flat.split(ch).length - 1
  const per1k = (ch) => r1((count(ch) / totalChars) * 1000)
  return {
    totalChars,
    avgSentence: r1(lens.reduce((a, b) => a + b, 0) / Math.max(lens.length, 1)),
    shortRatio: r1((lens.filter((l) => l <= 15).length / Math.max(lens.length, 1)) * 100),
    longRatio: r1((lens.filter((l) => l >= 50).length / Math.max(lens.length, 1)) * 100),
    paraAvg: r1(paras.reduce((a, b) => a + b.length, 0) / Math.max(paras.length, 1)),
    commaPer1k: per1k('，'),
    periodPer1k: per1k('。'),
    exclaimPer1k: per1k('！'),
    questionPer1k: per1k('？'),
    ellipsisPer1k: per1k('……'),
    dashPer1k: per1k('——'),
    dialogueRatio: r1(([...flat.matchAll(/“([^”]*)”/g)].reduce((s, m) => s + m[1].length, 0) / totalChars) * 100)
  }
}

/* ---------- 指纹规格（来源：各包 L1 表＋L2 结构自检行） ---------- */

const CLASSICAL = ['不虞', '仰仗', '满城皆知', '未曾', '岂', '遂', '敢问', '切记', '告辞', '分毫不差']
const HISTORY_NAMES = ['诸葛亮', '韩信', '霍去病', '陈平', '白起', '李斯', '蒙恬', '项羽', '刘邦', '张良', '岳飞', '戚继光', '王阳明', '徐达', '刘伯温', '李白', '华佗', '鲁班', '扁鹊', '姜子牙', '商鞅', '张仪', '屈原', '李信', '王翦', '范雎']
const BUREAU_TERMS = ['笔试', '面试', '铁饭碗', '编制', '科级', '组织部', '局长', '秘书', '领导', '公务员', '体制', '汇报', '编制内', '提拔']
const BODY_WORDS = ['声音', '目光', '微微', '指尖', '耳尖', '呼吸', '体温', '心跳', '指尖', '颤抖']

const SPECS = {
  'style-wangbuliao-baiyue': {
    label: '白月光双向暗恋（女频短篇）',
    language: [
      { metric: 'avgSentence', desc: '句均 13–26', ok: (m) => m.avgSentence >= 13 && m.avgSentence <= 26 },
      { metric: 'shortRatio', desc: '短句占比 ≥40%', ok: (m) => m.shortRatio >= 40 },
      { metric: 'dialogueRatio', desc: '对话占比 22–38%', ok: (m) => m.dialogueRatio >= 22 && m.dialogueRatio <= 38 },
      { metric: 'paraAvg', desc: '段均 ≤28', ok: (m) => m.paraAvg <= 28 },
      { metric: 'exclaimPer1k', desc: '感叹号 ≤6/千字（克制反讽）', ok: (m) => m.exclaimPer1k <= 6 },
      { metric: 'commaPer1k', desc: '逗号 ≥45/千字（绵密串句）', ok: (m) => m.commaPer1k >= 45 }
    ],
    structure: [
      { id: 'numberedSections', desc: '数字小节号（1/2/3 分拍）', ok: (t) => /^[#>\*\s　]*[0-9０-９]{1,3}[、.．\s]*$/m.test(t) },
      { id: 'quotedLines', desc: '带引号对白行 ≥4', ok: (t) => (t.match(/“[^”]{2,}”/g) || []).length >= 4 }
    ]
  },
  'style-moshi-danmu': {
    label: '末世弹幕（金手指短篇）',
    language: [
      { metric: 'avgSentence', desc: '句均 14–25', ok: (m) => m.avgSentence >= 14 && m.avgSentence <= 25 },
      { metric: 'exclaimPer1k', desc: '感叹号 ≥3.5/千字', ok: (m) => m.exclaimPer1k >= 3.5 },
      { metric: 'dialogueRatio', desc: '对话占比 18–36%', ok: (m) => m.dialogueRatio >= 18 && m.dialogueRatio <= 36 }
    ],
    structure: [
      { id: 'danmuBlocks', desc: '【】弹幕段 ≥3', ok: (t) => (t.match(/^[>*\s　]*[【\[][^】\]]{4,}[】\]]/gm) || []).length >= 3 },
      { id: 'openingDanmu', desc: '首屏 5 行内出现弹幕', ok: (t) => { const lines = t.split('\n').filter((l) => l.trim()).slice(0, 6); return lines.some((l) => /[【\[]/.test(l)) } },
      { id: 'numberedSections', desc: '数字小节号', ok: (t) => /^[#>\*\s　]*[0-9０-９]{1,3}[、.．\s]*$/m.test(t) }
    ]
  },
  'style-nianshang-yinshi': {
    label: '年上阴湿（现言甜宠短篇）',
    language: [
      { metric: 'avgSentence', desc: '句均 ≤20（极碎）', ok: (m) => m.avgSentence <= 20 },
      { metric: 'shortRatio', desc: '短句占比 ≥55%', ok: (m) => m.shortRatio >= 55 },
      { metric: 'sentencePeriod', desc: '句号主导（句号频次 ≥ 逗号）', ok: (m) => m.periodPer1k >= m.commaPer1k * 0.85 },
      { metric: 'dialogueRatio', desc: '对话占比 ≥25%', ok: (m) => m.dialogueRatio >= 25 },
      { metric: 'dashPer1k', desc: '破折号 ≥1.5/千字（时间分隔）', ok: (m) => m.dashPer1k >= 1.5 }
    ],
    structure: [
      { id: 'dateSeparator', desc: '——X——式时间分隔', ok: (t) => /——[^—\n]{1,14}——/.test(t) },
      { id: 'oneLineDialogues', desc: '一句一行对白 ≥8', ok: (t) => (t.match(/^[　\s]*“[^”]{1,40}”\s*$/gm) || []).length >= 8 }
    ]
  },
  'style-rejinzhi': {
    label: '惹金枝（古言世情长篇）',
    language: [
      { metric: 'avgSentence', desc: '句均 ≥23（绵密长句）', ok: (m) => m.avgSentence >= 23 },
      { metric: 'longRatio', desc: '长句 ≥7%', ok: (m) => m.longRatio >= 7 },
      { metric: 'dialogueRatio', desc: '对话占比 ≥28%', ok: (m) => m.dialogueRatio >= 28 },
      { metric: 'paraAvg', desc: '段均 ≥26（长段落）', ok: (m) => m.paraAvg >= 26 },
      { metric: 'commaPer1k', desc: '逗号 ≥45/千字', ok: (m) => m.commaPer1k >= 45 }
    ],
    structure: [
      { id: 'chapterTitle', desc: '章节制标题（第N章）', ok: (t) => /第[0-9一二三四五六七八九十百千]+章/.test(t) },
      { id: 'classicalFlavor', desc: '文言腔词 ≥2 种', ok: (t) => new Set(CLASSICAL.filter((w) => t.includes(w))).size >= 2 }
    ]
  },
  'style-shangan-guanchang': {
    label: '上岸官场（都市体制长篇）',
    language: [
      { metric: 'avgSentence', desc: '句均 ≥32（超长因果句）', ok: (m) => m.avgSentence >= 32 },
      { metric: 'longRatio', desc: '长句 ≥25%', ok: (m) => m.longRatio >= 25 },
      { metric: 'commaPer1k', desc: '逗号 ≥55/千字', ok: (m) => m.commaPer1k >= 55 },
      { metric: 'dialogueRatio', desc: '对话占比 ≤32%', ok: (m) => m.dialogueRatio <= 32 },
      { metric: 'shortRatio', desc: '短句占比 ≤30%', ok: (m) => m.shortRatio <= 30 }
    ],
    structure: [
      { id: 'dateAnchor', desc: '年代锚点（XXXX年）', ok: (t) => /\d{4}\s*年/.test(t) },
      { id: 'bureauTerms', desc: '体制术语 ≥3 种', ok: (t) => new Set(BUREAU_TERMS.filter((w) => t.includes(w))).size >= 3 }
    ]
  },
  'style-da-qin-yaoren': {
    label: '大秦摇人（历史脑洞长篇）',
    language: [
      { metric: 'avgSentence', desc: '句均 ≤28（喜剧快节奏）', ok: (m) => m.avgSentence <= 28 },
      { metric: 'dialogueRatio', desc: '对话占比 ≥25%', ok: (m) => m.dialogueRatio >= 25 },
      { metric: 'exclaimPer1k', desc: '感叹号 1.5–7/千字', ok: (m) => m.exclaimPer1k >= 1.5 && m.exclaimPer1k <= 7 }
    ],
    structure: [
      { id: 'historicalNames', desc: '历史名人 ≥2 位', ok: (t) => new Set(HISTORY_NAMES.filter((w) => t.includes(w))).size >= 2 },
      { id: 'speechlessEllipsis', desc: '无语省略号（：……）', ok: (t) => /(：|：)\s*[“"「]?……|：……/.test(t) }
    ]
  },
  'style-fengpi-fanpai': {
    label: '疯批反派（穿书狗血长篇）',
    language: [
      { metric: 'paraAvg', desc: '段均 ≤28（一拍一段）', ok: (m) => m.paraAvg <= 28 },
      { metric: 'shortRatio', desc: '短句占比 ≥40%', ok: (m) => m.shortRatio >= 40 },
      { metric: 'exclaimPer1k', desc: '感叹号 ≥2/千字', ok: (m) => m.exclaimPer1k >= 2 },
      { metric: 'ellipsisPer1k', desc: '省略号 ≥1.5/千字（转场/无语）', ok: (m) => m.ellipsisPer1k >= 1.5 }
    ],
    structure: [
      { id: 'bodyWords', desc: '身体反应词 ≥3 种', ok: (t) => new Set(BODY_WORDS.filter((w) => t.includes(w))).size >= 3 },
      { id: 'quotedLines', desc: '带引号对白行 ≥4', ok: (t) => (t.match(/“[^”]{2,}”/g) || []).length >= 4 }
    ]
  }
}

export function listFingerprintPacks() {
  return Object.keys(SPECS)
}

/**
 * 指纹硬指标提示块：把规格里的数值带编译成给 LLM 的明确写作目标（散文→数字）。
 * 只读 SPECS，不改判定逻辑——评测增强臂与 daemon 注入共用。
 */
export function fingerprintHint(packName) {
  const spec = SPECS[packName]
  if (!spec) return ''
  const lang = spec.language.map((item) => `- ${item.desc}`).join('\n')
  const struct = spec.structure.map((item) => `- ${item.desc}`).join('\n')
  return `【指纹·硬指标（${spec.label}）——逐项达到\n语言：\n${lang}\n结构：\n${struct}】`
}

/** 主入口：F/S 命中率 + pass 判定。 */
export function runStyleCheck(text, packName) {
  const spec = SPECS[packName]
  if (!spec) return { ok: false, error: `没有这个包的指纹规格：${packName}（可选 ${listFingerprintPacks().join(', ')}）` }
  const m = measure(text)
  const language = spec.language.map((item) => ({ metric: item.metric, desc: item.desc, value: m[item.metric], ok: !!item.ok(m) }))
  const structure = spec.structure.map((item) => ({ id: item.id, desc: item.desc, ok: !!item.ok(text) }))
  const F = language.filter((x) => x.ok).length / language.length
  const S = structure.filter((x) => x.ok).length / structure.length
  return { ok: true, pack: packName, label: spec.label, chars: m.totalChars, F: r1(F * 100) / 100, S: r1(S * 100) / 100, pass: F >= 0.6 && S >= 0.5, language, structure, metrics: m }
}
