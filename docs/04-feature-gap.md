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
> `mobile-catalog.ts` 宽解析读取，chip 点开是与子智能体切换器同款的下拉浮层（仅可查看 / 工作区内修改 / 完全权限，
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

> 2026-10-08 追加（模式菜单换成下拉浮层）：Web 的这两种选择器都挂在触发它的 chip 下面，
> 不是从屏幕底下推上来的 sheet，所以 `ChoiceSheet` 换成和子智能体切换器同一副壳——**没有遮罩**、
> `radius-panel` 圆角配软投影、行不再画边框（当前项用 accent 文字 + `IconCheckOutline`，
> danger 档仍是红字）。位置由 chip 自报：按下时 `measureInWindow` 拿到自己的窗口坐标，
> 面板就挂在它上方 8px（Fabric 上测量与开面板在同一个 batch 里，弹层不会先在兜底位置画一帧，
> 量不到的渲染器也有兜底偏移），所以键盘把输入卡顶起来时面板跟着走。

> 2026-10-08 追加（按下态收口）：`components/Touchable.tsx` 是 RN touchable 的薄封装，
> 默认 `activeOpacity` 从 RN 的 **0.2 提到 0.8**——浅色底上 0.2 会把控件压成近乎透明，
> 就是「太白」的那一下；26 个文件改从它取 `TouchableOpacity`，一个按下态走全 App。
> 消息气泡与助手回答行只有长按开操作菜单、点一下什么都不做，仍保留 `activeOpacity={1}`，
> 不给自己加一下假的反馈。

> 2026-10-08 追加（选中后弹框不再自己重开）：`+` 弹框是被「选中」关掉的，不走 `onClose`
> 那条记 dismissed 的分支，而它插进去的正文（`@提及`、`/命令行`）恰好就是触发检测认作查询的
> 那段文字——于是删掉插入自带的尾随空格、或修剪这一行，就会被当成一次新查询，弹框带着刚选的
> 引用/命令重新弹出，搜索框还被自动填上。`insertAtTrigger` 现在也把这条已完成的 token 记进
> `dismissedTrigger`，键与关闭时同一套（`composerTokenKey`：触发字符 + 偏移；插入那行按去掉
> 尾随空格后的文本取键，所以删掉这个空格也算同一个 token）；在同一偏移上继续编辑保持关闭，
> 另一处新写的 `@`/`/` 照常打开自己的 tab。
> 同形的问题还有第二条入口：会话更多菜单里的「浏览工作区」→「插入引用」（`WorkspaceBrowserSheet`）
> 不走 `insertAtTrigger`，而是直接往 draft 写 `@提及 `，所以同样会删掉空格就重开。这条路径现在
> 也用同一个 `finishedTokenKey` 记 dismissed（键仍在 `insertReference` 里生成，改完 draft 与
> 记忆只差一次 setState），两条插入入口共用一套抑制。
> 抑制记忆的清理条件也一并收紧了：原先只要草稿「不再以 token 结尾」就清空，而插入留下的那个尾随
> 空格恰好让草稿不满足「以 token 结尾」——于是**删掉空格（记住）→ 补回空格（清空记忆）→ 再删空格
> （重开）**三步就复现了。现在改为拿 `text.trimEnd()` 的 token 键与记忆比对，相同就保留：去掉尾部
> 空白后仍读作那个被抑制的 token，就还算同一段文字，这个空格来去多少次都不会让它重开。

> 2026-10-08 追加（输入框的字号、行高与位置对齐）：Web 的输入卡是
> `.card { gap: 12px; font-size: 14px; line-height: calc(24px + delta) }`，
> 草稿是 `.input { min-height: 36px; padding: 4px 8px 0 14px }`，卡片里草稿与**控制行**
> （`+`、模式 chip、发送圆）之间还有那 12px 的间距。App 之前把这段 gap 漏了，卡片只有
> 87pt 高（Web 在手机宽度上量到 101px），草稿离卡片顶 22.3pt（Web 18px），占位符和正文
> 还各是 12.3pt / 14.3pt 两种字号。
>
> ① **控制行补上 12px gap**（`composerRow` 的 `paddingTop` 2 → 14，即 Web 的
> `.card{gap:12px}` + `.row{padding-top:2px}`），卡片高度回到 99pt；
> ② **草稿的字号与行高改成和用户消息一样**（`input` 14/22，与 `userBubbleText` 同一条
> 字级）：Web 的输入框按内容字级走 14/24，而它自己发出的提示气泡是 14/22，手机上照抄
> 24 的行高会让草稿看着比它将要变成的那条消息更大——所以这里不跟 Web 的输入框、跟
> **Web 的气泡**，正在输入的字和读到的字就此同一号（实测字形墨迹 41px ≈ 13.7pt，与气泡
> 行首的 41px 一致），行距也从 25 收到 22；③ **顶内边距 4 → 0**：iOS 把行盒多余的 leading
> 挂在字形**上方**，照抄 Web 的 4px 会把草稿压得更低，减掉后卡片顶 → 首行字形顶 16.3pt
> （Web 18px，行高收紧后自然上移）；④ **草稿不再吃 `flex: 1`**：带 `flex: 1` 的
> RN `TextInput` 量不出内容高度，卡片会一直停在 36px 下限，多行草稿只能**从卡片顶滚出去**
> （截图里首行被边框裁掉半行）；去掉后草稿自报内容高，卡片随内容长高、到 336px 上限才
> 由 `overflow: 'hidden'` 裁剪——和 Web 由 `.scroll` 单独当滚动盒并裁剪是同一种分工。
> 模拟器复核（iPhone 17 Pro + Metro）：占位符态卡片顶 → 首行 16.3pt，单行正文墨迹 41px
> 与气泡行首等号；两行草稿卡片自动增高、首行不再溢出；长草稿顶到上限后停在卡片内滚动，
> 无内容越出边框。

