# OpenStory

**跑在浏览器 / DSH 里的小说工作台**（OpenDesign 形态的小说版）。独立开源项目。

## 项目声明

- **以 OpenStory 为前端**：模板化框架层＋模块化业务页；后端只提供固定的本地文件绑定 API（daemon，只监听 127.0.0.1）。
- **底座插件体系以 pinax-core 为原型**：`core/` 是底座抽取层（载体清单、建库内核、依赖闭包）——现状逐字 vendor 自 Pinax-next，后续按 pinax-core 的抽包节奏升格为独立底座包。
- **拥抱开源兼容的插件生态**：三类货架全部目录制、本机可上新、本机覆盖内置——
  1. **业务套件**（`openstory-suite@2`，协议见 [PROTOCOL.md](./PROTOCOL.md)）：写作/编剧/漫剧……版本号＋归属＋独立设置页（宿主表单或**套件自带设置页**），非常驻（可停用，规则退回默认）；
  2. **Agent 运行时 kit**（`openstory-runtime-kit@1`，见 `openstory/runtimes/README.md`）：模型对话通道可插拔（Pi 兜底＋sidecar/endpoint 套件）；
  3. **风格包**（tokens JSON）：整窗换肤＋栅格密度随包。
- **效仿 OpenDesign 补全用户体验**：顶栏库切换、页签纯工作面（产物首格＋版本历史）、分节制设置页、Agent 左列对话＋待确认卡。

## 三条边界

1. **数据真源在磁盘**：库＝文件夹（.pinax 兼容形态），OpenStory 不自建数据库，与 Pinax（Electron 壳）共用同一份文件资产与库清单——两个壳，一份稿子。
2. **daemon 只监听 127.0.0.1**：不做 HTTPS/隧道/多用户；配置与凭据只存本机。
3. **插件不常驻**：套件/运行时按声明加载，停用＝规则退回内置默认（值保留）。

## 快速开始

```bash
npm start          # node daemon.mjs → http://127.0.0.1:8807
npm test           # node --test（79 例）
```

## 结构

```
├── daemon.mjs / contracts.mjs    ← daemon＋38 端点契约（纯数据，两端共享）
├── chapters / libraryManage / agentStore / suites / stylePacks / runtimes / wikiHtml
├── public/                        ← 工作台单页（无构建依赖）
├── suites/ + styles/ + runtimes/  ← 三类插件货架（内置）＋ PROTOCOL.md（套件注册协议）
├── core/                          ← 底座抽取层（以 pinax-core 为原型；VENDORED.md 记出处）
└── test/                          ← 79 例
```

## 出处与致谢

OpenStory 自 [Pinax-next](https://github.com/skkbsgzf/Pinax-StoryHarness) 的 openstory/ 线（OS-1→OS-17 批次，2026-11-14~15）独立而来；底座模块逐字 vendor 自同仓（见 [core/VENDORED.md](./core/VENDORED.md)），后续按底座抽取路线升格。设计对标 OpenDesign（dsHarness 生态）的插件接入方式。
