# 移动端功能差距调研（vs Web 端 dsh）

> 2026-08-28。方法论：以 `packages/client/ui-*` 的 39 个 Web UI 插件 + apiproxy
> 契约全量（rpc-map 51 法 + mux/host 事件流 + SessionEvent 13 类核心事件 +
> 插件扩展事件）为 Web 功能全集；对照移动端已实现面（M1-M3 已验收）建立差距
> 矩阵。每项标注数据来源（已有 RPC/事件，或需宿主/插件新增）与建议优先级。
>
> 2026-08-30 更新：P0/P1 的本地可实施项已闭环；输入框 `+` 菜单、多图附件、
> 命令直连/回退、图片灯箱和插件版本/能力协商已接入。命令目录在旧宿主上会
> 自动退回常用命令，不阻塞连接。
>
> 2026-08-30 追加更新：消息级操作（长按复制/分享/按消息分叉/重发新会话/跳转）、
> 会话内搜索、结构化工具卡（Diff/Search/Web/子调用树）、目录路径复制与分享、
> 会话统计折叠条和上下文分解、i18n 基础与语言切换、连接诊断，以及 Android
> release 打包基础已接入。剩余文案迁移、正式 keystore、只读插件清单和平台
> 独有能力仍在后续项中。
>
> 2026-08-30 收尾更新：主要 UI 已完成中英文迁移；诊断补齐最近连接事件；
> Android 增加 release 明文禁用、空备份规则、`dshmobile://new-session` 深链接和
> “新会话”快捷方式；正式签名门禁支持环境变量或 `keystore.properties`，未配置时
> release 默认失败。系统推送、iPad 双栏和真正的大文件导出仍需宿主/插件后续支持。

> 2026-09-14 更新（dsh 0.1.5-rc.1 对齐）：按 `skills/dsh-sync-check` 完成一次上游核对，
> 冻结 wire 与 48 个 Remote endpoint 全部命中。本轮新增：PTC 派发事件改名兼容
> （`tool/ptc-dispatch*` 与旧名等价）、目标 activation（`goals/get` + `goal/activation-changed`）、
> 工作区文件面（`workspaceFiles` 的 list/read/bytes/stat/readRelated 与 `changes` 流）、
> 目录浏览器、文件预览（文本分页续读、图片窗口、Markdown 文中相对图片）、
> 变更按目录过滤的实时刷新、引用 chip、宿主机打开/定位，以及回车发送开关（设置页可关）。
> 插件仓库补上 CI（含浏览器半端的 `typecheck:client`）；`dev` 已合回 `v0.0.3` 发布提交，
> 三处版本载体恢复一致（`release-version.mjs check 0.0.3` 通过）。

> 2026-09-14 追加（B 组）：消息反馈（Like/Dislike）已接入——上游 0.1.5-rc.1 的
> `messageFeedback/list|put|delete` 此前被误记为"宿主无 RPC"，实际早已存在；
> 现在长按 assistant 消息即可评分/取消，评分作为 durable 事实写入会话日志（不是本地状态）。
> 同一轮还做了：引用 chip 点开即预览、变更流断开时的显式提示、预览显示并复制宿主机绝对路径。
> 目录分页（`workspaceFiles/list` 无游标）与 `sessionFeedback/record` 仍是未接入项。

> 2026-09-17 追加（dsh 0.1.5-rc.2 → 0.1.6-alpha.1 核对）：区间 800 个提交，但移动端消费面几乎未动——
> 51 个 Remote endpoint 门禁通过，会话格式仍是 V3，事件词汇表只**新增** `image/offload`（模型请求侧投影，
> 图片块只多一个 `offloaded: true` 标记，App 渲染不受影响）。需要知道的行为变化有三处：
> ① `session/fork` 的切点不再顺延到下一个 `turn/start`，而是在选中边界处精确切开；
> ② 目标 activation 的解除时机从 `agent/session-start` 改为 `agent/created`（提示出现得更早，更准确）；
> ③ 子代理结算时写给父会话的通知只保留子代理收尾的**文本**块（非文本块被过滤）。
> 新可用的增量：`workspace/unarchiveSession`（App 已有归档，尚无取消归档）、`agentPresets/list` 新增
> `modeSelectionEnabled`（宿主关掉模式选择时会忽略保存的默认 preset，App 的 preset 选择器应据此隐藏或禁用）、
> `SkillEntry.path`（技能文件绝对路径）。真机复核（模拟器 App 对 0.1.6-alpha.1 宿主）：
> mobile.info 握手、会话历史渲染、file.watch/list/stat/read、feedback.put/delete 全部通过，logcat 无错误码。

