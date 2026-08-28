# dsh-mobile 总体方案

> 状态：提案 v2（2026-08-25）。v2 变更：明确移动端在**外网**、harness 在**家庭内网 NAT 后**，引入 NATS 作为公网会合点做内网穿透；业务协议复用的结论不变，变的只是传输层。

## 目标

在手机上（移动网络 / 任意外网）实时查看本地 deepseek-harness 的任务（会话 / 后台 job / 审批请求），并能发起对话、引导（steering）、审批。目标平台：Android、iOS（鸿蒙端 2026-08-26 起明确不做）。

界面语言沿用 deepseek-harness Web 版（React 18 + Cordis slot 体系）的视觉风格，按移动端做适配优化。

## 网络拓扑与核心问题

harness 跑在家庭内网的电脑上：无公网 IP、无端口映射，手机从外网**永远无法主动连进来**。解法的共同形态是：找一个公网会合点，让电脑和手机各自**出站**连过去。

```text
┌──────────────┐   出站 WSS    ┌─────────────────┐    出站 WSS   ┌──────────────────────┐
│ dsh-mobile    │ ───────────► │ NATS server     │ ◄─────────── │ dsh-mobile-plugin     │
│ (外网, 三端)  │ ◄─────────── │ (公网会合点)     │ ───────────► │ (家庭内网 harness 内)  │
└──────────────┘              └─────────────────┘              └──────────────────────┘
```

## 核心评估结论

### 1. 业务协议仍然整套复用——NATS 只替换传输层，不替换协议

harness 的 `/api` 协议是一个**与物理通道解耦**的四象限信封（官方设计原话）：

| 信封 | 浏览器载体 | NATS 载体（本方案） |
|---|---|---|
| `ClientRequest`（一元请求） | POST `/api/<method>` 请求体 | NATS request-reply 的请求 |
| `ServerResponse`（一元响应） | POST 响应体 | NATS request-reply 的回复 |
| `ServerRequest`（下行推送帧） | WebSocket 下行 | NATS pub/sub 订阅 |
| `ClientResponse`（回答审批） | POST `/api/respond` | NATS request-reply |

NATS 的 request-reply 天然对应一元 RPC，pub/sub 天然对应下行帧——**映射是 1:1 的**。契约层（`@deepseek-ai/dsh-host-apiproxy` 的 `src/api/`，纯 TS + Zod、无 Node 依赖）、快照/重放语义（jobs、queue、projection、待处理提问）、`AbstractApiClient`（平台子类只需实现 `doFetch` 传输环节）全部原样保留。

### 2. 内网穿透方案对比：NATS 是合理选择

| 方案 | 原理 | 优点 | 代价 |
|---|---|---|---|
| **NATS 中继** | 双方出站连 broker | App 独立不装 VPN；request-reply 语义匹配 RPC；subject 级 ACL；家用网络零配置 | 需维护/租用 broker；流量绕行公网 |
| Tailscale 组网 | 虚拟网卡直连 | 最省心，组网后等价局域网，v1 的 LAN 方案直接用 | 手机必须装 Tailscale 并登录同 tailnet；依赖第三方协调服务器 |
| Cloudflare Tunnel | cloudflared 出站反代 | 免费、自带 TLS、可加 CF Access 认证 | 流量经 CF；稳定隧道需自有域名 |
| frp / nps | VPS 反代原始 TCP | 经典成熟 | 需 VPS；暴露原始 HTTP 还要自己加 TLS + 认证 |

选 NATS 的决定性理由：手机端是独立 App（不依赖 VPN 客户端，上架审核也更干净）；消息语义与 RPC/推送天然吻合；subject 命名空间让"多台 harness / 多设备"的扩展路径自然（`dsh.<instanceId>.>`）。

### 3. 插件 = NATS 出站桥（不再是 HTTP 路由插件）

v1 方案里插件在 webserver 上挂 `/mobile` 路由——那只服务局域网，**v2 全部废弃**。插件新职责：

