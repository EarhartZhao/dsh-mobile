# 协议接入：同一套信封，NATS 传输

> 本文描述移动端如何复用 deepseek-harness 的既有客户端协议。协议权威定义在
> `deepseek-harness/packages/host/apiproxy`（契约 + 宿主实现）与
> `deepseek-harness/packages/client/connection`（浏览器载体），本文只做消费侧摘要。
> v2：传输层从"HTTP + WebSocket"换成 NATS，**信封字节与业务语义一字不改**。

## 传输映射

harness 协议是四象限信封（`ClientRequest` / `ServerResponse` / `ServerRequest` / `ClientResponse`），与物理通道解耦。映射：

| 信封 | 浏览器载体 | NATS 载体 |
|---|---|---|
| `ClientRequest` | POST `/api/<method>` body | publish 到 `svc.dsh.{instance}.{method}`，带 reply-to |
| `ServerResponse` | POST 响应 body | request-reply 的回复载荷（回显同一 `rpcId`） |
| `ClientResponse` | POST `/api/respond` body | publish 到 `svc.dsh.{instance}.respond`，带 reply-to |
| `ServerRequest` | WS 下行文本帧 | 插件 publish 到 `evt.dsh.{instance}.mux` / `evt.dsh.{instance}.host`，App 订阅 |

subject 布局沿用既有 Hub 的命名约定（`svc.<服务>.<动作>` / `evt.<服务>.<事件>`，见 distributed-knowledge-architecture.md 第 5.1 节），`{instance}` 为 harness 实例 id（配对时下发）：

```text
svc.dsh.{instance}.{method}     request-reply    一元 RPC（白名单方法，如 session.prompt）
svc.dsh.{instance}.respond      request-reply    审批/提问回答（RpcReceipt）
svc.dsh.{instance}.pair         request-reply    配对码核销（无 token 时唯一可用）
evt.dsh.{instance}.mux          pub/sub          会话域下行帧（ServerRequest）
evt.dsh.{instance}.host         pub/sub          宿主域下行帧（ServerRequest）
```

帧格式与 WS 载体完全一致：`ServerRequest` 文本消息原样作为 NATS 载荷，Zod 信封解析逻辑一行不改。

既有 Hub 的 C 端账号权限（publish `svc.>`、subscribe `evt.>`）与 App 的需求**精确吻合**，无需为手机开放任何新权限。

## 连接生命周期

```text
1. 配对（一次性）     扫 PC 上的二维码 → { natsUrl, instance, pairCode }
                     → 连 NATS → request svc.dsh.{instance}.pair { code, deviceName }
                     → 得到 { token, expiresAt }（之后每个 RPC 帧头携带）
2. 连接              nats.ws 拨 WSS（Hub 的 8443，C 端账号凭证，App 内置/配对下发）
3. 握手              svc.dsh.{instance}.host.describe → 宿主描述 + 版本对齐检查
4. 订阅下行          sub evt.dsh.{instance}.mux + evt.dsh.{instance}.host
5. 就绪              订阅建立 + describe 成功 → 在线
6. 运行期            一元调用走 rpc subject；一切实时数据由两个事件 subject 推下来
7. 断线              nats.ws 自动重连；重连成功后按"重连基线"重拉（不重放差分）
```

注意：插件侧不直连 Hub，而是连 dsh 电脑的**本地 Leaf 节点**（`localhost:4222`）——订阅路由经 Leaf 自动同步到 Hub，断外网时本地浏览器/其他服务不受影响，恢复后自动重连（Leaf 模式的既有优势）。

重连基线（与浏览器 generation 语义对齐）：

- `workspace.list`（含归档集合）
- `session.list`
- 打开中的会话：`session.history` 尾页（含 `projections` 水位线块）
- 待处理提问/审批：插件在 App 重新订阅 `evt.dsh.{instance}.mux` 后重发当前待处理集合（对齐官方"mux 重开时重放"语义）

