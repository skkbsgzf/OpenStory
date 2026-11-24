/**
 * 设置归一（OS-145 / G6）——内核设置区 ＋ 模块自报设置区的聚合纯函数。
 *
 * 作者口径：「设置只留一个入口；内核自己的设置不动，各模块把自己的设置报上来。」
 *
 * 分工（与 OS-144 模块插件同一套 manifest）：
 *   · 内核设置（daemon 端口 / 库路径 / 数据目录 / 凭据存储）是 L5 宿主的，
 *     不插件化、不进 ui-state 的模块键——这里只作为**只读描述**参与聚合；
 *   · 模块设置由 `src/modules/<id>/module.manifest.json` 的 `settings` 自报，
 *     字段口径对齐业务套件 settings schema：{ key, label, type, default, options? }；
 *     值落库内 ui-state（`modules.settings.<id>.<key>`，兼容嵌套写法）。
 *
 * OS-146 复核口径（重要）：**界面上出现的每个设置项必须有真实消费者**。
 * 生图/识图的真源是本机 agent-config.json（loadConfigV2().image），知识库的真源是
 * 本机 kb-config.json（/api/kb/config），右栏卡片的真开关是 ui-state 的 analyzeEnabled——
 * 这些都**不在这里**再放一份输入框（改了不生效＝死配置）。模块的真配置在别处时，
 * manifest 只报两句指路：`settingsHint`（真配置在…）＋ `settingsJump`（设置页区块 id），
 * 设置页渲染成一行说明＋一个跳转按钮。
 *
 * 放在 `public/views/` 的理由：输出是**渲染用的分组结构**，主消费者是设置页（前端）；
 * 纯函数（零 import、不碰 DOM、不读全局 state、不写存储），Node 测试可直接 import，
 * 与 `views/registry.mjs` 同门风。app.js 只调用、不内联新逻辑（OS-143 增量冻结）。
 *
 * 停用语义：模块停用＝该设置区压暗、不可编辑，**值保留**（enabled/editable 分开表示，
 * 值照样从 ui-state 读出来）——重新启用立刻恢复，与 OS-144 的插件语义一致。
 *
 * 旧键迁移：机制保留（`migrateLegacySettings`＋marker `modules.settingsMigrated`，只跑一次、
 * 不覆盖新值、坏档不抛错）。OS-146 起迁移表为空——上一版把 ui-state 的 image.* / kb.* 旧读数
 * 迁进 `modules.settings.*`，但那些键从来不是真源（生图在 agent-config、知识库在 kb-config），
 * 迁过去也没人读，等于往库里写死键。以后真要有迁移，只准迁到 manifest 里声明过的键
 * （test/moduleSettingsConsumers.test.mjs 钉死这条）。
 */

/** 设置值类型（与 src/services/suites.mjs 的 SETTING_TYPES 同口径）。 */
export const SETTING_TYPES = Object.freeze(['string', 'number', 'boolean', 'select'])

/** 迁移 marker：写在 ui-state 的扁平键上，值为迁移版本号。 */
export const SETTINGS_MARKER_KEY = 'modules.settingsMigrated'
export const SETTINGS_MARKER_VERSION = 1

/**
 * 内核设置区描述（只读）。
 * 这些是宿主自己的东西（L5）：daemon 端口语义、库路径、数据目录、凭据存储——
 * 不随模块插件启停，也不由模块 manifest 声明。聚合时原样带出，供设置页标注。
 */
export const KERNEL_SETTINGS = Object.freeze([
  Object.freeze({ id: 'daemon', label: 'daemon 端口', note: '127.0.0.1:8807，只监听本机' }),
  Object.freeze({ id: 'libraryPath', label: '库路径', note: '库清单在 %LOCALAPPDATA%/OpenStory/libraries.json（旧 Pinax 清单只读导入）' }),
  Object.freeze({ id: 'dataDir', label: '数据目录', note: '草稿 / 推演 / 日志 / 界面状态都在库内 .pinax/' }),
  Object.freeze({ id: 'credentials', label: '凭据存储', note: '本机 agent-config.json / kb-config.json，响应只回掩码' })
])

