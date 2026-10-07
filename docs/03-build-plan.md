# 构建计划

> 2026-08-26，方案已确认（00/01/02 + dsh-mobile-plugin/docs）。本文是跨仓库的落地计划。
> 原则：**风险最高的假设最先验证**；每个阶段有可演示的验收点；插件可独立于 App 先行联调（用脚本模拟 App）。

> 进度（2026-09-07，dsh 0.1.3-alpha.1 兼容升级）：App 0.0.3 / plugin 0.2.2 已切到 Typert Remote v2。阶段一完成 commands/preset/goals 参数迁移、`$events/result` 审批回答、`session/follow + page` 深历史和 packed chunks 展开；阶段二接入 `session/control`、`workspace/follow`、流失败重建及重连瞬态状态清空；阶段三新增 canonical 文件/会话引用、主聊天历史翻页与锚点保持、root/nested `read_image` 图片卡、轮次导航和模型 provider 失败展示；本次补齐新 dsh 的 `submittedAttachments` 参数、`assistantStream` 实时帧，以及基于 `fileUploads/upload` 的小文件 staged receipt 上传。旧 ApiProxy vendor 仍为冻结 wire，Remote endpoint 门禁继续校验。

> 进度（2026-09-10，dsh 0.1.5-rc.1 兼容核对）：按 `skills/dsh-sync-check` 跑完门禁——冻结 wire（36 文件哈希）与 40 个 Remote endpoint 的 owner 定义全部命中，`session/*`、`workspace/*`、`$events`、`fileUploads/upload` 契约与插件宿主服务面（`connection` / `typertGateway`）无破坏性变化。唯一客户端可见的改动是 durable PTC 派发事件改名（`tool/code-dispatch*` → `tool/ptc-dispatch*`，历史会话由 v2→v3 迁移重写为新名）：core 事件归一层改为新旧名等价并补两条回归用例，App 与插件 typecheck/test 全绿。上游新增的 `goals/get`、`goal/activation-changed`、`workspaceFiles` Remote 命名空间、`/api/file` 媒体路由和 `session/openWorkspacePath` 的 `reveal` 动作本次未接入，留作后续增量。

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

> 进度（2026-10-07 第二十轮）：**一轮只留一个回答：中途旁白折进工序，不再各自成为消息。**
> - 症结：`settledRows` 把一轮里**所有**可见项都挂在 disclosure 之后，于是模型「一边干活一边念叨」的话
>   （截图里那句 "curl works even though `web_fetch` is blocked…"）在轮次结束后仍各自占一张卡、带自己的
>   复制/评分/用量/时间行。web 不是这么读的：轮次结束时它把**最后一个回答之前的一切**（旁白、思考、工具调用）
>   折进工序，只留一条回答站着——`ui-chat/src/client/chat/ChatNodeSeat.tsx` 的 `processHidden =
>   foldable && processMember && !processOpen`，`ChatGroupSeat.tsx` 的 `outerHidden`，以及
>   `ui-chat/tests/chat-view.client.spec.tsx` 里两条用例：`folds Think and Tool rows before the final answer`
>   （早先那条回答进组、只剩 final answer）与 `keeps a live Turn expanded and folds it once at turn/end`
>   （运行中 `hidden === null`，`turn/end` 后变成 `until-found`）。dsh 里根本看不到那段旁白，正是因为它在
>   disclosure 里。
> - 现在：运行中照旧逐段读（旁白留在它说出的位置，这次不动）；轮次一结束，`settledRows` 丢掉除**收尾回答**以外的
>   `assistant`/`stream` 行，工序 disclosure 改挂在收尾回答上（`processOwnerItem` 从「第一条回答」改成
>   「最后一条回答」，否则折叠后 disclosure 会没有行可挂）。被折掉的项仍能通过 `rowIndexOfItemKey` 落到该轮首行，
>   搜索/跳转不会指向不存在的行。
> - 已知与 web 的差异（有意保留）：若一轮最后一条消息本身还带工具调用，web 认为该轮「没有干净答案」，连那段文字
>   一起折掉、只留一行图标；App 保留最后这条回答的文字（丢内容换一个空图标行不划算）。
> - 验证：`packages/core` test（17 套 133 例，改动 settled 折叠与跳转两条期望）/ `apps/mobile` typecheck / test
>   （27 套 195 例，「运行中的一轮」用例改为：`turn/end` 后动作行 2 个、旁白不再出现、收尾回答仍在）/ lint 0 error。

