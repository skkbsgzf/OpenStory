/**
 * OS-192 · 插件中心：五类货架按供给类型六组呈现，一个地方启停与设置。
 *
 * 真源是 /api/suites（统一清单，含 kind/group/values/overrides）；这里只做纯渲染。
 * app.js 只留接线（本文件由 app.js 动态 import 后委托），不持有渲染函数本体。
 */
export function createSuiteShelfViews(scope) {
  const { state, esc, text, isDarkSurface, settingsModulesSectionHtml } = scope
  const GROUPS = ['技能包', '文风包', '体裁包', '运行时套件', '业务套装', '推演规则包']
  const GROUP_HINT = {
    技能包: 'SKILL.md 手艺配方，由 Agent 执行',
    文风包: 'styles/*.json 视觉令牌，底座界面消费',
    体裁包: 'genres/*.json 交付物与形制约束',
    运行时套件: 'runtimes/<id>/manifest.json，Agent 执行通道',
    业务套装: 'suites/<id>/manifest.json，业务默认规则',
    推演规则包: 'suites 中供给 deduce-rule 的规则数据'
  }

  function settingFieldHtml(setting) {
    const value = state.settings.draftValues?.[setting.key] ?? setting.default ?? ''
    if (setting.type === 'select') {
      const options = (setting.options ?? []).map((option) => `<option value="${esc(option)}"${option === value ? ' selected' : ''}>${esc(option)}</option>`).join('')
      return `<div class="field"><label>${esc(setting.label)}</label><select class="select" data-suite-key="${esc(setting.key)}">${options}</select></div>`
    }
    if (setting.type === 'boolean') {
      return `<div class="field"><label>${esc(setting.label)}</label>
        <select class="select" data-suite-key="${esc(setting.key)}">
          <option value="true"${value === true ? ' selected' : ''}>开</option>
          <option value="false"${value === false ? ' selected' : ''}>关</option>
        </select></div>`
    }
    const inputType = setting.type === 'number' ? 'number' : 'text'
    return `<div class="field"><label>${esc(setting.label)}</label>
      <input data-suite-key="${esc(setting.key)}" type="${inputType}" value="${esc(value)}" ${setting.type === 'number' ? 'step="any"' : ''}>
    </div>`
  }

  /** 右栏：单条目详情（来源/身份/能力/启停/schema 设置）。page 模式已退役，不再有 iframe。 */
  function suiteDetailPaneHtml(suite) {
    const caps = suite.capabilities ?? { settings: { mode: 'none' }, pages: [], services: [] }
    const src = suite.sourceDetail ?? {}
    const on = suite.enabled !== false
    const domains = Array.isArray(suite.domains) ? suite.domains : []
    const skills = Array.isArray(suite.bundledSkills) ? suite.bundledSkills : []
    const overrides = Array.isArray(state.settings.suiteOverrides) ? state.settings.suiteOverrides : []
    const shadow = overrides.find((item) => item.id === suite.id)

    const rows = []
    rows.push(['供给组', esc(suite.group || '业务套装')])
    rows.push(['来源', `${esc(src.kind || suite.source || '—')}${shadow
      ? `（本机覆盖内置：${esc(shadow.shadowed?.name || shadow.shadowed?.dir || '内置')} ← ${esc(shadow.shadowBy?.dir || '本机')}）`
      : src.shadowed ? '（覆盖同名内置）' : ''}`])
    if (src.dir) rows.push(['安装目录', `<span class="mono">${esc(src.dir)}</span>`])
    rows.push(['版本', `v${esc(suite.version)}`])
    if (domains.length) rows.push(['适用域', esc(domains.join('／'))])
    rows.push(['设置模式', caps.settings?.mode === 'schema' ? '宿主表单（schema）' : '无设置项'])

    const sourceBlock = `<dl class="suite-source">${rows.map(([key, value]) =>
      `<div><dt>${key}</dt><dd>${value}</dd></div>`).join('')}</dl>`
    const capsBlock = skills.length
      ? `<div class="suite-caps"><div class="suite-cap-row"><b>捆绑技能</b><span>${skills.length} 个：${skills.slice(0, 6).map((skill) => esc(skill.name)).join('、')}${skills.length > 6 ? ' …' : ''}</span></div></div>`
      : ''
    const header = `<div class="suite-detail-head">
        <div class="sdh-main"><h4>${esc(suite.name)}</h4><p class="sub">${esc(suite.description || '')}</p></div>
        <button class="sm-toggle${on ? ' on' : ''}" data-action="suite-toggle" data-id="${esc(suite.id)}"
          title="${on ? '停用（值保留，规则退回默认）' : '启用'}">
          <span class="knob"></span><span class="lab">${on ? '启用中' : '已停用'}</span>
        </button>
      </div>`
    const paused = on ? '' : '<div class="warn-box"><b>已停用</b>——这一项当前走内置默认；值保留，启用即恢复。</div>'
    let settingsBody
    if (caps.settings?.mode === 'schema') {
      const schema = Array.isArray(suite.settingsSchema) ? suite.settingsSchema : []
      settingsBody = `${schema.length ? schema.map(settingFieldHtml).join('') : '<p class="sub">这一项没有声明设置项。</p>'}
        <div class="err" id="suite-err"></div>
        <div class="ops"><button class="btn-primary" data-action="suite-settings-save" data-id="${esc(suite.id)}">保存设置</button></div>`
    } else {
      settingsBody = '<p class="sub">这一项没有宿主代管的设置项——它只提供规则、技能或资源。</p>'
    }
    state.settings.draftValues = { ...(suite.values ?? {}) }
    const modules = settingsModulesSectionHtml({ suiteId: suite.id })
    return `${header}${paused}
      <div class="suite-detail-body">
        <div class="suite-detail-section"><h5>来源与身份</h5>${sourceBlock}${capsBlock}</div>
        <div class="suite-detail-section"><h5>设置</h5>${settingsBody}</div>
        ${modules ? `<div class="suite-detail-section"><h5>工作台模块<span class="h5-sub">这一项启用时，左/右栏出现哪些模块</span></h5>
          ${modules.replace(/<div class="step"><h3>/g, '<div class="suite-mod-group"><h6>')
            .replace(/<\/h3>/g, '</h6>').replace(/<p class="sub">[^<]*<\/p>/g, '')}</div>` : ''}
      </div>`
  }

  /** 插件中心主面：六组货架，每项一行，点行进详情、右侧开关直接启停。 */
  function suitesSectionHtml() {
    const list = Array.isArray(state.suites) ? state.suites : []
    if (!list.length) {
      return `<div class="step"><h3>插件中心</h3><p class="sub">还没有货架条目——把 SKILL.md / *.json / 套件目录丢进本机货架即上新。</p></div>`
    }
    const activeId = state.settings.suiteId && list.some((suite) => suite.id === state.settings.suiteId)
      ? state.settings.suiteId
      : list[0].id
    const active = list.find((suite) => suite.id === activeId) ?? list[0]
    const groups = GROUPS.map((group) => {
      const items = list.filter((suite) => (suite.group || '业务套装') === group)
      if (!items.length) return ''
      const rows = items.map((suite) => {
        const on = suite.enabled !== false
        const blocked = suite.blocked === true
        return `<div class="shelf-row${suite.id === active.id ? ' on' : ''}">
          <button class="shelf-name" data-action="suite-select" data-id="${esc(suite.id)}">
            <b>${esc(suite.name)}</b><span class="sub">${esc(suite.description || suite.id)}</span>
          </button>
          ${blocked ? `<span class="plug-tag blocked" title="${esc(suite.blockedReason || '')}">缺依赖</span>` : ''}
          <button class="sm-toggle${on ? ' on' : ''}" data-action="suite-toggle" data-id="${esc(suite.id)}"
            title="${on ? '停用' : '启用'}"><span class="knob"></span><span class="lab">${on ? '启用中' : '已停用'}</span></button>
        </div>`
      }).join('')
      return `<div class="shelf-group"><div class="shelf-group-head"><b>${esc(group)}</b>
        <span>${items.length} 项 · ${esc(GROUP_HINT[group] || '')}</span></div>${rows}</div>`
    }).join('')
    return `<div class="step suite-center">
      <div class="shelf-groups">${groups}</div>
      ${suiteDetailPaneHtml(active)}
    </div>`
  }

  return { suitesSectionHtml, suiteDetailPaneHtml, settingFieldHtml }
}
