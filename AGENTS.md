# dsh-mobile Agent 指南

## 项目概览

dsh-mobile 是 React Native Android 优先的 monorepo，把 deepseek-harness（dsh）Web 端的对话、审批、任务和工具调用能力带到移动端。

- `apps/mobile`：React Native 应用、原生 Android/iOS 工程与界面。
- `packages/core`：平台无关的连接、会话、消息推导和插件兼容性逻辑。
- `packages/protocol`：从 dsh vendor 的 API 契约与 NATS 客户端。
- `docs/`：架构、协议、构建计划和功能差距记录；重大行为变化要同步更新。
- `skills/`：本仓库的 CI/CD 与发布流程技能。

## 常用命令

本仓库使用 pnpm 11 与 Node.js 22+。本机依赖检查偶尔不稳定时，保留 `--config.verify-deps-before-run=false`。

```bash
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false run test
pnpm --config.verify-deps-before-run=false run sync-protocol:check
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false run lint
```

最后两条在 `apps/mobile` 内执行。Android 构建在 `apps/mobile/android` 内执行：

```bash
./gradlew assembleDebug
./gradlew assembleRelease
```

正式 release 构建必须有签名配置；未配置签名时 `verifyReleaseSigning` 会失败。仅在本地冒烟时允许：

```bash
./gradlew assembleRelease -PallowDebugSignedRelease=true
```

## 安全与发布约定

- 绝不提交或输出 `apps/mobile/android/keystore.properties`、`apps/mobile/android/release.keystore`、`certs/ca.key`、`certs/server.key` 等私钥内容。
- 不要提交 `node_modules/`、`.pnpm-store*`、Android `build/`、`.gradle/`、日志文件和本地模拟器产物。
- 正式签名配置支持两种来源：
  - 本地：`apps/mobile/android/keystore.properties`（模板见 `keystore.properties.example`）。
  - CI：GitHub secrets `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。
- App 版本由 `apps/mobile/package.json`、`packages/core/src/compatibility.ts` 的 `APP_VERSION`，以及 `apps/mobile/android/app/build.gradle` 的 `versionName`/`versionCode` 共同表达。修改版本时优先使用 `node scripts/release-version.mjs bump <version>`。

## CI/CD 流程

1. 每次推送和 PR 由 `.github/workflows/ci.yml` 执行协议同步检查、workspace typecheck/test，以及 App typecheck/lint/test 和 Android debug 构建。
2. 推送 `v*` tag 由 `.github/workflows/release.yml` 执行同一组验证，随后做正式签名 release 构建、APK 验签，并上传到同名 GitHub Release。
3. 用户在 GitHub Releases 页面下载 APK；Release notes 由 GitHub 自动生成，可手工补充。

执行发布前按顺序阅读：

1. `skills/release-prep/SKILL.md`：版本号、tag 和发布前检查。
2. `skills/app-release/SKILL.md`：本地 Android 签名构建与验签。
3. `skills/github-release/SKILL.md`：GitHub Actions、secrets 与 Release 发布。
4. `skills/ci-verify/SKILL.md`：只验证、不发布时的标准路径。

dsh（deepseek-harness）上游发版后按以下 skill 检查兼容性：

1. `skills/dsh-sync-check/SKILL.md`：确认上游变更范围、同步协议 vendor、更新版本兼容区间。

## 工程习惯

- 保持仓库现有模块边界：UI 不直接写协议细节，连接/推导逻辑优先放进 `packages/core` 并补测试。
- 改动涉及协议时先跑 `sync-protocol:check`，不要手改 `packages/protocol/src/vendor`。
- 提交前给出实际执行的验证命令和结果；不要把未验证的构建状态说成已通过。
- 有大量无关未提交文件时不要主动提交；先和用户确认提交范围。