> 进度（2026-10-07 第二十轮）：**会话列表不再混入子代理会话。**
> - 症状：App 列表里同一句提示词重复出现十几行，dsh 侧正常。宿主 `session.list` 返回的是**全部**会话，子代理
>   子会话也在其中——一次委派任务每个 agent 写一个子会话（天津那次留下 17 个），且都以父会话的原提示词当种子，
>   读起来就像同一个会话复制了十几份。
> - web 的规则在 `packages/client/ui-workspace/src/client/tree.ts` 的 `sessionVisible`：
>   `if (session.origin === 'subagent') return false`。子会话只从父会话的 lineage 进（App 走 subagent 面板
>   那条路），不占列表行；App 缺这条过滤，于是全落进「未分组」桶。
> - 现在把这条可见性规则收进 `packages/core/src/session-list.ts`（`isSubagentSession` / `listedSessions` /
>   `archivedSessions`），列表页与 `session-sections` 共用同一份，不再各写一遍布尔式；`summaries` 仍是完整
>   注册表，从子代理面板打开的会话照样能取到自己的标题与 preset。搜索命中同样过这条规则（web 的
>   `sessionVisible` 对列表与搜索一视同仁）。
> - 只按 `origin === 'subagent'` 判，**不按** `parentSessionId`：fork 出来的会话带 `parentSessionId` 而不带
>   `origin`，它是用户可见的一等会话。
> - 验证：`packages/core` test（18 套 137 例，新增 `session-list.spec.ts` 4 例）/ `apps/mobile` typecheck /
>   test（27 套 198 例，新增「不渲染子代理行」「搜索结果剔除子代理」两条）/ lint 0 error（222 warnings 基线
>   不变）。真机（vivo V2405A，dev 包）复验：同一宿主同一份数据，列表由 22 行降到 5 行（22 − 17 个子会话），
>   父会话仍能打开、子代理面板仍列出 3 个直接子级并可进入。

> 进度（2026-10-07 第十九轮）：**运行中的轮次按 web 的读法逐段渲染，并修掉思考时的三处布局问题。**
> - 答案位置：`groupTurns` 原先把整轮的工序 block 统一插在答案之前（`rows = [prompt, process, 所有可见项]`），
>   于是「我来查一下天津近五年的经济数据。」这类**中途旁白**被压到了它后面那些工具调用的下方。web 的读法是
>   按时间顺序逐段渲染（`conversation-nodes/process-groups.ts`：一个 Step 的 reasoning 归入当前段、reply 单独
>   成行并结束该段、其后的工具调用开新段），只有轮次结束后才整轮折叠成一个 disclosure。现在 `TurnRow.process`
>   携带自己那一段的 `steps`/`summary`/`toolCallCount`，运行中的轮次行序为 `[prompt, 段1, 答案1, 段2, 答案2…]`，
>   轮次结束时再由 `settledRows` 折回「一个 disclosure 装整轮」的老样子（`turn/end` 后仍是答案卡内折叠）。
> - 运行中的底部按钮：动作行原先只按 `entry.kind` 判断，答案还在流式时就把复制/评分/分支/用量/时间全挂上去了。
>   web 的图标行挂在轮次尾部，且 `TurnTailNodeView.tsx` 在 `closing === null` 时**只渲染 tail**——还在写的消息
>   没有可复制、可评分、可分支的东西。现在 assistant 的行要等 `!turn.live` 才出现，用户消息始终保留自己的时间行。
> - 上下晃动（续第十八轮）：上一轮修掉「跟随滚动 vs 锚点」互抢之后还剩两个来源。① `TurnProcessBlock` 的
>   展开条件是 `manual ?? turn.running`，而 `turn.running` 只看「此刻有没有 in-flight 项」——模型两个步骤之间的
>   空档里它会折叠、下一个 chunk 再展开，每次都丢掉再补回上千像素；web 的依据是
>   `ChatGroupSeat.tsx` 的 `alwaysOpen = presentation?.turnClosed === false`，**是轮次是否活着**说话，不是某一帧
>   有没有在跑，所以改成 `manual ?? turn.live`。② `onListScroll` 里 `syncFollowTail(distanceFromBottom <= 48)`
>   会对「内容在下方增长」这一采样解除跟随（chunk 落地时 offset 原地不动，量出来的是读者没做过的位移），
>   再被 `onContentSizeChange` 的跟随滚动拉回来——每个 chunk 把滚动锚点和 offset 来回切一次。现在这一侧只在
>   确实贴底（≤48px）时把跟随**收回**，交出去只由手势和「回到底部」控件负责。
> - 验证：`apps/mobile` typecheck / test（27 套 195 例，新增 ChatScreen「running turn」3 例：逐段行序、运行中
>   动作行 1 个而 `turn/end` 后 3 个、步骤空档仍保持展开；另加 tail 跟随 1 例：过期采样不丢尾部）/
>   lint 0 error（222 warnings 基线不变）；`packages/core` test（17 套 133 例，新增 live 逐段与 settled 折叠各 1 例）。
>   真机复测留待设备（`adb devices` 当时为空）。

