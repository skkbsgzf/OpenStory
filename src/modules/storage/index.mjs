import * as courtyard from './courtyard.mjs'
import * as libraryManifest from './libraryManifest.mjs'
import * as projectDoc from './projectDoc.mjs'

export async function activate(context) {
  context.resolve('base.write', { min: 1 })
  context.resolve('base.naming', { min: 1 })
  return { capabilities: storageCapability }
}

export const projectMeta = Object.freeze({
  readProjectDocument: projectDoc.readProjectDocument,
  writeProjectDocument: projectDoc.writeProjectDocument,
  nextCarriers: projectDoc.nextCarriers,
  validateProjectDocument: projectDoc.validateProjectDocument
})

export const storageCapability = Object.freeze({
  'storage.roots': Object.freeze({ ...courtyard }),
  'library.list': Object.freeze({ ...libraryManifest, sources: () => libraryManifest.LIBRARY_SOURCES }),
  'storage.scaffold': Object.freeze({ ...projectDoc, carriers: () => projectDoc.CARRIERS })
})
