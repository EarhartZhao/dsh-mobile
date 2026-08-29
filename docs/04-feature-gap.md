# 移动端功能差距调研（vs Web 端 dsh）

> 2026-08-28。方法论：以 `packages/client/ui-*` 的 39 个 Web UI 插件 + apiproxy
> 契约全量（rpc-map 51 法 + mux/host 事件流 + SessionEvent 13 类核心事件 +
> 插件扩展事件）为 Web 功能全集；对照移动端已实现面（M1-M3 已验收）建立差距
> 矩阵。每项标注数据来源（已有 RPC/事件，或需宿主/插件新增）与建议优先级。

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
| Markdown/代码块渲染 | 客户端本地 | ○ | 当前纯文本气泡。react-native-markdown-display 即可覆盖 90%；代码块横向滚动 + 复制按钮 |
| 工具卡片分级展示 | ✅ tool/call+result（view 槽已有） | ◐ | Web 按 Terminal/Diff/Read/Search/Web 分块（ui-tool/ui-primitives）。移动端先做 TerminalBlock（bash/pwsh 输出滚动区）与 ReadBlock（文件内容折叠），其余走通用卡 |
| 会话重命名 | ✅ session.rename | ○ | 列表长按/会话头部菜单 |
| 会话分叉 | ✅ session.fork | ○ | 会话菜单；分叉后跳新会话 |
| 会话搜索 | ✅ session.search（结果上限 20/片段 120 字） | ○ | 列表页搜索框；已实现的 store 无需改 |
| 归档会话 | ✅ workspace.archiveSession + host/archived-sessions-changed | ◐ | store 已跟踪 archivedSessionIds，缺列表页「显示归档」开关与归档操作 |
| workspace 管理 | ✅ workspace.create/rename/delete/insertBefore/insertSessionBefore | ◐ | 移动端只读展示；补创建/重命名/删除 + 会话排序 |
| 图片附件 | ✅ session.attachment + PromptContentPart.image | ○ | 发送图片（相册/拍照）→ 附件引用；历史里的 image 块预览。需要原生选图模块 |
| 消息反馈 | ⚠️ 宿主无 RPC（Web 为客户端本地） | ○ | Like/Dislike 暂无契约面，等宿主 |

### B. 会话上下文与投影（中高价值，契约已有）

| 功能 | 数据来源 | 移动端 | 说明 |
|---|---|---|---|
| Todo 计划条 | ✅ todo/write 事件 | ○ | Web 在 composer 上方渲染 todo 列表（三态）。移动端做同款折叠条，数据已进 store（当前被丢弃） |
| 目标条 GoalBar | ✅ goal.* RPC + session/projection(goal) | ○ | 显示/编辑/暂停/恢复/清除；`/goal` 命令创建。store 需按 projection key 建模 |
| Plan 模式 chip | ✅ /plan 命令 + plan 投影 | ○ | 只读状态 chip + 进入/退出入口 |
| 上下文用量统计 | ✅ assistant/message.usage + contextBreakdown 投影 | ○ | Web composer 下 sticky 统计条；移动端做 token 用量/占比条 |
| Compaction 指示 | ✅ compaction 投影 + assistant 摘要 | ○ | 压缩事件出现时给「上下文已压缩」标记即可 |
| 会话标题/元信息头 | ✅ projection(title) + summary | ◐ | 有标题；缺 cwd/agent preset/模型 只读行 |

### C. 执行控制与模型（中价值，契约已有）

| 功能 | 数据来源 | 移动端 | 说明 |
|---|---|---|---|
| 模型选择 | ✅ session.models + session.selectModel | ○ | 会话页模型 chip：provider 分组 + effort 子菜单（数据结构 Web 已定义好） |
| Agent preset | ✅ agentPreset.list/select + summary.agentPreset | ○ | 新会话时选 preset；会话头只读标签 |
| 子代理面板 | ✅ subagent.list/history/prompt/interrupt + lineage 事件 | ○ | 会话头 lineage 面包屑 + 子代理列表/查看/打断。数据面完整，UI 工作量中等 |
| 技能 /skill | ✅ skill.list（白名单已有） | ○ | 输入 `/` 弹技能候选（startsWith 过滤，Web 同款交互） |
| 权限预设 | ✅ settings.mutate（permission 命名空间） | ◐ | 设置页一行 + 风险确认（Full access）。低频但便宜 |

### D. 工作区/文件面（中价值，契约已有）