> 进度（2026-10-06 第十八轮）：**流式思考时聊天列表不再上下晃动。**
> - 症结是两个机制同时抢滚动位置：跟随最新一行的滚动用 `FlatList.scrollToEnd`，而它是
>   `VirtualizedList` 的**估算**（末尾行没测量过就用平均行长），正在流式的行恰恰是整段对话里
>   最高的，落点会差出一屏；同时 `maintainVisibleContentPosition` 的锚点又把内容按自己记录
>   的 frame 拉回去。一个往下、一个往上，每个 chunk 拉一次，就是读者看到的上下晃动。
> - 现在按「读者是否在尾部」二选一：在尾部时只由跟随滚动负责（关掉锚点），滚上去读旧内容时
>   只由锚点负责（不滚动）。滚动目标改成实测高度——`onContentSizeChange` 给的真实内容高度
>   减去列表自身 layout 得到的高度就是底部，不再用估算；一帧内的多个 chunk 合并成一次滚动。
> - 顺带删掉按「尾部签名」判断是否跟随那套逻辑（它把行数也算作尾部变化，于是补齐历史的前插
>   会被当成尾部增长），跟随与否只看读者位置，前插交给锚点。
> - 验证：`apps/mobile` typecheck / test（27 套 185 例，新增 ChatScreen 两条：流式时按实测高度
>   贴底、滚走后前插不抢滚动）/ lint 0 error；`sync-protocol:check` 与 core 测试全绿。真机复测留待设备。

> 进度（2026-10-06 第十七轮）：**修掉 App 内更新的四个使用缺陷。**
> - 版本查询：更新检查原只在启动时静默跑一次，必须完全退出重进才知道有新版本。现在提取成
>   `checkUpdate('boot' | 'manual')`，设置页第一张卡片多一行「检查更新」，显示上次查询结果
>   （查询中／已是最新／发现新版本 x.y.z／查询失败原因），点击即查，查到就弹同一个更新弹窗。
>   启动那次改为 ref 守卫，切换语言重建 `t` 不会再弹一次已经关掉的对话框。
> - 设置页顺序：连接行（进连接切换页）原来在「连接设置」最底部、主题在最上面。现在连接行
>   移到主题行上方，检查更新行又在连接行上方——版本、连的是哪台电脑、外观，按这个顺序读。
> - 暂停/取消：原先下载中两个按钮都是 `disabled`，点不动。原生 `DshUpdater` 新增
>   `cancelDownload(keepPartial)`（断开正在读的 socket，否则要等 30 s 读超时才停）与
>   `downloadedUpdate(version)`；JS 侧弹窗变为三态——下载中「暂停／取消」、暂停后
>   「继续下载／取消」。暂停保留 `.part`，续传就是原有的 range 续传路径；取消删掉半包。
>   弹窗的返回键等同于暂停，不丢已下载的字节。原生取消用 `UPDATE_CANCELLED` 回绝 promise，
>   JS 据此不再弹「更新失败」。
> - 重复下载：下载完成后目标文件从固定的 `dsh-mobile-update.apk` 改成按版本命名
>   （`dsh-mobile-update-<version>.apk`），`downloadAndInstall(url, version)` 先查缓存命中就直接
>   调系统安装器，并把命中大小回给 JS（弹窗显示「更新包已经下载完成（82.2 MB），点安装直接装」）。
>   装完/杀掉进程再回来都不会重下 80 MB；同目录其他版本的残留包在开始新下载时清掉。
> - 验证：`apps/mobile` typecheck / test（27 套 183 例，新增 `app-update` 9 例与设置页 3 例）/
>   lint 0 error；`:app:compileDebugKotlin` 通过。真机复测（暂停后续传、装包不重下）留待设备。

