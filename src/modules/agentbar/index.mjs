export async function activate(context) {
  context.resolve('agent.runtime', { min: 1 })
  context.resolve('storage.roots', { min: 1 })
  context.resolve('fact.store', { min: 3 })
  return { handlers: {}, pages: {}, settingsConsumers: {} }
}