> 2026-09-17 追加（三处新增能力落地）：① 归档会话现在可以**取消归档**（插件 0.2.7 的
> `workspace-unarchive` + `workspace/unarchiveSession`）；② Agent preset 选择器按宿主的
> `modeSelectionEnabled` 策略禁用并给出说明，新建会话的长按选择器在关闭时直接走默认；
> ③ 技能行显示 SKILL.md 来源路径。顺带修掉一个真机才暴露的旧缺陷：会话行与工作区 chip 的
> 长按菜单用 `Alert.alert` 摆 4–5 个按钮，而 **Android 的 Alert 只显示 3 个**，导致"归档"
> 以及工作区的"重命名/删除"在手机上根本点不到——现在两者都改用底部 ActionSheet。
> 另外查明：冻结 vendor 的 zod schema 会 strip 上游新增字段，新增字段必须走 `mobile-*.ts`
> 宽解析层读取（`mobile-catalog.ts`），否则 host 返回了 App 也看不见。

> 2026-09-14 追加（C 组结论）：C 组四项都受外部条件限制，本轮只落地了"诚实降级"部分——
> 超出 512KB 窗口的图片不再渲染半张图而是明确提示（这是个真实缺陷，之前会画出截断的图）、
> 目录截断提示点名宿主 `workspaceFiles.maxEntries` 这个可调项、诊断 payload 标注
> `caFpEnforced: false`。剩余三项分别卡在：上游 fs seam 的 `listDir` 上限与 Remote 游标（分页）、
> Hub 中继或局域网端点（大文件）、FCM/APNs 凭据（推送）与原生 TLS pinning（CA 指纹强制）。

> 2026-09-30 追加（dsh 0.2.0-rc.2 上游核对）：区间 `21638c5631`（0.1.7-rc.2）→
> `639ed01539`，293 个提交。结论是**零破坏，两个项目都不用改代码**：
> `sync-protocol --check` 报 `frozen mobile wire verified (36 files)` +
> `Remote surface verified (51 endpoints)`；移动端相关包无删除/重命名；durable 事件词汇表
> （`packages/core/session/src/known-event-types.ts`）、宿主可转发事件名单（`remote-events.ts`）、
> 会话格式（仍是 v4）与 `agent-tool-presentation` 全部未变；`api/gateway` 只新增
> `hasLiveClient()`，移动侧不依赖。真机 + 桥探针复核（宿主 0.2.0-rc.2 / 插件 0.2.14）：
> `host.describe`、`session.list`(49)、`workspace.list`、`session.history`(22 事件)、`file.list`、
> `goal.get`、`session.models`、`feedback.list`、`command.list` 全通，App 会话渲染与统计条正常
> （`session.projections` 回 `mobile-forbidden` 属预期——该方法不在插件白名单里，App 走
> `session/projection` 帧）。
> 区间唯一实质变化在 `packages/interaction`：新增 `questions` 会话投影
> （`userQuestionProjectionDefinition`）与 `ask_user_question` 的 timed 模式
> （`mode: 'legacy' | 'timed'`，默认 legacy；请求多一个可选 `wait: { callId, … }`；超时后
> 工具返回 `{ pending: true, callId }`，答复改为进 inbox 的 `user-question-reply`）。
> 当前没有 bundle 打开 timed，故 App/插件行为不变。三项可选跟进：① 接 `questions` 投影
> （App 目前只靠 `question/requested` 帧，重载后拿不回待答问题）；② 若启用 timed，手机端需要
> 「倒计时 + claim」UI（Web 才有）；③ 上游新注册的 `userQuestions` Remote 命名空间未进移动
> manifest，是否暴露取决于前两项。