> 2026-10-08 追加（长会话滚动：跟尾、前插保位与卡顿）：内容一多，聊天页有三个毛病——
> ① 发完消息不自动跟到底、② 在结尾处轻轻上滑会**突然跳走一大块**、③ 拖动卡顿。三处的
> 根因互相独立，逐条换掉：
>
> ① **先修 ②**，因为它最刺眼。`maintainVisibleContentPosition`（原生滚动锚）的补偿量是
> **某个 subview 自己的 frame 在 mount 事务前后之差**，而虚拟列表会回收它锚定的那个 view，
> 差值就变成天文数字——模拟器实测：6,825pt 的长会话里在底部上滑 70pt，offset 从 6,305
> 直接跳到 268，甩掉六千点历史，且复现不稳定，读起来就是"随机跳一大块"。常驻、只跟尾态、
> 只阅读态三种模式全试过，都会踩，**整条移除**。读者离开尾部时的保位改由前插走查负责。
> ② **① 有三处**：(a) `ListEmptyComponent` 会继承列表自己的 `onLayout`，VirtualizedList
> 把"正在加载历史"转圈的盒子当列表高度上报（实测 84pt / 56pt，真列表 550pt）——记下来就
> 等于把视口记成几十点高，跟尾滚动的目标跟着算错。加 `listRowCount`，行数为 0 时忽略
> `onLayout`。(b) `onMomentumScrollEnd` 可能**早于**那个位置最后一条 `onScroll` 到达，
> 手势结束时读到的是中段样本，于是人明明在底部却不再跟尾。改成从结束事件本身读 geometry
> （`finishListInteraction(distance, viewportHeight)`），不再依赖过期样本。(c) **键盘**：
> 输入卡抬起来时视口变矮、内容没动，`onListLayout` 本该拿最后一次量到的高度重新贴底，但
> `pinTail(null)` 读的 `pendingTailHeight` 已经在上一帧被消费清空，于是什么都没发生——
> 点进输入框，正在回的那条消息就滑到折线以下（模拟器实测：内容整块没动，只是被裁掉）。
> 改成重贴时回退到 `listContentHeight`（最后一次上报的内容高度）。
> ③ **③ 卡顿**：`buildTranscript` / `deriveConversation` 每帧都返回新对象，行身份不可用；
> 能比的是 Markdown **源码字符串**，相等就没有新东西要画。加模块级
> `MemoMarkdown = React.memo(Markdown)` + `useMarkdownLinkPress`（稳定 `onLinkPress`），
> 三处 `<Markdown>` 全换过去，长回复不再每帧重新解析成原生树。读者离开尾部时前插页会移动
> 他脚下的文字，所以前插走查在 `followTail` 为假时**挂起**、回到尾部自动续跑（读者的手动
> 暂停 `backfillStop` 不在其列）。
> ④ 顺带把列表钉成 `flex: 1`（`styles.list`）：会按内容长高的列表把内容高度当自己的布局
> 上报，跟尾滚动拿它算目标就偏。
> 模拟器复核（iPhone 17 Pro + Metro，改的是模块级代码，重启 App 后测）：长会话底部上滑
> 76.2pt 位移 **0pt**（带状像素平移匹配 meandiff 0.0）；上滑离开尾部浮出"回到底部"，回去
> 后再上滑仍是 0pt，且与基线像素一致（meandiff 0.0）；十余条长 Markdown 的 6,853pt 会话
> 拖动顺滑。(c) 的"键盘抬起后整块内容被裁掉、最新一条落到折线以下"是模拟器实测复现的，
> 改完由新增单测锁住（`re-pins the newest row when the window shrinks…`）；设备上的键盘
> 复测未做——驱动模拟器要发真实鼠标事件，会打断机器上的其他操作。单测 29 套 236 例全过，
> typecheck 与 lint（0 error）同过。

