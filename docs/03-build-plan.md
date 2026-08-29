# 构建计划

> 2026-08-26，方案已确认（00/01/02 + dsh-mobile-plugin/docs）。本文是跨仓库的落地计划。
> 原则：**风险最高的假设最先验证**；每个阶段有可演示的验收点；插件可独立于 App 先行联调（用脚本模拟 App）。

## 阶段总览

```text
Phase 0  基础设施（Hub CA/8443/账号 + dsh 电脑 Leaf）        手动运维，~0.5 天
Phase 1  dsh-mobile-plugin v1.0（NATS 桥 + 配对 + 设置卡）    ~5-7 天
Phase 2  dsh-mobile M1/M2（RN Android：链路 + 对话 + 审批）    ~8-12 天
Phase 3  dsh-mobile M3（任务面板）+ M4（iOS）             按需要排期
```

Phase 1 和 Phase 2 的协议对接面只有一个：`svc./evt.` subject 约定 + 信封字节（docs/02）。
因此两边可以并行开发，联调用 Phase 1 交付的**模拟 App 脚本**先行完成。

## Phase 0：基础设施（手动，先行）

按 dsh-mobile-plugin/docs/02-nats-server.md 逐条执行：

> 进度（2026-08-28，完成）：**Phase 0 全部落地，公网 WSS 全链路验收通过**。
> 安全组 8443 已放行；验收记录：① 外网 `Test-NetConnection 8443` 通、`openssl s_client -CAfile` Verify 0；② App（模拟器）解除本地配对后走生产二维码重配对——wss 连接（私有 CA 经 networkSecurityConfig 校验）→ `svc.dsh.home.pair` 核销（Hub → Leaf → 插件）→ describe → 基线 → 历史分页全部走公网；③ 发送 prompt「reply」→ 真 agent 流式回复（reasoning + 正文）渲染正确。至此「手机（公网）⇄ 家庭内网 dsh」全链路闭环，M1 链路打通里程碑达成。
> - 证书：`certs/`（ca.key 未上服务器）；`scripts/setup-hub.sh` 已在 Hub 跑通——TLS 材料入 `/etc/nats/tls/`、`websocket 8443 + 原生 TLS` 已加、`c-end-dsh` 账号已建（密码在 cordis.patch.yml / 密码管理器），nats 重启正常。
> - TLS 验收：`-CAfile ca.crt` → Verify 0；不带 CA → 21（确认非公共 CA 链）。
> - ACL 验收（`scripts/verify-hub-acl.mjs`）：c-end-dsh sub `svc.dsh.>` / pub `evt.dsh.>` 各吃一个 PERMISSIONS_VIOLATION，sub `evt.dsh.>` 正常。
> - Leaf：本机 `C:\nats\leaf.conf`（leaf-b → Hub 7422），Hub `/leafz` 可见 `leaf-dsh-pc`；跨链路 RPC 实测通过（公网 Hub → Leaf → 插件 → 真 dsh 的 `host.describe` 往返）。Leaf 的本地 ws 8443 监听已收紧到 127.0.0.1，SG 放行后即可删除该块。
> - 插件 cordis.patch.yml 已切生产值（wss://115.159.57.137:8443 + c-end-dsh + caFp）。
> - 顺手排掉的坑：nats.js 2.29.x 不解析 server URL 里的 userinfo（demo 连法超时/鉴权失败），凭证必须走显式 user/pass 字段——App 与插件路径均如此，无影响，记录备查。

**验收**：`nats sub "evt.dsh.>" --server wss://115.159.57.137:8443`（带 CA）能从外网连上；Leaf 在线。

## Phase 1：dsh-mobile-plugin v1.0

> 进度（2026-08-26 晚）：**Phase 1 全部完成并联调通过**。1.4 落地为「回环控制台页面（`/mobile-bridge`，配置向导 + QR + 设备管理）+ 设置卡（iframe 嵌入控制台，lazy-CJS bundle 已被客户端模块系统收编）」。真实 dsh web profile 联调：配对/门控 RPC（真实工作区数据）/事件流/双端同步全部实测通过，详见 dsh-mobile-plugin/docs/00-plugin-plan.md 联调验收记录。剩余：Hub 侧 Phase 0（8443 + TLS + 账号，用户手动）→ 之后全链路 e2e。
> 排障记录：发布版 `@deepseek-ai/dsh-host-apiproxy@0.0.1-rc.1` 不可安装（依赖未发布包），编译期改用本地 shim 声明（src/harness-shims.d.ts）；pnpm 11 需在 pnpm-workspace.yaml 声明 onlyBuiltDependencies；测试中发现模块级 `const URL` 会遮蔽全局 URL 构造器——避免顶层同名变量。

### 1.0 工程骨架（~0.5 天）✅