1. 在 harness 进程内**出站**连 NATS（WSS），常驻重连；
2. 订阅本实例的 RPC subject，把请求喂给 `ctx.apiProxy`（`toFetchHandler`，进程内直连，webserver 都不参与）；
3. 把 `events.mux` / `events.host` 两条下行帧流发布到对应 NATS subject；
4. 配对与 token：配对码核销、设备 token 签发/吊销（细节见插件 docs）。

由此获得一个额外的安全收益：**webserver 可以保持绑定 `127.0.0.1`**，电脑在局域网里都不暴露任何端口，攻击面只剩 NATS 的 subject ACL。

### 4. 技术选型不变：React Native（Android / iOS）

理由见 [01-tech-stack.md](01-tech-stack.md)。NATS 客户端用官方的 `nats.ws`（WebSocket 传输，浏览器/ RN Hermes 可跑，需实测）。NATS server 需开启 WebSocket + TLS 监听。

## 端到端架构

```text
phone (RN)
  └─ packages/protocol: 契约层(vendored) + NatsApiClient(doFetch→NATS request)
        │  WSS 8443 + C 端账号（App 内置）+ 设备 token（配对签发）
        ▼
NATS Hub（既有，115.159.57.137，腾讯云）◄──── 其他电脑的其他服务共用同一 Hub
   subjects（沿用 svc./evt. 既有约定）:
     svc.dsh.{instance}.{method}   request-reply  ←→ 一元 RPC
     svc.dsh.{instance}.respond    request-reply  ←→ 审批回答
     svc.dsh.{instance}.pair       request-reply  ←→ 配对码核销
     evt.dsh.{instance}.mux        pub/sub        →  会话事件流
     evt.dsh.{instance}.host       pub/sub        →  宿主事件流
        ▲
        │  Leaf 出站长连接（:7422，既有模式）
本地 Leaf nats-server（dsh 电脑上，localhost:4222）
        ▲
        │  本机明文连接（不出网卡）
dsh-mobile-plugin（harness web profile 内的 Cordis 插件）
  └─ 进程内调 toFetchHandler(ctx.apiProxy) / 订阅宿主事件源
        │
deepseek-harness（webserver 仍可只绑 127.0.0.1）
```

Hub 为既有设施（见 distributed-knowledge-architecture.md），实测 2026-08-25：4222/7422 可达，v2.14.4，支持 headers（token 走 NATS headers 的前提成立），max_payload 1 MiB（故不传大文件）。需要为手机追加的唯一服务端改动：开 `websocket` 监听（8443）+ 私有 CA 原生 TLS（不用域名），见插件 docs/02。

## 功能范围（按里程碑）

### M1 链路打通

- Hub 追加配置：websocket 8443 + 私有 CA 原生 TLS + dsh 专用 C 端账号（改动清单见 dsh-mobile-plugin/docs/02-nats-server.md）。
- dsh 电脑部署 Leaf 节点（沿用既有 leaf-a~d 模式）。
- 插件：连本地 Leaf、RPC 桥、事件流桥、配对码/token。
- 移动端：RN 工程跑通 Android，经 NATS 完成配对 → describe → 列会话 → 实时流式输出。

### M2 核心对话

- 发起 prompt、流式渲染（`assistant/chunk`）、工具调用树折叠、取消、队列、审批（`/respond`）。

### M3 任务面板

- `session/jobs` 快照、状态徽章、归档；App 前台时的任务完成/待审批提醒。

### M4 iOS

- iOS 适配（需 Apple 开发者账号真机签名）。

## 双端数据同步（Web ⇄ 移动端）

**同步是架构自带的，不需要任何同步协议。** 关键在于：数据只有一份——会话日志在 dsh 进程里（追加式 `SessionEvent` 日志 + 磁盘持久化），Web 浏览器和手机都只是这份日志的"视图客户端"：