> 2026-10-08 追加（轨迹视图 + 顶底分界的弱阴影 + 头部与弹框的收口）：四项交互调整，
> 前两件是把 Web 的对话页结构补齐，后两件是照 Web 的模态习惯收口。
>
> ① **轨迹（Trajectory）**：Web 的对话视图环（`ctx.slots.inject('conversation.view')`）
> 把「对话」和「轨迹」当一个会话的两个 tab，手机宽度只够放标题，所以第二个视图做成
> 头部按钮（原「更新时间」那行的位置，用户要求删掉更新时间）。轨迹页是**纯投影**：
> 订阅与对话页同一个 `changed` 流，50ms 节流后 `groupTurns(deriveConversation(...))`，
> 不再向宿主另要一份数据；一轮一个 section header（第 N 轮 · 状态 · 用时 · N 次工具调用），
> 下面是该轮的记录行——**包含对话页根本不渲染的东西**（`tool/call`、只有 reasoning 的
> assistant 步），这正是轨迹存在的理由。点行展开参数/结果，**没有输入框**（轨迹是用来看
> 发生过什么的）。Web 的时间概览、检查器和工具栏没有移植：手机放不下，取舍写在
> `screens/TrajectoryScreen.tsx` 的文件头。路由上它是会话的**子页**（`route.ts` 的
> `openTrajectory`/`closeTrajectory`，`showsConversation` 保证 chat↔trajectory 不丢谱系），
> 系统返回键先回到它所属的会话再往上走（`system-back.ts` 的 `closeTrajectory`）。
>
> ② **顶底两条固定带的弱阴影**：头部和底部（计划/目标/队列/审批/统计/输入卡）都是固定的，
> 中间是滚动的会话内容，之前三者是同一个平面，最新一条消息和第一张卡片读起来像同一列。
> 新增 `shadow.edgeDown`（`0 2px 6px rgba(0,0,0,0.05)`，头部下缘）与 `shadow.edgeUp`
> （同参数取负，底带上缘），比面板层（`panel`/`soft`）**更弱**——它是分隔线，不是被抬起来
> 的面；同时给头部补 `backgroundColor: chat.bgBase`（否则滚动内容会从它身下透出来）。
>
> ③ **头部信息重排**：目录折成 `…/dsh/deepseek-harness` 这样的两段（新增
> `src/path-label.ts` 的 `foldPath`，`/` 与短路径原样返回），点一下换整条路径（`numberOfLines`
> 1 → 2）；模式去掉「预设」二字、挪到目录行的最右侧、与模型 chip 同列（`metaSide`）；
> 子代理标记从被删掉的更新行挪到自己的一行。
>
> ④ **底部多行默认收起**：`TodoStrip` 只留前 3 条 + 「还有 N 项」，标题行可点开合；
> `GoalBar` 的目标文本默认 2 行（>40 字或含换行才给展开控件）。停靠带在输入卡之下，
> 长计划会把正在回的消息顶出视口，收起后视口还给会话。
>
> ⑤ **模型弹框收口**：删掉弹框末尾的「关闭」行——`ModalBackdrop` 的 scrim 本来就是
> 点击空白关闭的按压目标，再放一个关闭按钮等于同一个动作两个入口。
>
> 验证：`zsh` 下在 `apps/mobile` 跑 `typecheck`（清）、`test`（31 套 255 例全过，
> 新增 `TrajectoryScreen.test.tsx` 4 例、`strips.test.tsx` 4 例与 ChatScreen 头部 2 例）、
> `lint`（0 error，220 warning 与基线同量级，均为既有规则）。设备复核未做：驱动模拟器要发
> 真实鼠标事件，会打断机器上的其他操作。

> 2026-10-08 追加（顶部固定带重排 + 下掉顶部的「待回答」横幅）：四条调整都落在
> 会话页顶部那条固定带上，外加拆掉一个跨屏横幅。
>
> ① **下掉「待回答 / 待审批」横幅**：App 不再订阅 store 的 `attention`。这两类帧本来就
> 有两处更贴身的落点——会话内的审批/提问动作条，列表行的「待处理」徽标——而横幅画在
> **当前所在屏幕**顶部（列表页也能看到「待回答：1 个提问」），既重复又压住固定头部。
> 任务完成的横幅（`jobSettled`）保留：它没有别的落点。core 的 `attention` 事件仍在
> （store 层信号，`session-store.spec.ts` 照旧断言），只是不再有 UI 消费者。
>
> ② **顶部固定带改成两行**（都在标题行下方）：第一行左「子智能体 · N」右「模型切换」，
> 第二行左「目录」（折叠成 `…/dsh/deepseek-harness`）右「模式」。原来模型 chip 与模式
> 挤在目录行右侧的**一列**里，目录因此被压窄——这正是「目录再宽一些」和「模型切换现在
> 不对」的同一个根因；子智能体 chip 原本挂在标题行上，用一个计数吃掉标题的宽度。
>
> ③ **新增 `styles.topDock`**：标题行、两行元信息、历史读取失败条合成**一个面**，
> `boxShadow: shadow.edgeDown` 与 hairline 落在整条带的底部。上一轮把边加在标题行上，
> 带子变两行后就在**带子中间**画出一道缝——模拟器截图里看得很清楚，所以这轮把它移到
> 容器上。
>
> ④ **目录改成弹框**：点目录打开「工作目录」弹层（`ModalBackdrop`，点空白关），弹层里
> 显示整条路径，**点路径即复制**并提示「已复制」（手机没有 ctrl-C，标签行也不是读路径的
> 地方）；不再用 `numberOfLines` 1↔2 就地展开。i18n 增 `chat.directoryOpen` /
> `chat.directoryTitle` / `chat.directoryTapToCopy`，删 `chat.directoryFold` /
> `chat.directoryUnfold` / `chat.subagentMeta` / `attention.*`。
>
> ⑤ **边距**：元信息带左右内边距 8 → 12pt（与标题行同一条基线），模型 chip 与模式各带
> 4pt 纵向 padding 当点按热区，模式左侧再留 8pt。子智能体下拉浮层的锚点随之从 104
> 挪到 148（安全区 + 标题行 + 一行元信息）。子会话的「子代理」标记只作标签，不再做成
> 按钮——回父会话的入口是它下面那一行。
>
> 验证：`apps/mobile` 的 `typecheck` 清；`test` 31 套 256 例全过（新增「子智能体计数与
> 模型 chip 同一行、且计数在前」一例，结构断言而非快照）；`lint` 0 error（220 warning，
> 与基线同量级）。模拟器（iPhone 17 Pro + Metro）用 App 自己的深链
> `dshmobile://new-session` 开一个空会话做**只读截图**核对：顶带无中缝、底部一条
> hairline + 约 2.7pt 阴影、两行元信息与右侧对齐都到位（没有发鼠标/触摸事件）。
> 有子智能体的会话那一行没在设备上核对——打开它需要点列表。

