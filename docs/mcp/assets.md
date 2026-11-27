# 素材、视觉与生图域

扮演素材按事实书放在 `扮演/<bookId>/素材/{角色,场景,bgm}`。素材读写有扩展名、文件签名与大小限制，不是任意文件通道；世界书图片则用于文学白描或条目设定图。

## 素材工具

| 工具 | 必填参数 | 用途与边界 | 最低确认 |
|---|---|---|---|
| `openstory_assets` | `root` | 盘点 `characters/scenes/bgm`；`bookId` 可选，目录不存在是合法空态 | read |
| `openstory_asset_read` | `root,path` | 读 `.png/.mp3`（≤16MB），返回 `mediaType/bytes/dataUrl`；`bookId` 可选 | read |
| `openstory_asset_put` | `root,path,dataBase64` | 严格 base64 写入 PNG/MP3；验扩展名与真实签名，≤16MB；`bookId/overwrite` 可选 | create |
| `openstory_deduce_image` | `root,name,prompt` | 为当前推演局面生图并落到扮演素材；`bookId/size/stylePrompt/negative` 可选 | create |

## 盘点与读取

```text
openstory_assets {root,bookId}
  → characters / scenes / bgm

openstory_asset_read {root,bookId,path:"角色/沈岚.png"}
  → path / mediaType / bytes / dataUrl
```

`path` 是素材目录内的相对路径。工具会拒绝路径越界、异盘符、异扩展名与缺档；读取上限 16MB。空素材目录不是错误，先用 `openstory_assets` 判断有哪些素材。

## 写入素材

```text
openstory_asset_put {
  root,bookId,path:"角色/沈岚.png",
  dataBase64:"严格 base64",
  overwrite:false,
  confirm:"create"
}
```

只接受对应扩展名与真实文件签名：PNG 素材用 `.png`，音频用 `.mp3`。默认不覆盖；`overwrite:true` 会先把旧档备份进 `.history` 并记录二进制 hash 日志。写入后重新 `openstory_assets` 盘点并 `openstory_asset_read` 回读。

## 推演生图

`openstory_deduce_image` 需要配置可用的生图后端。`name` 是素材名，`prompt` 是画面描述；`size`、`stylePrompt`、`negative` 可选。它写文件，必须提供 create 级确认。模型不可用返回 `AGENT_NOT_CONFIGURED` 或上游错误，不能把失败当空素材成功。

## 视觉工具

| 工具 | 必填参数 | 用途与边界 | 最低确认 |
|---|---|---|---|
| `openstory_vision_describe` | `root,image` | 为库内图片写 150–300 字文学白描；`target/focus` 可选 | read |
| `openstory_image_generate` | `root,path` | 为世界书条目生成设定图并回填 frontmatter；`prompt/stylePrompt/size` 可选 | create |

`openstory_vision_describe` 的 `image` 是库内图片相对路径；`target` 可为 `character/scene/creature/item`，`focus` 指定想抓的细节。产出是可直接进世界书的文学白描，也可作生图提示底稿，需要视觉/DSH 运行时，不是确定性纯文本分析。

`openstory_image_generate` 的 `path` 是 `世界书/` 下条目路径。`prompt` 省略时按条目名与摘要推导画面，`stylePrompt` 可覆盖默认风格；图片落条目旁 `assets/` 并回填 `cover/images`。它修改条目元数据，使用 create 级确认，写后回读世界书笔记与素材确认。