const text = (value) => String(value ?? '')

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 模块设置值在 ui-state 的键（扁平写法；uiGet/uiSet 直接用）。 */
export function moduleSettingKey(moduleId, key) {
  return `modules.settings.${text(moduleId)}.${text(key)}`
}

/**
 * manifest settings → 规整后的 schema（坏项跳过，不抛错）。
 * 输入项形状对齐套件：{ key, label, type, default, options? }。
 */
export function normalizeSettingsSchema(rawSettings) {
  const settings = []
  for (const entry of Array.isArray(rawSettings) ? rawSettings : []) {
    if (!isPlainObject(entry)) continue
    const key = text(entry.key ?? entry.id).trim()
    const type = text(entry.type).trim()
    if (!key || !SETTING_TYPES.includes(type)) continue
    const setting = { key, label: text(entry.label).trim() || key, type }
    if (type === 'select') setting.options = Array.isArray(entry.options) ? entry.options.map((option) => text(option)) : []
    if (entry.default !== undefined) setting.default = entry.default
    settings.push(setting)
  }
  return settings
}

/**
 * 单个值的类型闸：返回 { ok, value }；不接受的值一律 ok:false（调用方回落 default）。
 * 与值是否「已存过」无关——旧键迁移与渲染读值共用这一处口径。
 */
export function normalizeSettingValue(setting, value) {
  if (!isPlainObject(setting)) return { ok: false }
  if (value === undefined || value === null || value === '') return { ok: false }
  if (setting.type === 'boolean') return typeof value === 'boolean' ? { ok: true, value } : { ok: false }
  if (setting.type === 'number') return typeof value === 'number' && Number.isFinite(value) ? { ok: true, value } : { ok: false }
  if (setting.type === 'select') {
    const options = Array.isArray(setting.options) ? setting.options.map((option) => text(option)) : []
    const raw = text(value)
    return options.includes(raw) ? { ok: true, value: raw } : { ok: false }
  }
  return typeof value === 'string' ? { ok: true, value } : { ok: false }
}

/** 表单控件原始值 → 带类型值（number/boolean 字符串化后也能落库）。 */
export function coerceSettingValue(type, raw) {
  if (type === 'boolean') {
    if (raw === true || raw === 'true') return true
    if (raw === false || raw === 'false') return false
    return undefined
  }
  if (type === 'number') {
    const rawText = typeof raw === 'string' ? raw.trim() : raw
    if (rawText === '' || rawText === null || rawText === undefined) return undefined
    const num = Number(rawText)
    return Number.isFinite(num) ? num : undefined
  }
  return typeof raw === 'string' ? raw : undefined
}

/** 读一个模块设置值：先认扁平键，再认嵌套写法；都没有返回 undefined。 */
export function readModuleSetting(state, moduleId, key) {
  const source = isPlainObject(state) ? state : {}
  const flat = moduleSettingKey(moduleId, key)
  if (Object.prototype.hasOwnProperty.call(source, flat)) return source[flat]
  const nested = source.modules?.settings
  if (isPlainObject(nested) && isPlainObject(nested[moduleId]) && Object.prototype.hasOwnProperty.call(nested[moduleId], key)) {
    return nested[moduleId][key]
  }
  return undefined
}

/**
 * 设置聚合（纯函数）。
 *
 * @param {object} input
 * @param {Array}  input.kernel   内核设置区描述（缺省 KERNEL_SETTINGS）
 * @param {Array}  input.modules  模块 manifest 列表（id/name/description/settings）
 * @param {object} input.enabled  启停映射 { <id>: boolean }（缺省 true）
 * @param {object} input.state    库内 ui-state（读模块设置值）
 * @returns {{ version:number, groups:Array }} 渲染用分组结构
 *   分组：kernel（只读）＋ modules（每个模块：enabled / editable / settings[值已补齐]）
 */
