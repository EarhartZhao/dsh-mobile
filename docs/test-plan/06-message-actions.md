# F. 消息操作：反馈、分叉、重发、搜索

## 自动化验证

```bash
cd packages/core
pnpm --config.verify-deps-before-run=false vitest run tests/mobile-feedback.spec.ts tests/mobile-workspace.spec.ts
```

## 用例

### F1 长按消息弹出操作菜单

- 前置条件：会话中有消息。
- 操作步骤：长按任一消息。
- 预期结果：ActionSheet 弹出，选项包括复制/分享/从这里分叉/重发新会话（user 消息）/Like/Dislike（assistant 消息）。
- 自动化验证：无。
- 设备验证：需真机长按。

### F2 复制/分享

- 前置条件：同 F1。
- 操作步骤：选择"复制"或"分享"。
- 预期结果：`Clipboard.setString` 或 `Share.share` 被调用，内容为消息文本。
- 自动化验证：无。
- 设备验证：验证剪贴板和分享面板。

### F3 从这里分叉

- 前置条件：同 F1。
- 操作步骤：长按某条消息 → 选择"从这里分叉"。
- 预期结果：`session.fork` 发送，`throughSeq` 为该消息 seq；新会话包含到该消息为止的历史。
- 自动化验证：`mobile-workspace.spec.ts` 验证分叉 RPC。
- 设备验证：验证新会话内容。

### F4 重发到新会话

- 前置条件：同 F1，长按 user 消息。
- 操作步骤：选择"重发"。
- 预期结果：创建新会话并自动发送相同内容。
- 自动化验证：无。
- 设备验证：需宿主。

### F5 Like/Dislike 反馈

- 前置条件：同 F1，长按 assistant 消息。
- 操作步骤：选择 Like → 再次长按选择取消。
- 预期结果：`mobileFeedback` RPC 发送 `rating:'positive'` → `'clear'`；消息旁显示徽标。
- 自动化验证：`mobile-feedback.spec.ts` 验证 RPC、CAS 重试、清除。
- 设备验证：验证徽标视觉。

### F6 消息操作菜单反馈清除

- 前置条件：消息已有 Like/Dislike。
- 操作步骤：长按 → 选择"取消评分"。
- 预期结果：评分清除，徽标消失。
- 自动化验证：`mobile-feedback.spec.ts` 覆盖。
- 设备验证：不适用。
