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

> 2026-09-14 追加（C 组结论）：C 组四项都受外部条件限制，本轮只落地了"诚实降级"部分——
> 超出 512KB 窗口的图片不再渲染半张图而是明确提示（这是个真实缺陷，之前会画出截断的图）、
> 目录截断提示点名宿主 `workspaceFiles.maxEntries` 这个可调项、诊断 payload 标注
> `caFpEnforced: false`。剩余三项分别卡在：上游 fs seam 的 `listDir` 上限与 Remote 游标（分页）、
> Hub 中继或局域网端点（大文件）、FCM/APNs 凭据（推送）与原生 TLS pinning（CA 指纹强制）。

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
| 工具卡片分级展示 | ✅ tool/call+result（view 槽已有） | ● | Terminal/Read 已有专用折叠/滚动视图，Diff/Search/Web 与其余工具走通用卡 |
| 会话重命名 | ✅ session.rename | ● | 会话头部菜单已接入 |
| 会话分叉 | ✅ session.fork | ● | 会话菜单；分叉后跳新会话 |
| 会话搜索 | ✅ session.search（结果上限 20/片段 120 字） | ● | 列表页搜索框和结果片段已接入 |
| 归档会话 | ✅ workspace.archiveSession + host/archived-sessions-changed | ● | 归档操作、归档列表开关和事件同步已接入 |
| workspace 管理 | ✅ workspace.create/rename/delete/insertBefore/insertSessionBefore | ● | 创建/重命名/删除和工作区、会话排序已接入 |
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
| 技能 /skill | ✅ skill.list（白名单已有） | ● | 输入触发候选与 `+` 引用面板已接入 |
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
| @ 引用（文件/会话） | ✅ `fileReferences/list` + `sessionReferenceResolver/candidates` + `workspaceFiles` 浏览器 | ● | 输入触发候选、`+` 引用面板与目录浏览器三条入口共用 `fileMention` 规则；浏览器插入后显示引用 chip 并交还焦点 |
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
6. /skill 技能候选 + @ 引用候选（两个输入触发源，共用一套候选菜单）
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
