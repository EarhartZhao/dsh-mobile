---
name: ci-verify
description: 在本地复现 dsh-mobile CI 的标准验证路径。
---

# CI Verify

用于提交、PR 或发布前的完整验证，不生成可分发包。

## 标准步骤

仓库根：

```bash
pnpm --config.verify-deps-before-run=false install --frozen-lockfile
pnpm --config.verify-deps-before-run=false run sync-protocol:check
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false run test
```

`apps/mobile`：

```bash
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false run lint
pnpm --config.verify-deps-before-run=false run test
```

`apps/mobile/android`：

```bash
./gradlew assembleDebug
```

## 判定规则

- typecheck、lint、test、protocol sync 和 Android debug 构建必须全部通过。
- 只改 UI 时也不要跳过 root tests，因为 `packages/core` 的事件推导可能受影响。
- CI 中 `assembleDebug` 已覆盖基本原生编译；正式发布前仍必须走 release 签名构建。
