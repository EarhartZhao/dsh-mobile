# H. 模型、预设、权限、技能、子代理

## 自动化验证

```bash
cd apps/mobile
pnpm --config.verify-deps-before-run=false jest --runInBand --testPathPattern "session-references|plugin-inventory"
```

```bash
cd packages/core
pnpm --config.verify-deps-before-run=false vitest run tests/compatibility.spec.ts
```

## 用例

### H1 模型 chip 切换

- 前置条件：宿主配置了多个模型。
- 操作步骤：点击模型 chip → 从候选列表选择新模型。
- 预期结果：`session.selectModel` 发送；chip 文本更新。
- 自动化验证：无。
- 设备验证：需宿主。

### H2 模型路由不可用提示

- 前置条件：某 provider 不可达。
- 操作步骤：查看模型选择菜单。
- 预期结果：失败 provider 标记不可选；已选模型不可用时提示。
- 自动化验证：无。
- 设备验证：需模拟 provider 失败。

### H3 Agent preset 选择

- 前置条件：宿主有多个 preset 且 `modeSelectionEnabled=true`。
- 操作步骤：点击 preset chip → 选择。
- 预期结果：`agentPreset.select` 发送；chip 更新。
- 自动化验证：`compatibility.spec.ts` 验证 `presetSelectionEnabled` 策略。
- 设备验证：需宿主。

### H4 宿主关闭模式选择时 preset 禁用

- 前置条件：`modeSelectionEnabled=false`。
- 操作步骤：查看 preset chip。
- 预期结果：chip 不可点击或隐藏。
- 自动化验证：`compatibility.spec.ts` 覆盖。
- 设备验证：不适用。

### H5 权限预设切换与 Full access 确认

- 前置条件：已连接。
- 操作步骤：点击权限 chip → 选择"Full access"。
- 预期结果：弹出 Alert 确认；确认后发送 `/permission danger-full-access`；取消不发送。
- 自动化验证：无。
- 设备验证：需宿主。

### H6 /skill 候选

- 前置条件：宿主有技能列表。
- 操作步骤：输入 `/skill` 或 `/`。
- 预期结果：候选菜单显示可用技能；选择后插入 `/skill <name> `。
- 自动化验证：无。
- 设备验证：需宿主。

### H7 @ 文件/会话引用

- 前置条件：宿主有会话列表和文件系统。
- 操作步骤：输入 `@`。
- 预期结果：候选菜单显示文件和会话；选择后插入为 chip 文本。
- 自动化验证：`session-references.test.ts` 验证候选和插入文本。
- 设备验证：验证 UI 交互。

### H8 子代理列表/查看/继续/打断

- 前置条件：agent 产生子代理。
- 操作步骤：点击子代理 chip → 查看 → 发送 follow-up → 点击打断。
- 预期结果：子代理面板展开；可发送 `subagent.prompt`；打断后 follow-up FIFO 恢复到主会话。
- 自动化验证：无。
- 设备验证：需宿主。