> 2026-09-29 追加（对齐 Web 的三处交互细节 + 两处真机缺陷）：
> ① **消息动作行**。Web 的答案下常驻一行 `复制 / 👍 / 👎 / 分支 / 时间`（`MessageIconActions` +
> `MessageFeedbackActions`），App 此前只有长按菜单。现在 assistant 与 user 气泡下都渲染同一行：
> 复制走剪贴板、评分走 `messageFeedback` RPC（已存评分再点即撤回）、时间按 Web 的三段式
> （当天 `HH:mm`、同年 `M/D HH:mm`、跨年带年份）并遵循 Web 的位置（提示词在按钮前、回答在按钮后）。
> ② **分支锚点**。Web 的分支控件挂在轮次尾部并发**真实的 `turn/end` seq**（"the branch action owns
> boundary resolution"），而不是消息自身的 seq；`Turn` 现在携带 `endSeq`，`turnTail()` 统一决定
> 「哪条消息持有这个控件 + 锚点在哪 + 未结束的轮次显示为不可用」。分支成功后按 Web 的
> `increasedForkTitle` 规则给子会话改名（`… (1)` → `… (2)`），避免分叉在列表里和源会话同名。
> ③ **统计行总 token**。补齐 Web usage pill 的 `512K tok`（= 计费输入 + 输出），位于 tok/s 与
> 缓存命中之间。
> 两个真机缺陷：① **搜索跳转按行解析**——搜索列表按 `items` 编号，而列表渲染的是 `listRows`
> （工具调用、轮次边界、只有推理没有正文的回答都没有自己的行），旧代码用 item 序号去 `scrollToIndex`，
> 轻则偏几行、重则落在列表之外什么也不做；行构造已移入 core 的 `buildTranscript()`，同时返回
> item→行 的映射，折叠内容落回它所属的轮次。② **交付卡闭环**：真机会话里确实存在 `present`
> 调用与 `deliverables/presented` 事件（`session/history` 下 `arguments` 是字符串，可解析出
> 交付文件与说明），App 渲染的两张卡与 Web 的交付区一致。

> 2026-10-07 追加（图标改为上游原件）：App 之前用的是自绘近似字形和文字符号（`‹ › ⚙ ＋ ✕ ▼ ✓ 👍 👎`），
> 形状、笔画粗细、留白都和 Web 对不上。现在图标**不再手绘**：`scripts/sync-icons.mjs` 从
> `deepseek-harness/packages/client/ui-primitives/src/icons`（外加 `ui-conversation` 的 `InputBar`
> 里那两个内联 `<svg>`：发送上箭头、停止圆角方块）逐条拷贝 path 数据，生成 `apps/mobile/src/icons.tsx`，
> 每个字形保留 Web 自己的 16×16 viewBox、1px（regular）/1.3px（medium）描边和 `currentColor` 语义；
> 上游改图标只需重跑脚本，`pnpm run sync-icons:check` 用来防止本地副本过期（没有 harness 检出时自动跳过）。
> 对话面按 Web 的用法逐处对齐：头部返回/搜索/更多、回到底部、轮次折叠箭头、消息动作行
> （复制 / Like / Dislike / 分支，28×28 命中区、15px 字形、已评分换填充版）、思考行前置 `IconThinkOutline`、
> 工具行按 `classifyTool` 变体表选前置图标（search/read/bash/write/edit/code/others）、代码块复制与分享、
> 会话统计的 gauge 与 database、输入卡 34px 发送圆钮的 16px 上箭头（停止态同尺寸圆角方块）。
> 其余页面的 `‹ › ⚙ ＋ ✓ ×` 一并换成同一套字形。Todo 条的逐项状态改用 Web `ToolDetails` 的三态标记
>（完成 `IconCheckOutline`、进行中 `IconPlayOutline`、待办空心方框）。

> 2026-10-07 追加（会话谱系导航）：从父会话头部切进子智能体后，返回键要回到**父会话**而不是会话列表——
> 子会话根本不在列表里，直接退列表等于把读者正在读的会话弄丢。谱系放在 `apps/mobile/src/route.ts`
>（`openChat` 从 chat→chat 记父、`closeChat` 逐跳回退、离开对话即清空），`ChatScreen` 在
> `sessionId` 变化时重置一次性闩锁与输入框（草稿、引用 chip、待发图片都属于写下它们的那个会话）；
> 子会话头部的「父会话」行按标题显示，也可点回父会话。