> 2026-10-08 追加（顶带行列归位 + 下掉任务完成横幅 + 提示统一到顶部 + 计划收一行）：
> 上一轮的顶带两行化把两行的**内容**放反了，这一轮按用户给的分工摆回去，另外收掉
> 三处零散提示。
>
> ① **顶带两行归位**：第一行**目录**（`foldPath(cwd, 3)`，即三个尾段
> `…/mine/dsh/deepseek-harness`）+ 最右侧**模式**；第二行左侧**子智能体切换** +
> 右侧**模型切换**。上一轮是"子智能体 + 模型"在上、"目录 + 模式"在下——用户要的
> 是"模型切换和子智能体切换放在下面、目录显示再宽一些"，所以把两行整块对调，`directoryLine`
> 由 `flexShrink: 1` 改成 `flex: 1` 吃掉整行宽度（多出来的宽度给折叠段数从 2 段加到 3 段，
> 3 段正好跨过项目名进到 checkout 那一级）。
>
> ② **下掉任务完成横幅**：`jobSettled` 的 `showAlert` 一并删除（上一轮保留了它，因为
> "没有别的落点"；用户的结论是不要这个横幅）。i18n 随之删 `job.completed` / `job.settled` /
> `job.settledMessage`——`job.failed` 留着，`ChatScreen.jobStatusLabel` 还在用它。core 的
> store 事件不受影响，只是没有 UI 消费者。
>
> ③ **提示统一到顶部的一条**：会话页底部原先挂着一条 `styles.notice`（截图里的「已复制」），
> 而 App 顶部本来就有跨屏幕的 `alertBanner`。改成 `ChatScreen` 接一个 `onNotice` 回调、
> App 传 `showAlert`，会话页自己的 notice 状态与 4s 计时器整体删掉——全 App 只剩一条
> 画临时提示的位置。顺带把 Android 的 `ToastAndroid`（双击返回退出提示）也并进同一条，
> 不再分平台两种形状。
>
> ④ **底部那个英文浮条**：截图最底下那条 `Open debugger to view warnings.` 是 RN 的
> **LogBox 浮层**（Metro 日志里的触发源是 `@react-native/virtualized-lists` 对
> `ReactNativeFeatureFlags` 私有子路径的 import 报警，以及 RN 0.87 把 `Clipboard` 从 core
> 摘出去时 `index.js` 的 `warnOnce`）。它是 RN 自带的英文家具、只出现在 dev，而且盖住
> 正在打的输入卡；`apps/mobile/index.js` 里加 `LogBox.ignoreAllLogs(true)`，警告本身仍
> 照旧打到 Metro 终端。App 自己的文案全部走 i18n（zh/en 两份字典各 717 键、集合一致），
> 所以"加载和刷新时显示英文"与"这个怎么显示英文"都是这一条。
>
> ⑤ **计划条收成一行**：`TodoStrip` 原来只在超过 3 项时折叠，折叠态还留着**三行**，
> 点标题只是从 3 行变全部——所以"点击计划没有收起显示一行"。改成跟 Web 的 `TodoPanel`
> 一样：`collapsed` 初始就是 `true`，收起时**只有标题那一行**（`计划 · done/total` + 箭头，
> 连 `stripHead` 的 6pt 下边距也去掉），展开才是整份清单；控件永远是标题本身，跟清单
> 长度无关。i18n 删 `plan.todoMore`。
>
> ⑥ **底带上边距**：`styles.bottomDock` 加 `paddingTop: spacing(2)`。阴影/细线是画在
> 底带**顶边**上的，之前计划条第一行紧贴着它，读起来像一条穿过条的横杠。
>
> 验证：`apps/mobile` 的 `typecheck` 清；`test` 31 套 256 例全过（改「计划条」两例为
> 收一行/再收回去，改头部一例断言两行的**文档顺序**与不同行，目录断言改为三个尾段）；
> `lint` 0 error（220 warning，与基线同量级）。模拟器（iPhone 17 Pro + Metro）重启 App
> 做**只读截图**核对：底部不再出现 LogBox 浮条，顶带第一行是
> `目录 …/mine/dsh/deepseek-harness` + 右侧「标准模式」，第二行右侧 `deepseek-flash`，
> 底带顶边与输入卡之间留出空隙（没有发鼠标/触摸事件，计划条与「已复制」走单测）。

