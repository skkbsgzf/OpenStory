/**
 * OS-142 Host API：宿主授权与文本归一转供叶子。
 *
 * root 授权与路径安全转供叶子。路径原语由底座 src/protocol/rootPath.mjs 持有；
 * 库清单与白名单仍由宿主组合根 authorize.mjs 持有。
 */
export { canonicalRoot, pathFail, text, METADATA_DIR, resolveInsideRoot } from './rootPath.mjs'