- `package.json`（type: module）+ tsconfig + vitest；依赖：`nats`（Node 客户端，连本机 Leaf 走明文 TCP）、`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`、`qrcode`（生成 SVG/终端二维码）。
- 入口遵循 Cordis 插件约定：默认导出插件，`Config` 用 schemastery schema（对齐 00 文档配置草案）。
- 本地联调链路：`$DSH_HOME/profiles/web/package.json` 加 `file:` 依赖 + `cordis.patch.yml` insert 一行，`pnpm dsh --profile web` 从源码启动验证挂载。

### 1.1 NATS 连接层（~1 天）✅

- 连 `nats://127.0.0.1:4222`，自动重连（指数退避），连接状态暴露为 Cordis 服务（供设置卡展示"已连接/重连中/断开"）。
- 单元测试：起一个临时 `nats-server` 进程做集成测试。

### 1.2 RPC 桥 + 事件桥（~2 天）✅

- sub `svc.dsh.{instance}.>` → token 校验（NATS headers）→ 方法白名单 → `toFetchHandler(ctx.apiProxy)` 进程内分发 → request-reply 回复。
- 事件桥：复用 apiproxy 的 mux/host 帧源（与其同源订阅，`session/event` 等），帧原样 publish 到 `evt.dsh.{instance}.mux|host`。
- 待处理提问重放：App 重连（新订阅出现）后重发当前待处理集合。
- 测试：模拟 App 的 Node 脚本（`scripts/fake-app.ts`）经真实 NATS 完成 `host.describe` + `session.list` + 订阅事件。

### 1.3 配对与 token（~1 天）✅

- 配对码签发（8 位、120 秒、一次性、限流）、`svc.dsh.{instance}.pair` 核销 → 32 字节 token。
- token 存储 `$DSH_HOME/mobile-bridge/tokens.json`（哈希、原子写入、0600）。
- 吊销即时生效（内存索引）。

### 1.4 设置卡（~1.5 天）

- 按 harness cookbook《adding-a-settings-card》实现双半侧：Host 半 `installSettingsSection` 注册 `mobile-bridge` namespace（hubUrl/user/pass 字段，pass 用 `role('secret')`）；浏览器半注册卡片到 `settings.plugin.item`。
- 卡片内容：服务器信息表单、"测试连接"按钮（带状态）、连接状态指示、"生成配对二维码"（SVG 渲染）、已配对设备列表（v1.1 做吊销）。
- CLI 退路：无浏览器时在 dsh 启动日志打印终端二维码。

### Phase 1 验收（不依赖 App）

- `fake-app.ts` 从外网经 Hub 完成：配对码核销 → `host.describe` → `session.list` → `session.prompt` → 实时收到 `assistant/chunk` 帧 → `respond` 回答审批。
- 浏览器 Web 端同时在线，两端互见对方输入（双端同步实测）。
- 无 token / 错误 token / 白名单外方法分别返回 `unauthenticated`/`forbidden`。

## Phase 2：dsh-mobile M1/M2（Android 先行）

> 进度（2026-08-29 第二轮）：**P0-P2 本地可实施面完成，附件和剩余指示已闭环。**
> - 验证：`packages/core` 21/21、App `tsc --noEmit` 清洁、Android `gradlew assembleDebug` 通过；新 APK 已装回模拟器。
> - 新增 P1/P2：Android 原生选图（ACTION_GET_CONTENT，超过 384KB 自动降采样/JPEG 压缩）、pending 预览、`session.prompt` 图片块、历史 data/attachment 图片渲染；长按「全部」打开目录浏览器（面包屑/子目录/新建目录，browse capability 缺失时显示宿主错误）；会话权限预设 chips（Full access 确认）；assistant 收尾交付物 chips；`compaction/summary` 标记。Core 推导新增图片/交付物/compaction 单测。
> - 真链路附件验收：选择模拟器截图 → native base64 → vision 模型接收并识别为“mobile screenshot” → agent 开始基于图片制定计划；先切到 `deepseek-v4-flash-vision-exp`，非视觉模型返回的 `MODEL_DOES_NOT_SUPPORT_IMAGES` 被正确展示。
> - 部署限制：当前宿主 composed picker 只提供 `native` capability，`host.listDirectory` 返回需要 `browse`；目录浏览器可运行但列表数据受该宿主配置限制。`session.search` 仍受 index `openAt: never` 限制；detach 会话的 `skill.list` 依赖宿主 attach 状态。
> - 明确后续：完整亮色主题重构（当前是暗色优先）、系统推送（插件 v2）、iPad 双栏布局；TodoStrip 待真实任务触发 `todo/write` 后活体验证。
> 进度（2026-08-29 第三轮）：**移动端可实施功能补齐：拍照附件、排序、代码块操作、亮色/跟随主题和相机扫码配对已落地。**
> - 配对页接入 `react-native-vision-camera` QR 扫描，Android 开启 `VisionCamera_enableCodeScanner`，相机权限/设备不可用时保留粘贴二维码兜底。
> - 会话列表支持 workspace 和会话长按排序，持久化顺序驱动「全部」列表；代码块支持复制与分享；主题设置支持亮色/暗色/跟随系统，选择后保存原生模式并重载 JS 以立即生效。
> - 验证：`packages/core` 21/21、App `tsc --noEmit` 清洁、包含 VisionCamera 的 Android `gradlew assembleDebug` 通过。拍照、主题和扫码的真机/模拟器活体验证待下一次部署后确认。

