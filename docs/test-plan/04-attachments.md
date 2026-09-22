# D. 附件：图片与文件

## 自动化验证

```bash
cd apps/mobile
pnpm --config.verify-deps-before-run=false jest --runInBand --testPathPattern "chat-images|AttachmentImage"
```

```bash
cd packages/core
pnpm --config.verify-deps-before-run=false vitest run tests/file-upload.spec.ts
```

## 用例

### D1 图片格式校验

- 前置条件：无。
- 操作步骤：调用 `validatePendingImage` 传入 PNG/JPEG/WEBP/GIF 及不支持的格式。
- 预期结果：支持的格式通过；不支持的格式返回 `ImageRejection`，`reason='format'`。
- 自动化验证：`chat-images.test.ts` 覆盖。
- 设备验证：不适用。

### D2 单张图片大小/边长/像素校验

- 前置条件：设置 `maxImageBytes=1MB`、`maxImageSide=4096`、`maxImagePixels=16M`。
- 操作步骤：分别传入超大小、超边长、超像素的图片。
- 预期结果：各维度独立拒绝，`reason` 分别为 `'size'`/`'side'`/`'pixels'`，提示包含格式化后的大小。
- 自动化验证：`chat-images.test.ts` 覆盖。
- 设备验证：不适用。

### D3 张数与消息总字节校验

- 前置条件：`maxImages=3`、`maxMessageBytes=1MB`。
- 操作步骤：追加第 4 张图；追加多张累计超总字节的图。
- 预期结果：张数超限返回 `'count'`；总字节超限返回 `'totalSize'`，提示包含总大小。
- 自动化验证：`chat-images.test.ts` 覆盖。
- 设备验证：不适用。

### D4 无效单图不入批

- 前置条件：已有 1 张合法图。
- 操作步骤：追加 1 张非法图。
- 预期结果：`appendPendingImage` 返回 rejection；原数组不变（不可变更新）。
- 自动化验证：`chat-images.test.ts` 覆盖。
- 设备验证：不适用。

### D5 发送 payload 组装

- 前置条件：1 条文本 + 2 张图片 + 1 个文件。
- 操作步骤：调用 `buildPromptContent`。
- 预期结果：返回 `[{type:'text'},{type:'image'},{type:'image'},{type:'file'}]`；图片含 `mediaType`/`data`；文件含 `name`；空 text 不产生 text part；name 为 null 时省略。
- 自动化验证：`chat-images.test.ts` 覆盖。
- 设备验证：不适用。

### D6 历史附件图片加载与失败态

- 前置条件：会话历史含图片 attachment。
- 操作步骤：查看历史消息中的图片。
- 预期结果：data URI 图直出；attachment URI 经 `sessions.attachment` 拉取后设置 source；拉取失败显示"图片加载失败，点此重试"而非"加载中"；点击重试重新加载。
- 自动化验证：`AttachmentImage.test.tsx` 覆盖 6 条（data 直出、attachment 成功、失败态、点击重试、断连快速失败、重连自动加载）。
- 设备验证：验证真实宿主图片。

### D7 断连时图片快速失败 + 重连自动加载

- 前置条件：正在加载历史图片时断连。
- 操作步骤：断开网络 → 重连。
- 预期结果：断连时立即失败显示错误；重连后 `manager.client` 变化触发 useEffect 重新加载。
- 自动化验证：`AttachmentImage.test.tsx` 覆盖。
- 设备验证：需真机网络切换。

### D8 图片灯箱预览

- 前置条件：消息中有已加载的图片。
- 操作步骤：点击图片。
- 预期结果：全屏灯箱弹出，可缩放/关闭。
- 自动化验证：无。
- 设备验证：需真机手势。

### D9 通用文件选择上传

- 前置条件：已连接。
- 操作步骤：点击"+"→ 选择文件 → 发送。
- 预期结果：`fileUploads.upload` 返回 receipt → 发送 payload `type:'file'`；上传中发送按钮禁用。
- 自动化验证：`file-upload.spec.ts` 覆盖上传→发送链路。
- 设备验证：验证原生文件选择器。

### D10 文件上传失败

- 前置条件：上传时网络断开或宿主拒绝。
- 操作步骤：选择文件 → 观察结果。
- 预期结果：错误 chip 显示，发送不被卡住，可重选文件。
- 自动化验证：无。
- 设备验证：需模拟。
