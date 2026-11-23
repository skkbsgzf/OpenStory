/**
 * OS-142 Host API：宿主授权与文本归一转供叶子。
 *
 * 把 src/host/authorize.mjs 里模块层（src/modules/**）需要的五个能力按原名转出：
 *   · text              —— 任意值 → 字符串（String(value ?? '')），消息/参数归一用
 *   · METADATA_DIR      —— 库内元数据目录名（'.pinax'），扫描侧跳过用
 *   · canonicalRoot     —— root → 规范化绝对路径；空串/非法给 null（不抛）
 *   · pathFail          —— 路径越界/非法 → { ok:false, code, message } 失败对象
 *                          （code=API_ERROR_CODES.PATH_ESCAPE；不落盘）
 *   · resolveInsideRoot —— 相对路径解析＋越界校验；越界给 null（allowMetadata 放行 .pinax）
 *
 * 只做转出不包逻辑；宿主 authorize 的实现语义以原文件为准。模块层禁止直引
 * src/host/**——这条叶子就是唯一通道（门禁 S2.1 的 src/protocol/** 路径规则）。
 */
export { canonicalRoot, pathFail, text, METADATA_DIR, resolveInsideRoot } from '../host/authorize.mjs'
