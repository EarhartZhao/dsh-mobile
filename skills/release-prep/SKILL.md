---
name: release-prep
description: 准备 dsh-mobile 版本发布：同步版本号、执行验证、创建 tag。
---

# Release Prep

在发布前使用本 skill。目标不是“尽量改版本号”，而是让 App 包版本、兼容层版本、Android 版本和 git tag 完全一致。

## 输入确认

1. 确认目标版本号，格式必须是 `MAJOR.MINOR.PATCH`。
2. 确认要发布的分支通常是 `dev` 或用户明确指定的分支。
3. 确认工作区只包含本次发布需要的改动；不要提交本地产物、密钥或无关文件。

## 版本号更新

优先运行：

```bash
node scripts/release-version.mjs bump 0.2.0
node scripts/release-version.mjs check 0.2.0
```

脚本会更新：

- `apps/mobile/package.json` 的 `version`
- `packages/core/src/compatibility.ts` 的 `APP_VERSION`
- `apps/mobile/android/app/build.gradle` 的 `versionName`
- Android `versionCode`，默认映射为 `MAJOR * 1000000 + MINOR * 10000 + PATCH * 100`

如需显式指定 Android `versionCode`：

```bash
node scripts/release-version.mjs bump 0.2.0 --code 20000
```

注意：降版或重用旧 `versionCode` 会导致设备升级异常，除非用户明确要求，否则必须递增。

## 发布前验证

在仓库根执行：

```bash
pnpm --config.verify-deps-before-run=false run sync-protocol:check
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false run test
```

在 `apps/mobile` 执行：

```bash
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false run lint
pnpm --config.verify-deps-before-run=false run test
```

可选但发布前强烈建议，在 `apps/mobile/android` 执行：

```bash
./gradlew assembleDebug
```

## Tag

验证通过后创建 annotated tag：

```bash
git add apps/mobile/package.json packages/core/src/compatibility.ts apps/mobile/android/app/build.gradle
git commit -m "chore(release): v0.2.0"
git tag -a v0.2.0 -m "dsh-mobile v0.2.0"
git push origin HEAD
git push origin v0.2.0
```

推送 tag 会触发 `.github/workflows/release.yml`。不要推送 `wip`、`test` 或非语义版本 tag。