> 进度（2026-10-05 第十六轮）：**一个 App 连多台电脑 / 多个 Hub，可随时切换。**
> - 数据层：`apps/mobile/src/pairing-store.ts` 升到 v2（`{version, profiles[], activeId}`，
>   v1 单条记录自动迁移并删掉旧键），去重键是 `hub|instance|user`；重新配对同一实例只换 token，
>   不新增行。删除连接时只有"这个 Hub 再没别的连接"才清原生锚点（同 Hub 双实例共用一份锚点）。
> - 连接层：`connection.ts` 的 `connect` 回调改成"每次拨号都 `activateHub` 当前 host"，
>   修掉 Android 只认 `activeHost` 锚点导致切换后握手失败的问题；切换 = 换 active profile，
>   root 的 manager effect 整体重建。
> - 界面：新增 `ConnectionSwitcherScreen`（列表 + 当前标记 + 行内重命名 + `ConfirmModal` 二次确认
>   删除 + 「扫码添加」），设置页加「连接」入口与「本机设备名称」输入框，中英 i18n 各补 15 个键。
> - 设备名：`apps/mobile/src/device-name.ts` 默认「系统 + 系统版本 + 型号」，随 `hello` 上报；
>   插件侧新增 `instanceName`（设置卡「本机名称」、`mobile.info` 上报，空值回退 `instanceId`），
>   控制台与 App 列表都用它显示"这是哪台机器"。
> - 版本：App 提到 0.1.0（`package.json` / `compatibility.ts` / Android `versionName` /
>   iOS `MARKETING_VERSION`）；插件 0.2.23 只在工作区，未提交未打 tag。
> - 验证：App 165 个测试、插件 170 个测试、workspace typecheck/test、`sync-protocol:check`、
>   `verify-plugin-contract`（插件 0.2.23 / mobileApi 2 对上 App `>=0.2.2 <0.3.0`）全绿；
>   真机双实例/双 Hub 联调待设备接入。详见 `docs/07-multi-connection-plan.md`。
> - 本机联调（web profile 装本仓库构建的插件）：保存「本机名称」立即生效；`pair` 带设备名 →
>   `mobile.info` 回 `instanceName` → `hello` 带新设备名后控制台设备行改名，三段都实测通过。
>   顺手修掉一个真 bug：插件 `sameConfig` 漏比较 `instanceName`，导致保存本机名称其实
>   不生效（要再存一次或重启 dsh）；`tests/config.spec.ts` 加了按 schema 逐字段的漂移守卫。
>   插件测试 172 条、App 测试 165 条全绿，`assembleDebug` 产出 versionName 0.1.0 的 APK。

> 进度（2026-10-05 第十五轮）：**iOS 版本号与发布流程纳入 CI。**
> - 版本流程：`scripts/release-version.mjs` 的 `bump`/`check` 现在同时负责
>   `apps/mobile/ios/DshMobile.xcodeproj/project.pbxproj` 的两处 `MARKETING_VERSION` /
>   `CURRENT_PROJECT_VERSION`，此前 iOS 一直停在 0.0.8 而 App 已到 0.0.9。
> - 发布流程：`.github/workflows/release.yml` 增加 `ios-unsigned-ipa` job，在 macOS runner 上
>   `pod install` + `xcodebuild archive`（`CODE_SIGNING_ALLOWED=NO`）并打包未签名 IPA 挂到同名 Release。
>   CI 里没有 Apple 分发证书与描述文件，所以这一步只验证 iOS 目标能归档并交付可自签的 IPA；真机安装
>   仍需自备证书（模拟器不需要 Apple 开发者账号，本机 `xcodebuild -sdk iphonesimulator` 已通过）。

> 进度（2026-10-05 第十四轮）：**配对二维码在真机上扫不出来，修掉取景分辨率与缩放。**
> - 根因：配对二维码约 105 模块宽（它要装 Hub 地址、leaf 账号密码和 Hub 的 CA 证书）。CameraX 的
>   `ImageAnalysis` 默认出 VGA（640×480），对着笔记本屏幕时每模块只剩 ~2.4 像素，ML Kit 的 QR 检测
>   在这个密度上不再解码；取景预览本身清楚，所以现象是「看得到、扫不到」。
> - 修法有两处，缺一不可：`patches/react-native-vision-camera@4.7.3.patch` 让 code scanner 的
>   `ImageAnalysis` 走 `ResolutionSelector` 请求 1080p（16:9 fallback，取最接近的较低档，避免旧设备
>   直接拿不到支持的尺寸）；`PairingScreen` 的取景起始 `zoom` 设为 2 并打开 `enableZoomGesture`，
>   用户还能再双指放大。Android 真机（vivo V2405A / Android 16）实测扫码成功。

