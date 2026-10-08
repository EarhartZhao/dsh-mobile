# 技术选型

> 决策：**React Native（Hermes），目标平台 Android / iOS**。
> 2026-08-26 更新：鸿蒙端明确不做，本文保留当时的对比记录但移除鸿蒙相关实施内容。

## 候选对比

### React Native（推荐）

- Android / iOS：RN 官方支持，生态成熟，WebSocket、长列表（FlashList）、Markdown 渲染都有现成方案。
- 与 harness 的复用：
  - **协议层零重写**：`@deepseek-ai/dsh-host-apiproxy` 的 `src/api/` 是纯 TS + Zod、无 Node 依赖，可直接在 Hermes 中运行。`AbstractApiClient` 只需实现一个 `doFetch`。
  - 设计语言同源：Web 端是 React 18，视觉 token（配色、圆角、字号阶、间距）可以系统性移植。
- NATS 客户端：官方 `nats.ws`（WebSocket 传输）面向浏览器，Hermes 可跑的概率高，但 M1 必须真机实测。不过则在公网 VPS 上加一个轻量 HTTP↔NATS 网关，App 改用 HTTPS + WS。

### Flutter（备选）

- 优势：三端 UI 一致性最强，flutter_flutter 的 ohos 分支由华为主导。
- 致命伤：协议契约要用 Dart 完整重写（信封、Zod schema 等价物、流解码），且每次 harness 协议演进都要手工同步。对一个"复刻 Web 版体验"的项目，放弃了最大的复用资产。

### uni-app / Taro（不推荐）

- 长连接 + 高频流式增量渲染（`assistant/chunk` 可达每秒多次）在这类框架上的表现和可调试性都不如 RN/Flutter。

### WebView 套壳（仅作 v0 验证）

- 直接把 harness 打出来的 web dist 装进 WebView：Android 系统 WebView、iOS WKWebView。
- `dsh-client-connection` 预留了 `__DSH_TRANSPORT__` 全局钩子，允许整体替换传输层——理论上壳内通信都可以走原生桥。
- 用途：在 RN 工程未成形前验证"移动端网络环境能否完整跑通 /api + 两条 WS 下行"。不作为产品形态。

## 工程结构（monorepo）

```text
dsh-mobile/
  package.json            # pnpm workspace
  packages/
    protocol/             # 从 deepseek-harness 复制/vendored 的 /api 契约 + AbstractApiClient 子类
    core/                 # 连接管理、会话状态机、事件流 store（React 无关层）
    ui/                   # 共享 React 组件（Android/iOS 通用）
  apps/
    android-ios/          # RN 工程（react-native 官方模板）
  docs/
```

要点：

- `packages/protocol` 是唯一与 harness 耦合的包。初期直接 vendor harness 源码中的契约层文件（我们的 fork，版本可控），并保留一份 sync 脚本；不通过 npm 依赖拉，避免 pnpm workspace 跨仓库安装的复杂度。
- `packages/core` 不 import `react-native`，保证逻辑可在 Node 里单测，也可被 WebView 方案复用。
- UI 组件尽量写在 `packages/ui`；平台差异（状态栏、返回手势、安全区）收敛到 apps 壳内。

## UI 移植策略

源：deepseek-harness `packages/client/ui-*`（React 18 + slot 体系）。

不做 1:1 DOM 移植，做**视觉 token + 信息架构**的移植：

1. 提取 Web 端主题 token（`ui-theme`：配色、暗色模式、圆角、间距、字号阶）为 RN 的 StyleSheet 常量。
2. 信息架构对齐：workspace 侧边栏 → 抽屉/底部导航；会话列表 → 列表页；对话流 → 聊天页（气泡/工具调用折叠卡/代码块）；任务/审批 → 顶部横幅 + 任务页。
3. 移动端优化：流式渲染使用节流批量 setState（chunk 频率高）；长列表用 FlashList；工具调用默认折叠；审批做成底部动作条。

## 需要实测验证的清单（M1 前）

