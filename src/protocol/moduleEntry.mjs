/**
 * 工作台 activate 样板：解析 hard requires、回 pages，并把模块 handler 登记表并进贡献。
 *
 * OS-194：`handlers` 可以是对象，也可以是 `(context) => handlers | Promise<handlers>` 工厂——
 * 工厂里再用 `context.resolve(id)` 取内核句柄（OS-193 K2），宿主工具从 `context.host` 取。
 * 贡献形状由 validateModuleContribution 校验（键必须在 manifest.endpoints、声明端点必须有 handler）。
 */
export function workbenchEntry({ requires = [], pages = {}, handlers = null } = {}) {
  return async function activate(context) {
    for (const requirement of requires) {
      const resolved = context.resolve(requirement.id, requirement)
      if (resolved?.ok === false) throw new Error(resolved.message ?? `能力不可用：${requirement.id}`)
    }
    const contribution = { pages }
    if (handlers !== null) {
      contribution.handlers = typeof handlers === 'function' ? await handlers(context) : handlers
    }
    return contribution
  }
}