> 进度（2026-08-28 晚）：**M2/M3 完成，公网真链路活体验收通过**。
> - M2 队列编辑：运行中发送自动排队（`mode:'queue'`），队列 dock 实时渲染（`session/queue` 快照），支持 编辑（`updateQueue edit`）/ 引导（`steer`）/ 删除（`remove`）；活体验证：前台 sleep 90 占住 turn → 排队 → dock 出现（队列·1）→ 删除后 dock 消失；排队项被认领后 agent 正常处理。UI 修正：running 时不再用「引导」替换发送键（引导是 dock 上的显式动作，发送恒为排队）。
> - M2 命令面板：斜杠命令经 `session.prompt` 执行，返回的 `command` 槽以提示条展示；发送失败回填草稿并提示。注意：当前 harness 0.1.1-rc.2 的 apiproxy **没有** `command.list`/`command.execute` RPC（rpc-map 无此二法，插件白名单为前瞻占位）——命令发现列表待宿主版本补齐后接入。
> - M3 任务面板：`session/jobs` 快照驱动折叠条（运行计数/状态点/label/detail）；列表页运行中任务徽章；前台提醒横幅（任务沉降 `jobSettled` + 待审批/待提问 `attention`，5s 自动消失，不依赖系统推送）。活体验证：pwsh 后台任务（run_in_background）→ 「任务·1（1 运行中）」→ 完成沉降。
> - 测试：core 19/19（新增 jobSettled/attention 事件与 queuePreview 单测），App tsc 清洁。
> 进度（2026-08-27）：**2.1/2.2 完成，2.3 骨架完成，native 构建通过，模拟器 e2e 链路打通**。
> - monorepo 落地：`packages/protocol`（36 文件 vendor + `NatsApiClient`）、`packages/core`（连接生命周期/SessionStore/对话流推导）、`apps/mobile`（RN 0.87.1，配对/会话列表/对话页/审批动作条）。
> - 测试：core 16/16 通过（含真 nats-server 集成：配对核销、token 门、门控 RPC、mux 帧订阅、hello 重放、断线基线）。
> - 构建验证：Metro bundle 全图通过（踩坑：nats.ws 内 tweetnacl 的 `require('crypto')` 死代码需 Metro resolveRequest 置空；zod v4 的 `export * as` 需 babel 插件）；`gradlew assembleDebug` 通过（pnpm 隔离需显式补 `@react-native/gradle-plugin`、`@react-native/codegen`；Gradle 走腾讯镜像）。
> - **模拟器 e2e（fake-host 对线契约）**：配对核销 → describe → 基线 → mux/host 订阅 → hello 重放 → 审批应答 → prompt → 流式 chunk → 定稿，全部在 Hermes 上实测通过；断 broker 自动横幅提示、恢复后自动重连 + 基线重拉 + 待审批重放。
> - Hermes 运行时踩坑（已修）：① 无 `TextDecoder`（自写 UTF-8 polyfill，`src/vendor/text-decoder-polyfill.js`）；② 无 `URL`（react-native-url-polyfill）；③ 无 `crypto.randomUUID`（getRandomValues 之上的 v4 polyfill）；④ RN whatwg-fetch 对 Uint8Array body 按 Latin-1 解码（中文乱码）——doFetch 一律先 TextDecoder 解成字符串再构造 Response；⑤ ES import 提升会让 polyfill 晚于 nats.ws 模块初始化——index.js 入口改为有序 `require()`。
> - 健壮性增强（超出原计划）：establish 失败（如对端 503 无响应者）进入退避重试，不再卡死在 connecting。
> - 构建机环境：JDK 17（`E:\Program Files\Microsoft\jdk-17.0.20.101-hotspot`）、Android SDK（`E:\Android\Sdk`，platform 36/37.0、NDK 27.1.12297006、cmake 3.22.1）。JAVA_HOME/ANDROID_HOME 已写入用户环境变量。
> - 剩余 2.0 spike 项：WSS + 私有 CA（networkSecurityConfig）实测——依赖 Hub 侧 Phase 0；切后台长连接行为待真机观察。

