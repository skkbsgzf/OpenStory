/**
 * 套件依赖图（OS-122）——manifest 的 requires 声明 → 拓扑序＋缺依赖＋环。
 *
 * 口径（与 suites/PROTOCOL.md 的 requires 字段一致）：
 *   - 只有「启用中」（enabled !== false）的套件参与图；停用的套件不当可用依赖。
 *   - 缺依赖＝requires 里的 id 不在货架上，或货架上但已停用；
 *   - 环＝强连通分量（≥2 个成员）或自依赖。Kahn 排序剩下的节点里既有真环成员，
 *     也有「依赖了环的下游套件」——再用 SCC 把真环挑出来，下游套件不误报成环。
 *   - 本模块不碰 manifest 校验（那是 suites.mjs 的 normalizeSuite 的职责），只吃规整后的
 *     { id, enabled, requires }，方便单测与别处复用；也刻意不引 versionGate 之类，
 *     保持零依赖、零副作用。
 */

function text(value) {
  return String(value ?? '')
}

/** 依赖清单规整：只认非空字符串，按声明顺序去重（重边会让入度重复计，没必要）。 */
function normalizeRequires(value) {
  const list = []
  const seen = new Set()
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item !== 'string' || !item || seen.has(item)) continue
    seen.add(item)
    list.push(item)
  }
  return list
}

/**
 * Tarjan 强连通分量（迭代版）——套件数量不可控，别拿递归赌调用栈。
 * @param {string[]} nodes
 * @param {Map<string, string[]>} adjacency node → 它依赖的节点（两端都必须在 nodes 里）
 * @returns {string[][]}
 */
function stronglyConnected(nodes, adjacency) {
  let index = 0
  const indices = new Map()
  const low = new Map()
  const onStack = new Set()
  const stack = []
  const components = []

  for (const root of nodes) {
    if (indices.has(root)) continue
    indices.set(root, index)
    low.set(root, index)
    index += 1
    stack.push(root)
    onStack.add(root)
    const work = [{ node: root, next: 0 }]
    while (work.length) {
      const frame = work[work.length - 1]
      const neighbours = adjacency.get(frame.node) ?? []
      if (frame.next < neighbours.length) {
        const to = neighbours[frame.next]
        frame.next += 1
        if (!indices.has(to)) {
          indices.set(to, index)
          low.set(to, index)
          index += 1
          stack.push(to)
          onStack.add(to)
          work.push({ node: to, next: 0 })
        } else if (onStack.has(to)) {
          low.set(frame.node, Math.min(low.get(frame.node), indices.get(to)))
        }
        continue
      }
      work.pop()
      if (work.length) {
        const parent = work[work.length - 1].node
        low.set(parent, Math.min(low.get(parent), low.get(frame.node)))
      }
      if (low.get(frame.node) === indices.get(frame.node)) {
        const component = []
        let member
        do {
          member = stack.pop()
          onStack.delete(member)
          component.push(member)
        } while (member !== frame.node)
        components.push(component)
      }
    }
  }
  return components
}

/**
 * 解析套件依赖：Kahn 拓扑排序，剩下入度不为 0 的节点再拆成强连通分量找真环。
 *
 * @param {Array<{id:string, enabled?:boolean, requires?:string[]}>} suites
 * @returns {{
 *   ok: boolean,
 *   enabled: string[],                 // 拓扑序（依赖在前），只含真正可启用的套件
 *   unmet: Array<{id:string, needs:string[]}>, // requires 里有不存在或未启用的 id
 *   cycles: string[][]                 // 每个环是一组 id（组内按字典序，整体按首 id 排序）
 * }}
 */
export function resolveSuiteDependencies(suites = []) {
  const list = Array.isArray(suites) ? suites : []
  const byId = new Map()
  const order = []
  for (const suite of list) {
    const id = text(suite?.id)
    if (!id || byId.has(id)) continue // 空 id／重复 id：先出现的为准（与 loadSuites 的覆盖口径一致）
    byId.set(id, suite)
    order.push(id)
  }
  const active = order.filter((id) => byId.get(id)?.enabled !== false)
  const activeSet = new Set(active)

  // 1) 直接缺依赖：不存在或已停用
  const depsById = new Map()
  const unmet = []
  for (const id of active) {
    const deps = normalizeRequires(byId.get(id)?.requires)
    depsById.set(id, deps)
    const needs = deps.filter((dep) => !activeSet.has(dep))
    if (needs.length) unmet.push({ id, needs })
  }

  // 2) Kahn：边 dep → 依赖它的套件，入度＝还没就绪的依赖数
  const dependents = new Map(active.map((id) => [id, []]))
  const indegree = new Map(active.map((id) => [id, 0]))
  for (const id of active) {
    for (const dep of depsById.get(id)) {
      if (!activeSet.has(dep)) continue // 缺依赖已记入 unmet，不成边
      dependents.get(dep).push(id)
      indegree.set(id, indegree.get(id) + 1)
    }
  }
  const queue = active.filter((id) => indegree.get(id) === 0)
  const sorted = []
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor]
    sorted.push(id)
    for (const next of dependents.get(id)) {
      indegree.set(next, indegree.get(next) - 1)
      if (indegree.get(next) === 0) queue.push(next)
    }
  }

  // 3) Kahn 剩下的：环成员＋环的下游。SCC 只把真环挑出来（自依赖＝size 1 且自己依赖自己）
  const remaining = active.filter((id) => indegree.get(id) > 0)
  const remainingSet = new Set(remaining)
  const adjacency = new Map(remaining.map((id) => [
    id,
    depsById.get(id).filter((dep) => remainingSet.has(dep))
  ]))
  const cycles = stronglyConnected(remaining, adjacency)
    .filter((component) => component.length > 1 || depsById.get(component[0]).includes(component[0]))
    .map((component) => [...component].sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  // 4) 可启用清单：排好序且自己没缺依赖。环及其下游根本没进 sorted，天然被排除。
  const unmetIds = new Set(unmet.map((item) => item.id))
  const enabled = sorted.filter((id) => !unmetIds.has(id))

  return { ok: unmet.length === 0 && cycles.length === 0, enabled, unmet, cycles }
}