> 2026-10-08 追加（新对话卡加载 + 轨迹页内容补齐）：
>
> ① **「新对话卡在正在加载对话…」**：根因是会话页的挂载闩只写了 `false`——
> `useEffect(() => () => { mountedRef.current = false }, [])` 从不写回 `true`，而 Fast Refresh
> 会保留组件状态、重跑 effect：清理把闩按下后不再抬起，之后每个 tail 读取的结果都被
> `if (request !== … || !mountedRef.current) return` 丢掉，而 `loading` 唯一的出口就是那次
> 读取落地，于是**永久转圈**（真实 remount 之所以能好，因为新实例的 `mountedRef` 初值是
> `true`）。修法两条：闩在 effect 里两端都写；再加一个 5s 的看门狗，只在
> `status === 'loading'` 且**确实没有读取在飞**（`historyInFlight === 0`）时补发一次 tail
> 读取——它只在等待已经断裂时动手，绝不去打断在飞的请求。
>
> ② **轨迹页内容补齐**（对齐 Web `ui-trajectory` 的投影）。`deriveConversation` 现在也产出
> 轨迹需要的骨架：`system/message` → 「系统」记录（区分初始 / 已更新）、非 user 来源的
> `user/message` 与 `developer/message` → 「上下文」记录（带 `sourceKind`，如
> `agent-instructions` / `runtime-context` / `skill-catalog`），assistant / tool / stream /
> preparing 记录带上 `turn`/`step`；并从 `step/start` 取步骤起始时间、从 `request/header`
> 取调用时刻的工具 schema、从 `tool/result` 取结束时间，于是每行能报「时间」与工具耗时。
> 这两类记录**只进轨迹、不进对话**：`isVisible` 本来就把未知 kind 挡在 transcript 之外，
> `groupTurns` 也新增了前置缓冲，把出现在第一条 prompt 之前的 system/context 并入该轮，
> 而不是让它们单独占一个「第 1 轮」把轮次编号整体顶后一位。
>
> `TrajectoryScreen` 改成 Web 的分组结构：每轮先「消息」组（提示词、系统提示词、注入上下文），
> 再按 `step` 分「第 N 步」组，compaction 自成一「压缩 N」组；每条记录带 `#N` 序号、状态点、
> 与 Web 同名的三列用量（输入 / 输出 / 思考，来自该步 `usage`）；工具行展开后是
> 「参数 / Schema」分块加缩进的「子工具」子行（`ToolCallBlock` 的子调用树），assistant 行
> 展开后是完整正文。仍未做的（有意取舍）：Web 的工具栏、时间线与详情面板 tab——
> 手机宽度放不下，且同一份信息已在行内可读。
> 「消息」组不是单数：Web 只在**正站在**一个「消息」组末尾时往里追加，否则就在记录落点
> 另开一个。一条没有 `step` 的交付记录落在最后一步之后，若硬塞进开头的「消息」组，
> 就会把 13:35 的交付印在 13:31 的步骤上方——现在与 Web 一致，在步骤下方另起一组。
>
> 验证：`packages/core` `typecheck`/`test` 全过（新增 `tests/trajectory-fold.spec.ts` 5 例，
> 覆盖 turn/step 归属、工具起止耗时、请求头 schema、初始/更新系统提示词与前置缓冲）；
> `apps/mobile` `typecheck` 清、`lint` 0 error、`test` 31 套 258 例全过（`TrajectoryScreen`
> 新增两例：分组/系统行/用量列、展开工具到子工具）；`sync-protocol:check` 通过。
> 模拟器（iPhone 17 Pro + Metro）只读截图核对：`Greeting and session start` 一页显示
> 「消息」组里的 `#1 系统 初始系统提示词`、`#2 用户`、`#3–#5 上下文 · agent-instructions /
> runtime-context / skill-catalog`，随后「第 1 步」的 `#6 助手` 带 `输入 166 输出 27`；
> 长会话页显示「第 14 步」等分组与 `#N`、状态点、`已完成 · 0 秒 · 13:32:20`，展开态正文完整。

> 2026-10-08 追加（提示改成顶部悬浮卡 + 发送失败文案对齐 Web）：
>
> ① **提示框从跨屏横幅改成悬浮卡**（`components/NoticeToast.tsx`，新文件）。原来那条
> 横幅是插进布局里的：它一出现就把整屏往下推，而且 `numberOfLines={2}` 恰好把最长的失败
> 截在最有用的地方——用户截的图就是 `发送失败：session/writer-held: session "session-6abf24b4-…`
> 这样一句以省略号结尾的话。现在是一条**绝对定位的卡**：离顶部和左右各留边距，
> 浮在**当前屏幕之上**，不为它移动任何东西。
>
> ② **一行 / 3s 与 5s / 点击展开 / 长按复制 / 关闭按钮 / 点击重置**：默认
> `numberOfLines={1}`（`ellipsizeMode="tail"`）；**确认类**（`info`）3s、**失败类**
> （`error`）5s，等级由 `ChatScreen` 的 `onNotice(text, level)` 第二参传出，失败路径全部
> 走 `failNotice`；点一下展开成 `ScrollView`（`maxHeight: 260`）读全文，**长按复制**并
> 回一句「已复制」；展开后卡片**下方**出现 × 关闭按钮（不做在卡内——卡片本身是
> 一个按压面：点开、长按复制，卡内再放按钮只会和这两个打架）；展开态计时 5s，
> **每点一次重置**（`taps` 计数进 effect 依赖），读者读到一半不会丢。
>
> ③ **状态栏那一步要自己迈**：绝对定位的子元素对齐的是屏幕边，不认父容器
> （`SafeAreaView`）的 padding——真机上卡片正好压在时钟上，第一行就是被吃掉的那一行。
> 所以 `NoticeToast` 从 `react-native-safe-area-context` 取 `insets.top` 自己加上。
>
> ④ **「消息发送失败」的真话是「会话被别的 DSH 占着」**：根因不在手机——
> `lsof <session>/session.lock` 显示写锁在桌面版 `DeepSeek Harness.app`（也见过 `dsh web`
> 同时占着 21 个会话），宿主因此拒绝接管并回 `session/writer-held`，App 只是把原始的
> code + 会话 UUID 原样贴出来。Web 对这个 code 有专门的恢复文案
> （`ui-conversation` 的 `error.sessionInUse`），App 现在也有了（`chat.sessionInUse`）：
> 「当前会话已被占用，可能是其他正在运行的 DSH 导致的（如其他 dsh web、桌面端），
> 请退出其他正在运行的 DSH 后重试。」
>
> ⑤ **这个 code 得从消息里认，不能只看 code 字段**：插件的错误词表是**冻结**的，
> `session/writer-held` 不在其中，于是被投影成 `internal` + `${code}: ${host message}`
> 兜底（真机抓到的正是 `internal` / `session/writer-held: session "…" is already owned…`）。
> 只看 `error.code === 'session/writer-held'` 会**恰好漏掉所有已发布的插件**，所以
> `namesWriterContention()` 同时认「code 是这个」和「message 以这个开头」两种形状，
> 抛出的 `MobileRemoteError`（带附件那条走 throw 分支）也一起走同一段判断
> （`thrownText`）。
>
> 验证：`apps/mobile` 的 `typecheck` 清、`lint` 0 error（223 warning，与基线同量级，多出的
> 两条是新测试文件里既有的 `no-void` 写法）、`test` 32 套 267 例全过（新增
> `NoticeToast.test.tsx` 7 例：一行→点开全文、3s/5s 两个时长、点击重置、长按复制、
> 关闭按钮、以及「卡片要越过状态栏」的定位断言；ChatScreen 新增 1 例：插件把 code 折进
> 消息时仍然出恢复文案）。**Android 真机**（vivo V2405A，Metro + `adb reverse`）复核：
> 检查更新出 3s 蓝边确认卡、写占用出 5s 红边失败卡；卡片离顶部与左右都有间距且不再压
> 状态栏；点开显示全文三行 + 下方 ×，点 × 关闭；长按弹出「已复制」；连拍测时得到
> 失败卡约 5s、确认卡约 3s 后自行消失。中文真机文字与截图一致。