- **任一端发送** = 调 `session.prompt`，消息追加进同一份会话日志 → 宿主把 `user/message`、`assistant/chunk`、`tool/*` 等事件**广播给所有订阅了该会话的客户端** → 另一端实时渲染。手机发的消息 Web 端即时可见，反之亦然。
- **状态类数据同理**：队列快照、jobs 快照、projection 帧、待处理审批，宿主对每个订阅连接都广播同一份权威快照，两端永远不会出现"各存一份、需要合并"的局面。
- **断线的一端**重连后走基线重拉（`session.list` + `session.history` 尾页），从权威日志补齐，不存在冲突解决。
- 今天 Web 版开多个浏览器标签页就是这套机制在工作；手机只是接入同一广播的第三种客户端。

> 代码级验证（2026-08-26，deepseek-harness `packages/host/apiproxy/src/api-proxy.ts`）：
> `muxQueues` 集合向**所有**已连接 mux 消费者广播瞬态帧（约 L1214）；每条 mux 流各自监听
> `ctx.on('session/event', ...)` 并下推所有会话的全部事件（约 L3373）。即事件分发与
> "帧来源是哪个客户端"无关，双向同步在宿主侧天然成立。

设计约束：v1 不做"离线编辑后回同步"——手机没网就不能操作（连接是硬前提），因此永远不会产生需要合并的离线分歧。

## 已知风险与对策

| 风险 | 说明 | 对策 |
|---|---|---|
| broker 运维与单点 | 所有流量绕行公网 broker；broker 挂 = 全断 | 复用既有 Hub（已在跑多机服务互联）；M1 先把重连/断线提示做扎实 |
| Hub 目前无 TLS | 既有 Hub 的 4222/7422 是明文（其文档 TODO） | 手机只走 wss://IP:8443：自建私有 CA + nats-server 原生 TLS，CA 打进 App 构建（不用域名，零外部依赖），不碰明文 4222；Leaf 的 7422 TLS 建议随既有待办一起补 |
| RN 的 nats.ws 兼容性 | nats.ws 面向浏览器，Hermes 上需实测 | M1 第一项验证；不过则在 VPS 上加一个轻量 HTTP↔NATS 网关，App 退用 HTTPS+WS 直连网关 |
| 流式 chunk 的消息频率 | `assistant/chunk` 可能每秒多条 | NATS 擅长高频小消息；必要时插件侧做 ~50ms 合帧再发布 |
| 凭证安全等级提高 | 暴露面从 LAN 变成公网 | 双层凭证：NATS 账号（subject ACL 限 `dsh.{instance}.>`）+ 应用层设备 token（可吊销），见插件 docs |
| 协议无版本字段 | 官方"客户端与宿主一同发布" | 移动端与本地 harness 版本对齐；握手校验 `host.describe`，不匹配则明确报错 |
| 杀后台后无提醒 | NATS 长连接受系统后台限制 | 已明确：本地安装阶段不做系统推送，只保证前台体验 |

## 分发与 onboarding（已定，2026-08-26 更新）

App **有安装版**（可能分发给他人），但用户模型是**单用户多终端**：不做多租户隔离，每台终端通过扫码配对接入自己的 dsh。onboarding 必须傻瓜化：

- **App 构建内只含 Hub CA 公钥**（非机密），不含任何账号凭证——反编译拿不到可用机密。
- 新用户流程：dsh 机主装插件 → 设置页"移动端"卡填服务器信息 → 测试连接 → 出二维码；手机**扫码一次**拿到全部连接参数并完成配对（详见插件 docs/00 的 onboarding 流程）。
- 前期仍走本地安装渠道（Android APK 直发）；上架应用商店是独立议题，需要时再评估审核约束（内置私有 CA 信任配置在审核中需要说明用途）。
| 宿主重启丢待处理审批 | 官方已知限制 | 与 Web 版行为一致，接受现状 |

## 相关文档

- [01-tech-stack.md](01-tech-stack.md) — 三端技术选型细节
- [02-protocol.md](02-protocol.md) — 信封复用与 NATS 传输映射细节
- 插件侧：dsh-mobile-plugin/docs/
