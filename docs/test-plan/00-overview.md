# 测试策略与覆盖总览

## 范围

dsh-mobile 是 React Native Android 客户端，通过 NATS 连接 deepseek-harness
Web profile。测试范围分三层：

1. **packages/protocol**：wire schema、RPC carrier、NATS 映射。
2. **packages/core**：SessionStore 状态推导、连接生命周期、对话分组、统计。
3. **apps/mobile**：RN 屏幕/组件/纯逻辑（输入校验、路径、偏好、i18n）。

dsh-mobile-plugin（NATS 桥）在独立仓库 `C:\code\deepseek\dsh-mobile-plugin`
有自有 vitest，不重复覆盖。

## 方法

- 纯函数输入：单元测试（vitest / jest），覆盖边界与非法值。
- 屏幕渲染：React Native 浅渲染测试（jest + react-test-renderer）。
- 状态推导：Store 层测试，注入 mux/host 帧验证推导结果。
- 端到端：NATS 集成测试（真实 NATS broker）验证 carrier 链路。
- 用户旅程：模拟用户全部操作流程（17 步）在真实 NATS broker 上逐步执行。
- 设备：手工操作清单，按功能域文件中的步骤逐步执行。

## 自动化覆盖现状（2026-09-22）

| 层 | 测试文件数 | 用例数 | 备注 |
|---|---|---|---|
| packages/core + protocol | 12 specs | 72 tests | 含 10 条 NATS 集成 |
| apps/mobile | 13 suites | 77 tests | 含本轮新增 17 条图片/组件测试 |
| 合计 | 24 | 149 | |

命令：

```bash
# 根目录（core + protocol）
pnpm --config.verify-deps-before-run=false run test
pnpm --config.verify-deps-before-run=false run typecheck

# apps/mobile
cd apps/mobile
pnpm --config.verify-deps-before-run=false run test --runInBand
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false run lint   # 0 errors 即通过
```

用户旅程测试（模拟用户输入全流程）：

```bash
cd packages/core
pnpm --config.verify-deps-before-run=false run test -- --spec user-journey
```

## 功能域覆盖矩阵

| 域 | 文件 | 自动化 | 设备 |
|---|---|---|---|
| 配对/连接 | `01-pairing-connection.md` | ◐ | ◐ |
| 会话列表 | `02-session-list.md` | ◐ | ◐ |
| 对话 | `03-chat-input.md` | ◐ | ◐ |
| 附件 | `04-attachments.md` | ● | ◐ |
| 执行控制 | `05-execution-control.md` | ○ | ● |
| 消息操作 | `06-message-actions.md` | ◐ | ◐ |
| 任务上下文 | `07-task-context.md` | ◐ | ◐ |
| 模型/权限 | `08-model-preset-permission.md` | ◐ | ◐ |
| 工作区文件 | `09-workspace-files.md` | ◐ | ◐ |
| 设置/平台 | `10-settings-platform.md` | ◐ | ◐ |
| 健壮性 | `11-robustness.md` | ◐ | ◐ |

## 已知缺陷修复记录

| 日期 | 问题 | 修复 | 测试 |
|---|---|---|---|
| 2026-09-22 | 历史图片失败永久"加载中" | 共享 `AttachmentImage`，失败态可重试 | `AttachmentImage.test.tsx` 6 条 |
| 2026-09-22 | 图片 payload 组装与校验无单测 | 纯函数 `chat-images.ts` + 11 条单测 | `chat-images.test.ts` |
| 2026-09-22 | 问答弹窗提交后永远禁用 | `resolveQuestion` 乐观清除 + `accepted` 检查 | `session-store.spec.ts` 新增 1 条 |