export function aggregateSettings({ kernel = KERNEL_SETTINGS, modules = [], enabled = {}, state = {} } = {}) {
  const enabledMap = isPlainObject(enabled) ? enabled : {}
  const moduleGroups = (Array.isArray(modules) ? modules : [])
    .filter((manifest) => isPlainObject(manifest) && text(manifest.id).trim())
    .map((manifest) => {
      const id = text(manifest.id).trim()
      // OS-163：核心模块恒启用、不可停用（ui-state 里写成 false 也不生效）
      const core = manifest.core === true
      const on = core || enabledMap[id] !== false
      return {
        id,
        core,
        name: text(manifest.name).trim() || id,
        description: text(manifest.description).trim(),
        // OS-146：真配置在别处时的指路（hint 一句话＋jump 设置页区块 id）；没有就空
        settingsHint: text(manifest.settingsHint).trim(),
        settingsJump: text(manifest.settingsJump).trim(),
        enabled: on,
        // 停用＝设置区只读（压暗、不可编辑），但值照旧读出来保留
        editable: on,
        settings: normalizeSettingsSchema(manifest.settings).map((setting) => {
          const stored = normalizeSettingValue(setting, readModuleSetting(state, id, setting.key))
          return { ...setting, value: stored.ok ? stored.value : setting.default, stored: stored.ok, editable: on }
        })
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))

  return {
    version: 1,
    groups: [
      {
        id: 'kernel',
        label: '内核设置',
        hint: '宿主自己的设置，不随模块插件启停',
        ownedBy: 'host',
        editable: false,
        settings: (Array.isArray(kernel) ? kernel : []).map((item) => ({ ...item, editable: false }))
      },
      {
        id: 'modules',
        label: '模块',
        hint: '工作面插件的启停与各自设置',
        ownedBy: 'module',
        editable: true,
        modules: moduleGroups
      }
    ]
  }
}

/**
 * 旧键迁移表（一次性）。
 * legacy ＝ 旧键名（扁平或点路径，两种写法都认）；type/options 与目标 schema 同口径。
 *
 * OS-146：**现在为空**。上一版这里把 `analyzeEnabled` / `image.*` / `kb.*` 迁进
 * `modules.settings.*`，但那些旧键没有一个是真源（生图＝agent-config.json，知识库＝
 * kb-config.json，右栏卡片勾选＝ui-state 的 analyzeEnabled 数组），迁过去也没有消费者，
 * 只是往库里写死键。铁律：**迁移目标必须是 manifest 里声明过的设置键**，否则不迁。
 */
export const LEGACY_SETTING_MIGRATIONS = Object.freeze([])

/** 旧键取值：先认扁平键（`image.backend`），再按点路径下钻（`image: { backend }`）。 */
function pickLegacyState(state, path) {
  if (Object.prototype.hasOwnProperty.call(state, path)) return state[path]
  let cursor = state
  for (const part of text(path).split('.')) {
    if (!isPlainObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, part)) return undefined
    cursor = cursor[part]
  }
  return cursor
}

/**
 * 旧键迁移（幂等，只迁一次）。
 *
 * 规则：
 *   ① marker 已是当前版本 → 原样返回（changed:false），**绝不覆盖**作者后来改过的新值；
 *   ② 新键已有合法值 → 保留新值，旧键跳过；
 *   ③ 旧键缺失或类型不对（坏档）→ 跳过、不抛错；
 *   ④ 无论迁没迁到，首次运行都写 marker，避免每次进库重复扫旧键。
 *
 * @param {object} state  ui-state 原件（不修改）
 * @returns {{ state: object, changed: boolean, applied: Array, skipped: Array, marker: number }}
 */
export function migrateLegacySettings(state, options = {}) {
  const source = isPlainObject(state) ? state : {}
  const marker = text(options.marker ?? SETTINGS_MARKER_KEY)
  const version = Number(options.version ?? SETTINGS_MARKER_VERSION)
  const migrations = Array.isArray(options.migrations) ? options.migrations : LEGACY_SETTING_MIGRATIONS

  const currentMarker = Number(source[marker])
  if (Number.isFinite(currentMarker) && currentMarker >= version) {
    return { state: source, changed: false, applied: [], skipped: [], marker: currentMarker }
  }

  const next = { ...source }
  const applied = []
  const skipped = []
  for (const rule of migrations) {
    if (!isPlainObject(rule) || !rule.moduleId || !rule.key) continue
    const existing = normalizeSettingValue(rule, readModuleSetting(source, rule.moduleId, rule.key))
    if (existing.ok) {
      skipped.push({ ...rule, reason: 'target-exists' })
      continue
    }
    const legacy = normalizeSettingValue(rule, pickLegacyState(source, rule.legacy))
    if (!legacy.ok) {
      skipped.push({ ...rule, reason: 'legacy-missing-or-invalid' })
      continue
    }
    next[moduleSettingKey(rule.moduleId, rule.key)] = legacy.value
    applied.push({ ...rule, value: legacy.value })
  }
  next[marker] = version
  return { state: next, changed: true, applied, skipped, marker: version }
}

