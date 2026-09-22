# L. 健壮性与恢复

## 自动化验证

```bash
cd packages/core
pnpm --config.verify-deps-before-run=false vitest run tests/connection-failure.spec.ts tests/nats-integration.spec.ts
```

## 用例

### L1 弱网/WiFi 与蜂窝切换自动重连

- 前置条件：已连接。
- 操作步骤：在 WiFi 和蜂窝之间切换。
- 预期结果：状态 disconnected → connecting → online；不丢 pending approval/question；事件流从断点续传。
- 自动化验证：`connection-failure.spec.ts` 验证状态机。
- 设备验证：需真机网络切换。

### L2 事件流断开整体重建

- 前置条件：已连接。
- 操作步骤：人为断开 mux 或 host SSE 流。
- 预期结果：`resetLiveSnapshots()` 清空所有会话的 queue/jobs/projections/pendingApprovals/pendingQuestions/running；重新 establish；baseline 重拉。
- 自动化验证：`session-store.spec.ts` 验证 `resetLiveSnapshots`。
- 设备验证：需模拟。

### L3 变更流断开显式提示

- 前置条件：目录浏览器打开。
- 操作步骤：断开宿主文件变更流。
- 预期结果：显示明确的流错误提示；不静默失败。
- 自动化验证：`nats-integration.spec.ts` 验证 stream/error 帧。
- 设备验证：需宿主。

### L4 发送/加载失败有兜底

- 前置条件：网络断开时操作。
- 操作步骤：发送消息/加载图片/回答提问。
- 预期结果：消息草稿保留；图片显示失败态可重试；提问显示错误提示；无永久卡住。
- 自动化验证：`AttachmentImage.test.tsx` 验证图片；`session-store.spec.ts` 验证 `resolveQuestion`。
- 设备验证：需模拟断连。

### L5 待审批/待提问重放

- 前置条件：有 pending approval/question 时断连后重连。
- 操作步骤：重连后观察。
- 预期结果：pending 项重新出现（hello 重放或 baseline 重建）；用户可继续操作。
- 自动化验证：`nats-integration.spec.ts` 验证 hello 重放。
- 设备验证：需宿主产生 pending 项。
