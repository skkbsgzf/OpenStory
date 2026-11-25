/** C6：从 public/app.js 逐字迁出的libraryFlowViews渲染面。副作用仍由 app.js 持有。 */
export function createLibraryFlowViews(scope) {
  const { state, esc, text, needLibraryHtml, errorHtml, warningsHtml, unitLabel, divideLabel, deliverableLabel, openModal } = scope

const DECISION_LABELS = {
  chapter: '正文',
  script: '剧本',
  outline: '大纲',
  'outline-json': '大纲（结构化）',
  worldbook: '世界书',
  rule: '约束',
  idea: '构思',
  source: '资料',
  'source-json': '资料（归档 JSON）',
  material: '资料（章节衍生）',
  auxiliary: '资料（世界书辅助）',
  log: '日志'
}

const PRIMARY_CHOICES = [
  { id: 'openstory.carrier.novel', title: '小说', detail: '正文/ 世界书/ 日志 骨架' },
  { id: 'openstory.carrier.script', title: '剧本', detail: '剧本/ 人物/ 场景/ 世界书/ 日志 骨架' }
]

function flowError(message) {
  return message ? `<div class="error-box">${esc(message)}</div>` : ''
}

function joinDir(parent, name) {
  const base = text(parent).replace(/[\\/]+$/u, '')
  const isWindows = base.includes('\\') || /^[a-zA-Z]:/u.test(base)
  return `${base}${isWindows ? '\\' : '/'}${text(name).trim()}`
}

function createHtml() {
  const create = state.create
  const parent = create.parent.trim()
  const name = create.name.trim()
  const full = parent && name ? joinDir(parent, name) : ''
  const primaryCards = [
    ...PRIMARY_CHOICES.map((choice) => `<button class="big-opt${create.primary === choice.id ? ' on' : ''}" data-create-primary="${esc(choice.id)}"><b>${esc(choice.title)}</b><span>${esc(choice.detail)}</span></button>`),
    '<button class="big-opt' + (create.primary === '' ? ' on' : '') + '" data-create-primary=""><b>先建空壳</b><span>只落 .openstory/ 与元数据，主模块以后再选（OpenStory 里可以修）。</span></button>'
  ].join('')
  const genres = state.genres || []
  const selectedGenre = genres.find((item) => item.id === create.genre) ?? null
  const genreCards = genres.length
    ? genres.map((genre) => `<button class="big-opt${create.genre === genre.id ? ' on' : ''}" data-create-genre="${esc(genre.id)}">
        <b>${esc(genre.name)}${genre.tier === 'primary' ? '<span class="src">主打</span>' : ''}</b>
        <span>${esc(genre.summary || '')}</span>
        <span class="count">交付物：${genre.deliverables.map(deliverableLabel).join('／')} · 篇幅单位：${unitLabel(genre.length.unit)}${genre.length.divideBy !== 'none' ? ` · 分${divideLabel(genre.length.divideBy)}` : ' · 不分章'}</span>
      </button>`).join('')
    : '<span class="count">体裁货架读不到——库会建成未声明体裁的空壳，可在库里补声明。</span>'
  const lengthInput = create.length ?? (selectedGenre?.length?.total?.target ?? '')
  const perUnitInput = selectedGenre?.length?.perUnit?.target ?? ''
  const genreDetail = selectedGenre
    ? `<div class="row" style="margin-top:12px;align-items:flex-end">
        <div class="field"><label>总篇幅目标（${unitLabel(selectedGenre.length.unit)}）</label>
          <input id="create-length" type="number" min="1" value="${esc(lengthInput)}"></div>
        ${selectedGenre.length.divideBy !== 'none' ? `<div class="field"><label>每${divideLabel(selectedGenre.length.divideBy)}约（${unitLabel(selectedGenre.length.unit)}）</label>
          <input id="create-per-unit" type="number" min="1" value="${esc(perUnitInput)}"></div>` : ''}
        <span class="count">体裁建议区间：${selectedGenre.length.total ? `${selectedGenre.length.total.min}–${selectedGenre.length.total.max}` : '不限'}${selectedGenre.length.divideBy !== 'none' ? ` · 分${divideLabel(selectedGenre.length.divideBy)}` : ''}</span>
      </div>`
    : ''
  const result = create.result
    ? `<div class="step">
        <h3><span class="no">✓</span>库已建成</h3>
        <p class="sub">${esc(create.result.document?.name ?? '')} · ${esc(create.result.root)}</p>
        ${create.result.briefWritten ? '<p class="sub">✓ 作品简报已写入（体裁/篇幅已锁定，页签与 Agent 策略按它生效）</p>' : ''}
        ${create.result.briefError ? `<p class="sub" style="color:var(--danger)">${esc(create.result.briefError)}</p>` : ''}
        <p class="sub">${create.result.needsPrimary ? '这是个空壳库：还没选主模块。可以在库里点「诊断」修，或现在去导入稿件。' : `骨架与 .openstory/project.json 已按「${esc(create.result.document?.kind ?? '')}」落盘，并已登记进库清单（OpenStory 库清单里也能看到）。`}</p>
        <div class="repair-actions">
          <button class="btn-primary" data-action="create-open" data-root="${esc(create.result.root)}">打开这个库</button>
          <button class="btn-ghost" data-action="create-import" data-root="${esc(create.result.root)}">继续导入稿件</button>
          <button class="btn-ghost" data-action="flow-create-reset">再建一个</button>
        </div>
      </div>`
    : ''
  return `<div class="lib-wrap">
    <div class="lib-head-row">
      <button class="btn-ghost" data-action="flow-back">← 库管理</button><span class="sp"></span>
    </div>
    <h1>新建库</h1>
    <p class="sub">目录＝固化中文骨架 ∪ 模块认领的文件夹；只建不删。建好自动登记进库清单。</p>
    ${result}
    ${result ? '' : `
    <div class="step">
      <h3><span class="no">1</span>位置与名字</h3>
      <div class="row">
        <div class="field"><label>放在哪个目录下（绝对路径）</label>
          <div class="input-with-btn">
            <input id="create-parent" placeholder="D:\\写作" value="${esc(create.parent)}">
            <button class="btn-ghost" data-action="pick-folder" data-target="create-parent" title="弹出 Windows 文件夹选择框">浏览…</button>
          </div></div>
        <div class="field"><label>库名（也是文件夹名）</label>
          <input id="create-name" placeholder="长夜" value="${esc(create.name)}"></div>
      </div>
      ${full ? `<div class="path-preview">将创建：${esc(full)}</div>` : ''}
    </div>
    <div class="step">
      <h3><span class="no">2</span>主模块（决定骨架形态）</h3>
      <div class="big-opts">${primaryCards}</div>
      <p class="sub">当前可选小说与剧本两种主载体。</p>
    </div>
    <div class="step">
      <h3><span class="no">3</span>作品简报（体裁＝一等约束）</h3>
      <p class="sub">体裁决定要哪些模块、写多长、Agent 用什么策略——建库后写进 <span class="hint">.openstory/brief.json</span>。</p>
      <div class="big-opts">${genreCards}</div>
      ${genreDetail}
    </div>
    ${flowError(create.error)}
    <div class="row">
      <button class="btn-primary" data-action="create-submit"${create.running ? ' disabled' : ''}>${create.running ? '创建中…' : '创建库'}</button>
    </div>`}
  </div>`
}

function renderFsBrowserModal() {
  const fb = state.fsBrowse
  if (!fb?.open) { return }
  const rows = fb.entries.map((item) => `<button class="fsb-row" data-action="fsb-go" data-path="${esc(item.path)}">
      <span class="fsb-ic">${item.kind === 'drive' ? '💽' : '📁'}</span>
      <span class="fsb-name">${esc(item.name)}</span>
    </button>`).join('')
  // OS-119：默认根与「上次选择」都做成一步可回的快捷入口（作者：不用每次都从头选）
  const shortcuts = []
  if (fb.defaultRoot && !fb.isDefaultRoot) shortcuts.push(`<button class="fsb-jump" data-action="fsb-jump" data-path="${esc(fb.defaultRoot)}" title="默认放在这里：建库大多落这个目录">⌂ 默认目录</button>`)
  if (fb.lastPicked && fb.lastPicked !== fb.path && fb.lastPicked !== fb.defaultRoot) shortcuts.push(`<button class="fsb-jump" data-action="fsb-jump" data-path="${esc(fb.lastPicked)}" title="上次选过的文件夹">↺ 上次选择</button>`)
  openModal(`<h3>选择文件夹</h3>
    ${fb.note ? `<p class="sub">${esc(fb.note)}</p>` : ''}
    <div class="fsb-path">
      <button class="btn-ghost" data-action="fsb-up"${fb.parent ? '' : ' disabled'} title="上一级">↑ 上一级</button>
      <span class="fsb-cur">${esc(fb.path || '（选择盘符）')}${fb.isDefaultRoot ? '<span class="fsb-tag">默认目录</span>' : ''}</span>
    </div>
    ${shortcuts.length ? `<div class="fsb-jumps">${shortcuts.join(String())}</div>` : ''}
    <div class="fsb-list">
      ${fb.loading ? '<p class="fsb-hint">读取中…</p>' : ''}
      ${fb.error ? `<p class="fsb-err">${esc(fb.error)}</p>` : ''}
      ${!fb.loading && !fb.error ? (rows || '<p class="fsb-hint">这里没有子文件夹</p>') : ''}
    </div>
    <div class="ded-image-ops">
      <button class="btn-ghost" data-action="fsb-close">取消</button>
      ${fb.path ? `<button class="btn-primary" data-action="fsb-pick">选这个文件夹</button>` : ''}
    </div>`)
}

function importHtml() {
  const impo = state.impo
  const options = state.libraries
    .map((library) => `<option value="${esc(library.path)}"${library.path === impo.root ? ' selected' : ''}>${esc(library.name)}${library.path === state.current?.path ? '（当前）' : ''}</option>`)
    .join('')
  return `<div class="lib-wrap">
    <div class="lib-head-row">
      <button class="btn-ghost" data-action="flow-back">← 库管理</button><span class="sp"></span>
    </div>
    <h1>导入稿件</h1>
    <p class="sub">源目录永远只读；识别出的稿件按类别落进目标库的标准目录，只新增不覆盖，认不出的原样跳过不猜。</p>
    ${flowError(impo.error)}
    <div class="step">
      <h3><span class="no">1</span>目标库</h3>
      ${options ? `<select class="select" id="import-root">${options}</select>` : '<span class="count">还没有库——先去 <button class="btn-ghost" data-action="flow-create">新建一个</button>。</span>'}
    </div>
    <div class="step">
      <h3><span class="no">2</span>源目录（只读）</h3>
      <div class="field">
                  <div class="input-with-btn">
            <input id="import-source" placeholder="D:\\旧稿\\长夜　（顶层目录名＝类别：正文/剧本/大纲/世界书/约束/构思/资料/日志）" value="${esc(impo.source)}">
            <button class="btn-ghost" data-action="pick-folder" data-target="import-source" title="弹出 Windows 文件夹选择框">浏览…</button>
          </div>
      </div>
      <div class="row">
        <button class="btn-primary" data-action="import-scan"${impo.running || !options ? ' disabled' : ''}>${impo.running ? '扫描中…' : '扫描预览'}</button>
        <span class="count">上限 400 个文件 / 单文件 2MB / 总量 32MB。</span>
      </div>
    </div>
    ${impo.plan ? planHtml(impo.plan) : ''}
    ${impo.report ? reportHtml(impo.report) : ''}
  </div>`
}

function planHtml(plan) {
  const items = Array.isArray(plan.items) ? plan.items : []
  const groups = new Map()
  for (const item of items) {
    if (!groups.has(item.decision)) groups.set(item.decision, [])
    groups.get(item.decision).push(item)
  }
  const groupHtml = [...groups.entries()].map(([decision, list]) => `
    <div class="plan-group">
      <h4>${esc(DECISION_LABELS[decision] ?? decision)}<span class="cnt">${list.length} 个文件</span></h4>
      <div class="plan-files">${list.slice(0, 40).map((item) => `<div>${esc(item.source)} → ${esc(item.target || '（归档）')}</div>`).join('')}${list.length > 40 ? `<div>…还有 ${list.length - 40} 个</div>` : ''}</div>
    </div>`).join('')
  const skipped = Array.isArray(plan.skipped) ? plan.skipped : []
  const warnings = Array.isArray(plan.warnings) ? plan.warnings : []
  return `<div class="step">
    <h3><span class="no">3</span>预览（计划模式，还没写盘）</h3>
    <div class="result-kv">
      <span><b>${plan.importable ?? items.length}</b> 可导入</span>
      <span><b>${plan.skippedCount ?? skipped.length}</b> 跳过</span>
      <span class="count">扫描 ${plan.scanned ?? '—'} 个文件 · ${plan.mode === 'plan' ? 'dryRun' : plan.mode}</span>
    </div>
    ${groupHtml || '<div class="count">没有可导入的文件。</div>'}
    ${skipped.length ? `<div class="plan-group"><h4>跳过<span class="cnt">${skipped.length}</span></h4><div class="plan-files">${skipped.slice(0, 30).map((item) => `<div>${esc(item.source || item.name || '?')} — ${esc(item.reason || '')}</div>`).join('')}</div></div>` : ''}
    ${warningsHtml(warnings)}
    <div class="row">
      <button class="btn-primary" data-action="import-run"${state.impo.running ? ' disabled' : ''}>${state.impo.running ? '导入中…' : '执行导入'}</button>
      <span class="count">核对上面的 target 再落盘；写不进的逐条记账，不中断其余文件。</span>
    </div>
  </div>`
}

function reportHtml(report) {
  const written = Array.isArray(report.written) ? report.written : []
  const failures = Array.isArray(report.writeFailures) ? report.writeFailures : []
  return `<div class="step">
    <h3><span class="no">✓</span>导入完成</h3>
    <div class="result-kv">
      <span><b>${report.createdCount ?? 0}</b> 新建</span>
      <span><b>${report.reusedCount ?? 0}</b> 同内容复用</span>
      <span class="${failures.length ? 'bad' : ''}"><b>${failures.length || (report.failedCount ?? 0)}</b> 失败</span>
      <span><b>${report.skippedCount ?? 0}</b> 跳过</span>
    </div>
    ${written.length ? `<div class="plan-group"><h4>落盘清单<span class="cnt">${written.length}</span></h4><div class="plan-files">${written.slice(0, 40).map((item) => `<div>${esc(item.target || item.source)}${item.reused ? '（同内容，未重写）' : ''}</div>`).join('')}</div></div>` : ''}
    ${failures.length ? `<div class="plan-group"><h4>写失败<span class="cnt">${failures.length}</span></h4><div class="plan-files">${failures.slice(0, 20).map((item) => `<div>${esc(item.target || item.source || '?')} — ${esc(item.reason || '')}</div>`).join('')}</div></div>` : ''}
    <div class="repair-actions">
      <button class="btn-primary" data-action="import-open" data-root="${esc(report.targetRoot ?? '')}">打开这个库</button>
      <button class="btn-ghost" data-action="import-again">再导一批</button>
    </div>
  </div>`
}

function repairHtml() {
  const repair = state.repair
  if (!repair) return needLibraryHtml()
  const verdict = repair.verdict
  let actions = ''
  if (verdict.action === 'create-here') {
    actions = `<div class="repair-actions"><button class="btn-primary" data-action="repair-create">在这里新建库</button></div>`
  } else if (verdict.action === 'import-here') {
    actions = `<div class="repair-actions">
        <button class="btn-primary" data-action="repair-import">导入这个文件夹</button>
        <button class="btn-ghost" data-action="repair-create">或者旁边建个新库存它</button>
      </div>
      <p class="sub" style="margin-top:10px">导入需要一个已登记的库当目标：先「在这里新建库」再导，或回「库管理」选别的目标。</p>`
  } else if (verdict.action === 'pick-primary') {
    actions = `<div class="big-opts" style="margin-top:12px">
        ${PRIMARY_CHOICES.map((choice) => `<button class="big-opt" data-action="repair-primary" data-id="${esc(choice.id)}"><b>${esc(choice.title)}</b><span>${esc(choice.detail)}</span></button>`).join('')}
      </div>
      <p class="sub" style="margin-top:10px">选完连骨架一起落盘（依赖闭包装不齐会拒绝）。当前可选小说与剧本两种主载体。</p>`
  }
  return `<div class="repair-card">
    <h2>${esc(verdict.title)}</h2>
    <p class="detail">${esc(verdict.detail)}</p>
    <p class="path">${esc(repair.path)}</p>
    ${errorHtml()}
    ${actions}
    ${verdict.action ? '' : '<p class="sub">这个形态 OpenStory 修不了：请按下面的技术详情检查库文件。</p>'}
    <div class="raw-detail">形态：${esc(JSON.stringify(repair.shape))}</div>
    <div class="repair-actions"><button class="btn-ghost" data-action="flow-back">← 库管理</button></div>
  </div>`
}

  return { DECISION_LABELS, PRIMARY_CHOICES, flowError, joinDir, createHtml, renderFsBrowserModal, importHtml, planHtml, reportHtml, repairHtml }
}