> 进度（2026-09-30 第十三轮）：**去掉 App 内置 CA，只认二维码；Android 真机验证。**
> - App 不再随包携带任何 CA：删掉 `res/raw/dsh_root_ca.crt`、iOS `DshMobile/dsh_root_ca.crt` 与
>   `project.pbxproj` 的三处条目；`HubTlsTrust.anchorsFor` 与 `DshPinnedCertificatesForDomain`
>   （原 `DshCreateCertificateFromResource` 一并删除）只返回该 host 扫过码的锚，没有锚就交给系统信任库。
>   `network_security_config.xml`（main/debug 两份）只剩 `cleartextTrafficPermitted`，`@raw/dsh_root_ca` 的
>   `domain-config` 整段删除。副作用：公共 CA 签发的 Hub 照样能连（走系统库），自签 Hub 的二维码必须带 CA。
> - 插件侧同步口径：`hub-check` 与设置卡的 CA 提示改成「App 里没有内置 CA」，平台文档 02/03 的
>   「回退路径」段落改写。
> - **修掉一个真机才暴露的 bug**：`nats.ws` 的 `NatsError` 常常 `message` 为空、含义只在 `code` 上，
>   `pairingErrorMessage` 直接 `.trim()` 抛 `TypeError`，手机上前端显示的是一句 `Cannot read property
>   'trim' of undefined`。现在先过 `describeError`（字符串 / `message [code]` / `name [code]` 三态），
>   日志同时打码值；`[pairing]` 两条 catch 都改用它。
> - Android 真机（vivo V2405A / Android 16，adb）实跑 debug 包：同一 Hub 同一账号做 A/B——
>   二维码不带 `ca` → `NatsError [UNKNOWN_ERROR]`，界面给出「无法连接公网 NATS…自签证书请粘贴 ca.crt」；
>   二维码带 `ca`（线上 CA）→ 直接走到 `mobile-pair-failed`（TLS 与 NATS 认证都过了，只差真配对码）。
> - 验证：`unzip -l` 两个 APK 包内证书文件数均为 0；App jest 123/123、typecheck 干净、lint 0 error；
>   `./gradlew assembleDebug` 与 `assembleRelease -PallowDebugSignedRelease=true` 均 BUILD SUCCESSFUL；
>   插件 150/150、typecheck/client/build 全绿。
> - 说明：手机上原有的是正式签名的 release 包，与 debug 签名不兼容，验证前卸载过一次；原 APK 在
>   `/tmp/dsh-rel-v008.apk` 可随时装回。

> 进度（2026-09-30 第十二轮）：**代码审计：修掉一处私钥入库事故，并补上轮换工具。**
> - 发现：`certs/ca.key`、`certs/server.key` 在 `1c7930b` 入库、`3fc2171` 只从 HEAD 删除；仓库 `EarhartZhao/dsh-mobile` 是公开仓库，因此两把私钥仍在 git 历史中可读，且泄漏的就是生产密钥——`ca.key` 的公钥与 `certs/ca.crt` 逐位一致，指纹正是 App pin 的 `caFp`。
> - 影响面：两端 pinning（Android `network_security_config.xml`、iOS `SRSecurityPolicy`）锚的是 CA 而不是叶子证书，拿到 `ca.key` 可为任意地址现签服务器证书使 pinning 归零；拿到 `server.key` 可冒充 Hub，把手机的 `x-dsh-token` 骗走。4222/7422 是明文 + 账号/ACL，与这对密钥无关。
> - 新增 `scripts/rotate-hub-tls.sh`：一次生成新 CA 与新服务器证书（EC P-256、IP SAN、补上 `extendedKeyUsage=serverAuth`），私钥一律写到仓库外（默认 `~/.dsh-mobile-hub-tls`，脚本拒绝写进 checkout），`--apply` 只回写公开材料（`certs/ca.crt` + 两端 `dsh_root_ca.crt` + `certs/server.{crt,csr}` / `san.ext`）。在临时仓库副本上跑通了 `--force --apply`：三处 CA 一致、链校验通过、私钥 0600。顺手修掉 iOS 那条 `-67609` 回退路径的根因。
> - 轮换与"作废"（含 git 历史清理、Hub 密码与设备 token 轮换）写进插件 `docs/02-nats-server.md` §1.1。
> - `.gitignore` 加固：`certs/**/*.key`、`certs/**/*.pem`、`certs/**/*.srl`。
> - 复核结论：两个仓库的工作区与全量历史里都没有 Hub 密码、没有完整 CA 指纹、没有其它私钥（`git rev-list --all --objects | grep -iE '\.key$'` 只剩历史里那两把）；`debug.keystore` 是 AOSP 标准公开调试密钥，`keystore.properties`/`release.keystore` 从未入库；开发用的 `demo/demo` 配对入口在 `__DEV__` 里，不会进 release。
> - **待办**：轮换尚未执行（已生成的新材料在 `~/.dsh-mobile-hub-tls`，等 Hub 侧替换后再 `--apply` 并重建 App）；历史清理需用户确认后单独做。

