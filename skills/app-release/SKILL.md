---
name: app-release
description: 本地构建并验证已签名的 dsh-mobile Android release APK。
---

# App Release

本 skill 只处理 Android 应用构建和签名验证。创建 Release 请继续使用 `github-release` skill。

## 本地签名配置

签名文件必须留在 git-ignored 位置：

```text
apps/mobile/android/release.keystore
apps/mobile/android/keystore.properties
```

`keystore.properties` 示例：

```properties
storeFile=release.keystore
storePassword=your-store-password
keyAlias=your-key-alias
keyPassword=your-key-password
```

`storeFile` 相对于 `apps/mobile/android`。不要把这两个文件加入 git，也不要在命令输出、日志或诊断 JSON 中打印密码。

## 构建

在 `apps/mobile/android` 执行：

```bash
./gradlew assembleRelease
```

产物：

```text
apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

如果没有正式签名，默认构建会失败；只有本机冒烟允许：

```bash
./gradlew assembleRelease -PallowDebugSignedRelease=true
```

Debug-signed APK 不得上传 Release 或分发给用户。

## 验签

Windows 本机可运行：

```powershell
& "$env:ANDROID_HOME\build-tools\37.0.0\apksigner.bat" verify --print-certs apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

确认输出中的证书是正式 release 证书，而不是 `androiddebugkey`。如果用户要求进一步检查，可用：

```bash
./gradlew :app:verifyReleaseSigning
```

该任务只确认构建配置使用正式签名，最终仍以 `apksigner` 验证 APK 为准。
