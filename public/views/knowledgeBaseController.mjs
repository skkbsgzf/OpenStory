/** 知识库工作台前端控制器（OS-227）。app.js 只接线工厂与事件分发。 */
export function createKnowledgeBaseController(scope) {
  const { state, api, render, esc, text, go } = scope
  const controller = {
    async load(force = false) {
      const kb = state.knowledgeBase
      // 早退也要补渲染：并发调用时 kb.loading 已为 true，若直接 return，视图会永远停在「载入中」。
      if (kb.loading || (kb.loaded && !force)) { if (state.view === 'knowledge-base') render(); return }
      kb.loading = true
      kb.error = ''
      try {
        const list = await api('/api/knowledge/libraries')
        kb.libraries = Array.isArray(list.libraries) ? list.libraries : []
        kb.activeLibraryId = list.activeLibraryId || kb.libraries.find((item) => item.enabled)?.id || ''
        kb.loaded = true
        if (kb.activeLibraryId) await controller.loadDocuments()
      } catch (error) {
        kb.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
      } finally { kb.loading = false }
      if (state.view === 'knowledge-base') render()
    },
    async loadDocuments() {
      const kb = state.knowledgeBase
      if (!kb.activeLibraryId) { kb.documents = []; kb.graph = null; return }
      const payload = await api(`/api/knowledge/documents?libraryId=${encodeURIComponent(kb.activeLibraryId)}`)
      kb.documents = Array.isArray(payload.documents) ? payload.documents : []
      kb.tags = Array.isArray(payload.tags) ? payload.tags : []
      kb.graph = payload.graph || null
      kb.contentRevision = payload.contentRevision || ''
      kb.indexStatus = payload.indexStatus || 'never-indexed'
      if (!kb.documents.some((item) => item.ref === kb.activeRef)) kb.activeRef = ''
      if (kb.activeRef) await controller.openDocument(kb.activeRef)
      await controller.loadIndexStatus()
    },
    async loadIndexStatus() {
      const kb = state.knowledgeBase
      if (!kb.activeLibraryId) return
      try {
        const payload = await api(`/api/knowledge/index/status?libraryId=${encodeURIComponent(kb.activeLibraryId)}`)
        kb.indexStatus = payload.index?.status || 'never-indexed'
        kb.runtimeAvailable = payload.runtime?.available === true
      } catch (error) {
        kb.indexStatus = 'failed'
        kb.runtimeAvailable = false
        kb.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
      }
    },
    async openDocument(ref) {
      const kb = state.knowledgeBase
      if (!kb.activeLibraryId || !ref) return
      kb.activeRef = ref
      kb.documentLoading = true
      render()
      try {
        const payload = await api(`/api/knowledge/document?libraryId=${encodeURIComponent(kb.activeLibraryId)}&documentRef=${encodeURIComponent(ref)}`)
        kb.document = payload.document || null
        kb.backlinks = payload.backlinks || { linked: [], unlinked: [] }
      } catch (error) { kb.error = text(error?.message || error) } finally { kb.documentLoading = false }
      render()
    },
    async activate(libraryId) {
      const kb = state.knowledgeBase
      await api('/api/knowledge/library/state', { method: 'PUT', body: JSON.stringify({ libraryId, activate: true }) })
      kb.activeLibraryId = libraryId
      kb.activeRef = ''
      kb.hits = []
      await controller.load(true)
    },
    async preview() {
      const kb = state.knowledgeBase
      const form = kb.form
      kb.formError = ''
      try {
        const payload = await api('/api/knowledge/library/preview', { method: 'POST', body: JSON.stringify({ root: form.root, id: form.id || undefined, name: form.name || undefined }) })
        form.preview = payload
      } catch (error) {
        kb.formError = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
      }
      render()
    },
    async register() {
      const kb = state.knowledgeBase
      kb.formError = ''
      try {
        await api('/api/knowledge/library/register', { method: 'POST', body: JSON.stringify({ previewId: kb.form.preview.previewId, confirm: true }) })
        kb.form = null // 登记成功后表单自动收起，不相干地一直占版面
        kb.notice = '知识库已登记。'
      } catch (error) {
        kb.formError = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
      }
      await controller.load(true)
    },
    async create() {
      const kb = state.knowledgeBase
      kb.formError = ''
      try {
        await api('/api/knowledge/library/create', { method: 'POST', body: JSON.stringify({ id: kb.form.id, name: kb.form.name || undefined, root: kb.form.root }) })
        kb.form = null
        kb.notice = '空知识库已创建。'
      } catch (error) {
        kb.formError = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
      }
      await controller.load(true)
    },
    async search() {
      const kb = state.knowledgeBase
      kb.searching = true
      kb.searchError = ''
      render()
      try {
        const payload = await api('/api/knowledge/search', { method: 'POST', body: JSON.stringify({ libraryId: kb.activeLibraryId, query: kb.query }) })
        kb.hits = Array.isArray(payload.hits) ? payload.hits : []
      } catch (error) { kb.searchError = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}` } finally { kb.searching = false }
      render()
    },
    async sync() {
      const kb = state.knowledgeBase
      await api('/api/knowledge/index/sync', { method: 'POST', body: JSON.stringify({ libraryId: kb.activeLibraryId, confirm: true }) })
      await controller.load(true)
    },
    async saveCustomization() {
      const kb = state.knowledgeBase
      const library = kb.libraries.find((item) => item.id === kb.activeLibraryId)
      const customization = { ...(library?.customization || {}) }
      for (const el of document.querySelectorAll('[data-kb-custom]')) customization[el.dataset.kbCustom] = el.value
      const retrieval = { ...(customization.retrieval || {}) }
      for (const el of document.querySelectorAll('[data-kb-retrieval]')) retrieval[el.dataset.kbRetrieval] = Number(el.value)
      customization.retrieval = retrieval
      await api('/api/knowledge/library/customization', { method: 'PUT', body: JSON.stringify({ libraryId: kb.activeLibraryId, customization }) })
      await controller.load(true)
    },
    // 这次点击归知识库工作台管吗？只管自己的 data-kb-* / data-wiki-*，其余交给宿主全局分发。
    owns(target) {
      return Boolean(target?.dataset?.wikiOpen || target?.hasAttribute?.('data-wiki-tag') || String(target?.dataset?.action || '').startsWith('kb-'))
    },
    async click(target) {
      const kb = state.knowledgeBase
      const action = target.dataset.action
      if (target.dataset.wikiOpen) { await controller.openDocument(target.dataset.wikiOpen); return true }
      if (target.hasAttribute('data-wiki-tag')) { kb.activeTag = kb.activeTag === target.dataset.wikiTag ? '' : target.dataset.wikiTag; render(); return true }
      if (action === 'kb-active-library') return false
      if (action === 'kb-register') { kb.form = { kind: 'register', root: '', id: '', name: '', preview: null }; render(); return true }
      if (action === 'kb-create') { kb.form = { kind: 'create', root: '', id: '', name: '', preview: null }; render(); return true }
      if (action === 'kb-form-cancel') { kb.form = null; render(); return true }
      if (action === 'kb-preview') { await controller.preview(); return true }
      if (action === 'kb-register-confirm') { await controller.register(); return true }
      if (action === 'kb-create-confirm') { await controller.create(); return true }
      if (action === 'kb-search') { await controller.search(); return true }
      if (action === 'kb-sync') { await controller.sync(); return true }
      if (action === 'kb-custom-save') { await controller.saveCustomization(); return true }
      if (action === 'kb-toggle-enabled') {
        const library = kb.libraries.find((item) => item.id === kb.activeLibraryId)
        await api('/api/knowledge/library/state', { method: 'PUT', body: JSON.stringify({ libraryId: kb.activeLibraryId, enabled: !library?.enabled }) })
        await controller.load(true)
        return true
      }
      if (action === 'kb-view-graph') { kb.view = kb.view === 'graph' ? 'detail' : 'graph'; render(); return true }
      return false
    },
    async change(target) {
      const kb = state.knowledgeBase
      if (target.dataset.action === 'kb-active-library') { await controller.activate(target.value); return true }
      return false
    },
    async input(target) {
      const kb = state.knowledgeBase
      if (target.dataset.kbQuery !== undefined) { kb.query = target.value; return true }
      if (target.dataset.kbTreeQuery !== undefined) { kb.treeQuery = target.value; render(); return true }
      if (target.dataset.kbField) { kb.form[target.dataset.kbField] = target.value; return true }
      return false
    },
    html() {
      if (!state.current) return '<div class="empty">请先选择一个作品库，再打开知识库。</div>'
      // md 由壳注入（app.js 的 loadMd 单例）；知识库详情只读渲染，不自行 import 渲染器。
      return scope.knowledgeBaseViews?.()?.knowledgeBaseHtml({ ...state.knowledgeBase, md: scope.md?.() ?? null }) || '<div class="loading">知识库视图载入中…</div>'
    },
    async enter() { await controller.load(); go('knowledge-base') }
  }
  return controller
}