> 2026-10-09 追加（每轮 Turn 各成一块，思考块不再自己折叠／闪空）：
>
> ① **读到的现象**：`dsh项目前端深入学习课程计划` 这个会话里，同一段思考区在读者
> 不动手的情况下反复换脸——一会儿是展开的多行工具/思考行，一会儿塌成两三行，
> 中间还夹着整屏空白（顶带往下到「深度求索中」之间全白，持续 4–7 秒后自己长回来）。
> 这个会话是 **goal 自动续轮**会话：1 条人类 prompt + 9 个 turn（`turn/start 1..9`，
> 每轮之间由 `agent/inbox/spliced` 注入 `<goal_round>`），共 179 步、225 次工具调用。
>
> ② **根因一，分轮太粗**：`packages/core/src/turns.ts` 的 `groupTurns` 原来**只在人类
> 消息处开新 turn**，于是 9 轮被合并成 1 块；第一轮的 `turn/end` 一落地就把 `endReason`
> 写在这个唯一的块上，而那 8 轮自动续轮既没有自己的 prompt、也没有自己的结束事件，
> `turn.live` 于是退化成「此刻有没有步骤在飞」——**每过一个 step 边界就折叠一次再展开
> 一次**。折叠会把整块的 narration 收进回答下的一条 disclosure，读者眼前的行数从
> 20 行掉到 3 行；展开又弹回来。Web 不是这么读的：`ui-conversation` 的 location index
> 按「最后一个 `turn/start` 直到 `turn/end`」把事件归轮，`ui-chat` 的 `ProcessGroup`
> 每个 turn 一组，`turn-process` 的 `liveProcess` 也是按轮判定的。
>
> ③ **根因二，空白是 Android 的 cell 回收**：行在读者眼皮底下被移除时，Android 的
> `removeClippedSubviews`（FlatList 默认开）会摘掉 cell 的原生视图，而列表已量好的
> 布局高度还在——内容高度仍是折叠前的两万来像素，可视区却什么都没有。所以白屏和
> 折叠是同一件事的两面。
>
> ④ **改法**：`groupTurns` 改成 **`turn/start` 即轮边界**（与 Web 同构），并把结算收口到
> 事件自己点名的那一轮：
> - `turn/start` 见到不同的 turn 号就开新块，先 `flushRun()` 再计时（自动续轮从此各有
>   自己的开始时间和 `endReason`）；
> - `turn-end` 只结算它点名的 turn（`numbered` 表），不再把旧轮的结束扣在刚开的新块上；
> - **prompt 坐在自己的边界里**：日志的顺序是 `turn/start` 先写、被认领的 `user/message`
>   后写（宿主 `turn/start → 认领 → append user/message`），所以第一条之后的人类 prompt
>   都排在它自己的边界**之后**。边界开了、还没有任何步骤和行的 turn 就是这条 prompt 的
>   家；再给它另开一块会在读者路上留一个空 turn，也把这一轮挂在边界没点名的块上。
>   （这一段是实机数据逼出来的：只做前三步时，`session-01974258` 等 5 个正常会话多出
>   了一个 `items=0` 的空轮。）
> - `apps/mobile/src/screens/ChatScreen.tsx` 的 transcript `FlatList` 加
>   `removeClippedSubviews={false}`（折叠仍会在每轮结束时收行，不让它再留白）。
>
> ⑤ **取证**：把本机 `~/.dsh/sessions` 的 80 个会话全部解码重放（多帧 zstd 按 magic
> `28 B5 2F FD` 切帧），新旧 `groupTurns` 逐会话对比：**76 个逐字节相同**，4 个变化——
> 上报的 `session-c03c6af3` 由「1 块 / 427 项」变成 **9 轮**（55/59/37/70/39/45/58/39/25），
> `0aeded81` 由 96 变成 42/54，`84f31419` 由 148 变成 128/20，`55f9dd5b` 只是把
> `turn/start` 之后的那条 system 消息从上一轮尾巴挪回它自己那一轮（9/9 → 8/10，轮数不变）。
> 对上报会话再按 179 个 step 边界逐帧建 transcript：修前那块在连续 27 个 step 里钉在
> 折叠态的 3 行（整段 9 轮里翻了 7 次脸），修后运行中的那一轮行数随工作单调增长
> （3→6→8→10…→24），只在真正结束的那一轮才收成折叠态。
>
> 验证：`packages/core` `typecheck` 清、`test` 21 套 170 例全过（`turns.spec.ts` 新增 2 例：
> 边界各成一轮且自动续轮自己活着、prompt 坐进自己边界开的那一轮而不是旁边另开空轮）；
> 工作区 `typecheck` 清；`sync-protocol:check` 通过；`apps/mobile` `typecheck` 清、
> `lint` 0 error（223 warning，与基线同量级）、`test` 32 套 267 例全过。
> **本轮没有真机/模拟器复核**（`adb devices` 为空，机器上也没有 Android 模拟器），
> 上面全部结论来自对真实会话日志的重放；`removeClippedSubviews={false}` 与滚动是否
> 回退需要在下次接上设备时按「长会话滚动」那一段的办法再核一遍。

