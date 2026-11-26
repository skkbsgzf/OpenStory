# 派发头部硬约束（施工方每张单都会收到这一份）

> 每行一条，原样注入派发提示词的「项目硬约束（违反即返工）」段，取代 `.zcode/dispatch.mjs` 里那份过时的缺省规则。
> 这里只放施工时必须照办的硬条；派发流程、门禁清单与交付格式见 [`COMMON-RULES.md`](COMMON-RULES.md)。**本文件不要写代码块、不要写小标题**——每一行都会被当成一条规则。

1. 既有测试只许新增或等价加强：不许删除、skip、放宽断言；工单点名的合法改写要逐处说明，改写后的断言不弱于原来。
2. 零 npm 依赖、零构建：package.json 的版本号与依赖不许动（工单明确允许时才可改 scripts）；前端与后端都不许 import 第三方库。
3. public/app.js 只许减不许增（修 bug 除外）；渲染函数一律进 public/views/；views/*.mjs 之间不许互相 import（依赖由 app.js 注入），视图模块里不许有 eval／new Function／with。
4. 前端颜色、字号、间距只准用令牌：颜色走 public/index.html 的 :root（新令牌同步进 design-system/tokens.css）；字号只用 --ui-fs-*，间距只用 --ui-gap-* 或 calc(Npx * var(--ui-scale))；令牌定义区之外不许裸色值、不许裸写像素字号。新 UI 优先用 .uikit-* 组件与既有组件类（docs/UI-KIT.md）。
5. 前端零浏览器存储：public/** 任何文件（连注释都算）不许出现 localStorage、sessionStorage、indexedDB、document.cookie、caches.open、serviceWorker 这些字样；界面状态一律落库内 .openstory/ui-state.json。
6. daemon 只监听 127.0.0.1；凭据只存本机且响应只回掩码。
7. 8807 上的常驻 daemon 是作者在用的旧进程：不重启、不杀、不连接；也不许起任何固定端口的服务。要验证端到端，一律 startDaemon({ port: 0 }) 起临时进程。
8. 测试一律用临时夹具库与临时 LOCALAPPDATA（mkdtemp）；绝不碰 D:/Projects/**、真实的 %LOCALAPPDATA%\OpenStory\ 与 %LOCALAPPDATA%\PinaxNext\；测试里不许出现本机绝对路径，不许依赖本机装了什么。
9. 外部契约名不动：端点路径与 MCP 工具名不改；响应只许在工单写明处新增字段。
10. 三名一致：新增或改名面向用户的概念，先改命名表 public/views/registry.mjs；显示名＝库内目录名＝修改日志模块名，一个正名只许一个 slug，不许另起名。
11. 与 Pinax 的边界：产品代码不许出现 pinax 旧名（只有 src/protocol/libraryUpgrade.mjs 与出处注释可以）；出处声明不许删。
12. 模块边界：模块不许直引别的模块的内部实现；内核件只经能力句柄（context.resolve）或底座契约取用；src/protocol/ 只放底座契约，新增文件必须登记进 src/protocol/README.md。
13. 「已实现」的口径：新机制必须有生产调用方、在真实请求路径上生效——只有测试在调的不算实现；交付时在 VERIFIED 里贴出调用点（文件:行）。做不到就如实写进 LIMITATIONS，不许用「框架就位」交差。
14. 不执行任何 git 写操作（不 add／commit／push）；不动 .zcode/；临时探针、调试脚本用完必须删。
15. 遇到门禁不可能通过、或规格互相矛盾：停下来如实上报；不许删断言、加白名单或扩大豁免来凑绿。
16. 自验如实：VERIFIED 只写自己实际跑过的命令与输出，没跑的不许写成通过；施工回报不写「已验收」。
17. 收尾必做且按序：npm run arch:stats 回写文档 → node tools/number-anchors.mjs 回写数字锚 → node tools/acceptance/acceptance.mjs 必须全绿。
