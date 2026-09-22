# dsh-mobile 测试技能

> 本文件说明如何使用 `docs/test-plan/` 目录下的测试用例与流程来验证
> dsh-mobile 的全部功能。每次功能变更、回归或发布前都应按此执行。

## 1. 快速开始

### 运行全部自动化测试

```bash
# 在 dsh-mobile 根目录执行（core + protocol + mobile）
pnpm --config.verify-deps-before-run=false run test
pnpm --config.verify-deps-before-run=false run typecheck
cd apps/mobile && pnpm --config.verify-deps-before-run=false run test --runInBand && pnpm --config.verify-deps-before-run=false run typecheck && pnpm --config.verify-deps-before-run=false run lint
```

### 运行单个域的自动化测试

每个功能域文件末尾列出对应的自动化命令，例如验证配对/连接：

```bash
cd packages/core && pnpm --config.verify-deps-before-run=false vitest run tests/connection-failure.spec.ts tests/nats-integration.spec.ts
```

### 运行设备手工验收

需要 Android 模拟器/真机 + 运行中的 dsh Web profile（含 dsh-mobile-plugin）。
按对应功能域文件中的"手工流程"逐步操作，每步标记通过/失败。

## 2. 测试目录结构

| 文件 | 功能域 | 自动化 | 设备 |
|---|---|---|---|
| `00-overview.md` | 策略/方法/覆盖总览 | - | - |
| `01-pairing-connection.md` | 配对、连接、兼容性 | ◐ | ◐ |
| `02-session-list.md` | 会话列表、工作区 | ◐ | ◐ |
| `03-chat-input.md` | 对话输入、发送、流式 | ◐ | ◐ |
| `04-attachments.md` | 图片与文件附件 | ● | ◐ |
| `05-execution-control.md` | 队列、取消、审批、命令 | ○ | ● |
| `06-message-actions.md` | 消息操作、反馈、分叉 | ◐ | ◐ |
| `07-task-context.md` | Todo/Goal/Plan/Stats | ◐ | ◐ |
| `08-model-preset-permission.md` | 模型/预设/权限/技能/子代理 | ◐ | ◐ |
| `09-workspace-files.md` | 工作区文件浏览与预览 | ◐ | ◐ |
| `10-settings-platform.md` | 设置/主题/语言/诊断/Android | ◐ | ◐ |
| `11-robustness.md` | 健壮性、断连、恢复 | ◐ | ◐ |

符号：● = 全自动可验证，◐ = 部分自动 + 部分设备，○ = 纯设备手工。

## 3. 用例格式

每个功能域文件中的用例按以下格式编写：

```
### [ID] 用例标题

- 前置条件：...
- 操作步骤：...
- 预期结果：...
- 自动化验证：<命令或测试文件>（或"需设备"）
- 设备验证：步骤编号或"不适用"
```

## 4. 自动化输入验证

"自动输入验证"指：对用户可能输入的每种数据（文本、图片、文件、命令、
引用、配置值）在纯函数层进行边界/非法值测试，不需要真机。

现有覆盖：

| 模块 | 测试文件 | 覆盖内容 |
|---|---|---|
| 图片校验 | `apps/mobile/src/chat-images.test.ts` | 格式/大小/边长/像素/张数/总字节拒绝；合法放行；payload 组装 |
| 文件类型 | `apps/mobile/src/file-kinds.test.ts` | MIME → 图标/分类映射 |
| 路径 | `apps/mobile/src/workspace-path.test.ts` | 路径规范化、~ 展开、分隔符 |
| 会话引用 | `apps/mobile/src/session-references.test.ts` | @ 候选、插入文本 |
| 偏好 | `apps/mobile/src/preferences.test.ts` | 主题/语言/回车发送持久化 |
| 兼容性 | `packages/core/tests/compatibility.spec.ts` | 插件版本/API 版本匹配 |
| 文件上传 | `packages/core/tests/file-upload.spec.ts` | 上传 receipt → 发送 payload |
| 统计 | `packages/core/tests/stats.spec.ts` | token 计数、翻页不丢 |

新增输入验证时：

1. 确定输入的纯函数模块（如 `chat-images.ts`、`preferences.ts`）。
2. 在同级 `*.test.ts` 中添加边界用例（空值/超限/非法格式/混合输入）。
3. 运行 `pnpm test` 确认通过。
4. 在对应功能域文件中更新用例的"自动化验证"列。

## 5. 回归清单

每次提交前至少跑：

```bash
pnpm --config.verify-deps-before-run=false run test          # core+protocol
cd apps/mobile && pnpm --config.verify-deps-before-run=false run test --runInBand
pnpm --config.verify-deps-before-run=false run typecheck
```

发布/合并前额外跑：

```bash
pnpm --config.verify-deps-before-run=false run lint           # 0 errors 即通过
```

涉及 UI 组件变更时在真机/模拟器上手工过对应功能域的"设备验证"项。

## 6. 新增功能时的操作

1. 在对应功能域文件中添加用例（按第 3 节格式）。
2. 如果新功能有用户输入，先写纯函数 + 单测（第 4 节）。
3. 如果新功能涉及屏幕渲染，写屏幕浅渲染测试（参考 `SessionListScreen.test.tsx`）。
4. 更新 `00-overview.md` 的覆盖统计。
5. 更新 `05-test-plan.md` 的用例矩阵（保持同步）。