> 2026-10-07 追加（子智能体会话看到底）：子会话的记录一直是完整的，看不到回答是渲染问题——
> 用户气泡之前走 Markdown 渲染器，提示词里的 ``` 代码块因此变成带横向 ScrollView 的代码卡，
> 而气泡宽度是 `maxWidth: '82%'` 这样的 at-most 约束，iOS 把它量成了六倍高、三屏宽的空盒
> （1667 字的提示词量出 10567pt），正文只露顶部几行、右侧被切，把下面的回答整个顶出屏幕。
> 现在气泡正文是 `white-space: pre-wrap` 的纯文本，与 Web 的 `.bubble` 同源（`projectUserText`
> 发的是 inline runs，不是文档），超过 6000 字仍可折叠；长回答的折叠预览也改为**渲染后的**
> Markdown，并按块边界截断（未闭合的围栏补上闭合），不再是裸源码。
> 另外，`FlatList` 现在按 `sessionId` 换 `key`：换会话就是换一份 transcript，上一份的
> offset、测量缓存和已armed 的 anchor 都不会带过来；尾随状态在换会话的那次 commit 里
>（`useLayoutEffect`）就复位，早于新 transcript 的第一次布局，因此进子会话/回父会话都落在
> 最新一条消息上。

> 2026-10-08 追加（输入框的两枚模式 chip + 控制页下线）：Web 的输入卡左边就带着
> 「访问模式」和「新任务的 Agent 模式」两个选择器，App 之前把同样的开关塞在 `+` 菜单的
> 第四个 tab「控制」里，于是同一个开关有两扇门、输入框上却什么都没有。这一轮按 Web 的分工收口：
> ① **控制 tab 整块删除**（`PlusMenuSheet` 从 4 tab 回到 命令/附件/引用），模型、Plan、
> 目标、子代理、权限这些都只在它们各自该在的地方（输入框、会话统计条、会话「更多」菜单）；
> ② **输入框左侧的访问模式 chip**：`permissions` 投影只有 `currentValue`，可切换的名单是
> **进程级 catalog**，App 早先按投影里的 `options` 找选项，所以这个控件从来没有渲染出来过——
> 插件新增 `permissionPreset.catalog`（0.2.38，白名单 + `remoteCall`），App 走
> `mobile-catalog.ts` 宽解析读取，chip 点开是底部弹层（仅可查看 / 工作区内修改 / 完全权限，
> 后两者里的 danger 值仍先弹确认），选中走 `/permission <value>`；
> ③ **Agent 模式只属于新对话**：只有 `blank === true` 的会话才渲染第二枚 chip，选中调
> `agentPresets.select` 且**不发任何消息**；已开始的会话完全不渲染该控件（宿主在首轮就冻结组合、
> 后来的切换请求会被拒），改由 Meta 行的只读「预设」一行说明本任务跑的是什么，与 Web 的
> hero seat / header label 分工一致；
> ④ **预设文案对齐上游**：按 `agent-preset-registry/display` 的 `presetDisplayText` 折法，
> 宿主没发布名字（`standard`/`ptc`/`minimal`/`cordis`）即内置预设，名字与描述取自字典，
> 自己声明过名字的预设保留原话；权限 preset 同样按 `displayPermissionPreset` 折，
> 不再是 kebab 原文；
> ⑤ **多图选择在 Android 上的真凶**：模块把 Kotlin `List` 直接 resolve 给 RN bridge，
> 触发 `Cannot convert argument of type class java.util.ArrayList`——图片其实已经读完，
> 却被自己的 catch 吞成「无法读取所选图片」，于是**每一批**多选都失败；现在用
> `WritableNativeArray` 逐个 `pushMap`，失败路径也带上原因（真机 vivo V2405A 已验证选图成功）。
> 模拟器复核（iPhone 17 Pro + Metro）：空白会话上两枚 chip 同时在，Agent 弹层列出四个内置模式
> 及各自描述，选 `ptc` 后 chip 变为「Agent 模式，当前：PTC 模式」且不发送消息；
> 已开始的会话只有访问模式 chip，Meta 行读作「预设 标准模式」。

## 一、移动端现状（已完成）
配对/token、连接生命周期（重连+基线重拉+hello 重放）、workspace/session 列表、
新建会话、会话历史分页、prompt 发送（queue 模式）、流式渲染（chunk 节流）、
取消、队列 dock（排队/引导/编辑/删除）、审批/提问动作条、任务折叠条 + 前台提醒
横幅、解除配对。

## 二、差距矩阵

图例：RPC/事件 ✅=契约已有、⚠️=需宿主/插件新增；移动端 ●=已实现、◐=部分、○=未实现。

### A. 对话体验（高价值，全部契约已有）

| 功能 | 数据来源 | 移动端 | 说明 |
|---|---|---|---|
| Markdown/代码块渲染 | 客户端本地 | ● | Markdown 渲染、代码块横向滚动、复制和分享已接入 |
| 工具卡片分级展示 | ✅ tool/call+result 的 `view` 槽（桥 0.2.10 起真正下发） | ● | 卡片注册表在 `apps/mobile/src/components/tool-cards.tsx`（generic/terminal/diff/read/search/web，每个条目声明 title/meta/summary/body）；settled 行的**标签取自两个相位**（result 未声明 title 时沿用 call 的，宿主契约如此），内容取当前状态相位。真机已验证：read 卡显示行号窗口；`pwsh` 行标题为宿主的 `echo title-check · title-check`，展开有输出与 `退出码 0` |
| 工序实时表头（"在做什么"） | ✅ assistant/chunk 具名 tool-call-delta + tool/call + turn/start\|end | ● | 分类词表与详情字段优先级与 Web 同表（`packages/core/src/activity.ts`）；运行中显示"正在调用工具 · job_output"（与 Web 的 `message.stepProcess.*` 逐条对应），结束的轮次只显示 Web 那一行"用时 1分04秒"（无计时"已完成工作"，取消"已停止"，出错"处理失败"，计时下限 1 秒），不再另外拼类别摘要 |
| 工序逐步行 + 思考预览 | ✅ 同上 | ● | 运行中自动展开并逐步列出工具行（分类 + 详情 + 状态）；思考行折叠成一行预览（末段首行），点开看全文 |
| 运行中底部实时指示 | ✅ turn/start.time + 本地时钟 | ● | "深度求索中，用时 49秒…"，行内自持 1 秒定时器，不触发整表重渲染 |
| 会话底部实时统计 | ✅ sessionStats/tokenUsage 投影 | ● | 统计条常驻一行「25 轮 · 58 步 · 236 tok/s · 缓存命中 98%」（Web composer-stats 的同款组成），展开仍是明细 chips；tok/s 与缓存命中用 Web 的同一套格式化（`formatTokensPerSecond` / `formatCacheHitPercent`，`packages/core/src/stats.ts`），部分命中不会四舍五入成 100% |
| 未知插件事件兜底 | ✅ event.type 为宽字符串 + surfaceOp 标记 | ● | 未认领的 append-origin surface 事件显示为「未知事件：{type}」折叠行（展开看原始数据、可复制/分享）；判据见 `packages/core/src/unknown-event.ts` 与 docs/06 |
| 未知提问意图降级 | ✅ question/requested（intent 为开放词表） | ● | 冻结 schema 拒掉的提问帧由 `packages/protocol/src/mobile-questions.ts` 宽解析重读，未知 `intent.kind` 按通用问答显示并在卡上注明类型（docs/06 落地清单 B） |
| 会话重命名 | ✅ session.rename | ● | 会话头部菜单已接入 |
| 会话分叉 | ✅ session.fork | ● | 会话菜单；分叉后跳新会话 |
| 会话搜索 | ✅ session.search（结果上限 20/片段 120 字） | ● | 列表页搜索框和结果片段已接入 |
| 归档会话 | ✅ workspace.archiveSession + host/archived-sessions-changed | ● | 归档操作、归档列表开关和事件同步已接入 |
| workspace 管理 | ✅ workspace.create/rename/delete/insertBefore/insertSessionBefore | ● | 创建/重命名/删除和工作区、会话排序已接入 |
| 列表基线自动保鲜 | ✅ host/session-*、host/workspace-* 帧 + App 前台/列表出现 | ● | 列表类帧兼作失效信号（去抖 400ms 重拉 workspace.list + session.list），离线期间置脏待 establish 后补拉；列表出现或回到前台按 30s 信任期重拉，别的客户端新建/归档会话不再需要手动重连 |
| 文件预览与转交 | ✅ workspace-files 分页读 / readBytes 字节窗 + 原生模块 | ● | 全屏面板：图片内联、文本按文本、`.md` 走与聊天同一套 markdown 渲染；pdf/office/压缩包/音视频等非预览格式不拉二进制，改为「用手机应用打开」（原生 `DshFileOpener`：字节写 cacheDir/open → FileProvider → ACTION_VIEW；JS 探测不到模块时提示更新 APK） |
| 图片附件 | ✅ session.attachment + PromptContentPart.image | ● | 拍照/相册多选、限制预检、待发送排序、历史图片预览和全屏灯箱已接入 |
| 消息反馈 | ✅ `messageFeedback/list\|put\|delete` | ● | 长按消息 Like/Dislike，已评分显示徽标并可取消；按 `version` compare-and-set，冲突自动重试一次。`sessionFeedback/record`（命令反馈）仍未接入 |

### B. 会话上下文与投影（中高价值，契约已有）

| 功能 | 数据来源 | 移动端 | 说明 |
|---|---|---|---|
| Todo 计划条 | ✅ todo/write 事件 | ● | 三态折叠条已接入 |
| 目标条 GoalBar | ✅ goal.* RPC + session/projection(goal) + `goals/get`(activation) + `goal/activation-changed` | ● | 显示、创建/编辑、暂停/恢复/完成/清除已接入；进程内 activation 由 `goals/get` 补读并在事件到达时刷新，关闭自动续跑会显式提示 |
| Plan 模式 chip | ✅ /plan 命令 + plan 投影 | ● | 状态 chip 与进入/退出入口已接入 |
| 上下文用量统计 | ✅ assistant/message.usage + contextBreakdown 投影 | ● | token 用量条已接入 |
| Compaction 指示 | ✅ compaction 投影 + assistant 摘要 | ● | 压缩/摘要标记已接入 |
| 会话标题/元信息头 | ✅ projection(title) + summary | ● | cwd、agent preset、父会话和更新时间已展示 |

### C. 执行控制与模型（中价值，契约已有）

| 功能 | 数据来源 | 移动端 | 说明 |
|---|---|---|---|
| 模型选择 | ✅ session.models + session.selectModel | ● | 会话页模型 chip、provider 分组和 effort 子菜单已接入 |
| Agent preset | ✅ agentPreset.list/select + summary.agentPreset | ● | 新会话选择、`+` 菜单切换和元信息展示已接入 |
| 子代理面板 | ✅ subagent.list/history/prompt/interrupt + lineage 事件 | ● | 子代理列表、查看/继续/打断已接入 |
| 技能 /skill | ✅ skill.list（白名单已有） | ● | 输入 `/` 与 `+` 面板的「命令」tab 是同一个上拉弹框，落点即该 tab；子智能体会话里这个弹框和 `/`、`@` 触发都不存在（命令由父会话执行，输入框只发文字） |
| 权限预设 | ✅ settings.mutate（permission 命名空间） | ● | chips、当前项和 Full access 确认已接入 |

### D. 工作区/文件面（中价值，契约已有）

| 功能 | 数据来源 | 移动端 | 说明 |
|---|---|---|---|
| 目录浏览 | ✅ `workspaceFiles/list`（插件 `file.list`，workspace 相对路径） | ● | 会话菜单进入；面包屑、上级目录、目录优先排序、刷新与截断提示已接入 |
| 文件预览 | ✅ `workspaceFiles/read\|readBytes` | ● | 文本按 400 行一页并可续读，图片取 512KB 字节窗口；非文本给出明确失败信息 |
| 预览缓存复用 | ✅ `workspaceFiles/stat` | ● | 打开前比对 `version`，未变直接复用缓存页，避免整页重读 |
| Markdown 文中图片 | ✅ `workspaceFiles/readRelated` | ● | 以文档目录为基准解析 `![](rel)`，最多 4 张就地展示，单张失败不影响其余 |
| 变更实时刷新 | ✅ `workspaceFiles/changes`（插件 `file.watch`/`file.unwatch`） | ● | 复用已发布的 `host/remote-event` 承载；插件按 workspace 相对路径补 `path`，App 只刷新受影响目录，300ms 去抖 |
| 交付物/产物行 | ✅ tool/result + 产物投影 | ● | assistant 收尾后的产物 chips 已接入 |
| @ 引用（文件/会话） | ✅ `fileReferences/list` + `sessionReferenceResolver/candidates` + `workspaceFiles` 浏览器 | ● | 输入 `@`、`+` 面板的「引用」tab 与目录浏览器三条入口共用 `fileMention` 规则；浏览器插入后显示引用 chip 并交还焦点 |
| 宿主机打开/定位 | ✅ `session/openWorkspacePath`（`action: 'reveal'`） | ● | 预览面板可"在电脑上打开"或用文件管理器定位；宿主不支持时回显错误 |
| 文件导出 | ⚠️ session.export（ZIP，max_payload 1MiB 限制） | ○ | 设计已排除大文件传输；用一次性下载 URL 方案，待宿主支持 |
| 目录列表分页 | ⚠️ `workspaceFiles/list` 无游标/offset | ○ | 宿主按 `maxEntries` 截断并回报 `truncated`，客户端只能提示进子目录；真续读需上游加 limit/offset |
| 大文件预览/下载 | ⚠️ `/api/file` 是宿主本机 HTTP 路由 | ○ | 手机经公网 Hub 够不到宿主 `/api`；超出 512KB 窗口的图片改为明确提示（不再渲染半张图）。要支持需 Hub 中继或局域网专用端点 |
| CA 指纹校验 | ⚠️ 需原生 TLS pinning | ○ | `caFp` 只记录不强制，诊断 payload 带 `caFpEnforced: false` |

### E. 设置与系统（低-中价值）

| 功能 | 数据来源 | 移动端 | 说明 |
|---|---|---|---|
| 主题跟随 | 客户端本地（settings.theme 可选） | ● | 亮色、暗色、跟随系统已接入并持久化 |
| 外观/语言/权限设置页 | ✅ settings.describe/update/mutate | ○ | 移动端只暴露高频项（主题、语言、权限预设），全量设置页继续用 Web |
| LLM provider/凭据管理 | ✅ llm.* + credentials.* + settings.* | ○ | 移动端不建议做（密钥管理在手机上风险收益比差），设置卡指向 Web |
| 插件清单/配置 | ⚠️ dsh-mobile-plugin 0.2 `mobile.inventory` | ● | 设置页展示只读插件清单；配置编辑指向 Web 控制台 |
| 首次引导 onboarding | 客户端本地 | ◐ | 配对向导已有；可加「Web 端还能做什么」引导页 |

### F. 平台增强（移动端独有，非 Web 对齐）

| 功能 | 依赖 | 说明 |
|---|---|---|
| 系统推送 | ⚠️ 插件 v2 规划（JetStream 低频通知）+ FCM/APNs | 后台审批/任务完成提醒；明确已列为插件后续项 |
| 分享/输出 | 系统分享面板 | 把 agent 回复/代码块分享出去 |
| 小组件/快捷方式 | 原生 | 一键进入最近会话 |
| iPad/平板布局 | RN | 双栏（列表+对话），ui-layout 的 Web 思路可平移 |

## 三、建议路线

**P0（已完成）**
1. Markdown + 代码块渲染（体验差距最大的一项）
2. 工具卡片分级：TerminalBlock + ReadBlock + 通用卡兜底
3. 会话重命名 / 搜索 / 归档开关
4. Todo 计划条 + 上下文用量条
5. 模型选择 chip

**P1（已完成）**
6. /skill 技能候选 + @ 引用候选（两个输入触发源都落到 `+` 的同一个上拉弹框，各自定位到对应 tab）
7. 子代理面板（lineage + 列表/打断）
8. 目标条 GoalBar + Plan chip
9. workspace 管理操作 + 目录浏览
10. 图片附件发送 + 历史图片预览（需原生选图）

**P2（部分完成）**
11. Agent preset 选择、权限预设、主题跟随：已完成
12. 交付物行、compaction 指示、会话元信息头：已完成
13. 系统推送（等插件 v2）、iPad 双栏、分享面板：系统推送和 iPad 双栏待排期；代码块分享已完成，整条回复分享待按需评估

**不建议移动端做**：LLM/凭据管理、全量设置页、大文件导出（等待一次性 URL 方案）。
命令目录已由 App/插件新增的 `command.list`/`command.execute` 面 + 常用命令回退接入；
旧宿主不支持动态目录时仍可执行常用斜杠命令。

## 四、数据源核对结论

- 全部 P0/P1 项的 RPC 与事件在已 vendor 的契约层中均存在（`rpc-map.ts` 51 法 +
  mux/host 帧 + SessionEvent 核心事件），无需宿主改动
- 命令发现/执行、goal.*、subagent.* 和 agentPreset.* 已加入插件白名单；
  消息反馈 RPC、文件导出一次性 URL、系统推送仍需宿主或插件后续新增
- 备查：nats.js 2.29.x 不解析 server URL 的 userinfo，凭证走显式
  user/pass 字段（App/插件现有路径均如此，无影响）
