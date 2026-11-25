/**
 * 五层命名单一真源（OS-148/G8a）——Host 侧的取表口。
 *
 * 表本体只有一份，在 `public/views/registry.mjs` 的 `NAMING_TABLE`：它必须同时被浏览器
 * （注册表直接派生 DIR_LABELS/页签名）和 Node（写通道推断日志模块名）消费，而浏览器拿不到
 * `src/`。所以数据放前端 leaf 模块、后端在这里**只 re-export、不复制一个字面量**
 * （先例：daemon 直接 import `public/analysis.mjs`）。
 *
 * 为什么表不单独成 `public/naming.mjs`：注册表有「零 import」纯度门禁
 * （test/tabRegistry.test.mjs），独立成文件就得 import，与门禁冲突；注册表本来就是
 * 目录词表/页签名的唯一真源，表放在那里仍是单一来源。理由同见 AGENTS.md 硬规则 21。
 *
 * 消费方：src/protocol/chapterWrite.mjs（路径→日志模块）、src/modules/deduce/deduceSession.mjs
 * （会话目录名）、写日志的各模块（LOG_MODULES 常量）、test/naming.test.mjs 与
 * tools/acceptance/acceptance.mjs（一致性门禁）。
 */
export {
  NAMING_TABLE,
  LOG_MODULES,
  BUILTIN_PAGE_IDS,
  namingEntry,
  namingEntryForDir,
  logModuleForDir,
  logModuleForView,
  PAGE_TO_DIR_LOCAL
} from '../../public/views/registry.mjs'