> 2026-10-09 追加（轨迹页补齐工具栏 / 时间概览 / 搜索，检查器改成独立一页）：
>
> ① **投影搬出组件**：轨迹的投影从 `TrajectoryScreen.tsx` 提到 `src/trajectory-model.ts`
> （纯函数，无 React、无 store），列表、时间概览、搜索框和新的记录页读同一份
> `projectTrajectory` 的结果，三者不可能对同一段日志有两种说法。投影本身与上一轮一致
> （每轮「消息」组 + 按 step 的「第 N 步」组 + 「压缩 N」组），新增的是记录自带
> `durationMs`（工具取 `endedAt - startedAt`、assistant 取 `step/start` 到 `assistant/message`
> 的墙钟）、`turn`/`group` 归属，以及「子工具的子树也编号」——`#N` 与 Web 一样按日志
> 顺序连续。
>
> ② **Web 的工具栏三开关落到手机上**（对齐 `TrajectoryToolbar`）：`时长` 在
> **等宽操作**（每条记录一个槽位）与**实际时长**（按记录毫秒数、并压缩空档，与 Web 的
> `deriveTrajectoryTimeline('duration')` 同一套算法）之间切换；`轮次` 收起/展开所有轮次；
> `调用` 把工具行从列表里收起（手机上的行没有自己的正文本可折叠，记录的正文在记录页）。
> 搜索框对齐 Web 的 `TrajectorySearchIndex`：空格分词的**全部**词都要命中同一条记录，
> 命中面覆盖 chip / 标题 / meta / 正文 / 各分块 / 所属分组；有查询时列表只留命中项
> （连同它所在轮次与分组的表头）并报「N 条匹配」，概览条把没命中的块按 Web 的
> `[data-search-match='false']` 压到 0.16 透明度。
>
> ③ **时间概览条**（`components/TrajectoryTimeline.tsx`，新文件）：Web 的三条泳道
> （输入 / 模型 / 工具）、每次轮次边界一条发丝线、每条记录一个按泳道着色的块（错误的
> 记录用红、用户蓝、上下文绿、assistant 琥珀、工具深蓝），高度与间距照搬 Web 的
> 50px / 8px / 14px。Web 的拖拽选区与视口缩放没有移植——手机上无法一边拖一边读表；
> 保留的是**点击落点最近的记录**：先展开挡住它的折叠（含 `调用` 开关），再滚到它并高亮
> 该行（缩略图式导航）。
>
> ④ **检查器改成一页**：Web 把点开的记录显示在右侧面板，手机宽度放不下，改成推入
> `TrajectoryRecordScreen`（新文件，新路由 `trajectoryRecord`）。这一页不再截断：正文、
> `参数` / `Schema` / `结果` / `原始内容` 全部分块，加上轮次、分组、类型、状态、记录时间、
> 开始/结束、时长（毫秒，与 Web 的 `formatDurationMillis` 同样带千分位）、用量三列，以及
> 它拥有的子工具各自的正文与分块。系统返回键在这一页回到轨迹页（`system-back` 新增
> 一个分支），轨迹页再回会话。
>
> 验证：`apps/mobile` `typecheck` 清、`lint` 0 error（224 warning，与基线同量级）、
> `test` 34 套 286 例全过（`TrajectoryScreen` 重写为 12 例：整轮成员、点行开记录页、
> 只有搜索框没有输入框、空态、分组、落点分组、三泳道概览与等宽槽位、工具栏收轮次、
> 单轮表头收起、收起调用、时长开关往返、搜索命中与计数；新增 `TrajectoryRecordScreen`
> 4 例：工具的参数/结果/子工具、思考块正文、记录不在日志里、返回；新增
> `trajectory-model.test.ts` 6 例：`#N` 连续编号与子工具归属、等宽槽位与泳道、按时长
> 压缩空档、空查询、逐词命中；`system-back` 与 `route` 各新增记录页的往返一例）；
> 工作区 `typecheck` 清、`sync-protocol:check` 通过、`packages/core` `test` 全过。

