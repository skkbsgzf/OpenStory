/** C6：从 public/app.js 逐字迁出的settingsViews渲染面。副作用仍由 app.js 持有。 */
const escHtml = (value) => String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')

/**
 * OS-204：设置页导航的唯一真源——两大域七项。纯数据，供 Node 测试直接导入。
 * 具名导出；app.js 不再持有 SETTINGS_GROUPS/SETTINGS_SECTIONS。
 */
export const SETTINGS_NAV = Object.freeze([
  Object.freeze({
    id: 'app', label: '本体设置', hint: '软件自己的外观、模型与行为',
    sections: Object.freeze([
      Object.freeze({ id: 'appearance', label: '外观', hint: '皮肤主题与字号档位' }),
      Object.freeze({ id: 'engines', label: '引擎与存储', hint: 'Agent 运行时 / 模型 / 知识库 / 路径' }),
      Object.freeze({ id: 'about', label: '关于', hint: '版本与定位' })
    ])
  }),
  Object.freeze({
    id: 'plugins', label: '插件中心', hint: '治理、面板与货架',
    sections: Object.freeze([
      Object.freeze({ id: 'governance', label: '插件治理台', hint: '能力图 · 启停 · 依赖 · 设置指路' }),
      Object.freeze({ id: 'panels', label: '面板', hint: '左右栏面板插拔' }),
      Object.freeze({ id: 'suites', label: '全部套件', hint: '技能包 / 文风包 / 体裁包 …' }),
      Object.freeze({ id: 'localModules', label: '本机模块', hint: '模块根登记 · 预览 · 摘要' })
    ])
  })
])

/** OS-204：旧分区 id → 正名分区。深链兼容只写这一处。 */
export const SETTINGS_REDIRECT = Object.freeze({
  moduleSettings: 'governance',
  pluginsOverview: 'suites', plugins: 'suites', suite: 'suites', suiteSettings: 'suites', suiteDetail: 'suites',
  typography: 'appearance',
  models: 'engines', kb: 'engines', data: 'engines', runtimes: 'engines', runtime: 'engines', discover: 'engines'
})

/** OS-204：取表函数——治理台跳转标签与测试都从这一份拿，不另抄名单。 */
export function settingsNavLabel(id) {
  for (const group of SETTINGS_NAV) {
    const section = group.sections.find((item) => item.id === id)
    if (section) return section.label
  }
  return ''
}

/**
 * OS-203a：设置区卡片三态纯函数。数据源只有 /api/plugins 的 payload.modules，
 * 不读 ui-state 影子字段、也不依赖治理台视图是否已加载；文案由 missingText 注入。
 */
export function settingsCardState(payload, id, missingText = null) {
  const modules = Array.isArray(payload?.modules) ? payload.modules : []
  const entry = modules.find((item) => item && typeof item === 'object' && item.id === id) ?? null
  const status = entry?.status === 'degraded' || entry?.status === 'disabled' ? entry.status : 'loaded'
  const name = String(entry?.name || id || '')
  const missing = Array.isArray(entry?.missing) ? entry.missing : []
  const rawRequires = Array.isArray(entry?.requires) ? entry.requires : []
  // 供给方友好名也从同一份 payload.modules 取——不回治理台卡片，不另抄一份名字表。
  const nameById = new Map(modules.filter((item) => item && typeof item === 'object' && item.id).map((item) => [item.id, String(item.name || item.id)]))
  const requires = rawRequires.map((req) => {
    if (!req || typeof req !== 'object') return req
    const provider = String(req.provider || '')
    const providerName = String(req.providerName || (provider === 'base' ? '底座' : (nameById.get(provider) || provider)))
    return { ...req, providerName }
  })
  const degraded = status === 'degraded'
  const why = degraded
    ? (typeof missingText === 'function'
      ? String(missingText(missing, requires) || '')
      : `缺少所需能力：${missing.map((item) => escHtml((item && item.capability) || item)).join('、')}`)
    : ''
  const notice = degraded
    ? `<div class="cfg-note is-degraded" data-degraded="1" data-module="${escHtml(id)}" title="${escHtml(why)}"><b>${escHtml(name)} · 暂不可用</b>：${escHtml(why)} 到「插件治理台」恢复供给，或到「引擎与存储」核对配置。<button type="button" class="uikit-btn uikit-btn-ghost" data-settings-section="governance">去插件治理台 →</button></div>`
    : ''
  return { id, name, status, degraded, missing, requires, why, notice }
}