/* ---------- 渲染（纯字符串；esc 由调用方注入，不引 DOM） ---------- */

function settingFieldHtml(module, setting, esc) {
  const id = `mp-${module.id}-${setting.key}`.replace(/[^\w-]/gu, '-')
  const disabled = module.editable ? '' : ' disabled'
  const value = setting.value
  const attrs = `data-action="plugin-module-setting" data-module-id="${esc(module.id)}" data-key="${esc(setting.key)}" data-type="${esc(setting.type)}"`
  const label = esc(setting.label)
  if (setting.type === 'boolean') {
    return `<label class="cfg-switch"><input type="checkbox" id="${esc(id)}" ${attrs}${value === true ? ' checked' : ''}${disabled}><span>${label}</span></label>`
  }
  if (setting.type === 'select') {
    const options = (setting.options ?? []).map((option) => `<option value="${esc(option)}"${text(option) === text(value) ? ' selected' : ''}>${esc(option)}</option>`).join('')
    return `<div class="field"><label for="${esc(id)}">${label}</label>
      <select class="select" id="${esc(id)}" ${attrs}${disabled}>${options}</select></div>`
  }
  const type = setting.type === 'number' ? 'number' : 'text'
  const raw = value === undefined || value === null ? '' : text(value)
  return `<div class="field"><label for="${esc(id)}">${label}</label>
    <input class="uikit-input" type="${type}" id="${esc(id)}" ${attrs} value="${esc(raw)}"${disabled}></div>`
}

/**
 * 设置页「模块」组 HTML。
 * 每个模块：启停开关（写 ui-state modules.enabled.<id>）＋ 自报设置项（按 schema 渲染）。
 * 真配置在别处（manifest 给了 settingsHint）＝一行指路＋一个跳转按钮，不摆第二份输入框。
 * 停用：整卡压暗（.mp-off）、控件 disabled，值保留。
 *
 * @param {{groups:Array}} aggregation aggregateSettings 的输出
 * @param {{esc?:Function}} deps      转义函数（app.js 的 esc）
 */
export function renderSettingsModules(aggregation, deps = {}) {
  const esc = typeof deps.esc === 'function' ? deps.esc : (value) => text(value)
  const group = (aggregation?.groups ?? []).find((item) => item.id === 'modules')
  if (!group) return ''
  const cards = (group.modules ?? []).map((module) => {
    // OS-163：核心模块的启停开关锁死（checked + disabled），旁边挂「核心模块」徽标。
    const toggle = module.core
      ? `<label class="cfg-switch"><input type="checkbox" checked disabled data-module-id="${esc(module.id)}"><span>启用「${esc(module.name)}」</span></label><span class="pill">核心模块</span>`
      : `<label class="cfg-switch"><input type="checkbox" data-action="plugin-module-toggle" data-module-id="${esc(module.id)}"${module.enabled ? ' checked' : ''}><span>启用「${esc(module.name)}」</span></label>`
    // 指路行（OS-146）：真配置在 agent-config / kb-config 之类的宿主位置，这里只说明去哪找
    const pointer = text(module.settingsHint)
      ? `<div class="row"><span class="cfg-note">${esc(module.settingsHint)}</span>${text(module.settingsJump)
        ? `<button type="button" class="btn-ghost" data-settings-section="${esc(module.settingsJump)}">去配置 →</button>`
        : ''}</div>`
      : ''
    const fields = module.settings.length
      ? module.settings.map((setting) => settingFieldHtml(module, setting, esc)).join('')
      : (text(module.settingsHint) ? '' : '<span class="cfg-note">这个模块没有自报设置项。</span>')
    const offNote = module.enabled ? '' : '<span class="cfg-note">已停用：设置值保留，重新启用立刻恢复。</span>'
    return `<div class="cfg-card mp-card${module.enabled ? '' : ' mp-off'}">
      <div class="cfg-head"><h3>${esc(module.name)}</h3></div>
      ${toggle}
      ${pointer}
      ${fields}
      ${offNote}
    </div>`
  }).join('')
  return `<div class="step">
    <h3>模块<span class="sub">${esc(group.hint)}</span></h3>
    <p class="sub">内核设置（daemon 端口、库路径、数据目录、凭据存储）归宿主，见「引擎与存储」，不随模块走。</p>
    ${cards || '<p class="sub">还没有模块插件——模块把自己的设置写在 module.manifest.json 里就会出现在这里。</p>'}
  </div>`
}

