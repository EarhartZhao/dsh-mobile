# 协议接入：同一套信封，NATS 传输

> 本文描述移动端如何接入 deepseek-harness 的当前 Typert Remote。协议权威定义在
> `deepseek-harness/packages/api/**`、`packages/interaction/**` 等 Remote owner 中。
> App 仍消费稳定的移动端信封；dsh-mobile-plugin 0.2.2 把 dsh 0.1.5-rc.1 Remote 参数、流和事件适配成该信封。
> 迁移期内插件与 App 同时兼容旧命名，例如 durable PTC 派发事件的新名
> `tool/ptc-dispatch*` 与旧名 `tool/code-dispatch*`（见"事件流消费要点"）。

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

NATS 帧继续使用已发布 App 的 `ServerRequest`/`ServerResponse` 信封。插件内部通过 Typert Gateway 调用当前 Remote，并把 `session/follow`、`session/control`、`workspace/follow` 和 `$events` 投影成移动端 mux/host 帧。

既有 Hub 的 C 端账号权限（publish `svc.>`、subscribe `evt.>`）与 App 的需求**精确吻合**，无需为手机开放任何新权限。

## 连接生命周期

```text
1. 配对（一次性）     扫 PC 上的二维码 → { natsUrl, instance, pairCode }
                     → 连 NATS → request svc.dsh.{instance}.pair { code, deviceName }
                     → 得到 { token, expiresAt }（之后每个 RPC 帧头携带）
2. 连接              nats.ws 拨 WSS（Hub 的 8443，C 端账号凭证，App 内置/配对下发）
3. 握手              mobile.info → mobileApi/features 门禁 → host.describe
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
- 实时控制：`session/control` baseline 覆盖 queue/jobs/projections；App 在新 generation 前清空旧瞬态快照
- 工作区：`workspace/follow` baseline 与增量，`workspace.list` 仍作为重连权威快照
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
| `command.list` / `command.execute` | 当前 Remote 的动态命令发现与执行 |
| `reference.files` / `reference.sessions` | 映射到文件与会话引用候选 Remote |
| `file.upload` | 移动端以 base64 通过 NATS 调用 dsh `fileUploads/upload`，返回 Agent-scoped receipt 与文件引用 |
| `goal.get` | 映射到 `goals/get`：读当前目标的 phase 与**进程内 activation**（durable `goal` projection 故意不含 activation） |
| `feedback.list` / `feedback.put` / `feedback.delete` | 映射到 `messageFeedback/list\|put\|delete`：按消息的持久评分（Like/Dislike）。宿主返回**业务结果**（`{ok:true\|false}`）而不是 Remote 错误，客户端按 `version` 做 compare-and-set，冲突时用返回的 `current.version` 重试一次 |
| `file.list` / `file.read` / `file.bytes` | 映射到 `workspaceFiles/list|read|readBytes`：workspace 目录列表、有界文本页、有界 base64 字节窗口（路径以 `workspaceFileScopeId` 解析到该会话的 workspace root） |
| `file.related` | 映射到 `workspaceFiles/readRelated`：以某个文件所在目录为基准读相对路径，供 Markdown 预览拉取文中引用的图片 |
| `file.stat` | 映射到 `workspaceFiles/stat`：只取 `version`/`bytes` 的轻量探针，版本未变时预览直接复用缓存页，省掉整页重读 |
| `file.watch` | 映射到 `workspaceFiles/changes` 流：插件为「会话 + 目标目录」打开变更流，把它作为 `workspace-files/change` / `-ready` / `-watch-error` 转发事件发到宿主域下行帧。dsh 0.1.7 起宿主按**单个目标** watch，所以 `path`（workspace 相对、缺省为根）随请求下发，App 浏览目录时会带着当前目录重新挂流 |
| `file.unwatch` | 插件自有方法：释放该目标（会话 + `path`）的变更流。App 关闭浏览器或切换目录时调用，属尽力而为——未知会话或缺少 hook 都返回成功，不能因为"关面板"而报错 |
| `workspace.unarchiveSession` | 映射到 `workspace/unarchiveSession`（dsh 0.1.6 新增）：把归档会话恢复到列表。插件 0.2.7 起放行并声明可选能力 `workspace-unarchive`；旧插件返回 `mobile-forbidden`，App 据此隐藏"取消归档" |
| `file.reveal` / `host.openPath` | 都映射到 `session/openWorkspacePath`：`file.reveal` 带 `action: 'reveal'` 在宿主机文件管理器定位，`host.openPath` 用默认应用打开 |

### M3 任务面板

无需新 RPC：`session/jobs` 快照帧、`host/session-status`、`session/projection` 帧全部走 `evt.dsh.{instance}.mux` 下行。

### 明确不做（v1）

- `settings.*` / `credentials.*` / `llm.*` 配置面与 `host.pickDirectory`：移动端用不到，且插件白名单直接不放行。（`host.openPath` 自插件 0.2.3 起放行，见上表。）
- `session.export`（ZIP 导出）：暂无场景；未来要做则走插件签发一次性下载 URL，不走 NATS 传大文件。
- dsh 新增的 `/api/file` 媒体路由：它是宿主 web server 上的 HTTP 路由，而移动端只经 NATS 连公网 Hub，手机到不了宿主的 `/api` 前缀，因此不接入；文件读取统一走 `file.read` / `file.bytes`（受 `workspaceFiles.maxBytes` 与 NATS `max_payload` 双重约束）。

文件上传使用 `file.upload` 移动端扩展方法：客户端先提交 canonical base64 与可选文件名，拿到 `receiptId` 后，再通过 `filePrompts.prompt` 以 `{ type: 'file', receiptId }` 提交到 `session.prompt`。由于 NATS Leaf 的 `max_payload` 约为 1 MiB，该路径适合小文件；大文件应使用 dsh Web 的 `/api/session/uploadFileBinary` 流式 HTTP 路径，移动端暂不绕过 NATS 限制。

## 事件流消费要点

### events.mux（会话域）

- 流式渲染：订阅目标会话的 `assistant/chunk`，**按 seq 排序、节流批量进 UI**；`assistant/message` 是定稿。
- 工具卡是**宿主声明式**的：`session/event` 的 `view` 槽（`{for:'call'|'result', view}`）随事件下发渲染意图，`card` 取值 `generic/terminal/diff/search/read/web`。App 按 `card` 分支渲染（注册表在 `apps/mobile/src/components/tool-cards.tsx`），**未知 card 一律落通用卡**（`title`/`rawInput`/`content`/`locations` + 原始 result）——因为 `view` 在冻结 schema 里是 `z.looseObject({ card: z.string() })`，未知类型会原样透传而不会被丢。插件新面若只是加一种卡，App 不改也能显示得可读。**这个槽由桥填**（插件 0.2.10 `src/tool-views.ts`）：宿主进程内按 Agent scope 调各工具声明的 `presentCall`/`presentResult`，`result` 由 durable 事件重建（`message.content`/`message.isError`/`data.meta`）。注意工具是**按 scope 注册**的，只查 `ctx.tools.get(name)` 会得到"未注册"，必须带上 `ctx.agents.get(sessionId)` 那个 scope；任何一步拿不到就返回"无 view"，App 回退原文，宿主日志按原因各记一行。
- 工序表头的实时文案来自三处：`assistant/chunk` 里**具名的** `tool-call-delta`（模型已宣告、尚未 dispatch → "准备调用工具"行）、运行中的 `tool/call`（分类 + 参数里的任务详情），以及 `turn/start`/`turn/end` 的 `time`/`reason`（用时、"已停止"/"处理失败"）。分类与详情字段优先级固定在 `packages/core/src/activity.ts`，与 Web 的 `process-activity.ts` 同表；准备行被同 `callId` 的 `tool/call` 取代、随 `turn/end` 清除，所以取消的流不会留下幽灵行。
- 未知事件不静默丢弃：带 `surfaceOp: 'append'` 的事件如果 App 没有渲染器，就显示成"未知事件：{type}"折叠行（原始 data 可展开、复制、分享），对齐 Web 的 `unknown-surface`。**判据只看 `surfaceOp` 标记、不维护类型表**——宿主拒绝在非 surface 类型上写这个标记、又要求 surface 类型必须带它，所以标记本身即"该事件进了模型可见面"的声明；`system/message` 与 `developer/message` 是宿主写给模型的，按 Web 口径排除。判据与数据的实现在 `packages/core/src/unknown-event.ts`。
- 提问帧的 `intent` 是**开放的渲染意图词表**，因此不能当严格标签联合用：冻结 vendor 把它写成 `discriminatedUnion('kind', [plan-review])`，未知 tag 会拒掉整个帧，用户看到的是"会话卡住、没有问题卡、也没有任何提示"。App 的处理是"拒帧时宽解析重读一次"（`packages/protocol/src/mobile-questions.ts`）：`intent` 保持 `looseObject({ kind: string })`、其余字段仍按 vendor 形状校验，未知 kind 降级成通用问答卡并在卡片上注明类型，未渲染的 kind 同步进诊断日志。新增一种 intent 时只要在 `KNOWN_QUESTION_INTENTS` 登记并补一张卡，登记之前的行为是"可读、可回答、有说明"。
- durable 事件名会随 dsh 版本改名（`tool/code-dispatch*` → `tool/ptc-dispatch*` 即 0.1.5 的改动，历史会话由 v2→v3 迁移重写为新名）。App 的事件归一层 `normalizeEventType` 把两套名字折到同一套语义，新增改名时在此登记，不要各自打补丁。
- `session/projection` 帧（`{sessionId, key, value, seq}`）：按会话维护通用值仓，seq 高者胜；标题在 `title` 键下。
- `session/jobs`：完整快照语义（非差分），直接替换本地集合；没有 baseline 即空集。dsh 0.1.6-alpha.2 由 `session/control` 的 baseline 与 `{type:'jobs'}` 帧推送，0.1.7 删除后改由 `job` 命名空间（Service 名 `jobController`）的 `list` 流承载；插件在 App 打开某个会话时挂一条 roster 流并翻译回同一帧型，App 侧不变。
- `session/queue`：权威队列快照，不要从轮次事件推断队列。dsh 0.1.6-alpha.2 删掉了宿主侧的 `queues` baseline 表与 `queue` 控制帧，待处理输入改由会话 `inbox` 投影表达；插件 0.2.8 把该投影翻译回同一帧型（`next-turn` → `queued`，`next-step` 按来源分 `steering`/`context`），App 侧契约不变。`inbox` 只在会话挂着活动 Agent 时存在，与 alpha.1 的 `queues` 是同一个门禁——空闲宿主上观察不到队列帧属于预期。

### events.host（宿主域）

- `host/session-added` / `host/session-status(running)` / `host/workspace-*` / `host/archived-sessions-changed`：驱动列表页与状态徽章。
- 转发事件帧（`host/remote-event`）：`commands/change`、`llm/adapters-updated` 等失效信号，收到后重拉对应 RPC，不做差分。

### 公网场景额外注意

- 事件是 fire-and-forget 的 pub/sub：App 断线期间**会丢帧**。这是可接受的——重连后一律走"基线重拉"恢复权威状态，帧只用于在线期间的低延迟更新。
- 帧不带离线队列（不用 JetStream）：待办类状态（jobs、待审批）本身在宿主有权威源，重拉即可；引入 JetStream 只会让 broker 变成状态存储，收益不成比例。

## 认证（双层，详见插件 docs/01）

1. **NATS 层**：App 用 Hub 的 C 端受限账号连 broker（publish `svc.>` / subscribe `evt.>`）。这层是命名空间围墙——注意它**允许调用任何服务**，所以它不是业务安全的边界。
2. **应用层**：每个 RPC/respond 请求携带设备 token（配对时签发），插件逐请求校验并执行方法白名单。这层防"拿到 NATS 账号的人直接操作 harness"，也是吊销设备的真实开关。

配对失败会保留可操作原因：无效/过期配对码返回 `mobile-pair-failed`；有效码因有效设备达到上限被拒绝时返回 `mobile-device-limit`，App 引导用户在电脑端吊销旧设备。插件健康状态的设备数只统计未吊销且未过期的有效设备。

## 版本兼容

App 在建立会话基线前调用插件自有 `mobile.info`。App 0.0.3 要求 `dsh-mobile-plugin >=0.2.2 <0.3.0`、`mobileApi=2`，并校验 Remote v2、分页历史、control/follow 与事件回答能力位。`host.describe.version` 是宿主 dsh 版本，不代表插件能力。命令目录失败会明确报错，不再伪造旧命令或静默退回普通 prompt。

能力位分两级：`mobile.info.features` 里插件必须提供的门禁能力（见 `packages/core/src/compatibility.ts` 的 `REQUIRED_PLUGIN_FEATURES`），以及**可选能力**——`workspace-files`（工作区文件目录浏览与文件预览）、`goal-state`（目标 activation）、`open-path`（宿主机打开/定位）。可选能力缺席时 App 只隐藏对应入口（会话菜单不出现"工作区文件"、文件 chip 点击降级为复制路径、目标条只显示 durable phase），不会判为不兼容；因此旧插件仍可与 App 0.0.3+ 共存。

dsh 0.1.6-alpha.2 另有三处新面，App 按可选路径接入，旧宿主缺席时自然退化，都不进 `REQUIRED_PLUGIN_FEATURES`：

1. **引用候选的 `displayTitle`**（`sessionReferenceResolver/candidates`）：子代理会话用自身 label 呈现，行文案统一在 `apps/mobile/src/session-references.ts`（标题取 `displayTitle ?? label`，两者不同时把会话标题拼在工作目录前），`@` 补全与加号菜单共用。旧宿主不发该字段时退回 `label`。alpha.2 起冷会话也能从投影缓存回答标题，所以这一列不再普遍退化成会话 id。
2. **插件清单的 `managementAvailable`**（`pluginInventory/list`）：表示本机是否具备持久化的当前配置管理能力（宿主挂了 `pluginManager` 才为 true）。插件页据此显示"具备插件管理能力"或"只读清单"，`fetchMobileInventory` 把非布尔值归一为缺省。
3. **`plugin-manager/changed|install-state|install-log` 转发事件**：宿主 0.1.6-alpha.2 起转发，插件以既有的 `host/remote-event` 透传任意 emit 事件，App 订阅 store 的 `remoteEvent` 后按前缀静默重读清单（不整页清空），桌面端装插件时手机不再需要手动刷新。事件自身到达就是能力信号，因此没有新增 feature 位。

dsh 0.1.7 的破坏性变更全部由插件 0.2.9 在桥内吸收，移动 wire 与 App 无需跟着改，但排查时要知道源头换了：

| 面 | 0.1.6-alpha.2 及以前 | 0.1.7 起 | 桥的做法 |
|---|---|---|---|
| `$events` 下行流 | `wireStream.open(endpoint, payload, signal)` | 在 signal 前插入 Client uplink 与 Peer | 插件按声明 arity 选择调用形状（`openEventStream`），否则 `$events` 直接报 AbortSignal 错，审批/提问/全部转发事件一起失效 |
| 字节窗口读 | `readBytes` 顶层 `range`，`data` 是 base64 字符串 | 窗口移入 `options`，`data` 是原生字节；`readRelated` 删除，改由 `options.baseFile` 表达 | 插件发新形状并把字节编回 base64；宿主回参数/端点错时退回旧形状 |
| 工作区变更流 | 按会话（`workspaceFileScope`）watch | 按单个目标 watch，`path` 必填 | `file.watch`/`file.unwatch` 带上当前目录，桥按 (会话, 目标) LRU 4 条流 |
| 子代理目录 | `subagents/list` Remote | 删除；改为父会话 `subagentCatalog` 投影（durable `subagent/catalog`），可经 `session/projections` 不激活 Agent 读取 | 插件用投影行 ∩ `session/list`（`running`/`agentAvailable`/`parentSessionId`）合成 App 冻结的目录，宿主不认识 `session/projections` 时回退旧 Remote |
| 后台任务 | `session/control` baseline 的 `jobs` 表 + `{type:'jobs'}` 帧 | 删除；改为 `job` 命名空间的 `list` 流（整集替换、开流即首帧）与 `follow`/`kill` | 插件在 App 打开会话时挂 roster 流，翻译回 `session/jobs` |

另外，`session/list` 的每一行在 0.1.7 增加了 `agentAvailable`（该会话是否挂着活 Agent），正好解释队列投影（`inbox`）为什么有时为空；`workspace/follow` 基线新增 `pinnedSessionIds` 与 `pinned` 增量（会话置顶），`workspace.archiveSession` 新增 `stopActivity` 与 `workspace/session-active` 拒绝原因——这些是可选新面，App 尚未接入。

工作区浏览器只走 workspace 相对路径：`file.list` 返回的条目只带 basename，客户端自己拼接/回退/构建面包屑（`apps/mobile/src/workspace-path.ts`），路径以 `workspaceFileScopeId` 交给宿主解析成会话 workspace root，因此手机端既不需要知道绝对前缀，也无法越出工作区。图片按字节窗口读（上限 512 KB），文本按行页读（默认 400 行），两者都受宿主 `workspaceFiles` 的 `maxBytes`/`maxLines` 上限再裁一次。

文件变更通知刻意复用**已发布**的 `host/remote-event` 帧，而不是新增 mux 帧类型：App 侧的 mux/host 帧 schema 是冻结的 `discriminatedUnion('type')`，未知帧类型会被载体丢弃；`host/remote-event` 的 `args` 是 `unknown[]`，正好承载 `{ sessionId, absolutePath, version | absent, path? }`。事件名沿用上游词汇 `workspace-files/*`，浏览器收到后做 300 ms 去抖重列（一次工具运行会连续写多个文件）。

插件在开流前用 `session/list` 取该会话的 `cwd`（与 `workspaceFileScope` 解析 workspace root 用的是同一个值），据此把 `absolutePath` 额外换算成 workspace 相对 `path`；拿不到 `cwd` 时该字段缺省，App 视为"位置未知"一律重列。浏览器只有在 `parentPath(path) === 当前目录` 时才刷新——仓库里高频写入时不再每次都整列重拉。

变更流是宿主上的活流，所以插件按 **LRU 上限 4 条**管理：超过上限时释放最早接入的会话；App 关闭浏览器会显式 `file.unwatch`，异常退出则由该上限兜底。Host generation 结束时全部释放，重连后按最近接入顺序重新武装。

**变更流不是文件系统监视器**（真机联调实测确认）：宿主只把**自己 instrumented 的文件系统操作**（`fs/observed`，即 agent 工具/host 侧读写）变成帧，不监听操作系统。所以"agent 正在写文件"会实时刷新手机端列表，而宿主上别的程序改文件不会通知——那种情况用户手动刷新即可。探针 `scripts/watch-probe.mjs` 在真实宿主上验证了 `ready` 转发与释放路径。

预览的读取策略：打开文件先用 `file.stat` 比对 `version`，命中缓存就直接展示上次那页，否则按种类读取（图片取 512 KB 字节窗口，其余按 400 行一页）。文本页在 `eof=false` 时提供"继续读取"，按 `offset + lines` 拉下一页并追加。目录列表没有游标参数——`workspaceFiles/list` 只按宿主 `maxEntries` 截断并回报 `truncated`，因此列表无法续读，只能提示用户进入子目录。

浏览器插入引用后，App 会在输入框上方保留一枚引用 chip（文件名 + 大小/目录），并把焦点交还输入框；chip 跟随草稿——用户把 mention 删掉，chip 也随之消失。回车发送默认开启（Shift+回车换行），可在设置页"输入"分组关闭。

## 已知边界（能力之外的三件事）

1. **目录列表没有分页。** `workspaceFiles/list` 按宿主 `maxEntries`（默认 2000）截断并回报 `truncated`，没有游标；客户端只能提示，缓解手段是把宿主的 `workspaceFiles.maxEntries` 调大。真正的续读需要上游两处改动：文件系统 seam 的 `listDir` 支持上限（否则截断只是少返回、列举代价照付——上游 README 自己记了这条），以及 Remote 增加 offset/游标参数。
2. **大文件不出网关。** NATS 的 `max_payload` 约 1 MiB，而宿主新增的 `/api/file` 是**宿主本机**的 HTTP 路由，手机经公网 Hub 连不到。所以超过一窗口的图片现在会明确提示"超过手机端预览上限"，而不是渲染半张图；要真正支持需要 Hub 侧中继，或增加一个仅同一局域网可用、带设备 token 的下载端点——两者都是产品决策，未实现。
3. **二维码里的 CA 指纹没有强制。** `caFp` 被配对记录保存、也出现在诊断里，但 RN 的 WebSocket 不暴露对端证书，校验需要原生实现；因此诊断 payload 明确带 `caFpEnforced: false`，不要把该字段当作已生效的信任锚。

插件在 `features` 中声明 `health-check` 后，App 可调用需要设备 token 的 `mobile.health`。响应包含桥连接状态、插件版本、mobileApi、功能列表、构建 ID、真实加载路径、实例 ID、已配对设备数、启动时间、运行时长、最近连接/重连和最近错误。App 记录调用延迟并在连接诊断页展示；复制的诊断信息不得包含 Hub 密码、配对码或设备 token。

## 客户端实现策略

- `packages/protocol/src/vendor/` 是 App 已发布移动端信封的冻结快照，不再从已删除的 ApiProxy 目录复制。
- **冻结 vendor 会吞掉上游新增字段**：vendor 里的 zod schema 默认 strip 未声明键，所以 `client.skills.list` / `client.agentPresets.list` 拿不到后续 dsh 加的 `SkillEntry.path` 与 `agentPresets/list.modeSelectionEnabled`（真机实测：host 明明返回了，App 侧全是 undefined）。凡是读"快照之后新增的字段"，一律走 `mobile-*.ts` 这一层（`mobile-catalog.ts` 就是为此而设），那里用宽解析保留 host 原样响应；旧 host 缺字段时保持原行为。
- `packages/protocol/src/REMOTE_ALPHA5.json`（文件名保留历史命名）列出插件实际依赖的 Remote endpoint；`sync-protocol:check` 同时校验冻结 vendor 哈希和当前 dsh 源码中的 Remote 定义，目录重构或方法改名会直接失败。
- `NatsApiClient extends AbstractApiClient`：官方抽象要求平台子类只提供 `doFetch` 传输环节——我们的 `doFetch` 把请求字节作为 NATS request 发出、把回复字节返回，其余（rpcId、信封编解码、Zod、超时、取消）全部复用。
- 下行循环：订阅两个事件 subject，帧喂给与浏览器载体相同的 sink 逻辑。
- 握手时比对 `host.describe`；协议不匹配给出"请升级 App 或 harness"的明确错误。
