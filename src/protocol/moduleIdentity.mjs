export const HOST_COMPOSITION_IDS = Object.freeze(['agentbar', 'library'])

export function isHostComposition(id) {
  return HOST_COMPOSITION_IDS.includes(id)
}

export function moduleRole(manifest) {
  if (isHostComposition(manifest?.id)) return 'host-composition'
  return manifest?.class ?? 'unclassified'
}

export function hostCompositionDisablePatch(patch = {}) {
  const disabled = new Set()
  for (const id of HOST_COMPOSITION_IDS) {
    if (patch[`modules.enabled.${id}`] === false) disabled.add(id)
    if (patch?.modules?.enabled?.[id] === false) disabled.add(id)
  }
  return [...disabled].sort()
}
