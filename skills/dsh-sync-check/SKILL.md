---
name: dsh-sync-check
description: 检查 dsh（deepseek-harness）上游更新对 dsh-mobile 协议 vendor 和运行时的影响，并执行同步。
---

# DSH Sync Check

dsh 上游发版后，用本 skill 确认 dsh-mobile 的协议 vendor 树和 RPC 契约是否需要更新。

## 第一步：确认上游变更范围

```bash
# 在 deepseek-harness 仓库内
git -c safe.directory=C:/code/deepseek/deepseek-harness log --oneline HEAD~10..HEAD -- packages/api/ packages/interaction/ packages/goal/ packages/preset/ packages/subagent/ packages/context/
git -c safe.directory=C:/code/deepseek/deepseek-harness diff --stat HEAD~10..HEAD -- packages/api/ packages/interaction/ packages/goal/ packages/preset/ packages/subagent/ packages/context/
```

关注两类信号：

- **breaking**：commit message 含 `!`（如 `refactor(api)!: ...`）或涉及文件删除/重命名。
- **additive**：新增 RPC 路由、schema 字段或事件类型；不立即阻塞，但需要评估是否在移动端暴露。

## 第二步：检查协议 vendor 树

```bash
cd dsh-mobile
node scripts/sync-protocol.mjs --check
```

三种结果：

| 结果 | 含义 | 操作 |
|------|------|------|
| `frozen mobile wire verified ... Remote surface verified` | 旧移动 wire 未漂移，当前 Remote endpoint 仍存在 | 转第三步核对语义 |
| `frozen mobile wire changed` | 冻结 vendor 被篡改或遗漏 | 还原意外修改；有意升级需同步协议与 manifest |
| `Remote surface drifted` | Remote owner 文件、方法或流已移动/改名 | 对比上游并更新插件映射与 `REMOTE_ALPHA5.json` |

## 第三步：对比上游 API 契约变化

`packages/protocol/src/vendor/` 是已发布移动端 wire 的冻结快照，不再从已删除的 ApiProxy 复制。当前宿主契约由 `packages/protocol/src/REMOTE_ALPHA5.json` 列出并由插件适配。逐项核对：

1. Remote 方法名、命名参数和返回值。
2. `session/follow`、`session/page`、`session/control`、`workspace/follow` 的 baseline/增量语义。
3. `$events` ready/waterfall/cancel 与 `$events/result` generation 绑定。
4. 将变化同时映射到插件 `bridge.ts`/`events.ts`、App protocol/core 和测试。

## 第四步：更新版本兼容区间

如果 RPC 契约有 breaking change：

1. 更新 `packages/core/src/compatibility.ts` 中的 `APP_MOBILE_API`（+1）或 `SUPPORTED_PLUGIN_RANGE`。
2. 同步更新 `packages/core/src/index.ts` 导出的兼容性常量。
3. 更新 `apps/mobile/src/i18n.tsx` 中的兼容性提示文案。
4. 跑 `pnpm --config.verify-deps-before-run=false run typecheck` 和 `pnpm --config.verify-deps-before-run=false run test` 确认。

如果只是 additive 变化：

1. 在 `packages/protocol/src/` 中补充新的 RPC schema 和客户端方法。
2. 跑完整测试套件。

## 第五步：验证插件兼容性

```bash
cd ../dsh-mobile-plugin
pnpm test
```

重点检查 `src/index.ts` 中 `ctx.get('apiProxy')` 或类似的宿主服务引用是否仍有效。
如果上游移除了 `apiProxy` 服务（如 0.1.2-alpha.2），需要改用新的宿主 API 入口。

## 已知 dsh 版本与插件兼容性

| dsh 版本 | apiproxy 状态 | dsh-mobile-plugin 兼容性 |
|----------|--------------|--------------------------|
| 0.1.1-rc.2 及以下 | `packages/host/apiproxy` 存在 | 0.1.x–0.2.x 直接兼容 |
| 0.1.2-alpha.2–alpha.5 | 已移除，替换为 Typert Gateway/Remote | 插件 0.2.1+，mobileApi 2 |

## 防止遗漏

- 冻结 wire 有意升级时必须同步 `packages/protocol/src/vendor/` 与 `SYNCED.json`；普通 Remote 迁移不得修改它。
- Remote 变化必须同步 `REMOTE_ALPHA5.json`；有上游源码时 gate 会检查 owner 文件，无源码时只校验已提交 manifest 与 vendor 哈希。
- 每次上游发版（tag `dsh-v*`）至少跑一次本 skill 的第一到第四步。
