# dsh-mobile

deepseek-harness 的移动端（Android / iOS）：实时查看本地 harness 的任务与会话，并能对话、审批。

方案文档见 [docs/](docs/)：

- [00-overview.md](docs/00-overview.md) — 总体方案与评估结论（外网拓扑 + NATS 内网穿透）
- [01-tech-stack.md](docs/01-tech-stack.md) — 技术选型（RN，Android/iOS）
- [02-protocol.md](docs/02-protocol.md) — 复用 harness `/api` 信封、NATS 传输映射
- [03-build-plan.md](docs/03-build-plan.md) — 构建计划（阶段、验收点、立即行动项）

配套桥接插件：[dsh-mobile-plugin](../dsh-mobile-plugin)。

## 构建与运行

本仓库使用 pnpm 11 与 Node.js 22+：

```bash
pnpm --config.verify-deps-before-run=false run typecheck   # core + protocol
pnpm --config.verify-deps-before-run=false run test        # core（真 nats-server 集成）
pnpm --config.verify-deps-before-run=false run sync-protocol:check
```

App 自身的检查在 `apps/mobile` 内：

```bash
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false run lint
pnpm --config.verify-deps-before-run=false run test
```

Android（在 `apps/mobile/android` 内，需要 adb 与已连接设备）：

```bash
./gradlew assembleDebug
./gradlew assembleRelease -PallowDebugSignedRelease=true   # 仅本地冒烟；正式签名见 AGENTS.md
```

iOS（需要 Xcode 26+；`Pods/` 已被 gitignore，克隆后先跑一次 pod install）：

```bash
cd apps/mobile/ios
pod install                        # 生成 DshMobile.xcworkspace
open DshMobile.xcworkspace         # 或在命令行构建：
xcodebuild -workspace DshMobile.xcworkspace -scheme DshMobile \
  -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17' build
```

命令行跑起来（换成本机 `xcrun simctl list devices booted` 里的 id）：

```bash
pnpm --dir apps/mobile start            # Metro，另开一个终端
xcrun simctl boot 'iPhone 17'
xcrun simctl install booted /path/to/DshMobile.app
xcrun simctl launch booted com.dshmobile
```

Debug 构建从 Metro 取 JS，release 构建打包 `main.jsbundle`；两者共用 `com.dshmobile` 一个 bundle id。