/**
 * 设置页「模块」组（OS-146：从 app.js 迁出——app.js 只留接线，渲染函数一律在 views/）。
 * app.js 传：modules（/api/plugins 的 modules）、enabledFor(id)、uiState（当前库 ui-state）、esc。
 * 还没有模块清单时（加载中）由调用方决定占位文案。
 */
export function moduleSettingsSectionHtml({ modules = [], enabledFor = () => true, uiState = {}, esc } = {}) {
  const list = Array.isArray(modules) ? modules : []
  const enabled = Object.fromEntries(list.map((module) => [module.id, enabledFor(module.id) !== false]))
  return renderSettingsModules(aggregateSettings({ modules: list, enabled, state: uiState }), { esc })
}

/* ---------- 设置页渲染器（OS-143「只出不进」：从 app.js 原样迁出） ----------
 * 这些函数原先内联在 app.js（OS-143 增量冻结后只许减不许增）。本体一字未改，
 * 只是把外部依赖（state / 工具函数）改为调用方注入，app.js 留一行转交壳。
 * 属设置页渲染，放本文件与聚合函数同处一处（同一个 ui-state 口径）。 */

/**
 * 剧本设置（原 settingsScriptSectionHtml）。
 * deps：{ state, scriptPrefs, dirWork, castColorOf, esc }
 */
export function scriptSectionHtml({ state, scriptPrefs, dirWork, castColorOf, esc } = {}) {
  const castColorPreviewHtml = () => {
    const work = dirWork('剧本')
    const mod = state.scriptModule
    if (!mod?.splitScriptBlocks || !work?.text) return '<span class="cfg-note">当前库没有剧本——打开剧本页后这里会显示角色配色预览。</span>'
    const cast = [...new Set(mod.splitScriptBlocks(work.text).filter((b) => b.kind === 'line' && b.who).map((b) => b.who))]
    if (!cast.length) return '<span class="cfg-note">剧本里还没有角色台词。</span>'
    return cast.slice(0, 12).map((name) => {
      const c = castColorOf(name)
      return `<span class="cast-chip" style="background:${c.bg};color:${c.fg}">${esc(name)}</span>`
    }).join('')
  }
  if (!state.current) {
    return `<div class="step"><h3>剧本</h3><p class="sub">剧本设置是「按库」的——先选一个库。</p></div>`
  }
  const prefs = scriptPrefs()
  const isScriptLib = (state.current.kind || '').includes('script') || (state.libDirs || []).includes('剧本')
  return `
    <div class="cfg-card">
      <div class="cfg-head"><h3>自动排版</h3><span class="cfg-note">把自由输入转成规范剧本格式</span></div>
      <div class="field">
        <label class="cfg-switch">
          <input type="checkbox" id="sc-pref-autoformat"${prefs.autoFormat ? ' checked' : ''}>
          <span>启用自动排版（保存时自动规范化）</span>
        </label>
      </div>
      <div class="sc-rule-list">
        <div class="sc-rule"><code>洪信：你来了。</code><span>→</span><code>**洪信**：你来了。</code></div>
        <div class="sc-rule"><code>洪信（压低声音）：…</code><span>→</span><code>**洪信**（压低声音）：…</code></div>
        <div class="sc-rule"><code>【场景】山道</code><span>→</span><code>*〔场景：山道〕*</code></div>
        <div class="sc-rule"><code>（幕落）</code><span>→</span><code>*〔幕落〕*</code></div>
        <div class="sc-rule"><code>第一幕：雨前</code><span>→</span><code># 第一幕：雨前</code></div>
      </div>
      <span class="cfg-note">已是规范格式的行不会被二次包装（幂等）；不确定的行保持原样（保守）。</span>
    </div>

    <div class="cfg-card">
      <div class="cfg-head"><h3>角色配色</h3><span class="cfg-note">每个角色一个专属色</span></div>
      <div class="field">
        <label class="cfg-switch">
          <input type="checkbox" id="sc-pref-castcolors"${prefs.castColors ? ' checked' : ''}>
          <span>给不同角色不同颜色（按名字稳定生成，换个库也一致）</span>
        </label>
      </div>
      <div class="sc-cast-preview">${castColorPreviewHtml()}</div>
      <span class="cfg-note">颜色由角色名 hash 到固定色相（HSL 42% 饱和度、深色文字），不用手工维护。</span>
    </div>

    ${isScriptLib ? '' : '<div class="cfg-note" style="padding:8px 0">提示：当前库不是剧本载体，这里的设置会在打开剧本页时生效。</div>'}

    <div class="row">
      <button class="btn-primary" data-action="script-pref-save">保存剧本设置</button>
      <span class="cfg-note" id="sc-pref-note"></span>
    </div>`
}