- [x] Hermes 中跑通契约层（Zod v4 需 babel `transform-export-namespace-from`）。✅ 2026-08-27
- [x] Hermes 中跑通 `nats.ws`：连接、request-reply、订阅、自动重连。✅ 2026-08-27（需 TextDecoder/URL/randomUUID 三个 polyfill，见 apps/mobile/index.js；切后台恢复待真机）
- [ ] NATS server 的 WSS + TLS：私有 CA + nats-server 原生 TLS（见插件 docs/02，不用域名）。
- [x] 私有 CA 锚定对 RN WebSocket 生效：无 `network_security_config` 等价物，改在 Android OkHttp 的 `X509TrustManager` 与 iOS `SRWebSocket` 接缝上装自定义信任策略，用**二维码带来的 ca.crt** 当该地址的唯一锚点。✅ 2026-09-30（iPhone 17 / iOS 26.5 模拟器连线上 Hub）
- [x] App 包内不再内置任何 CA：`res/raw/dsh_root_ca.crt`、iOS `resources/` 条目与对应的回退分支全部删除，换 Hub 只需重扫一次码。✅ 2026-09-30
- [ ] 外网弱网下的重连体验：移动网络切换（WiFi↔蜂窝）时 NATS 重连 + 基线重拉的耗时。

### 传输策略：release 只走 TLS，本地明文入口仅 debug（2026-09-14 决策）

App 的 `nats.ws` 只能走 websocket，两种载体的可用性由构建类型决定：

| 链路 | 传输 | debug | release | 依据 |
|---|---|---|---|---|
| 线上 Hub | `wss://115.159.57.137:8443`（私有 CA 签发的 TLS） | ✅ | ✅ | 二维码携带的 ca.crt 由 `DshHubTls` 装成该地址的信任锚；`network_security_config.xml` 只剩 `cleartextTrafficPermitted="false"` |
| 本地 leaf（模拟器 `10.0.2.2:8443` / 局域网 IP） | `ws://`（`leaf.conf` 里 `no_tls: true`） | ✅ | ❌ | 同一文件的 `<base-config cleartextTrafficPermitted="false" />`；debug 变体覆盖为 `true` |

结论：**release 连不上本地 leaf 的原因是"明文被禁"，不是"本地不可用"**。当前决定是本地明文入口只服务 debug（开发捷径），release 走 Hub，暂不为本地直连放行。

将来若要让 release 包在家里脱离公网直连本地 harness，需要三件事（缺一不可）：

1. 用现有私有 CA 重签服务器证书，SAN 加上要用的本地地址（现在 `certs/san.ext` 只有 `IP:115.159.57.137`；CA 私钥按设计**离线保管、绝不上服务器也不进仓库**，仓库内只应有 `ca.crt` 这类公钥材料——轮换流程见插件 docs/02 §1.1）；
2. 本地 leaf 的 websocket 打开 `tls { cert_file, key_file }`（去掉 `no_tls`），4222 继续明文供本机进程使用；
3. 把该本地地址加入 release 的 `network_security_config.xml` domain-config，复用同一个私有 CA。

不建议的做法：在 release 里对本地地址放行明文——那会把"release 只走 TLS"的安全基线打穿，且明文流量携带设备令牌，同网段可嗅探。

## iOS 落地（2026-09-30）

同一份 JS（`apps/mobile/src`）跑在两个平台上，平台差异全部收敛到 `apps/mobile/ios/DshMobile/` 的 ObjC++ 模块；JS 侧只用 `NativeModules` 的运行时判空，不写 `Platform.OS` 分支来适配能力差异。

### 原生模块对照

| JS 入口 | Android | iOS | 说明 |
|---|---|---|---|
| `DshTheme` | `ThemeModule.kt` | `DshThemeModule.mm` | 读写主题模式，写入 `NSUserDefaults` 的 `dsh_theme_mode` |
| `DshImagePicker` | `ImagePickerModule.kt` | `DshImagePickerModule.mm` | `pickImage` / `pickImages` / `captureImage` |
| `DshFilePicker` | `FilePickerModule.kt` | `DshFileModules.mm` | `pickFile`（Android `ACTION_OPEN_DOCUMENT` / iOS `UIDocumentPickerViewController`） |
| `DshFileOpener` | `FileOpenerModule.kt` | `DshFileModules.mm` | `openWithApp`：写缓存文件后弹分享/打开面板 |

