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
- [ ] Android networkSecurityConfig 内嵌私有 CA 对 RN WebSocket 生效。
- [ ] 外网弱网下的重连体验：移动网络切换（WiFi↔蜂窝）时 NATS 重连 + 基线重拉的耗时。