> 2026-10-09 追加（记录详情页按 Web 检查器的形状重做）：
>
> ① **分页**：上一轮把检查器搬成了一页平铺，形状仍与 Web 不同。现在对齐
> `TrajectoryTable.tsx` 的 `detailTabs`：助手/用户/上下文是**概述 / 预览 / 原始内容**
> （有来源对象时再加**来源**，打印 Web `MessageSource` 的原始 JSON），工具是**概述 /
> 参数 / 结果 / Schema / 计时**，系统提示词单页，压缩只有**概述 / 原始内容**。顶部一行
> 是 Web 的 tab 条，当前页带下划线；标题区改成 Web 检查器的「分类 + 第 N 轮 · 第 M 步」。
> 记录内容的切换不再重算投影——列表、概览与这一页读同一份 `projectTrajectory`。
>
> ② **概述页补齐 Web 的读数**：来源（用户的 source 标签：用户 / 目标 · Round N /
> `kind` 首字母大写；助手是**请求 #N**，编号与 Web 一样按 assistant 步与压缩的日志顺序
> 连续编，含没有正文、只调用工具的步）、`层级`、`状态`（Web 的 `statusOf`：错误→失败、
> 空压缩与无结果的调用→等待中，其余已完成；未完成的字样统一改成 Web 的「等待中」）、
> message 的三行 token（`Token` = output、`推理` = reasoning、`内容` = output − reasoning）、
> 以及**请求计时**五项：开始时间（本地时间带毫秒，与 Web `formatStartedAt` 同格式）、
> 总时长、首 token 延迟、生成、吞吐量（tok/s，1 位小数）。缺项各有专门文案
> （步骤开始时间不可用 / 首 token 时间不可用 / 输出 token 数不可用 / 时长过短），
> 不是印 0。
>
> ③ **首 token 时间落到 core**：`assistant/message` 只记录答案落地的时间，TTFT 的锚点
> 只在 chunk 流里。`deriveConversation` 现在按 Web 的 `isTokenDelta`（text/reasoning delta
> 非空，或 tool-call delta 带 name/argumentsDelta）记每个 step 的首个 token，挂到
> `assistant` 与 `stream` 项上（`firstTokenTime`）；没有 chunk 的会话重放则如实显示
> 「首 token 时间不可用」。同时把 prompt 的 source 原对象带进 `user` / `context` 项
> （`source`），供「来源」页打印。
>
> ④ **预览/原始内容**：预览走聊天同一套 Markdown 规则（`markdownPreviewRules`），助手的
> 预览先渲染思考块再渲染正文——与 Web 的 `MarkdownRecordContent` 一致；原始内容是不渲染、
> 可选择的同一段文本。参数/Schema/来源 JSON 用等宽字，结果按正文排。
>
> 验证：`apps/mobile` `typecheck` 清、`lint` 0 error（224 warning，与基线同量级）、
> `test` 34 套 289 例全过（`TrajectoryRecordScreen` 重写为 7 例：助手概述的
> 来源/状态/三行 token/五项计时与思考预览、工具的参数与 Schema 分页、结果与子工具留在
> 概述、prompt 的来源标签、系统提示词单页、记录缺失、返回；`packages/core` 新增 2 例：首 token 锚点
> 在 stream 与 settled message 之间保持不变、prompt 的 source 原对象保留）；工作区
> `typecheck` 清、`sync-protocol:check` 通过、`packages/core` `test` 全过（23 套 172 例）。
> 本轮**没有真机/模拟器肉眼复核**：Android 停在锁屏（需要用户解锁），iOS 模拟器按约定
> 不用抢真实鼠标的工具驱动；记录页的渲染顺序用一次性的 headless 渲染核对过（
> 概述 → 来源/请求 #N → 层级 → 状态 → Token/推理/内容 → 预览（思考块 + 正文）→ 请求计时）。

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
| 会话标题/元信息头 | ✅ projection(title) + summary | ● | 两行元信息：子智能体计数（最左）与模型切换一行，目录（点开弹层可复制整条路径）与模式一行；父会话行、轨迹入口已接入，更新时间按需求下线 |
| 会话轨迹视图 | ✅ 客户端本地投影（`deriveConversation` + `groupTurns`，投影在 `src/trajectory-model.ts`） | ● | Web 的 conversation.view 第二个 tab；按轮次列出全部记录（含对话页不渲染的工具调用与纯思考步）。Web 的工具栏（时长/轮次/调用）、搜索框、三泳道时间概览条都已移植；点行不再就地展开，改为推入记录页（`TrajectoryRecordScreen`）。记录页按 Web 检查器分页：助手/用户/上下文是概述/预览/原始内容（+来源），工具是概述/参数/结果/Schema/计时，概述含来源（请求 #N）、状态、三行 token 与请求计时五项（开始时间/总时长/首 token 延迟/生成/吞吐量）。未移植：概览条的拖拽选区与视口缩放（手机上无法一边拖一边读表）、请求级检查器的选项/用量页与跨记录跳转（父助手消息 / 请求 #N 的左右跳转） |

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