Android 专属、**不**移植的两个模块：`DshApp.moveTaskToBack`（Android 返回键"再按一次退出"）与 `DshUpdater`（APK 自更新）。JS 侧对两者都做了运行时判空，缺失时静默降级。

### TLS：私有 CA 的锚定方式

**锚来自二维码，App 包里没有 CA。** 配对时 `PairingScreen` 先调 `installHubAnchor`（`apps/mobile/src/hub-tls.ts`），
把二维码里的 ca.crt 装成 **Hub 主机名** 的信任锚，之后才建立 WebSocket。两个平台的接缝不同，规则一致：
先让系统信任库判一次（公共 CA 签发的 Hub 照常工作），失败且该主机装过锚时，再用锚重新校验链。

- Android：`HubTlsTrust.install` 在 `MainApplication.onCreate` 里给 RN 的 OkHttp（也就是 `nats.ws` 拨号用的那个客户端）
  换上自定义 `X509TrustManager`；锚存在 `HubTlsStore`（SharedPreferences）。
- iOS：`RCTSetCustomSRWebSocketProvider` 拿到 RN 为 `new WebSocket(...)` 构造的 `SRWebSocket`，挂自定义
  `SRSecurityPolicy`（`DshWebSocketSecurity.mm`）；锚由 `DshHubTlsModule.mm` 按 host 存在 `NSUserDefaults`。

锚按 host 存，重扫同一地址的新 CA 就等于吊销旧的；`network_security_config.xml` 里那份
`@raw/dsh_root_ca` 以及两端的包内证书已删除（2026-09-30），所以「二维码没带 CA」只对公共 CA 有效。

> **注意事项：Hub 服务器证书缺 `extendedKeyUsage = serverAuth` 时 iOS 会拒。**
> 老证书由插件仓库的 `certs/san.ext` 签发，只有 IP SAN、没有 EKU 扩展，Apple 的 SSL 策略会以
> `-67609 certificate is not permitted for this usage` 拒绝。免 EKU 的兜底路径仍然留着（标准 SSL 策略失败后
> 退到「锚定二维码 CA + 自写 DER 解析校验 SAN 主机名」，规则等同 Android 的信任根 + 主机名匹配，不放宽信任面），
> 但 `rotate-hub-tls.sh` 已经给服务器证书补上 `extendedKeyUsage = serverAuth`，现在走的是严格路径。

### 系统选择器：RN Modal 把 picker 一起撤掉

`+` 面板是 RN 的 `Modal`（`RCTFabricModalHostViewController`），JS 在关闭它的同一 tick 里调起系统 picker。UIKit 会把 picker present 到那个"正在退场"的 modal 上，React 的 commit 一到就把它连同 modal 一起撤掉——picker 出现一帧就消失（相册和文件选择器都复现）。

`DshPresentation.mm` 的 `DshPresentWhenSettled` 解决这个问题：等同一个宿主连续 3 个 tick 稳定且仍在屏上再 present，之后 2.4s 内持续监视；只要 picker 和它的宿主**都**失去 window（用户主动取消时宿主仍在屏上，可以区分），就把它重新挂到新的宿主上（最多 3 次）。

### 其它 iOS 差异

- **竖屏锁定**：`UISupportedInterfaceOrientations`（含 `~ipad`）只有 `Portrait`，与 Android `screenOrientation="portrait"` 一致。
- **深链接**：`CFBundleURLTypes` 注册 `dshmobile://`；`Info.plist` 补齐相机/麦克风/相册用途文案。
- **依赖**：`react-native-svg` 需 ≥ 15.15.x，15.12.1 在 RN 0.87 上编译不过。
