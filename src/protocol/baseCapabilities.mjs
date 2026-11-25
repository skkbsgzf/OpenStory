export const BASE_CAPABILITIES = Object.freeze([
  Object.freeze({ id: 'base.process', version: 1 }),
  Object.freeze({ id: 'base.loader', version: 1 }),
  Object.freeze({ id: 'base.contract', version: 1 }),
  Object.freeze({ id: 'base.write', version: 1 }),
  Object.freeze({ id: 'base.naming', version: 1 })
])

export const BASE_REQUIRES = Object.freeze(BASE_CAPABILITIES.map(({ id }) => Object.freeze({ id, min: 1, maxExclusive: 2 })))

export const BASE_GRAPH = Object.freeze({ capabilities: BASE_CAPABILITIES, requires: BASE_REQUIRES })
