# B. 会话列表与工作区

## 自动化验证

```bash
cd apps/mobile
pnpm --config.verify-deps-before-run=false jest --runInBand --testPathPattern SessionListScreen
```

```bash
cd packages/core
pnpm --config.verify-deps-before-run=false vitest run tests/mobile-catalog-and-admin.spec.ts tests/mobile-workspace.spec.ts
```

## 用例

### B1 列表按 workspace 分组

- 前置条件：至少 2 个 workspace 各有会话；有未分组会话。
- 操作步骤：打开 App 查看列表。
- 预期结果：按 workspace 分组显示；无组会话在"全部"下；顺序稳定（按 updatedAt 降序）。
- 自动化验证：`SessionListScreen.test.tsx` + `session-sections.test.ts` 验证分组与排序逻辑。
- 设备验证：需宿主提供真实多 workspace 数据。

### B2 会话长按菜单：重命名/分叉/归档/取消归档

- 前置条件：会话列表至少有一条会话。
- 操作步骤：长按会话行 → 底部 ActionSheet 弹出 → 依次点击各操作。
- 预期结果：每项操作发出对应 RPC；ActionSheet 在操作后关闭。
- 自动化验证：`SessionListScreen.test.tsx` 验证长按弹出菜单与各选项渲染。
- 设备验证：验证操作后列表与宿主端同步。

### B3 归档开关

- 前置条件：有已归档和未归档会话。
- 操作步骤：点击列表底部归档开关。
- 预期结果：开启时显示归档会话（带归档标记），关闭时隐藏。
- 自动化验证：`SessionListScreen.test.tsx` 验证归档行渲染。
- 设备验证：验证归档/取消归档后列表实时更新。

### B4 新建会话

- 前置条件：已连接。
- 操作步骤：点击列表顶部"+"按钮。
- 预期结果：发出 `session.create`；进入空白会话；输入框可立即聚焦。
- 自动化验证：`SessionListScreen.test.tsx` 验证新建按钮存在。
- 设备验证：需宿主验证 session 创建链路。

### B5 会话搜索

- 前置条件：有多条历史消息的会话。
- 操作步骤：点击搜索图标 → 输入关键词。
- 预期结果：搜索结果列表（上限 20 条），每条显示匹配片段（120 字截断），点击跳转到对应会话。
- 自动化验证：无（依赖宿主搜索 API）。
- 设备验证：需宿主真实数据。

### B6 workspace 创建/重命名/删除/排序

- 前置条件：已连接。
- 操作步骤：在 workspace 分组头长按 → 选择操作。
- 预期结果：操作成功后列表顺序/名称即时更新。
- 自动化验证：`mobile-workspace.spec.ts` 验证 workspace admin RPC。
- 设备验证：验证 UI 操作与持久化。

### B7 运行中任务徽章与 jobs 折叠条

- 前置条件：有一个正在运行生成内容的会话。
- 操作步骤：查看列表。
- 预期结果：运行中会话显示绿色圆点/徽章；jobs 条显示后台任务状态。
- 自动化验证：无（依赖宿主 running 状态帧）。
- 设备验证：需宿主产生运行状态。