> 进度（2026-08-27 下午）：**真 dsh 端到端验收通过（本地回环链路）**。本地 stand-in nats（`scripts/local-hub-standin.conf`，4222 + ws 8443 无认证）顶替 Hub，插件（web profile，instance `home`）经 cordis.patch.yml 指向它；App dev 按钮从 `/mobile-bridge/api/pair` 拉真实配对载荷完成配对 → 真实 `session.create` → `session.prompt("hi")` → 真 agent 流式回复（reasoning + 正文渲染正确，宿主自动起标题 "Greeting session"）。
> 新踩坑：① Hermes 的 `Intl...timeZone` 返回 `GMT`（非 IANA），host 严格校验拒绝——clientTimeZone 非 IANA 时省略；② 废弃 SafeAreaView 不管 Android 状态栏 inset，头部按钮被状态栏遮住无法点击——换 `react-native-safe-area-context`；③ `user/message` 的 data 即消息本体（`{content, source, role, id}`），注入上下文（agent-instructions / skill-catalog / plugin）按 `data.source.kind !== 'user'` 过滤，不再污染对话流。
>
> **Phase 0 就绪待执行（需服务器 SSH）**：`certs/`（ca.crt/ca.key/server.crt/server.key，ca.key 离线保管，指纹 sha256 62:FF:70:14:…）+ `scripts/setup-hub.sh`（幂等一键：装证书、加 websocket 8443 块、插 c-end-dsh 账号、`-t` 校验后重启、握手验证；awk 插入逻辑已对文档样本验证）。执行后：腾讯云安全组放行 8443，插件配置改指真实 Hub。Leaf 账号（leaf-a~d 哪个分给本机）待用户确认。

### 2.0 风险验证 spike（~1 天，最先做）

- 最小 RN 工程 + `nats.ws`：Hermes 下连接 WSS（私有 CA 经 networkSecurityConfig）、request-reply、订阅、断网重连、切后台恢复。
- Zod 契约层在 Hermes 下跑通（vendor 一份 `apiproxy/src/api` 进来跑解析）。
- 不通过则触发预案（VPS 加 HTTP↔NATS 网关），**这一步不过后续不排期**。

### 2.1 工程骨架（~1 天）

- pnpm monorepo：`packages/protocol`（vendored 契约 + `NatsApiClient extends AbstractApiClient`，`doFetch` → NATS request）、`packages/core`（连接管理、会话 store，不 import react-native）、`apps/mobile`（RN 工程）。
- `scripts/sync-protocol.ts`：从 deepseek-harness 复制契约层并 diff。

### 2.2 连接与状态层（~2 天）

- 配对：扫码（vision-camera + zxing）→ 解析载荷 → 存 token（react-native-keychain / EncryptedSharedPreferences）。
- 连接管理器：connect → describe → 订阅双流 → 在线；断线自动重连 + 基线重拉（`workspace.list` / `session.list` / 打开会话的 `history` 尾页）。
- generation 语义对齐官方：任一事件流断开即整体重建。

### 2.3 核心界面（~4-6 天）

- 会话列表页（workspace 分组、状态徽章、归档）。
- 对话页：流式渲染（chunk 节流批量提交）、Markdown/代码块、工具调用折叠卡、取消、队列查看。
- 审批/提问：底部动作条（`/respond`）。
- UI token 从 `ui-theme` 移植（配色/暗色/圆角/字号阶）。

### Phase 2 验收（M1/M2 合演）

- 手机上发起任务，Web 端实时同步；Web 端发起，手机同步。
- 蜂窝网络下弱网切换（WiFi↔蜂窝）自动重连、状态一致。
- 审批在手机上回答后 Web 端状态即时更新。

## Phase 3：M3 + M4（后续排期）

- M3 任务面板：`session/jobs` 快照帧渲染、前台提醒。
- M4：iOS 适配（需 Apple 开发者账号）。鸿蒙端已明确不做（2026-08-26）。

## 风险与预案（承接 00-overview 风险表）

| 时点 | 风险 | 预案 |
|---|---|---|
| 2.0 spike | Hermes 跑不动 nats.ws | VPS 加轻量 HTTP↔NATS 网关，App 改说 HTTPS+WS |
| Phase 1 联调 | 事件源复用方式与 apiproxy 内部耦合过深 | 退到直接 `ctx.on('session/event')` 自行组帧（格式照抄 apiproxy） |
| 协议演进 | harness 契约变化 | `sync-protocol.ts` diff + `host.describe` 握手校验 |

## 立即行动项（Phase 0 起手）

1. 在 Hub 服务器上生成 CA/证书、改 `hub.conf`、放行 8443（命令都在插件 docs/02）。
2. dsh 电脑装 Leaf 并常驻。
3. 告诉我"Hub 就绪"，我开始 Phase 1 插件骨架。
