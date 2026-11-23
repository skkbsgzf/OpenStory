/**
 * OS-135②：e2e 夹具书（三章 plot fact＋对应正文）——原 test/e2e-fact-first.mjs 内联数据的收编。
 *
 * 为什么收编：原 e2e 脚本把夹具写死在 test/fixtures/os-e2e/（gitignore 的未跟踪目录，
 * 靠脚本每次重建），而 test/fact-curve.test.mjs 又 cp 这份未跟踪残留——夹具成了跑不出来的
 * 隐藏依赖（新 clone 直接红）。改成可 import 的工厂后，夹具写到各自的系统临时目录，
 * 数据只有这一份真相（本文件），e2e 与 fact-curve 共用。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const E2E_BOOK_ID = 'e2e-book'

export async function writeE2eBookFixture(root) {
  await mkdir(join(root, '正文'), { recursive: true })
  await mkdir(join(root, '拆解'), { recursive: true })
  for (const [name, body] of [
    ['001-开局.md', '第一章 弹幕预警\n\n沈岚看到弹幕预警：末世只剩三天。林逸说她疯了。'],
    ['002-设局.md', '第二章 反向设局\n\n沈岚识破骗局，决定引导林逸卖房买米。'],
    ['003-收网.md', '第三章 合同收网\n\n沈岚出示合同，当众揭露林逸骗贷。']
  ]) await writeFile(join(root, '正文', name), body, 'utf8')
  await writeFile(join(root, '拆解', `${E2E_BOOK_ID}.json`), JSON.stringify({
    book: { id: E2E_BOOK_ID, title: '端到端测试书', author: 'tester', word_count: 6000 },
    entries: [
      { schema: 'fact.data/v3', id: 'plot-1', layer: 'plot', name: '开局', domain: '测试', status: 'fact',
        provenance: { book: E2E_BOOK_ID, book_id: E2E_BOOK_ID, mode: 'analyze', extractor: 'fact-chain/v1', chapters: [1] },
        who: ['沈岚', '林逸'],
        events: [
          { index: 1, who: '沈岚', channel: 'perceive', content: '沈岚看到弹幕预警：末世只剩三天。', segments: [{ index: 1, chars: 18 }] },
          { index: 2, who: '林逸', channel: 'say', content: '林逸说别听弹幕胡说，米是刚需。', segments: [{ index: 1, chars: 16 }] }
        ],
        validity: { from: 1, to: 1 } },
      { schema: 'fact.data/v3', id: 'plot-2', layer: 'plot', name: '设局', domain: '测试', status: 'fact',
        provenance: { book: E2E_BOOK_ID, book_id: E2E_BOOK_ID, mode: 'analyze', extractor: 'fact-chain/v1', chapters: [2] },
        who: ['沈岚'],
        events: [{ index: 1, who: '沈岚', channel: 'decision', content: '沈岚决定反向设局，引导林逸卖房买米。', segments: [{ index: 5, chars: 20 }] }],
        validity: { from: 2, to: 2 } },
      { schema: 'fact.data/v3', id: 'plot-3', layer: 'plot', name: '收网', domain: '测试', status: 'fact',
        provenance: { book: E2E_BOOK_ID, book_id: E2E_BOOK_ID, mode: 'analyze', extractor: 'fact-chain/v1', chapters: [3] },
        who: ['沈岚', '林逸'],
        events: [{ index: 1, who: '沈岚', channel: 'action', content: '沈岚出示合同，当众揭露林逸骗贷。', segments: [{ index: 9, chars: 18 }] }],
        validity: { from: 3, to: 3 } }
    ]
  }, null, 1), 'utf8')
  // 兄弟 wiki（派生层）：原夹具目录里这份文件靠 e2e enrich 运行残留——这里给确定性版本，
  // fact 曲线（读 wiki.chapterSummaries）不再依赖「先跑过一次 e2e」
  await writeFile(join(root, '拆解', `${E2E_BOOK_ID}.wiki.json`), JSON.stringify({
    derivedFrom: { factRevision: 1, schema: 'pinax-wiki-derived@1' },
    chapterSummaries: [
      { chapter: 1, title: '弹幕预警', summary: '沈岚看到弹幕预警末世将至，林逸不信并让她别囤货。', function: '建立', emotion: '疑', beats: 3 },
      { chapter: 2, title: '反向设局', summary: '沈岚识破骗贷合谋，反向设局引导林逸卖房买米。', function: '对峙', emotion: '燃', beats: 4 },
      { chapter: 3, title: '合同收网', summary: '过户完成，沈岚携合同脱身收网。', function: '揭露', emotion: '爽', beats: 4 }
    ],
    foreshadows: [
      { id: 'f-1', text: '弹幕预言逐条应验', chapter: 1, status: 'resolved' },
      { id: 'f-2', text: '卖房合同的法律效力', chapter: 2, status: 'resolved' }
    ]
  }, null, 1), 'utf8')
}
