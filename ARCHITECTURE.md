# OpenStory 架构

## 分层

```
┌─ 浏览器 / DSH webview ─────────────────────────────┐
│  工作台（public/ 单页，无构建依赖）                    │
│  框架层：顶栏（库切换/设置）/ 页签纯工作面 / Agent 左列  │
│  业务页：产物｜正文｜世界书｜大纲｜…｜Wiki｜推演        │
└──────────────┬─────────────────────────────────┘
               │ HTTP（127.0.0.1，JSON＋SSE）
┌──────────────▼─────────────────────────────────┐
│  daemon（daemon.mjs，唯一磁盘层）                  │
│  · 38 端点契约（contracts.mjs，两端共享纯数据）      │
│  · 文件绑定 API：库/条目/章节/wiki/产物             │
│  · Agent 通道：会话 JSONL＋运行时 kit 转发（Pi 兜底） │
│  · 套件/风格包/运行时 三类货架装载                  │
└──────────────┬─────────────────────────────────┘
┌──────────────▼─────────────────────────────────┐
│  core/（底座抽取层——以 pinax-core 为原型）           │
│  载体清单注册表 / 建库内核 / 依赖闭包 / 导入适配      │
│  现状：逐字 vendor 自 Pinax-next（VENDORED.md）     │
└──────────────┬─────────────────────────────────┘
               │
┌──────────────▼─────────────────────────────────┐
│  磁盘（数据真源）                                  │
│  库＝文件夹（.pinax 兼容）＋本机插件货架              │
│  %LOCALAPPDATA%/PinaxNext/openstory/{suites,styles,runtimes} │
└───────────────────────────────────────────────┘
```

## 插件生态（三层货架，协议各自成文）

| 层 | 协议 | 管什么 | 注册方式 |
|---|---|---|---|
| 业务套件 | [PROTOCOL.md](./PROTOCOL.md)（openstory-suite@2） | 业务域默认规则＋独立设置页＋（未来）业务页/工作流 | 目录＋manifest；capabilities 能力声明；宿主按声明加载 |
| Agent 运行时 kit | openstory-runtime-kit@1（`openstory/runtimes/README.md`） | 模型对话通道（sidecar/endpoint） | 目录＋manifest；chat 面＝OpenAI 兼容 SSE |
| 风格包 | tokens JSON | 整窗换肤＋栅格密度 | 目录＋tokens |

共同规则：**本机目录按 id 覆盖内置**；坏档跳过＋warning 不拖垮货架；停用＝规则退回内置默认（值保留）；凭据只存本机。

## 与 Pinax 的关系

- 同一份文件资产、两个壳：Pinax（Electron 深度形态）与 OpenStory（浏览器轻形态）。
- core/ 现为逐字 vendor（Pinax-next@70a4f44，单间依赖方向 openstory→core，Pinax 从不 import OpenStory）；
  底座抽取路线：core/ 层按 pinax-core 的抽包模式（清单与内核上收、实现下沉）逐步升格为独立底座包。
- 两侧设置互不干扰：OpenStory 的套件/运行时/风格配置全部只存本机 openstory 目录。

## 演进约定

- 契约先行：API 变更先改 contracts.mjs（纯数据），两端一起跟。
- 每批「界面上能看到新东西」；demo 数据退役一批、真数据上位一批。
- 插件协议升级走 schemaVersion（@2 起精确匹配＋@1 兼容读），不做半懂兼容。