/**
 * OS-167 设置页「导入 Pinax 清单」纯视图。
 *
 * app.js 只做取数/勾选/提交：传入 `scan`（/api/library/pinax-list 的载荷＋selected/result），
 * 这里只吐 HTML。非法项标灰、写明原因，不能勾选；只读预览不写任何文件。
 *
 * @param {{scan?:object, esc?:Function}} deps
 */
export function pinaxImportSectionHtml({ scan = null, esc } = {}) {
  const escape = typeof esc === 'function' ? esc : (value) => text(value)
  if (!scan) {
    return `<div class="step">
      <h3>导入 Pinax 清单<span class="sub">旧院只读，不写回</span></h3>
      <p class="sub">OpenStory 自持库清单在 <code>%LOCALAPPDATA%/OpenStory/libraries.json</code>。
        互认靠库内 <code>.pinax/project.json</code>，不靠本机清单；需要把 Pinax 里登记过的库带过来时，在这里扫描并勾选。</p>
      <div class="row"><button type="button" class="btn-ghost" data-action="pinax-import-scan">扫描旧 Pinax 清单</button></div>
    </div>`
  }
  const list = Array.isArray(scan.libraries) ? scan.libraries : []
  const selected = new Set(Array.isArray(scan.selected) ? scan.selected : [])
  const rows = list.map((item) => {
    const path = text(item?.path)
    const enabled = item?.ok === true
    const checked = enabled && selected.has(path) ? ' checked' : ''
    const state = enabled
      ? '<span class="pill">可导入</span>'
      : `<span class="pill">${escape(item?.reason || '不可导入')}</span>`
    return `<label class="cfg-switch${enabled ? '' : ' mp-off'}" title="${escape(path)}">
      <input type="checkbox" data-pinax-path="${escape(path)}"${checked}${enabled ? '' : ' disabled'}>
      <span>${escape(item?.name || path)}</span>
    </label>
    <div class="kv-line"><span class="k">路径</span><span class="v">${escape(path)}</span></div>
    <div class="kv-line"><span class="k">体检</span><span class="v">${state}</span></div>`
  }).join('')
  const result = scan.result
    ? `<p class="sub">已导入 ${Number(scan.result.imported?.length ?? 0)} 项；拒绝 ${Number(scan.result.rejected?.length ?? 0)} 项。清单路径：${escape(scan.result.preferencesPath || '')}</p>`
    : ''
  const warnings = (Array.isArray(scan.warnings) ? scan.warnings : [])
    .map((warning) => `<p class="sub">${escape(warning?.message || '')}</p>`).join('')
  return `<div class="step">
    <h3>导入 Pinax 清单<span class="sub">旧院只读，不写回</span></h3>
    <p class="sub">来源：${escape(scan.source || '（旧院清单不存在）')}。逐个体检后才可勾选；不存在的目录、没有 <code>.pinax/project.json</code> 的项标灰。</p>
    ${rows || '<p class="sub">旧清单里没有可显示的库。</p>'}
    ${warnings}
    ${result}
    <div class="row">
      <button type="button" class="btn-ghost" data-action="pinax-import-scan">重新扫描</button>
      <button type="button" class="btn-primary" data-action="pinax-import-apply">导入勾选</button>
    </div>
  </div>`
}
