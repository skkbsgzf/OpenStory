import * as courtyard from '../../protocol/courtyard.mjs'
import * as libraryManifest from './libraryManifest.mjs'
import * as libraryInventory from './libraryInventory.mjs'
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
  'storage.scaffold': Object.freeze({ ...projectDoc, carriers: () => projectDoc.CARRIERS }),
  // OS-195a：库内只读盘点是通用能力，登记为 storage.inventory@1，
  // 产物工作台／库管理／宿主 system 端点都经句柄取，不 import 本模块内部。
  'storage.inventory': Object.freeze({
    listArtifacts: libraryInventory.listArtifacts,
    listLibraryFiles: libraryInventory.listLibraryFiles
  })
})