| 功能 | 数据来源 | 移动端 | 说明 |
|---|---|---|---|
| 目录浏览 | ✅ host.listDirectory + host.createDirectory | ○ | 只读浏览足够移动端场景（createDirectory 一并带上） |
| 交付物/产物行 | ✅ tool/result + 产物投影 | ○ | 会话结束行展示产出文件列表（Web 的 ui-deliverables）。需确认投影 key |
| @ 引用（文件/会话） | ✅ host.listDirectory + session.list 组合 | ○ | 输入 @ 弹候选：文件树 + 会话列表（Web 的 ui-reference 就是这两个数据源的组合） |
| 文件导出 | ⚠️ session.export（ZIP，max_payload 1MiB 限制） | ○ | 设计已排除大文件传输；用一次性下载 URL 方案，待宿主支持 |

### E. 设置与系统（低-中价值）

| 功能 | 数据来源 | 移动端 | 说明 |
|---|---|---|---|
| 主题跟随 | 客户端本地（settings.theme 可选） | ◐ | 当前恒暗色；加 light/system 跟随即可，不必接 settings |
| 外观/语言/权限设置页 | ✅ settings.describe/update/mutate | ○ | 移动端只暴露高频项（主题、语言、权限预设），全量设置页继续用 Web |
| LLM provider/凭据管理 | ✅ llm.* + credentials.* + settings.* | ○ | 移动端不建议做（密钥管理在手机上风险收益比差），设置卡指向 Web |
| 插件清单/配置 | ✅ api-remotes pluginInventory + settings.plugins.* | ○ | 只读插件列表可做；配置编辑指向 Web 控制台 |
| 首次引导 onboarding | 客户端本地 | ◐ | 配对向导已有；可加「Web 端还能做什么」引导页 |

### F. 平台增强（移动端独有，非 Web 对齐）

| 功能 | 依赖 | 说明 |
|---|---|---|
| 系统推送 | ⚠️ 插件 v2 规划（JetStream 低频通知）+ FCM/APNs | 后台审批/任务完成提醒；明确已列为插件后续项 |
| 分享/输出 | 系统分享面板 | 把 agent 回复/代码块分享出去 |
| 小组件/快捷方式 | 原生 | 一键进入最近会话 |
| iPad/平板布局 | RN | 双栏（列表+对话），ui-layout 的 Web 思路可平移 |

## 三、建议路线

**P0（对齐日常使用，全部契约已有，约 1 周量级）**
1. Markdown + 代码块渲染（体验差距最大的一项）
2. 工具卡片分级：TerminalBlock + ReadBlock + 通用卡兜底
3. 会话重命名 / 搜索 / 归档开关
4. Todo 计划条 + 上下文用量条
5. 模型选择 chip

**P1（补齐操控面，约 1-2 周）**
6. /skill 技能候选 + @ 引用候选（两个输入触发源，共用一套候选菜单）
7. 子代理面板（lineage + 列表/打断）
8. 目标条 GoalBar + Plan chip
9. workspace 管理操作 + 目录浏览
10. 图片附件发送 + 历史图片预览（需原生选图）

**P2（按需）**
11. Agent preset 选择、权限预设、主题跟随
12. 交付物行、compaction 指示、会话元信息头
13. 系统推送（等插件 v2）、iPad 双栏、分享面板

**不建议移动端做**：LLM/凭据管理、全量设置页、大文件导出（等待一次性 URL 方案）、
命令发现列表（宿主 0.1.1-rc.2 无 command.list RPC，等宿主补齐）。

## 四、数据源核对结论

- 全部 P0/P1 项的 RPC 与事件在已 vendor 的契约层中均存在（`rpc-map.ts` 51 法 +
  mux/host 帧 + SessionEvent 核心事件），无需宿主改动
- 需要宿主/插件新增的仅四项：消息反馈 RPC、命令发现 RPC（command.list）、
  文件导出一次性 URL、系统推送——均已记录，不阻塞上表其余项
- 插件白名单现状：session.*/workspace.*/skill.list/session.models/selectModel
  已覆盖；**缺 goal.*、subagent.*、agentPreset.***（P1 目标条/子代理面板与
  P2 preset 需要先在 dsh-mobile-plugin 的 ALLOWED_METHODS 补齐——一行一法的
  插件侧纯增量，无宿主改动）
- 备查：nats.js 2.29.x 不解析 server URL 的 userinfo，凭证走显式
  user/pass 字段（App/插件现有路径均如此，无影响）
