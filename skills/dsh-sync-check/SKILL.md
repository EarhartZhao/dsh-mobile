---
name: dsh-sync-check
description: 检查 dsh（deepseek-harness）上游更新对 dsh-mobile 协议 vendor 和运行时的影响，并执行同步。
---

# DSH Sync Check

dsh 上游发版后，用本 skill 确认 dsh-mobile 的协议 vendor 树和 RPC 契约是否需要更新。

## 第一步：确认上游变更范围

```bash
# 在 deepseek-harness 仓库内
git -c safe.directory=C:/code/deepseek/deepseek-harness log --oneline HEAD~10..HEAD -- packages/host/apiproxy/ packages/api/ packages/client/connection/
git -c safe.directory=C:/code/deepseek/deepseek-harness diff --stat HEAD~10..HEAD -- packages/host/apiproxy/ packages/api/ packages/client/connection/
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
| `vendor tree matches committed manifest` | vendor 与自身快照一致 | 转第三步对比上游 |
| `source not found: .../packages/host/apiproxy/src` | 上游已重构目录结构 | 更新 sync-protocol.mjs 的 `sourceRoot` 路径 |
| hash 不匹配 | vendor 文件被篡改或遗漏 | 运行完整 sync 重新 vendor |

## 第三步：对比上游 API 契约变化

如果 `sourceRoot` 路径仍然有效（上游未重构），直接运行完整 sync：

```bash
DSH_REPO=C:/code/deepseek/deepseek-harness node scripts/sync-protocol.mjs
git diff --stat -- packages/protocol/src/vendor/
```

如果上游已重构（如 apiproxy → packages/api），需要人工比对：

1. 找到新的 API 契约目录（如 `packages/api/gateway`）。
2. 逐文件对比 RPC 方法名、请求/响应 schema 是否与 vendor 树一致。
3. 重点关注：删除的 RPC 方法、改名的字段、新增必填参数、事件流协议变化。
4. 将变化映射到 `packages/protocol/src/` 中 mobile 侧的消费代码和 `packages/core/src/connection-manager.ts`。

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
| 0.1.2-alpha.2+ | 已移除，替换为 `packages/api` gateway | 插件 0.2.1+ 已完成迁移 |

## 防止遗漏

- sync 后必须提交 `packages/protocol/src/vendor/` 目录和 `SYNCED.json`。
- CI 中 `sync-protocol:check` 在无源码时用 manifest 校验完整性，不会自动对比上游。
- 每次上游发版（tag `dsh-v*`）至少跑一次本 skill 的第一到第四步。