> 进度（2026-09-30 第十一轮）：**iOS 端落地并在本机模拟器跑通。**
> - 原生面补齐：Android 的 `DshTheme` / `DshImagePicker` / `DshFilePicker` / `DshFileOpener` 在 iOS 各有一份 ObjC++ 实现，JS 入口和返回结构逐一对照（见 01-tech-stack 的对照表）；Android 专属的 `DshApp.moveTaskToBack` 与 `DshUpdater` 不移植，JS 侧运行时判空后静默降级。
> - TLS：iOS 没有 `network_security_config` 等价物，改为在 RN 的 `RCTSetCustomSRWebSocketProvider` / `SRSecurityPolicy` 接缝上用与应用一起打包的 `dsh_root_ca.crt` 做唯一锚点（PEM/DER 都接受），非 Hub 域名继续走系统信任库。
> - **踩坑（需插件侧配合）**：Hub 证书由 `certs/san.ext` 签发，只有 IP SAN、没有 `extendedKeyUsage = serverAuth`，Apple 的 SSL 策略以 `-67609` 拒绝；策略回退到「锚定 pinned CA + 自写 DER 解析校验 SAN 主机名」，与 Android `network_security_config` 实际执行的规则等价。给 Hub 证书补 `extendedKeyUsage = serverAuth` 重签后严格路径自动生效，App 无需改动。
> - **踩坑（RN Modal 与系统 picker 竞态）**：`+` 面板是 RN Modal，JS 在同一 tick 里调起 picker，UIKit 把 picker 连同正在退场的 modal 一起撤掉（出现一帧即消失）。`DshPresentation.mm` 的 `DshPresentWhenSettled` 等宿主连续 3 tick 稳定再 present，并在 2.4s 内监视、宿主也被撤走时重新挂载（最多 3 次）。
> - 工程：bundle id 改 `com.dshmobile`、版本对齐 App 0.0.8（`CURRENT_PROJECT_VERSION` 20007）、AppIcon、`dshmobile://` scheme、相机/麦克风/相册用途文案、竖屏锁定（与 Android `screenOrientation="portrait"` 一致）；`react-native-svg` 升到 15.15.5（15.12.1 在 RN 0.87 编译不过）；顺手去掉 `Info.plist` 里空的 `NSLocationWhenInUseUsageDescription` 构建 warning。
> - 验证：`xcodebuild -workspace DshMobile.xcworkspace -scheme DshMobile -configuration Debug -sdk iphonesimulator`（iPhone 17 / iOS 26.5）BUILD SUCCEEDED；core 136/136、App 110/110、lint 0 error、typecheck 全绿、`sync-protocol:check` 通过；模拟器实测：连接与在线态、会话列表（分组/搜索/归档入口）、对话页（思考与工具折叠、复制/评分/分支）、`+` 四面板、相册多选/文件选择器、相机取景与拍照入口、主题切换、插件清单（399 项）、连接诊断、解除配对。

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

> 进度（2026-08-30 第四轮）：**Web 端 `+` 菜单对齐与插件版本/能力协商完成。**
> - 插件新增 `mobile.info`；App 在 describe 前读取版本、mobileApi 和 feature 清单，版本或必备能力不符时阻断并提供“更新后重试”。
> - 输入框相机/相册双按钮合并为 `+`；新增命令、附件、引用、控制四类面板，支持动态命令目录与常用命令回退、带参命令、相册多选、待发送多图、灯箱、preset/权限/Plan/Goal/模型/子代理入口。
> - 相册改为 `ACTION_OPEN_DOCUMENT`，修复系统返回多 URI 后的读取失败；`command.list`/`command.execute` 已加入插件白名单。
> - 验证：插件 26/26、core 25/25、App typecheck/eslint 0 errors、协议 vendor 同步、Android `assembleDebug` 通过；模拟器实测版本门禁、`+` 四面板、`/compact` 执行和相册多选读取。

