---
name: release-prep
description: 准备 dsh-mobile 版本发布：同步版本号、执行验证、创建 tag。
---

# Release Prep

当用户说“发布版本”时使用本 skill。目标不是“尽量改版本号”，而是让 App 包版本、兼容层版本、Android 版本和 git tag 完全一致。

## “发布版本”请求处理顺序

收到发布请求后，严格按以下顺序执行，不要跳步，也不要先改版本号：

1. 检查当前工作区：

   ```bash
   git status --short
   ```

2. 如果命令有任何输出（包括已跟踪改动、未跟踪文件、删除文件或本地产物），立即停止发布，向用户列出状态并提醒：

   > 当前有未提交代码，请先提交代码；提交完成后再告诉我继续发布。

   不要替用户自动提交、暂存、丢弃或隐藏这些改动，也不要切换分支。

3. 只有工作区完全干净时，才切换到 `master`：

   ```bash
   git switch master
   ```

   如果切换失败（例如本地没有 `master` 或分支状态异常），停止并报告具体错误，不要用强制切换覆盖文件。

4. 切换成功后再次运行发布预检：

   ```bash
   node scripts/release-version.mjs preflight
   ```

5. 预检通过后，继续执行本 skill 后面的版本递增、验证、提交、推送和 tag 发布流程。

用户补充“继续发布”前，不得绕过第 1～4 步。

## 输入确认

1. 发布入口固定为 `master`，不允许从 `dev`、临时分支或 detached HEAD 发布。
2. 发布开始前工作区必须完全干净（`git status --porcelain` 无输出），不允许带未提交改动、未跟踪文件或本地产物。
3. 先运行发布预检；预检失败时不得继续改版本号或创建 tag：

```bash
node scripts/release-version.mjs preflight
```

## 版本号更新

默认按上一个 `v*` tag 的版本增加 `0.01`：对三段式 SemVer 表现为 patch 加 1（例如 `0.0.2 -> 0.0.3`；`0.0.99 -> 0.1.0`），不要手工猜版本号：

```bash
node scripts/release-version.mjs next
node scripts/release-version.mjs bump-next
```

如需显式指定目标版本，格式必须是 `MAJOR.MINOR.PATCH`：

```bash
node scripts/release-version.mjs bump 0.0.3
node scripts/release-version.mjs check 0.0.3
```

脚本会更新：

- `apps/mobile/package.json` 的 `version`
- `packages/core/src/compatibility.ts` 的 `APP_VERSION`
- `apps/mobile/android/app/build.gradle` 的 `versionName`
- Android `versionCode`，默认映射为 `MAJOR * 1000000 + MINOR * 10000 + PATCH * 100`

未显式指定 `versionCode` 时，脚本会取“版本映射值”和当前 `versionCode + 1` 的较大值，避免 Android 升级被版本号降级阻断。如需显式指定 Android `versionCode`：

```bash
node scripts/release-version.mjs bump 0.0.3 --code 20002
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

验证通过后确认仍在 `master` 且工作区干净，再创建 annotated tag：

```bash
git add apps/mobile/package.json packages/core/src/compatibility.ts apps/mobile/android/app/build.gradle
git commit -m "chore(release): v0.0.3"
git push origin master
git tag -a v0.0.3 -m "dsh-mobile v0.0.3"
git push origin v0.0.3
```

推送 tag 会触发 `.github/workflows/release.yml`。不要推送 `wip`、`test` 或非语义版本 tag。
