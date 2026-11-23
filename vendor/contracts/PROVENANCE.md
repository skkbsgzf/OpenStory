# PROVENANCE — vendor/contracts 收编出处

`vendor/contracts/` 下的文件**逐字收编**自 npm 包 `@pinax/core`（上游仓
[Recoletas/pinax-core](https://github.com/Recoletas/pinax-core) 的抽包产物）。
本目录文件在本仓**不改**；改动应发生在上游（本地克隆 `D:/Pinax-core`）再同步。

| 本仓文件 | 收编自 | 上游提交 |
|---|---|---|
| `worldbookFileContract.js` | @pinax/core **0.16.0** 的 `src/domain/worldbookFileContract.js` | pinax-core `e56a0bc133efdb675be17af95f0967cdf2e11e16` |

收编载体 tgz：`vendor/core/pinax-core-0.16.0.tgz`
（sha256 `db662543eda2094042f65231088a156da91acd9f1e6810345e5d583ee216b077`，
integrity `sha512-y4HoYKmse3uXleYge57e0LF+i4w+J3IDXZjEDX9Pps6MRKqw0iyGuHpmArz25PQ2a0NOBFDZ9cr33U41YEMtwQ==`，
详见 `vendor/core/pinax-core-0.16.0.provenance.json`）。收编日期 2026-11-23（OS-132）。

## 收编口径

- 除 `worldbookFileContract.js` 文件头的出处注释外，与上游**逐字节一致**（上游文件
  e56a0bc↔HEAD 零 diff；tgz 内容是 LF，`D:/Pinax-core` Windows 检出是 CRLF，
  行尾归一化后两侧同源）。上游是 ESM（`"type": "module"`），本仓同 ESM，原样直用。
- 收编原因：`@pinax/core` 当时只剩这一个消费点（`textUtil.mjs` 的契约判定＋
  `test/decoupleStep1.test.mjs` 的 serialize 护栏），`lexiconFileContract` 已无消费方——
  为最后一个文件挂整份 file: tgz 依赖不值得（OS-132 收编，依赖条目已从 package.json 删除；
  tgz 与 provenance json 留在 `vendor/core/` 作审计凭证）。

## 漂移检测

`scripts/vendor-drift.mjs` 的 **pinaxCore 段**（`vendor/contracts/` ↔ `D:/Pinax-core/src/domain`，
锚 `upstreamCommit=e56a0bc`）逐文件比对：

```bash
node scripts/vendor-drift.mjs check      # 漂移 → exit 1
node scripts/vendor-drift.mjs snapshot   # 重生成 core/.vendored-manifest.json
```

注意：该段哈希是**行尾归一化**（去 `\r` 后 sha256）——因为 tgz 载体是 LF 而上游
Windows 检出是 CRLF，原始字节比对会恒误报；本仓文件若被重新检出也可能变 CRLF，
归一化对两侧同样免疫。core/pinax 的 pinaxNext 段仍按原始字节比对（两仓同为 CRLF 检出）。