> 进度（2026-08-30 第五轮）：**消息操作、工具卡细分、会话内搜索、路径操作、i18n 基础、诊断和 release 打包基础落地。**
> - 消息长按支持复制/分享/从这里分叉（`session.fork` + `atSeq`）/重发到新会话；会话页新增当前会话搜索与消息跳转。
> - 工具卡补齐 Diff、Search、Web 结果、Read、位置与子调用树展示；core 修正嵌套 `code-dispatch` 的更新语义，并新增子调用树/view 用例。
> - 目录浏览器支持当前路径、面包屑和子目录路径复制/分享；设置页支持中英文/跟随系统切换（先覆盖根导航、设置、`+` 菜单、消息操作和会话内搜索）。
> - 设置页新增连接诊断：状态、App/插件版本、mobileApi、feature 位、最近错误和脱敏诊断 JSON 复制。
> - Android release 配置统一 App 版本为 0.1.0，启用 R8/资源收缩，支持通过 `DSH_RELEASE_*` 环境变量注入正式签名，未配置时暂用 debug 签名兜底；新增 Android 8+ 自适应图标。
> - 验证：core typecheck + 28/28 测试、App typecheck、App lint 0 errors（旧 warning 保留）、`gradlew assembleRelease` 通过并产出 `app-release.apk`。

> 进度（2026-08-30 第六轮）：**i18n 全面迁移、诊断补强和发布安全门禁落地。**
> - 中文/English 切换覆盖配对、会话列表、聊天、设置、`+` 菜单、目标/统计条、工具卡、子代理和提问卡；固定标签也改为 locale-aware。
> - 连接诊断增加最近连接状态事件；设置页展示状态、版本/能力、错误与连接事件，并复制脱敏 JSON。
> - 连接诊断进一步接入 `mobile.health`：展示 RPC 延迟、桥构建 ID、真实加载路径、实例与启动/重连时间，并把桥无响应、鉴权、TLS、网络和协议错误分别归类；NATS 已连接但宿主桥未运行时不再误报“插件版本未知”。
> - Android release：release 网络策略禁用明文、debug 源集保留本地回环；显式空备份/迁移规则；新增 `dshmobile://new-session` 深链接与“新会话”桌面快捷方式，连接未就绪时排队上线后自动创建。
> - 签名支持 `DSH_RELEASE_*` 或 git-ignored `keystore.properties`；默认 release 无正式签名会失败，`-PallowDebugSignedRelease=true` 仅允许本机冒烟。正式 keystore 仍待用户提供/配置。
> - 验证：App typecheck、lint 0 errors、core 28/28；`assembleRelease -PallowDebugSignedRelease=true` 通过；无签名 `verifyReleaseSigning` 按预期失败；模拟器实测深链接入口。

> 进度（2026-08-30 第七轮）：**只读插件清单接入。**
> - dsh-mobile-plugin 0.2 新增 `mobile.inventory`（设备 token 门控），桥接宿主 `pluginInventory.list()`，feature 清单上报 `plugin-inventory`。
> - App 兼容范围扩展到 plugin 0.1.x/0.2.x；设置页改为可滚动，新增插件清单模块，展示模块名、启用状态和 Fiber 阶段，支持刷新。
> - 验证：plugin typecheck + 27/27、core typecheck + 29/29、App typecheck/lint 0 errors、插件 build 通过。

> 进度（2026-08-30 第八轮）：**正式 release 签名闭环。**
> - 生成本地 PKCS12 release key（4096-bit RSA，10000 天），配置为 git-ignored `keystore.properties` + `release.keystore`；`storeFile` 支持相对 Android 工程根。
> - `verifyReleaseSigning` 无签名默认失败，正式签名通过；`assembleRelease` 成功；`apksigner verify --print-certs` 确认 APK 为 release key 而非 debug key。

