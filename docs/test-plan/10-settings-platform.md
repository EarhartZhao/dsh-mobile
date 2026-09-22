# J. 设置、主题、语言、诊断、插件 + K. Android 平台

## 自动化验证

```bash
cd apps/mobile
pnpm --config.verify-deps-before-run=false jest --runInBand --testPathPattern "SettingsScreen|preferences|plugin-inventory|system-back"
```

## 用例

### J1 主题切换与持久化

- 前置条件：App 已启动。
- 操作步骤：设置 → 主题 → 依次选择亮色/暗色/跟随系统。
- 预期结果：UI 立即切换；退出重进后保持。
- 自动化验证：`SettingsScreen.test.tsx` + `preferences.test.ts` 验证状态与持久化。
- 设备验证：验证原生 StatusBar 同步。

### J2 语言切换

- 前置条件：同 J1。
- 操作步骤：设置 → 语言 → 中文/English/跟随系统。
- 预期结果：所有屏幕文案切换；重进保持。
- 自动化验证：`SettingsScreen.test.tsx` 验证语言状态。
- 设备验证：验证全部屏幕无遗漏。

### J3 回车发送开关

- 前置条件：同 J1。
- 操作步骤：设置 → 开启/关闭"回车发送"。
- 预期结果：开启时 Enter 发送；关闭时 Enter 换行。
- 自动化验证：`preferences.test.ts` 覆盖。
- 设备验证：需真机键盘。

### J4 连接诊断

- 前置条件：已连接或连接失败。
- 操作步骤：设置 → 诊断。
- 预期结果：显示状态、版本、mobileApi、features、最近错误/状态事件、脱敏 JSON。
- 自动化验证：`plugin-inventory.test.ts` 验证清单格式。
- 设备验证：验证错误时的诊断信息。

### J5 插件清单

- 前置条件：宿主有插件。
- 操作步骤：设置 → 插件。
- 预期结果：只读列表显示模块名、启用状态、Fiber 阶段；刷新按钮重新拉取。
- 自动化验证：`plugin-inventory.test.ts` 覆盖。
- 设备验证：需宿主真实插件。

### J6 解绑设备

- 前置条件：已配对。
- 操作步骤：设置 → 解绑 → 确认。
- 预期结果：token 吊销；回到配对向导；旧 token 不再可用。
- 自动化验证：`SettingsScreen.test.tsx` 验证解绑流程。
- 设备验证：验证吊销后旧 token 被拒。

### K1 深链接 `dshmobile://new-session`

- 前置条件：App 已安装。
- 操作步骤：浏览器或命令行打开 `dshmobile://new-session`。
- 预期结果：App 唤起并创建新会话；连接未就绪时排队，上线后自动创建。
- 自动化验证：无。
- 设备验证：需真机。

### K2 桌面快捷方式

- 前置条件：App 已安装。
- 操作步骤：长按桌面图标 → 点击"新会话"。
- 预期结果：与 K1 相同。
- 自动化验证：无。
- 设备验证：需真机。

### K3 系统返回键

- 前置条件：App 运行中。
- 操作步骤：在输入态/弹窗态/列表页依次按返回键。
- 预期结果：逐层退出（关闭弹窗 → 清空输入 → 返回列表 → 最小化），不误关 App。
- 自动化验证：`system-back.test.ts` 覆盖层级逻辑。
- 设备验证：验证真机返回键。

### K4 网络策略

- 前置条件：release 与 debug 构建。
- 操作步骤：release 构建尝试 ws:// 明文连接。
- 预期结果：release 被系统阻止（`usesCleartextTraffic=false`）；debug 允许回环。
- 自动化验证：无。
- 设备验证：需两种构建。

### K5 主题切换后重载保持

- 前置条件：已设置暗色主题。
- 操作步骤：JS 重载（shake → Reload）。
- 预期结果：原生模式保存暗色；重载后 StatusBar 和 UI 保持一致。
- 自动化验证：无。
- 设备验证：需真机。
