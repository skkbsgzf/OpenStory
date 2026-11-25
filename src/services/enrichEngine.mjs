/**
 * 语义增补引擎——OS-193 归位后只作兼容转供。
 *
 * 把 Pinax-next devtools/wiki-enrich-run.mjs 的六槽位管线封装成宿主可调用的引擎：
 *   ① 章批五合一 ② 因果图 ③ 人物卡＋马斯洛需求 ④ 世界要素 ⑤ 状态台账 ⑥ 四槽位＋文风九维。
 * 溯源纪律（TRACE_HEADER）沿用 Pinax 六槽位口径：章号证据 / 三态置信 / 引用≤40字。
 *
 * 实现真源：src/modules/fact/enrich/engine.mjs（833 行）。本叶只经唯一静态入口
 * KERNEL_CAPABILITIES 取 fact.enrich 句柄；调用时才解引用，避开装载环。"转出不换实现"。
 */
import { KERNEL_CAPABILITIES as K } from '../protocol/capabilityImplementations.mjs'

export const enrichBook = (...args) => K.factEngine.enrichBook(...args)
export const enrichGraph = (...args) => K.factEngine.enrichGraph(...args)