## 最小 RPC 清单（按里程碑）

### M1-M2 对话核心

| 方法 | 用途 |
|---|---|
| `host.describe` | 握手、能力发现、版本对齐检查 |
| `workspace.list` | 工作台列表（重连基线） |
| `session.list` | 会话列表（重连基线） |
| `session.create` | 新建会话（可带 `agentPreset`） |
| `session.history` | 分页拉历史；尾页带 projections |
| `session.prompt` | 发起对话；携带 `clientTimeZone` |
| `session.cancel` | 取消活动轮次（保留队列） |
| `session.updateQueue` | 编辑/移除待处理队列项 |
| `session.rename` / `session.fork` | 标题、分叉 |
| `respond` | 回答提问/审批（RpcReceipt） |

### M3 任务面板

无需新 RPC：`session/jobs` 快照帧、`host/session-status`、`session/projection` 帧全部走 `evt.dsh.{instance}.mux` 下行。

### 明确不做（v1）

- `settings.*` / `credentials.*` / `llm.*` 配置面、`host.pickDirectory` / `host.openPath` / `agentPreset.*` 创作面：移动端用不到，且插件白名单直接不放行。
- `session.export`（ZIP 导出）：暂无场景；未来要做则走插件签发一次性下载 URL，不走 NATS 传大文件。

## 事件流消费要点

### events.mux（会话域）

- 流式渲染：订阅目标会话的 `assistant/chunk`，**按 seq 排序、节流批量进 UI**；`assistant/message` 是定稿。
- `session/projection` 帧（`{sessionId, key, value, seq}`）：按会话维护通用值仓，seq 高者胜；标题在 `title` 键下。
- `session/jobs`：完整快照语义（非差分），直接替换本地集合；没有 baseline 即空集。
- `session/queue`：权威队列快照，不要从轮次事件推断队列。

### events.host（宿主域）

- `host/session-added` / `host/session-status(running)` / `host/workspace-*` / `host/archived-sessions-changed`：驱动列表页与状态徽章。
- 转发事件帧（`host/remote-event`）：`commands/change`、`llm/adapters-updated` 等失效信号，收到后重拉对应 RPC，不做差分。

### 公网场景额外注意

- 事件是 fire-and-forget 的 pub/sub：App 断线期间**会丢帧**。这是可接受的——重连后一律走"基线重拉"恢复权威状态，帧只用于在线期间的低延迟更新。
- 帧不带离线队列（不用 JetStream）：待办类状态（jobs、待审批）本身在宿主有权威源，重拉即可；引入 JetStream 只会让 broker 变成状态存储，收益不成比例。

## 认证（双层，详见插件 docs/01）

1. **NATS 层**：App 用 Hub 的 C 端受限账号连 broker（publish `svc.>` / subscribe `evt.>`）。这层是命名空间围墙——注意它**允许调用任何服务**，所以它不是业务安全的边界。
2. **应用层**：每个 RPC/respond 请求携带设备 token（配对时签发），插件逐请求校验并执行方法白名单。这层防"拿到 NATS 账号的人直接操作 harness"，也是吊销设备的真实开关。

## 客户端实现策略

- 契约层 vendor：从 deepseek-harness（我们的 fork）复制 `packages/host/apiproxy/src/api/` 到 `packages/protocol/src/vendor/`，sync 脚本负责更新与 diff。
- `NatsApiClient extends AbstractApiClient`：官方抽象要求平台子类只提供 `doFetch` 传输环节——我们的 `doFetch` 把请求字节作为 NATS request 发出、把回复字节返回，其余（rpcId、信封编解码、Zod、超时、取消）全部复用。
- 下行循环：订阅两个事件 subject，帧喂给与浏览器载体相同的 sink 逻辑。
- 握手时比对 `host.describe`；协议不匹配给出"请升级 App 或 harness"的明确错误。