> 进度（2026-09-29 第十轮 · v0.0.6/v0.0.7）：**预览面板三处体验修复 + 安装签名对齐。**
> - 预览面板：Modal 是独立窗口，根部 `SafeAreaView` 的边距进不去，标题会被状态栏压住；
>   现在面板自己按 `useSafeAreaInsets` 留边距，正文 `flex: 1` 占满整屏（原来是
>   `maxHeight: 360` / `height: 320`，只填了半屏）。
> - md 预览长按选中：渲染器自己的文本节点没有 `selectable`，预览专用规则补上；
>   同时**去掉**了为贴齐系统栏而加的 `statusBarTranslucent` / `navigationBarTranslucent`
>   ——实测这两个窗口 flag 会让 dialog 内所有 Text 都选不中。
> - 预览底部四个动作按钮由两排改一排（收紧左右内边距与间距；`flexWrap` 留作英文兜底）。
> - 空会话提示居中并留出内边距：判断条件原为 `visible.length === 0`（全局还有没有会话），
>   选中空工作区时不成立，提示就退化成裸 `<Text>` 贴左上角。
> - **安装签名对齐**：真机上装正式 APK 报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`（已安装的是
>   debug 签名）。Android 只允许同签名的包互相覆盖，所以从 `run-android` 的 dev 包切到正式包
>   必须卸载一次；之后各版本（含 App 内更新）都能直接覆盖。为了让本地 dev 包与正式包同签名，
>   `signingConfigs.debug` 现在在配置了正式密钥时直接使用它（`keystore.properties` 或
>   `DSH_RELEASE_*`），没有配置时仍是内置 debug key；App 内更新弹窗在 `__DEV__` 构建上会
>   明确提示「当前是开发版，装正式版需要先卸载一次」。
> - 验证：App 109、core 136、plugin 84、lint 0 error、typecheck 全绿；临时 keystore 实测
>   `assembleDebug` 产物签名为该密钥（`apksigner --print-certs`），确认这条分支生效。
> - 顺带修好 App 的「本地配对（真实 dsh）」：插件 0.2.13 起控制台的 mutating 路由要求自带
>   `x-dsh-mobile-console` 头 + JSON content type 且 `Host` 必须是回环地址，旧的开箱 POST 一律
>   403。App 现在带上这两项；模拟器上还需 `adb reverse tcp:3080 tcp:3080`（配对用的 ws 同理
>   `tcp:8443`）并把 host 填 `127.0.0.1`，写成注释留在 PairingScreen 里。
> - 正式包（v0.0.7）首次做了启动冒烟：卸载调试包 → 安装 release APK → 启动到配对页无崩溃；
>   并检查 dex 里 `DshUpdater`/`DshFileOpener`/`ImagePickerModule`/`ThemeModule` 与
>   `@ReactMethod` 名字都在，确认 R8 没削掉原生模块面。

> 进度（2026-09-29 第九轮 · v0.0.5）：**对齐 Web 的消息级交互细节，并修掉两个真机缺陷。**
> - 消息动作行：assistant/user 气泡下常驻 `复制 / 👍 / 👎 / 分支 / 时间`（Web 的
>   MessageIconActions + MessageFeedbackActions）。评分走 messageFeedback RPC（已存评分再点即撤回），
>   时间按 Web 的三段式且遵循 Web 的左右位置；宿主未声明 `message-feedback` 时整对按钮不渲染。
> - 分支锚点：Web 的分支控件挂在轮次尾部并发送真实的 `turn/end` seq，`Turn` 现在携带 `endSeq`、
>   `turnTail()` 统一给出「哪条消息持有控件 + 锚点 + 未结束时不可用」；分支成功后按 Web 的
>   `increasedForkTitle` 规则给子会话改名，避免与源会话同名。
> - 统计行补齐 Web usage pill 的总 token；上下文徽标、tok/s、缓存命中不变。
> - 搜索跳转：搜索列表按 `items` 编号而列表渲染的是行，旧实现用 item 序号 `scrollToIndex`，
>   会偏几行甚至什么都不做；行构造移入 core 的 `buildTranscript()` 并同时给出 item→行 映射。
> - 交付卡真机闭环：learner 会话确实有 `present` 调用与 `deliverables/presented`，App 渲染的卡片与 Web 一致。
> - 验证：core 136/136、App 110/110、plugin 84/84、lint 0 error、typecheck 全绿；
>   `assembleRelease -PallowDebugSignedRelease=true` 通过（R8 收缩后的 release 构建）；
>   模拟器真机验收：动作行、评分写读撤回、分支建子会话并改名并归档清理、统计行 `575K tok`、
>   搜索跳转、工具卡与交付卡渲染。

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
- M4：iOS 适配 —— 已落地并在本机模拟器跑通（2026-09-30，见第十一轮进度）。模拟器不需要 Apple 开发者账号；只有真机分发/上架才需要。发布侧只交付未签名 IPA（`release.yml` 的 `ios-unsigned-ipa` job，见第十五轮进度），安装到真机仍需自备证书自签。鸿蒙端已明确不做（2026-08-26）。

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
