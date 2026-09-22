# E. 执行控制：队列、取消、审批、命令

## 自动化验证

此域主要依赖宿主实时状态，纯自动化覆盖有限。Queue/store 层测试：

```bash
cd packages/core
pnpm --config.verify-deps-before-run=false vitest run tests/session-store.spec.ts
```

## 用例

### E1 队列 dock 出现与实时更新

- 前置条件：会话正在运行。
- 操作步骤：发送一条消息 → 观察队列区域。
- 预期结果：队列 dock 显示新增项（placement=queued/steering）；`session/queue` 帧更新时列表实时刷新。
- 自动化验证：`session-store.spec.ts` 验证 queue 帧处理。
- 设备验证：需宿主。

### E2 队列项编辑

- 前置条件：队列中至少有一条排队消息。
- 操作步骤：点击队列项 → 编辑文本 → 确认。
- 预期结果：`session.updateQueue` 发送 `action:{kind:'edit'}`；宿主确认后列表更新。
- 自动化验证：无。
- 设备验证：需宿主。

### E3 队列项引导（steering）

- 前置条件：同 E2。
- 操作步骤：点击队列项 → 选择"引导"。
- 预期结果：`action:{kind:'steer'}`；消息从 queued 变为 steering。
- 自动化验证：无。
- 设备验证：需宿主。

### E4 队列项删除

- 前置条件：同 E2。
- 操作步骤：点击队列项 → 删除。
- 预期结果：`action:{kind:'remove'}`；宿主确认后从列表消失。
- 自动化验证：无。
- 设备验证：需宿主。

### E5 审批请求弹出与回答

- 前置条件：agent 调用需要审批的工具。
- 操作步骤：观察审批条 → 点击"允许一次"/"拒绝"。
- 预期结果：`client.respond` 发送 `{ok:true, value:{sessionId, outcome}}`；宿主确认后审批条消失。
- 自动化验证：无（ChatScreen 审批逻辑依赖宿主帧）。
- 设备验证：需宿主触发审批。

### E6 问答弹窗提交与关闭

- 前置条件：agent 调用 `ask_user_question`。
- 操作步骤：选择选项 → 点击"提交回答"；或点击"关闭"。
- 预期结果：提交后弹窗立即消失（乐观清除）；bridge `accepted:false` 时显示"回答已过期"错误并保持弹窗可操作。
- 自动化验证：`session-store.spec.ts` 验证 `resolveQuestion` 乐观清除。
- 设备验证：需宿主触发提问。

### E7 斜杠命令执行

- 前置条件：已连接。
- 操作步骤：输入 `/help` 或其他命令 → 发送。
- 预期结果：命令作为消息发送；宿主返回结果提示条。
- 自动化验证：无。
- 设备验证：需宿主。

### E8 动态命令目录

- 前置条件：宿主支持 command.list。
- 操作步骤：输入 `/` 触发命令候选菜单。
- 预期结果：显示宿主提供的命令列表；选择后填入输入框。
- 自动化验证：无。
- 设备验证：需宿主。
