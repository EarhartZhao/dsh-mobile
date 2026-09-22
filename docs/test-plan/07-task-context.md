# G. 任务上下文：Todo/Goal/Plan/Stats/Compaction

## 自动化验证

```bash
cd packages/core
pnpm --config.verify-deps-before-run=false vitest run tests/stats.spec.ts tests/session-store.spec.ts
```

## 用例

### G1 Todo 条显示与折叠

- 前置条件：agent 创建了 todo 列表。
- 操作步骤：观察 Todo 条 → 点击折叠/展开。
- 预期结果：显示 `N/M` 计数；状态图标正确（pending/in_progress/completed）；折叠后只显示计数。
- 自动化验证：`session-store.spec.ts` 验证 `todo/write` 事件解析。
- 设备验证：需宿主产生 todo。

### G2 Goal 创建/编辑/暂停/恢复/完成/清除

- 前置条件：已连接。
- 操作步骤：通过 `/goal create <text>` 等命令操作。
- 预期结果：Goal 条实时更新状态（active/paused/completed）；操作后 host 帧 `session/event goal/*` 同步。
- 自动化验证：无（依赖宿主命令）。
- 设备验证：需宿主。

### G3 Plan chip 进入/退出

- 前置条件：agent 发起 plan review。
- 操作步骤：观察 Plan chip → 审批/拒绝。
- 预期结果：Plan review 卡片显示 plan 内容与审批/拒绝按钮；审批后 chip 消失。
- 自动化验证：`QuestionCard` 组件处理 plan review intent。
- 设备验证：需宿主。

### G4 上下文用量条

- 前置条件：会话有 usage 数据。
- 操作步骤：观察底部统计条。
- 预期结果：显示 input/output/cacheRead/reasoning tokens；历史翻页不丢失。
- 自动化验证：`stats.spec.ts` 验证统计计算。
- 设备验证：验证视觉。

### G5 compaction 摘要

- 前置条件：上下文超限触发 compaction。
- 操作步骤：观察 compaction 标记。
- 预期结果：摘要显示在正确位置，折叠正确。
- 自动化验证：无。
- 设备验证：需宿主长对话。

### G6 会话元信息头

- 前置条件：会话有 cwd/preset/父会话。
- 操作步骤：查看会话头部。
- 预期结果：显示目录、preset 名称、父会话（子代理时）、最后更新时间。
- 自动化验证：无。
- 设备验证：需宿主数据。