export function createSettingsViews(scope) {
  const { state, agent, esc, text, uiKit, runtimeShelf, moduleOn, hiddenModules, WORKBENCH_MODULES, scriptPrefs, dirWork, castColorOf, settingsScriptSectionHtml, settingRuntimeKind, probeBadgeLabel, comfyNodeMapText, typographyState, docPrefSlidersHtml, syncPolicy, syncProblemsFrom, warningsHtml, uiMemory, settingsAggregation, suitesSectionHtml, pluginsOverviewHtml, errorHtml, api, render, loadPlugins, governanceHtml, missingText } = scope

  // OS-203a：降级判定直接取 state.plugins.modules（经纯函数），不再绕治理台卡片或 ui-state。
  function degradedNoticeHtml(id) {
    return settingsCardState(state.plugins, id, missingText).notice
  }
  function degradedCardHtml(id, healthy) {
    return degradedNoticeHtml(id) || healthy
  }

  // OS-196：本机模块区的临时视图态只在内存里；登记状态一律在 daemon 的机器级信任表。
  let localPath = ''
  let localBrowse = null
  let localPreview = null
  let localNotice = ''

// OS-204：面板节——8 个左右栏面板的开关从套件详情迁出，独立成节；仍写库内 ui-state moduleHidden。
function settingsModulesSectionHtml() {
  const hidden = hiddenModules()
  const owned = WORKBENCH_MODULES
  if (!owned.length) return ''
  const groups = ['左栏', '右栏']
  const rows = groups.map((slot) => {
    const items = owned.filter((mod) => mod.slot === slot)
    if (!items.length) return ''
    return `<div class="step"><h3>${esc(slot)}</h3>
      <div class="mod-list">${items.map((mod) => {
        const on = !hidden.has(mod.id)
        return `<div class="mod-row">
          <label class="mod-main">
            <input type="checkbox" data-action="module-toggle" data-module-id="${esc(mod.id)}"${on ? ' checked' : ''}>
            <span><b>${esc(mod.label)}</b><i>${esc(mod.hint)}</i></span>
          </label>
        </div>`
      }).join('')}</div>
      <p class="sub">${slot === '左栏' ? '三个都关掉，左栏整体收起来，正文更宽。' : '关掉的模块不再出现在分析面板里，其余照常。'}</p>
    </div>`
  }).join('')
  return `${rows}<div class="step"><h3>当前库</h3><p class="sub">${state.current ? esc(state.current.name) : '还没选库'}——模块开关按库分别记，换库不串。</p></div>`
}

// OS-204：帮助文案只按七项正名索引；旧分区 id 经 SETTINGS_REDIRECT 收敛后共用同一份。
const SETTINGS_HELP = Object.freeze({
  appearance: '皮肤只管配色与明暗，字号分两轨：界面字号影响按钮、表单、卡片、标签与表格，正文字号只管阅读纸面。档位是项目级的，存在当前库的 .openstory/ui-state.json——换机器、清缓存也保持一致。',
  engines: '这里配四样东西：对话模型（Agent 平时用的那条通道）、生图、识图、以及 Agent 的默认档。填完可以先点「测试连接」——它会真的发一个最小请求试连，没保存的值也能测。生图的测试会真生成一张小图、消耗额度，所以会先问你一次。知识库给 Agent 供弹药（技法、文风、题材、读者信号、同型案例），这里只看连接是否健康。你的稿子始终是磁盘上的文件夹，不另建数据库；下面是各项配置存在哪儿——都只在这台机器上。',
  about: 'OpenStory 是给写小说用的本地工作台。稿件、草稿、会话与密钥都只留在本机，所有修改都有备份与日志，不上传也不联网同步。版本号取自 daemon 的 /api/health，取不到就显示「未知」。',
  governance: '插件治理台逐件管 21 件模块：供给、依赖逐条（带谁供给与最低版本）、谁依赖我、设置指路、停用影响都在卡片里。内核件与宿主组合面只读，工作台停用先出确认条、库内数据保留；没开库时开关置灰。能力、依赖与状态全部来自 /api/plugins 投影，不在界面另存名单。',
  panels: '左右栏的面板可以随时插拔：关掉的模块不再出现在左栏或分析面板里，其余照常；左栏三个都关掉，左栏整体收起来，正文更宽。开关写进库内 ui-state 的 moduleHidden，按库分别记，换库不串。',
  suites: '插件分成两类：一类给写作能力（比如写作套件、编剧套件），一类给 Agent 一条能对话的模型通道，都可以随时启用或停用。往本机货架目录丢一个目录或 JSON 文件，刷新就出现在列表里；同名时你本机那份优先，坏文件只跳过它。停用一个套件，规则退回内置默认，填过的值不会丢。',
  localModules: '本机模块是可以给 daemon 增加能力/工作台/端点的可执行代码——和 daemon 同进程、同权限。这里没有「扫描任意目录」：只有你亲自选定并确认过的模块根才会被读取。先预览清单，确认后才生效；移除即回到内置层。套件仍然只许放数据，不放可执行代码。'
})

const RUNTIME_STATUS_LABEL = {
  ready: '就绪', idle: '待拉起', running: '运行中', unconfigured: '未配置', missing: '不可用'
}

function runtimeCard(runtime) {
  const on = runtime.id === agent.runtime
  const status = RUNTIME_STATUS_LABEL[runtime.status] ?? runtime.status ?? ''
  const probe = runtime.probe ?? null
  const probeNote = probe?.version ? ` · ${esc(probe.version)}` : probe?.message ? ` · ${esc(probe.message)}` : ''
  const canFix = runtime.status === 'missing' && runtime.kind === 'dsh'
  const desc = text(runtime.description).trim()
  return `<div class="big-opt${on ? ' on' : ''}${runtime.status === 'missing' ? ' is-missing' : ''}" data-runtime-id="${esc(runtime.id)}" title="${esc(desc)}">
    <b>${esc(runtime.name)}<span class="src">${esc(runtime.source)}</span><span class="rt-status ${esc(runtime.status || '')}">${esc(status)}</span></b>
    <span class="one-line">${esc(desc)}${probeNote}</span>
    ${canFix ? `<div class="rt-fix" data-action="runtime-setup" data-id="${esc(runtime.id)}">修复</div>` : ''}
  </div>`
}

function settingsRuntimeSectionHtml() {
  const runtimeCards = (runtimeShelf()?.RUNTIME_SHELF_GROUPS ?? []).map((group) => {
    const items = runtimeShelf()?.runtimeKitsByCategory(agent.runtimeList, group.key) ?? []
    if (items.length === 0) return ''
    return `<div class="runtime-group"><div class="runtime-group-head">${esc(group.label)}</div><div class="big-opts">${items.map(runtimeCard).join('')}</div></div>`
  }).join('')
  return `<div class="step">
    <h3>Agent 运行时</h3>
    <div class="big-opts">${runtimeCards}</div>
    <div class="field" style="margin-top:14px"><label>Pi 兜底端点</label>
      <input id="cfg-endpoint" placeholder="https://api.deepseek.com/v1/chat/completions" value="${esc(agent.endpoint)}">
    </div>
    <div class="field"><label>模型</label>
      <input id="cfg-model" placeholder="deepseek-chat" value="${esc(agent.model)}">
    </div>
    <div class="field"><label>API Key${agent.apiKeyMasked ? `（已设置 ${esc(agent.apiKeyMasked)}）` : ''}</label>
      <input id="cfg-key" type="password" placeholder="${agent.apiKeyMasked ? '留空保留原 key' : 'sk-…'}">
    </div>
    ${dshDepthFieldHtml()}
    <div class="field">
      <!-- OS-100：原来 inline flex + width:auto 覆盖了统一样式，导致标签竖排、勾选框悬空 -->
      <label class="cfg-switch">
        <input type="checkbox" id="cfg-chinese-reasoning"${agent.chineseReasoning !== false ? ' checked' : ''}>
        <span>用中文推理（推荐）</span>
      </label>
      <p class="field-note">
        中文写作讨论用中文思考更贴题，术语和语感不容易在翻译里走样。<br>
        代价是可能损失一部分推理性能——复杂的形式化推理用英文通常更稳。<br>
        关掉后模型用默认语言思考，回复本身仍然是中文。
      </p>
    </div>
    <div class="err" id="settings-err"></div>
    <div class="ops">
      <button class="btn-primary" data-action="agent-config-save">保存</button>
    </div>
  </div>`
}

function dshDepthFieldHtml() {
  const options = agent.dshReasoningOptions || []
  if (!options.length) return ''
  const current = text(agent.reasoningEffort)
  const rows = [
    `<option value=""${current ? '' : ' selected'}>默认（用 DSH 自己的档）</option>`,
    ...options.map((option) => `<option value="${esc(option.id)}"${option.id === current ? ' selected' : ''}>${esc(option.name)}${option.default ? '（DSH 默认）' : ''}</option>`)
  ].join('')
  return `<div class="field"><label>推理深度（仅 DSH）</label>
    <select class="select" id="cfg-reasoning">${rows}</select>
    <span class="count">想得更久＝答案更稳但更慢；留默认即可</span>
  </div>`
}

function cfgBadgeHtml(kind) {
  const probe = agent.probes[kind]
  const state = probe?.state ? ` ${probe.state}` : ''
  const label = probeBadgeLabel(probe)
  return `<span class="cfg-badge${state}" data-probe-badge="${esc(kind)}" title="${esc(label)}">${esc(label)}</span>`
}

function dshModelValue(model) {
  return model.provider ? `${model.provider}/${model.id}` : model.id
}

function dshModelOptionsHtml(current, emptyLabel) {
  const models = agent.dshModels || []
  const value = text(current)
  const rows = [`<option value=""${value ? '' : ' selected'}>${esc(emptyLabel)}</option>`]
  let known = false
  for (const model of models) {
    const id = dshModelValue(model)
    if (id === value) known = true
    rows.push(`<option value="${esc(id)}"${id === value ? ' selected' : ''}>${esc(model.name)}${model.providerName ? `（${esc(model.providerName)}）` : ''}</option>`)
  }
  if (value && !known) rows.push(`<option value="${esc(value)}" selected>${esc(value)}（当前值，不在清单里）</option>`)
  return rows.join('')
}

function dshModelFieldHtml(id, label, current, emptyLabel) {
  const models = agent.dshModels || []
  if (!models.length) {
    return `<div class="field"><label>${esc(label)}</label>
      <select class="select" id="${esc(id)}">${dshModelOptionsHtml(current, emptyLabel)}</select>
      <span class="cfg-note">DSH 模型清单没取到（DSH 没装或 profile 没就绪）——先在「插件 · 运行时」里修好，这里才能选。</span>
    </div>`
  }
  return `<div class="field"><label>${esc(label)}</label>
    <select class="select" id="${esc(id)}">${dshModelOptionsHtml(current, emptyLabel)}</select>
  </div>`
}

function settingsModelsSectionHtml() {
  const config = agent.config
  if (!config) {
    return `<div class="step"><h3>模型</h3><p class="sub">配置还没读到——确认 daemon 在跑，再回到设置重进这一节。</p></div>`
  }
  const runtime = text(agent.runtime)
  const isDsh = settingRuntimeKind(runtime) === 'dsh'
  const textBlock = config.text ?? {}
  const image = config.image ?? {}
  const vision = config.vision ?? {}
  const agentBlock = config.agent ?? {}

  const runtimeOptions = [
    `<option value=""${runtime ? '' : ' selected'}>Pi（默认兜底）</option>`,
    ...(runtimeShelf()?.selectableRuntimeKits(agent.runtimeList) ?? []).map((item) => `<option value="${esc(item.id)}"${item.id === runtime ? ' selected' : ''}>${esc(item.name)}${item.source ? `（${esc(item.source)}）` : ''}</option>`)
  ].join('')

  const runtimeKind = settingRuntimeKind(runtime)
  const activeKit = (agent.runtimeList || []).find((item) => item.id === runtime)
  const kitModels = Array.isArray(activeKit?.models) ? activeKit.models : []
  // OS-74：三种运行时三种表单——DSH（模型从 /models 选）/ CLI（模型从 kit.models 选，凭据走 CLI 自己）/ Pi（直连端点）
  const textFields = isDsh
    ? `${dshModelFieldHtml('mcfg-text-model', '主模型（对话）', textBlock.model, '用运行时自己的默认模型')}
       ${dshModelFieldHtml('mcfg-subagent-model-a', '子 agent 模型', agentBlock.subagentModel, '跟主模型一样')}
       ${dshDepthFieldHtml()}
       <div class="field">
         <label class="cfg-switch">
           <input type="checkbox" id="mcfg-chinese"${agent.chineseReasoning !== false ? ' checked' : ''}>
           <span>用中文推理（推荐）</span>
         </label>
         <span class="cfg-note">中文写作讨论用中文思考更贴题，代价是可能损失一部分形式化推理性能。</span>
       </div>`
    : runtimeKind === 'cli'
      ? `<div class="field"><label>模型（走 ${esc(activeKit?.name || 'CLI')} 自己的模型清单）</label>
           <select class="select" id="mcfg-cli-model">
             <option value=""${textBlock.model ? '' : ' selected'}>用 kit 缺省（${esc(activeKit?.defaultModel || '未声明')}）</option>
             ${kitModels.map((m) => `<option value="${esc(m)}"${textBlock.model === m ? ' selected' : ''}>${esc(m)}</option>`).join('')}
           </select>
           <span class="cfg-note">CLI 用自己登录的凭据；本仓不存 key、不直连 LLM API——跑动记录因此一致。</span>
         </div>
         <div class="field"><label>子 agent 模型（可选）</label>
           <select class="select" id="mcfg-cli-subagent-model">
             <option value=""${agentBlock.subagentModel ? '' : ' selected'}>跟主模型一样</option>
             ${kitModels.map((m) => `<option value="${esc(m)}"${agentBlock.subagentModel === m ? ' selected' : ''}>${esc(m)}</option>`).join('')}
           </select>
         </div>`
      : `<div class="field"><label>Endpoint（OpenAI 兼容 chat/completions）</label>
         <input id="mcfg-endpoint" placeholder="https://api.deepseek.com/v1/chat/completions" value="${esc(text(textBlock.endpoint))}">
       </div>
       <div class="field"><label>模型</label>
         <input id="mcfg-model" placeholder="deepseek-chat" value="${esc(text(textBlock.model))}">
       </div>
       <div class="field"><label>API Key${textBlock.apiKeyMasked ? `（已设置 ${esc(textBlock.apiKeyMasked)}）` : ''}</label>
         <input id="mcfg-key" type="password" placeholder="${textBlock.apiKeyMasked ? '留空保留原 key' : 'sk-…'}">
       </div>`

  return `
    <div class="cfg-card" data-cfg-card="text">
      <div class="cfg-head"><h3>对话模型</h3>${cfgBadgeHtml('text')}</div>
      <div class="field"><label>运行时</label>
        <select class="select" id="mcfg-runtime">${runtimeOptions}</select>
        <span class="cfg-note">运行时决定 Agent 走哪条通道；选 DSH 时下面改选模型，选 Pi 时直连端点。</span>
      </div>
      ${textFields}
      <div class="row">
        <button class="btn-primary" data-action="config-save" data-block="text">保存</button>
        <button class="btn-ghost" data-action="config-probe" data-probe-kind="text">测试连接</button>
        <span class="cfg-note" id="mcfg-text-note"></span>
      </div>
      ${isDsh ? '<span class="cfg-note">测试连接测的是 Pi 兜底端点；DSH 自身的连通性看「插件 · 运行时」的状态灯。</span>' : ''}
      <div class="err" id="mcfg-text-err"></div>
    </div>

    ${degradedCardHtml('imagegen', `
    <div class="cfg-card" data-cfg-card="image"${moduleOn('imagegen') ? '' : ' hidden'}>
      <div class="cfg-head"><h3>生图</h3>${cfgBadgeHtml('image')}</div>
      <div class="field">
        <label class="cfg-switch">
          <input type="checkbox" id="mcfg-image-enabled"${image.enabled === true ? ' checked' : ''}>
          <span>启用生图（扮演/世界书生成场景图时会用到）</span>
        </label>
      </div>
      <div class="field"><label>后端</label>
        <select class="select" id="mcfg-image-backend">
          <option value="openai"${(image.backend ?? 'openai') !== 'comfyui' ? ' selected' : ''}>OpenAI 兼容 API（云端）</option>
          <option value="comfyui"${image.backend === 'comfyui' ? ' selected' : ''}>ComfyUI（本机）</option>
        </select>
        <span class="cfg-note">OpenAI 兼容：填 endpoint＋模型＋key，一次请求直接出图。ComfyUI：填本地端口＋工作流 JSON，走提交→轮询→取图。</span>
      </div>
      <div class="cfg-sub" id="mcfg-image-openai"${image.backend === 'comfyui' ? ' hidden' : ''}>
        <div class="field"><label>Endpoint（OpenAI 兼容，填到 /v1 为止）</label>
          <input id="mcfg-image-endpoint" placeholder="https://api.openai.com/v1" value="${esc(text(image.endpoint))}">
        </div>
        <div class="field"><label>模型</label>
          <input id="mcfg-image-model" placeholder="gpt-image-1" value="${esc(text(image.model))}">
        </div>
        <div class="field"><label>API Key${image.apiKeyMasked ? `（已设置 ${esc(image.apiKeyMasked)}）` : ''}</label>
          <input id="mcfg-image-key" type="password" placeholder="${image.apiKeyMasked ? '留空保留原 key' : 'sk-…'}">
        </div>
      </div>
      <div class="cfg-sub" id="mcfg-image-comfy"${image.backend === 'comfyui' ? '' : ' hidden'}>
        <div class="field"><label>ComfyUI 地址（端口）</label>
          <input id="mcfg-comfy-url" placeholder="http://127.0.0.1:8188" value="${esc(text(image.comfyUrl))}">
          <span class="cfg-note">ComfyUI 默认 8188；启动后浏览器打开同地址可确认。</span>
        </div>
        <div class="field"><label>工作流 JSON（API 格式导出的那份）</label>
          <div class="input-with-btn"><input id="mcfg-comfy-workflow" placeholder="世界书/素材/comfy/scene.json 或绝对路径" value="${esc(text(image.comfyWorkflow))}"><button class="btn-ghost" data-action="pick-file" data-target="mcfg-comfy-workflow" data-mode="full" data-filter="JSON 工作流 (*.json)|*.json|所有文件 (*.*)|*.*" title="选择 ComfyUI 工作流 JSON 文件">浏览…</button></div>
          <span class="cfg-note">在 ComfyUI 里用「Save (API Format)」导出。相对路径按库根解析。</span>
        </div>
        <div class="field"><label>节点映射（可选，逗号分隔 key:节点id）</label>
          <input id="mcfg-comfy-nodemap" placeholder="positive:6,negative:7,seed:3" value="${esc(comfyNodeMapText(image.comfyNodeMap))}">
          <span class="cfg-note">留空＝按节点标题自动猜（Positive/Negative/KSampler/EmptyLatentImage）。</span>
        </div>
      </div>
      <div class="row">
        <button class="btn-primary" data-action="config-save" data-block="image">保存</button>
        <button class="btn-ghost" data-action="config-probe" data-probe-kind="image">测试连接</button>
        <span class="cfg-note" id="mcfg-image-note"></span>
      </div>
      <span class="cfg-note">测试会真生成一张 256×256 的小图（消耗额度），点按钮后还会再确认一次。</span>
      <div class="err" id="mcfg-image-err"></div>
    </div>`)}

    ${degradedCardHtml('imagegen', `
    <div class="cfg-card" data-cfg-card="vision"${moduleOn('imagegen') ? '' : ' hidden'}>
      <div class="cfg-head"><h3>识图</h3>${cfgBadgeHtml('vision')}</div>
      <div class="field">
        <label class="cfg-switch">
          <input type="checkbox" id="mcfg-vision-enabled"${vision.enabled === true ? ' checked' : ''}>
          <span>启用识图（派 DSH 子 agent 读图写白描）</span>
        </label>
      </div>
      <div class="field"><label>识图模型（从 DSH 模型清单选）</label>
        <select class="select" id="mcfg-vision-model">
          <option value=""${text(vision.model) ? '' : ' selected'}>用 DSH 默认模型</option>
          ${(agent.dshModels || []).map((m) => `<option value="${esc(m.provider + '/' + m.id)}"${text(vision.model) === m.provider + '/' + m.id ? ' selected' : ''}>${esc(m.providerName + ' / ' + m.name)}</option>`).join('')}
        </select>
        <span class="cfg-note">走 DSH 子 agent + 内置 read_image 工具，不引入额外模型、不直连 LLM API。跑动记录与 DSH 会话一致。</span>
      </div>
      <div class="field"><label>DSH profile（留空＝默认 openstory）</label>
        <input id="mcfg-vision-profile" placeholder="openstory" value="${esc(text(vision.profile))}">
      </div>
      <div class="row">
        <button class="btn-primary" data-action="config-save" data-block="vision">保存</button>
        <span class="cfg-note">识图没有独立探测——随手生一张设定图后点「看这张图写白描」就能验。</span>
      </div>
      <div class="err" id="mcfg-vision-err"></div>
    </div>`)}

    <div class="cfg-card" data-cfg-card="agent">
      <div class="cfg-head"><h3>Agent 默认档</h3></div>
      ${dshModelFieldHtml('mcfg-default-model', 'OpenStory 默认模型（对话模型留空时用它）', agentBlock.defaultModel, '不指定')}
      ${dshModelFieldHtml('mcfg-subagent-model', '默认子 agent 模型', agentBlock.subagentModel, '跟主模型一样')}
      <div class="field"><label>Profile 名（可选）</label>
        <input id="mcfg-profile" placeholder="openstory" value="${esc(text(agentBlock.profile))}">
        <span class="cfg-note">DSH 的 profile 名；留空＝用 DSH 自己的默认 profile。</span>
      </div>
      <div class="row">
        <button class="btn-primary" data-action="config-save" data-block="agent">保存</button>
        <span class="cfg-note" id="mcfg-agent-note"></span>
      </div>
      <div class="err" id="mcfg-agent-err"></div>
    </div>`
}

function skinCardsHtml() {
  const styleCards = state.styles.map((pack) => `
    <button class="big-opt${pack.id === state.skin ? ' on' : ''}" data-skin="${esc(pack.id)}">
      <b>${esc(pack.name)}<span class="src">${esc(pack.source)}</span></b>
      <span>${esc(pack.description || '')}</span>
    </button>`).join('')
  return `<div class="big-opts">${styleCards || '<span class="count">风格包清单读不到，先用内置珊瑚兜底。</span>'}</div>`
}

function settingsAppearanceSectionHtml() {
  return `<div class="step"><h3>风格包</h3>${skinCardsHtml()}</div>`
}

function settingsTypographySectionHtml() {
  const st = typographyState()
  const uiOptions = [
    { id: 'compact', label: '紧凑', hint: '0.92× · 信息密度优先' },
    { id: 'comfortable', label: '标准', hint: '1.0× · 默认' },
    { id: 'large', label: '大', hint: '1.08× · 长时间看屏' },
    { id: 'xlarge', label: '特大', hint: '1.18× · 高分屏/远距' }
  ]
  const docOptions = [
    { id: 's', label: '小', hint: '15px' },
    { id: 'm', label: '中', hint: '17px · 默认' },
    { id: 'l', label: '大', hint: '19px' },
    { id: 'xl', label: '特大', hint: '21px' },
    { id: '2xl', label: '巨', hint: '24px' }
  ]
  const uiCards = uiOptions.map((opt) => `
    <button class="big-opt${st.ui === opt.id ? ' on' : ''}" data-action="typo-ui" data-typo-ui="${esc(opt.id)}">
      <b>${esc(opt.label)}</b><span>${esc(opt.hint)}</span>
    </button>`).join('')
  const docCards = docOptions.map((opt) => `
    <button class="big-opt${st.doc === opt.id ? ' on' : ''}" data-action="typo-doc" data-typo-doc="${esc(opt.id)}">
      <b>${esc(opt.label)}</b><span>${esc(opt.hint)}</span>
    </button>`).join('')
  return `
    <div class="step">
      <h3>界面字号<span class="sub">影响按钮、表单、卡片、标签、表格等所有功能元素</span></h3>
      <p class="sub">改完立刻生效并写进本库——换机器、清缓存后重新打开也保持一致（存在 .openstory/ui-state.json）。</p>
      <div class="big-opts">${uiCards}</div>
      <div class="typo-preview">
        <div class="typo-preview-head">预览</div>
        <button class="btn-primary" type="button">主要按钮</button>
        <button class="btn-ghost" type="button">次要按钮</button>
        <span class="chip">标签</span>
        <input class="text" placeholder="输入框示例" style="max-width:200px">
        <div class="typo-preview-row"><b>卡片标题</b><span class="count">副标说明</span></div>
      </div>
    </div>

    <div class="step">
      <h3>正文字号<span class="sub">只影响正文纸面（阅读/写作），不动界面元素</span></h3>
      <p class="sub">正文用衬线体与独立行高，与界面字号分轨——调大界面不会把正文撑爆，反之亦然。</p>
      <div class="big-opts">${docCards}</div>
      <div class="typo-preview typo-preview-doc">
        <div class="typo-preview-head">正文预览</div>
        <p class="doc-paper-sample" style="max-width:none;margin:0">话说大宋仁宗天子在位，嘉祐三年三月三日五更三点，天子驾坐紫宸殿，受百官朝贺。</p>
      </div>
    </div>

    <div class="step">
      <h3>复位</h3>
      <div class="ops">
        <button class="btn-ghost" data-action="typo-reset">恢复默认（标准 + 中号正文）</button>
        <span class="count">档位是项目级的：同一台机器上不同的库可以各自不同</span>
      </div>
    </div>`
}

function settingsWritingSectionHtml() {
  return `<div class="step">
    <h3>正文排版</h3>
    ${docPrefSlidersHtml()}
  </div>`
}

function settingsDiscoverSectionHtml() {
  const shelves = [
    { label: '业务套件', dir: '%LOCALAPPDATA%\\OpenStory\\openstory\\suites' },
    { label: 'Agent 运行时', dir: '%LOCALAPPDATA%\\OpenStory\\openstory\\runtimes' },
    { label: '风格包', dir: '%LOCALAPPDATA%\\OpenStory\\openstory\\styles' }
  ]
  const rows = shelves.map((shelf) => `<div class="discover-row"><div><b>${esc(shelf.label)}</b></div><div class="hint">${esc(shelf.dir)}</div></div>`).join('')
  return `<div class="step"><h3>插件货架</h3>${rows}</div>
    <div class="step"><h3>库与稿件</h3>
    <div class="row"><button class="btn-ghost" data-action="flow-create">＋新建库</button><button class="btn-ghost" data-action="flow-import">导入稿件</button></div></div>`
}

function settingsCombinedDataSectionHtml() {
  return `<div class="step">
    <h3>货架路径<span class="sub">丢文件即上新，本机目录覆盖内置</span></h3>
    <div class="kv-line"><span class="k">业务套件</span><span class="v">%LOCALAPPDATA%\OpenStory\openstory\suites</span></div>
    <div class="kv-line"><span class="k">Agent 运行时</span><span class="v">%LOCALAPPDATA%\OpenStory\openstory\runtimes</span></div>
    <div class="kv-line"><span class="k">风格包</span><span class="v">%LOCALAPPDATA%\OpenStory\openstory\styles</span></div>
  </div>
  <div class="step">
    <h3>库与稿件</h3>
    <div class="ops">
      <button class="btn-primary" data-action="flow-create">＋ 新建库</button>
      <button class="btn-ghost" data-action="flow-import">导入稿件</button>
    </div>
  </div>
  ${settingsSyncSectionHtml()}
  ${settingsDataSectionHtml().replace(/^<div class="step">\s*<h3>本机路径<\/h3>/, '<div class="step"><h3>本机路径</h3>')}`
}

function settingsSyncSectionHtml() {
  const p = syncPolicy()
  const seg = (group, value, current, label) => `<button class="seg-btn${current === value ? ' on' : ''}" data-action="sync-policy-${group}" data-value="${esc(value)}">${esc(label)}</button>`
  const data = state.sync?.data
  const problems = syncProblemsFrom(data)
  const dot = !data ? 'idle' : (problems.length ? 'warn' : 'ok')
  const statusText = !data
    ? '还没检查过'
    : (problems.length ? problems[0].label : '一致')
  return `<div class="sync-set">
    <div class="sync-set-row">
      <span class="sync-set-label">检查</span>
      <span class="seg">${seg('checkon', 'enter', p.checkOn, '进页面')}${seg('checkon', 'manual', p.checkOn, '手动')}</span>
      <span class="sync-set-label">不同步时</span>
      <span class="seg">${seg('action', 'remind', p.action, '提醒')}${seg('action', 'auto', p.action, '自动同步')}${seg('action', 'silent', p.action, '不打扰')}</span>
    </div>
    <div class="sync-set-status-row">
      <span class="sync-dot ${dot}"></span>
      <span class="sync-set-status-text">${esc(statusText)}</span>
      <button class="sync-mini" data-action="sync-recheck" title="重新检查一次">↻</button>
    </div>
  </div>`
}

function settingsDataSectionHtml() {
  const paths = [
    { label: '库清单', path: state.preferencesPath || '%LOCALAPPDATA%\\OpenStory\\libraries.json' },
    { label: 'Agent 配置', path: agent.configPath || '%LOCALAPPDATA%\\OpenStory\\openstory\\agent-config.json' },
    { label: '运行时套件货架', path: state.settings.userDir || '%LOCALAPPDATA%\\OpenStory\\openstory\\runtimes' },
    { label: '风格包货架', path: (state.stylesDirs || [])[0] || '%LOCALAPPDATA%\\OpenStory\\openstory\\styles' }
  ]
  return `<div class="step">
    <h3>本机路径</h3>
    ${paths.map((item) => `<div class="kv-line"><span class="k">${esc(item.label)}</span><button class="v kv-path" data-action="reveal-path" data-path="${esc(item.path)}" title="在资源管理器里打开">${esc(item.path)}</button></div>`).join(String())}
    ${warningsHtml(state.warnings)}
  </div>`
}

function settingsAboutSectionHtml() {
  // OS-204：版本号由 app.js 进设置页时取一次 /api/health 回填；取不到如实写「未知」。
  const version = text(state.appVersion).trim() || '未知'
  return `<div class="step">
    <h3>OpenStory</h3>
    <div class="kv-line"><span class="k">版本</span><span class="v">${esc(version)}</span></div>
  </div>`
}

/**
 * OS-233：本地 RAG 运行时取数（状态 + 安装前置检查）。纯取数、写回传入的 state 对象，
 * 由壳在进入设置页时调用一次；「重新检测」按钮会再调一次。
 */
async function loadKnowledgeRuntime(rt) {
  if (!rt || rt.loading) return
  rt.loading = true
  try {
    const [status, plan] = await Promise.all([
      api('/api/knowledge-runtime/status').catch(() => null),
      api('/api/knowledge-runtime/install-plan').catch(() => null)
    ])
    rt.status = status?.ok ? status : null
    rt.plan = plan?.ok ? plan : null
    rt.error = status || plan ? '' : '拿不到本地 RAG 运行时状态'
  } catch (error) {
    rt.error = text(error?.message || error)
  } finally { rt.loading = false }
}

/**
 * OS-233：本地 RAG 运行时（HyperGraphRAG）——机器级，一处装好所有库共用。
 * 状态 + 安装前置检查 + embedding 默认本地。安装不代跑（torch 约 2GB），
 * 给出可复制命令；embedding 用仓内 transformers.js，不另下模型权重。
 */
function settingsKnowledgeRuntimeSectionHtml() {
  const rt = state.knowledgeRuntime || {}
  // 首次渲染自取一次（懒加载）；「重新检测」按钮清掉 loaded 后同样会再取。
  if (!rt.loaded && !rt.loading) { rt.loaded = true; loadKnowledgeRuntime(rt).then(() => { if (state.view === 'settings') render() }) }

  const status = rt.status
  const plan = rt.plan
  const stateLabel = { ready: '已就绪', partial: '部分安装', missing: '未安装', broken: '状态异常' }[status?.state] || '未知'
  const bytes = (n) => {
    const v = Number(n) || 0
    if (!v) return '0 B'
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GB`
    if (v >= 1e6) return `${(v / 1e6).toFixed(0)} MB`
    return `${(v / 1e3).toFixed(0)} KB`
  }
  const missing = Array.isArray(status?.missing) ? status.missing : []
  const blockers = Array.isArray(plan?.blockers) ? plan.blockers : []
  const embed = status?.config?.embedding || { provider: 'local', model: 'Xenova/bge-small-zh-v1.5', endpoint: 'http://127.0.0.1:8808' }
  const rows = [
    `<div class="kv-line"><span class="k">运行状态</span><span class="v">${esc(stateLabel)}${status?.venvBytes ? ` · ${esc(bytes(status.venvBytes))}` : ''}</span></div>`,
    status?.python ? `<div class="kv-line"><span class="k">venv Python</span><span class="v">${esc(status.python)}</span></div>` : '',
    status?.venvDir ? `<div class="kv-line"><span class="k">安装位置</span><span class="v">${esc(status.venvDir)}</span></div>` : '',
    `<div class="kv-line"><span class="k">embedding</span><span class="v">${esc(embed.provider === 'local' ? `本地 ${embed.model}` : embed.provider || '未配')}</span></div>`
  ].filter(Boolean).join('')
  const missingHtml = missing.length
    ? `<div class="warn-box"><b>还缺</b>${missing.map((item) => `<div>${esc(item)}</div>`).join('')}</div>`
    : ''
  const planHtml = blockers.length
    ? `<div class="warn-box"><b>不能安装</b>${blockers.map((item) => `<div>${esc(item)}</div>`).join('')}</div>`
    : (plan
      ? `<p class="sub">依赖 ${plan.packageCount} 个包，约 ${bytes(plan.estimatedBytes)}。${esc(plan.note || '')}</p>
         ${plan.command ? `<div class="kv-line"><span class="k">安装命令</span><span class="v"><code>${esc(plan.command)}</code></span></div>` : ''}`
      : '')
  return `<div class="step">
    <h3>本地 RAG <span class="sub">语义检索运行时（HyperGraphRAG），装一次所有知识库共用；不装则只能用文档浏览</span></h3>
    ${rt.error ? `<div class="error-box">${esc(rt.error)}</div>` : ''}
    ${rows}
    ${missingHtml}
    ${planHtml}
    <p class="sub">embedding 默认走本机 transformers.js（bge-small-zh-v1.5 量化版，约 25MB，不联网下载大模型）。装好运行时后，知识库页的「同步索引」才会从灰变可用。</p>
    <div class="uikit-toolbar"><span class="uikit-toolbar-left"></span><span class="uikit-toolbar-right">
      <button type="button" class="uikit-btn uikit-btn-ghost" data-action="kb-runtime-refresh">重新检测</button>
    </span></div>
  </div>`
}

function settingsKbSectionHtml() {
  const s = state.kbStatus
  const cfg = state.kbConfig
  const lamp = (up) => up
    ? '<span class="knowledge-lamp is-up">●</span>在线'
    : '<span class="knowledge-lamp is-down">●</span>离线'

  if (!cfg) {
    return '<div class="step"><h3>知识库</h3><div class="loading">正在读取配置…</div></div>'
  }

  const collections = cfg.collections && typeof cfg.collections === 'object' ? cfg.collections : {}
  const collectionRows = Object.entries(collections).map(([alias, id]) => `
    <div class="knowledge-collection-row">
      <input class="uikit-input" data-knowledge-collection-alias value="${esc(alias)}" placeholder="别名" aria-label="分库别名">
      <input class="uikit-input" data-knowledge-collection-id value="${esc(id)}" placeholder="collection id" aria-label="分库 id">
      <button type="button" class="btn-ghost" data-action="knowledge-collection-remove" title="删除这一行">×</button>
    </div>`).join('')

  const live = s || {}
  const svc = live.services || {}
  const embed = svc.embedding || {}
  const liveRows = (live.collections || []).map((item) => {
    const docs = item.docs === null || item.docs === undefined ? '—' : String(item.docs)
    const parsed = item.parsed === null || item.parsed === undefined ? '—' : `${item.parsed}/${item.docs ?? '?'}`
    return `<div class="kv-line"><span class="k">${esc(item.alias)}</span><span class="v">文档 ${esc(docs)}｜已解析 ${esc(parsed)}</span></div>`
  }).join('')

  const statusBlock = !s
    ? '<div class="kv-line"><span class="k">状态</span><span class="v">读取中…</span></div>'
    : `<div class="kv-line"><span class="k">WeKnora</span><span class="v">${lamp(!!(svc.weknora && svc.weknora.up))}${svc.weknora && svc.weknora.version ? ' · v' + esc(svc.weknora.version) : ''}</span></div>
       <div class="kv-line"><span class="k">Embedding</span><span class="v">${lamp(!!embed.up)}${embed.up && embed.model ? ' · ' + esc(embed.model) : ''}</span></div>
       <div class="kv-line"><span class="k">最近检查</span><span class="v">${esc(s.lastCheck ? String(s.lastCheck).replace('T', ' ').slice(0, 19) : '—')}</span></div>
       ${liveRows ? '<div class="kv-line-sep"></div>' + liveRows : '<div class="kv-line"><span class="k">分库</span><span class="v">读不到（服务离线或分库为空）</span></div>'}
       ${s.configError ? '<div class="kv-line"><span class="k">读取问题</span><span class="v">' + esc(s.configError) + '</span></div>' : ''}`

  return `
    <div class="step">
      <h3>连接<span class="sub">WeKnora 本体（默认本机 8080）＋ 本地 embedding（8808）</span></h3>
      ${uiKit().field({
        label: '服务地址',
        hint: 'WeKnora 的 HTTP 入口，不带 /api 后缀',
        control: uiKit().textInput({ id: 'knowledge-base-url', value: cfg.baseUrl || 'http://127.0.0.1:8080', placeholder: 'http://127.0.0.1:8080' })
      })}
      ${uiKit().field({
        label: 'API Key',
        hint: cfg.apiKeyMasked ? '当前：' + cfg.apiKeyMasked + '（留空＝不改）' : '必填，WeKnora 的 X-API-Key',
        control: uiKit().textInput({ id: 'knowledge-api-key', value: '', placeholder: cfg.apiKeyMasked ? '留空则保留现有密钥' : 'sk-…' })
      })}
      ${uiKit().field({
        label: 'Space ID',
        hint: '可选；多空间部署时填',
        control: uiKit().textInput({ id: 'knowledge-space-id', value: cfg.spaceId || '', placeholder: '留空＝默认空间' })
      })}
    </div>

    <div class="step">
      <h3>分库映射<span class="sub">别名 → WeKnora collection id（六个库各管一类知识）</span></h3>
      <div class="knowledge-collections" id="knowledge-collections">
        ${collectionRows || '<p class="sub">还没有分库——点下面「＋ 添加分库」</p>'}
      </div>
      <div class="ops">
        <button class="btn-ghost" data-action="knowledge-collection-add">＋ 添加分库</button>
        <span class="count">别名决定检索时怎么选库</span>
      </div>
    </div>

    <div class="step">
      <h3>状态</h3>
      ${statusBlock}
      <div class="kv-line"><span class="k">配置文件</span><span class="v">${esc(cfg.configPath || '—')}</span></div>
    </div>

    <div class="ops knowledge-ops">
      <button class="btn-primary" data-action="knowledge-save">保存配置</button>
      <button class="btn-ghost" data-action="knowledge-test">测试连接</button>
      <span class="count" id="knowledge-msg">${esc(state.kbMsg || '')}</span>
    </div>`
}

function settingsCombinedAppearanceHtml() {
  // OS-98：皮肤与字号合成一节——作者口径「外观只放一个，字体和主题都是一件事」
  return `
    <div class="step">
      <h3>皮肤主题<span class="sub">亮/暗与配色基调，全局生效</span></h3>
      ${skinCardsHtml()}
    </div>
    ${settingsTypographySectionHtml()}`
}

function settingsCombinedEnginesHtml() {
  const section = (title, hint, body) => `
    <div class="step">
      <h3>${esc(title)}${hint ? `<span class="sub">${esc(hint)}</span>` : ''}</h3>
      ${body}
    </div>`
  // 各子节的内部 h3 去掉（外层已有标题）
  const strip = (html) => text(html)
    .replace(/^\s*<div class="step">\s*<h3>[^<]*(?:<span class="sub">.*?<\/span>)?[^<]*<\/h3>/, '<div>')
    .replace(/<div class="step">\s*<h3>[^<]*(?:<span class="sub">.*?<\/span>)?[^<]*<\/h3>/gu, '<div>')

  // OS-100：运行时不再单列——「对话模型」自带运行时选择器与端点/模型/key，
  // 两处都放会出现两个「运行时」下拉（作者实测截图里就是重复的）。
  // 这里的顺序＝「接什么 → 查什么 → 存哪」。
  return [
    section('对话模型与运行时', 'Agent 走哪条通道、用哪个模型', strip(settingsModelsSectionHtml())),
    ...(moduleOn('knowledge') ? [section('知识库', 'WeKnora 连接、分库与测试', degradedNoticeHtml('knowledge') || strip(settingsKbSectionHtml()))] : []),
    section('本地 RAG', '语义检索运行时与本地 embedding；不装则知识库只能浏览', settingsKnowledgeRuntimeSectionHtml()),
    section('本机路径与导入', '货架位置、库清单、导入稿件', strip(settingsCombinedDataSectionHtml()))
  ].join('')
}

function localStatusLabel(item) {
  if (item.status === 'loaded') return item.contentChanged ? '已生效 · 内容已变' : '已生效'
  if (item.status === 'invalid') return `${item.gate || 'identity'} 门拒绝：${item.reason || '未知原因'}`
  if (item.status === 'skipped') return `跳过（${item.gate || 'trust'}）：${item.reason || ''}`
  return item.status || '未知'
}

function settingsLocalModulesSectionHtml() {
  const roots = state.plugins?.moduleRoots ?? []
  const modules = state.plugins?.localModules ?? []
  const rootRows = roots.length ? roots.map((root) => `
    <div class="mod-row">
      <div><b>${esc(root.path)}</b><i>${esc(root.registeredAt || '')} · ${Number(root.moduleCount) || 0} 个模块</i></div>
      <button type="button" class="uikit-btn uikit-btn-ghost" data-action="local-root-remove" data-path="${esc(root.path)}">移除</button>
    </div>`).join('') : '<div class="uikit-empty">还没有登记模块根——只认你亲自确认过的目录。</div>'
  const moduleRows = modules.length ? modules.map((item) => `
    <div class="mod-row">
      <div><b>${esc(item.name || item.id)}</b><i>v${esc(item.version || '—')} · ${esc(item.class || '—')} · ${esc(item.sourceDir || '')}</i>
        <span class="sub">${esc(localStatusLabel(item))}</span>
        <span class="sub">供给 ${esc((item.capabilities || []).join('、') || '—')} · 依赖 ${esc((item.requires || []).join('、') || '—')}</span>
        <span class="sub">摘要 ${esc((item.contentSha256 || '').slice(0, 12) || '—')}</span>
      </div>
    </div>`).join('') : '<div class="uikit-empty">模块清单为空，当前只用内置层。</div>'
  const browseRows = localBrowse?.entries?.length
    ? localBrowse.entries.map((entry) => `
      <div class="mod-row"><span>${esc(entry.name || entry.path || entry)}</span>
        <button type="button" class="uikit-btn uikit-btn-ghost" data-action="local-root-enter" data-path="${esc(entry.path || entry.name || entry)}">进入</button>
        <button type="button" class="uikit-btn uikit-btn-ghost" data-action="local-root-choose" data-path="${esc(entry.path || entry.name || entry)}">选这个</button>
      </div>`).join('')
    : '<div class="uikit-empty">点「浏览目录」列出可选文件夹。</div>'
  const previewRows = localPreview?.modules?.length
    ? localPreview.modules.map((item) => `
      <div class="mod-row"><span><b>${esc(item.name || item.id)}</b> · v${esc(item.version || '—')} · ${esc(item.class || '—')}</span>
        <span class="sub">${esc(item.status === 'ok' ? '可装载' : localStatusLabel(item))} · 摘要 ${esc((item.contentSha256 || '').slice(0, 12) || '—')}</span>
        <span class="sub">供给 ${esc((item.capabilities || []).join('、') || '—')} · 依赖 ${esc((item.requires || []).join('、') || '—')}</span>
      </div>`).join('')
    : '<div class="uikit-empty">选好目录后先点「预览清单」。</div>'
  return [
    `<div class="step"><h3>信任说明<span class="sub">登记之前请先读完</span></h3>
      <p class="sub">${esc(localPreview?.risk || '可执行模块与 daemon 同进程、同权限：登记一个模块根，等于信任这个根目录下的所有代码。只预览不生效，必须点确认才登记。')}</p></div>`,
    `<div class="step"><h3>已登记的根<span class="sub">机器级，不属于任何一个库</span></h3>
      ${rootRows}
      <div class="uikit-toolbar"><span class="uikit-toolbar-left">
        <input type="text" class="uikit-input" data-local-root-path value="${esc(localPath)}" placeholder="模块根目录（绝对路径）">
      </span><span class="uikit-toolbar-right">
        <button type="button" class="uikit-btn uikit-btn-ghost" data-action="local-root-browse">浏览目录</button>
        <button type="button" class="uikit-btn uikit-btn-ghost" data-action="local-root-preview">预览清单</button>
        <button type="button" class="uikit-btn uikit-btn-primary" data-action="local-root-confirm"${localPreview ? '' : ' disabled'}>确认登记</button>
        <button type="button" class="uikit-btn uikit-btn-ghost" data-action="local-root-refresh">刷新快照</button>
      </span></div>
      ${localNotice ? `<p class="sub">${esc(localNotice)}</p>` : ''}
    </div>`,
    `<div class="step"><h3>目录浏览<span class="sub">内建浏览器，不依赖桌面权限</span></h3>
      <p class="sub">${esc(localBrowse?.path || '尚未浏览')}</p>${browseRows}</div>`,
    `<div class="step"><h3>预览清单<span class="sub">确认前不写盘、不装载</span></h3>${previewRows}</div>`,
    `<div class="step"><h3>模块状态<span class="sub">摘要变化＝同版本改代码，快照随之更新</span></h3>${moduleRows}</div>`
  ].join('')
}

function settingsHtml() {
  const governanceRenderer = () => governanceHtml?.() ?? '<div class="gov"><div class="gov-empty">拿不到插件清单：治理台视图没有接上</div></div>'
  const sectionRenderers = {
    // —— 两大域七项（OS-204：导航真源见 SETTINGS_NAV）——
    appearance: settingsCombinedAppearanceHtml,
    engines: settingsCombinedEnginesHtml,
    about: settingsAboutSectionHtml,
    governance: governanceRenderer,
    panels: settingsModulesSectionHtml,
    suites: suitesSectionHtml,
    localModules: settingsLocalModulesSectionHtml,
    // 仅深链可达的兼容渲染器（不在导航里）
    script: settingsScriptSectionHtml
  }
  // OS-204：旧 id 经唯一的表收敛；每个旧 id 仍可达，不再散落重定向分支。
  const requested = state.settings.section
  const resolved = SETTINGS_REDIRECT[requested] ?? requested
  const sectionId = sectionRenderers[resolved] ? resolved : 'appearance'
  const sectionHtml = sectionRenderers[sectionId]()
  // OS-204：只照 SETTINGS_NAV 渲染——不再逐套件铺行、不再追加「本机模块」组。
  // 每项 <b>标签</b> 与 <span>提示</span> 是上下两行（.settings-nav-item 为 flex column）。
  const nav = SETTINGS_NAV.map((group) => `<div class="settings-nav-group">
      <div class="settings-nav-grouphead">${esc(group.label)}<span>${esc(group.hint)}</span></div>
      ${group.sections.map((section) => `
        <button class="settings-nav-item${section.id === sectionId ? ' on' : ''}" data-settings-section="${esc(section.id)}">
          <b>${esc(section.label)}</b>
          <span>${esc(section.hint)}</span>
        </button>`).join('')}
    </div>`).join('')
  const help = SETTINGS_HELP[sectionId] || ''
  const helpOpen = state.settings.helpOpen === true
  return `<div class="lib-wrap">
    <div class="page-head">
      <h1>设置</h1>
      <span class="sp"></span>
      <button class="help-btn${helpOpen ? ' on' : ''}" data-action="settings-help-toggle" title="这些设置是干什么的" aria-expanded="${helpOpen}">!</button>
      <button class="icon-btn page-close" data-action="settings-close" title="关闭设置">×</button>
    </div>
    ${helpOpen ? `<div class="help-bubble">${esc(help)}</div>` : ''}
    ${errorHtml()}
    <div class="settings-layout">
      <nav class="settings-nav">${nav}</nav>
      <div class="settings-content">${sectionHtml}</div>
    </div>
  </div>`
}

  // OS-196：本机模块的交互只在这里接线——app.js 不新增动作分支（OS-143 增量冻结）。
  if (typeof document !== 'undefined' && typeof api === 'function' && typeof render === 'function') {
    function readPath() {
      return document.querySelector('[data-local-root-path]')?.value?.trim() || localPath
    }
    document.addEventListener('click', async (event) => {
      const target = event.target?.closest?.('[data-action^="local-root-"]')
      if (!target) return
      const action = target.dataset.action
      try {
        if (action === 'local-root-browse') {
          const payload = await api('/api/fs/browse', { method: 'POST', body: JSON.stringify({ path: localBrowse?.path || '' }) })
          localBrowse = payload
          localNotice = ''
        } else if (action === 'local-root-enter') {
          const payload = await api('/api/fs/browse', { method: 'POST', body: JSON.stringify({ path: target.dataset.path || '' }) })
          localBrowse = payload
          localPath = payload.path || target.dataset.path || ''
          localNotice = ''
        } else if (action === 'local-root-choose') {
          localPath = target.dataset.path || ''
          localPreview = null
          localNotice = `已选：${localPath}——先预览清单再确认。`
        } else if (action === 'local-root-preview') {
          localPath = readPath()
          localPreview = await api('/api/module-roots/preview', { method: 'POST', body: JSON.stringify({ path: localPath }) })
          localNotice = (localPreview.warnings || []).map((item) => item.message).join('；')
        } else if (action === 'local-root-confirm') {
          if (!localPreview) return
          await api('/api/module-roots/add', { method: 'POST', body: JSON.stringify({ path: localPath, confirm: true }) })
          localPreview = null
          localBrowse = null
          localNotice = '已登记，新快照生效。'
          await loadPlugins(state.current?.path || '')
          return
        } else if (action === 'local-root-remove') {
          await api('/api/module-roots/remove', { method: 'POST', body: JSON.stringify({ path: target.dataset.path || '' }) })
          localNotice = '已移除，回到内置层。'
          await loadPlugins(state.current?.path || '')
          return
        } else if (action === 'local-root-refresh') {
          const payload = await api('/api/module-roots/refresh', { method: 'POST', body: '{}' })
          localNotice = payload.blocked ? `${payload.blocked.gate} 门：${payload.blocked.reason}` : `快照 ${payload.id} 已生效。`
          await loadPlugins(state.current?.path || '')
          return
        } else return
        render()
      } catch (error) {
        localNotice = (error && error.message) ? String(error.message) : String(error)
        render()
      }
    })
  }

  return { loadKnowledgeRuntime, settingsModulesSectionHtml, SETTINGS_HELP, navLabel: settingsNavLabel, RUNTIME_STATUS_LABEL, runtimeCard, settingsRuntimeSectionHtml, dshDepthFieldHtml, cfgBadgeHtml, dshModelValue, dshModelOptionsHtml, dshModelFieldHtml, settingsModelsSectionHtml, skinCardsHtml, settingsAppearanceSectionHtml, settingsTypographySectionHtml, settingsWritingSectionHtml, settingsDiscoverSectionHtml, settingsCombinedDataSectionHtml, settingsSyncSectionHtml, settingsDataSectionHtml, settingsAboutSectionHtml, settingsKbSectionHtml, settingsCombinedAppearanceHtml, settingsCombinedEnginesHtml, settingsLocalModulesSectionHtml, settingsHtml }
}
