/**
 * 同源同步盘点（OS-113）：列出所有「一份数据 → 多处在用」的关系，
 * 标注各自的版本字段与当前是否有失效检测。
 */
const report = [
  {
    id: 'fact→wiki',
    upstream: '拆解/<bookId>.json（revision 自增）',
    downstream: '拆解/<bookId>.wiki.json（章摘要/人物档/伏笔）',
    versionField: 'wiki.derivedFrom.factRevision',
    checkExists: false,
    note: '内核 readFactWiki 会返回 derivedFrom，但 OpenStory 没有任何地方拿它和当前 revision 比。实测泄密的心：wiki 记 factRevision=1，fact 已 revision=4——已过期 3 版，界面无感知。'
  },
  {
    id: 'fact→故事源',
    upstream: '拆解/<bookId>.json',
    downstream: '故事源三形态（大纲/表格/图表）',
    versionField: 'entry.revision（文件级，逐条目透出）',
    checkExists: false,
    note: '故事源顶部显示「《泄密的心》· revision 4」（看见版本号），但没有「你看到的这份是否比磁盘旧」的判断——纯展示。'
  },
  {
    id: 'fact→世界书词条',
    upstream: '拆解/<bookId>.json',
    downstream: '世界书·拆解词条分区',
    versionField: 'entry.revision',
    checkExists: false,
    note: '词条列表不带 revision，也不刷新感知。'
  },
  {
    id: 'fact+notes→图谱',
    upstream: '拆解/*.json + 参考/**/*.md',
    downstream: '关系图谱（节点/边）',
    versionField: '无',
    checkExists: false,
    note: 'state.refCol.graph 一旦加载就缓存（loadRefGraph 有 force 参数但没人自动调）。参考笔记改了图谱不会自动重算。'
  },
  {
    id: '参考笔记→世界书索引',
    upstream: '参考/**/*.md（mtime）',
    downstream: '世界书列表/标签树/反链',
    versionField: 'note.mtime（逐篇）',
    checkExists: 'partial',
    note: '只有编辑块后 1.6 秒防抖重扫（commitRefBlock 里 refRescanTimer）。外部改动（VSCode 改文件）不感知。'
  },
  {
    id: '剧本↔fact',
    upstream: '剧本/*.md',
    downstream: '拆解条目（scriptToFact / factToScript）',
    versionField: '无',
    checkExists: false,
    note: '互转是一次性动作，两边都不记「从哪一版转来的」。转完任一边改了，另一边不知道。'
  },
  {
    id: 'fact→扮演底座',
    upstream: '拆解/<bookId>.json',
    downstream: '扮演 present/roleplayTurn 的事实包',
    versionField: '无',
    checkExists: false,
    note: '每回合现读（loadEntries），天然拿最新——这里反而是对的，不需要版本检测。'
  },
  {
    id: '正文↔拆解',
    upstream: '正文/**.md（mtime）',
    downstream: '拆解条目（provenance.chapters/sources）',
    versionField: '无',
    checkExists: false,
    note: '正文改了，拆解里引用的段号/内容不会自动失效——这是最大的缺口。'
  },
  {
    id: '正文→agent上下文',
    upstream: '正文/**.md',
    downstream: 'systemPromptFor 的参考资料索引（按最大章号过滤）',
    versionField: 'currentChapter 实时算',
    checkExists: 'realtime',
    note: '每次组 prompt 现算，天然最新。'
  },
  {
    id: 'UI状态',
    upstream: '界面操作',
    downstream: '.pinax/ui-state.json',
    versionField: '无（整份覆盖）',
    checkExists: 'n/a',
    note: '偏好类，不需要版本。'
  }
]

const lines = []
lines.push('# 同源同步盘点（OS-113）', '')
lines.push(`生成于 ${new Date().toISOString()}`, '')
lines.push('## 一、同源关系清单', '')
lines.push('| # | 上游 | 下游 | 版本字段 | 有检测 |', '|---|---|---|---|---|')
report.forEach((r, i) => {
  const chk = r.checkExists === true ? '✓' : r.checkExists === 'partial' ? '部分' : r.checkExists === 'realtime' ? '实时' : r.checkExists === 'n/a' ? '不需要' : '✗'
  lines.push(`| ${i + 1} | ${r.upstream} | ${r.downstream} | ${r.versionField} | ${chk} |`)
})
lines.push('', '## 二、逐条说明', '')
for (const r of report) {
  lines.push(`### ${r.id}`)
  lines.push(`- 上游：${r.upstream}`)
  lines.push(`- 下游：${r.downstream}`)
  lines.push(`- 版本字段：${r.versionField}`)
  lines.push(`- 说明：${r.note}`)
  lines.push('')
}
lines.push('## 三、结论')
lines.push('')
lines.push('**有版本字段的**：fact 文件 revision（内核自增）、wiki derivedFrom.factRevision、参考笔记 mtime、条目 entry.revision。')
lines.push('')
lines.push('**真正做了失效检测的**：只有 2 处——① commitRefBlock 编辑后 1.6s 防抖重扫参考索引（仅自己写的）；② agent 上下文每次现算 currentChapter（天然最新）。')
lines.push('')
lines.push('**完全没检测的（主要缺口）**：')
lines.push('1. **wiki 派生档过期**——fact revision 涨了，wiki 还标着老 factRevision，界面照用（实测已过期 3 版）')
lines.push('2. **正文改了拆解不知道**——拆解条目的 provenance 引用段号/原文，正文改动后没有任何失效标记')
lines.push('3. **外部编辑参考笔记不感知**——只有本页编辑才重扫，VSCode 改文件要手动刷新')
lines.push('4. **剧本↔fact 互转无溯源**——转完不知道转自哪一版')
lines.push('5. **图谱不自动重算**——参考笔记/拆解变了，state.refCol.graph 还是旧的')
lines.push('')
lines.push('**天然正确的（不需改）**：扮演底座每回合现读、agent 上下文实时算章号。')

const out = lines.join('\n')
const { writeFileSync } = await import('node:fs')
writeFileSync('docs/AUDIT-SYNC.md', out, 'utf-8')
console.log(out)
