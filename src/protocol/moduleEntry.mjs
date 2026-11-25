export function workbenchEntry({ requires = [], pages = {} } = {}) {
  return async function activate(context) {
    for (const requirement of requires) {
      const resolved = context.resolve(requirement.id, requirement)
      if (resolved?.ok === false) throw new Error(resolved.message ?? `能力不可用：${requirement.id}`)
    }
    return { pages }
  }
}
