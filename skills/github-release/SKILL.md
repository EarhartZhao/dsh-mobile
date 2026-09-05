---
name: github-release
description: 通过 GitHub Actions 构建签名 APK 并发布 GitHub Release。
---

# GitHub Release

发布入口是 `.github/workflows/release.yml`。推送 `v*` tag 后自动构建、签名、验签并上传 APK。

## 一次性仓库配置

在 GitHub 仓库 `Settings > Secrets and variables > Actions` 配置：

| Secret | 内容 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `release.keystore` 的 Base64 编码 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore store password |
| `ANDROID_KEY_ALIAS` | release key alias |
| `ANDROID_KEY_PASSWORD` | release key password |

生成 Base64 时不要把输出贴到公开终端、issue 或聊天记录：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("apps/mobile/android/release.keystore"))
```

## 自动发布

必须先使用 `release-prep` skill 在 `master` 的干净工作区完成版本递增、提交和 tag。禁止直接从 `dev` 或带本地改动的工作区推送 tag。

使用 `release-prep` skill 完成 tag 后：

```bash
git push origin v0.0.3
```

workflow 会：

1. 安装 Node.js 22、pnpm 11、JDK 17 和 Android SDK。
2. 执行协议同步、workspace 测试、App lint/typecheck/test。
3. 校验 tag、package 版本、`APP_VERSION`、Android `versionName` 和 `versionCode` 一致。
4. 从 secrets 解码 keystore 并生成临时 `keystore.properties`。
5. 运行 `./gradlew assembleRelease`。
6. 用 `apksigner` 验证 APK，并上传 workflow artifact。
7. 对同名 tag 创建或更新 GitHub Release，上传对应版本的 `DshMobile-v<version>-release.apk`。

检查结果：

```bash
gh run list --workflow=release.yml --limit 5
gh release view v0.0.3
```

失败时不要重打同名 tag；先修正代码或 secrets，再递增/保留版本并重新走 `release-prep`。如果只是 rerun，workflow 可以覆盖同名 Release 的同名 APK 附件。

## 手动兜底

GitHub Actions 不可用时，用 `app-release` skill 本地构建并验签后：

```bash
gh release create v0.0.3 apps/mobile/android/app/build/outputs/apk/release/app-release.apk --generate-notes --title "dsh-mobile v0.0.3"
```

已有 Release 时改用：

```bash
gh release upload v0.0.3 apps/mobile/android/app/build/outputs/apk/release/app-release.apk --clobber
```
