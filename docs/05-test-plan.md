# dsh-mobile 测试计划与功能用例矩阵

> 2026-09-22 建立。以 deepseek-harness Web 端 e2e（`apps/web/tests`，118 个
> `.e2e.ts` 文件）和 dsh-mobile 功能面（docs/00-04）为基线，整理移动端全部
> 功能测试用例与操作流程，并记录 dsh-mobile 现有自动化覆盖与本轮执行结果。

## 一、测试基线

被测对象：

- `dsh-mobile`（本仓库）：`packages/core`、`packages/protocol`、`apps/mobile`（RN Android）。
- `dsh-mobile-plugin`：NATS RPC/事件桥、配对/token、插件清单。其自有 vitest 在插件仓库跑。
- 对端宿主：deepseek-harness Web profile + dsh-mobile-plugin，经 NATS Hub/Leaf 链路。

自动化基线（2026-09-22 执行）：

| 命令（在对应目录） | 范围 | 结果 |
|---|---|---|
| `pnpm --config.verify-deps-before-run=false run test`（dsh-mobile 根） | core+protocol 11 specs | 70 tests 通过 |
| `pnpm --config.verify-deps-before-run=false run typecheck`（dsh-mobile 根） | core+protocol | 通过 |
| `pnpm --config.verify-deps-before-run=false run test`（apps/mobile） | 13 jest suites | 76 tests 通过 |
| `pnpm --config.verify-deps-before-run=false run typecheck`（apps/mobile） | App TS | 通过 |
| `pnpm --config.verify-deps-before-run=false run lint`（apps/mobile） | ESLint | 0 errors（215 既有 warnings） |

符号：●=已自动化覆盖、◐=部分覆盖、○=未覆盖；“本轮”列记录 2026-09-22 的验证动作。

## 二、功能操作流程总览

用户从安装到日常使用的完整路径：

1. 启动 App → 未配对时进入配对向导（扫码或粘贴二维码载荷）→ 连接参数 + 设备 token 落地 → `mobile.info`/`host.describe` 握手。
2. 会话列表：workspace 分组/排序、运行中徽章、归档开关、新建会话、长按菜单（重命名/分叉/归档/取消归档）、搜索。
3. 打开会话：历史尾页加载（分页）→ 流式渲染（chunk 节流）→ 输入框（文本/图片/文件/命令/@ 引用）→ 发送（运行中自动排队）→ 取消/引导/编辑/删除排队项。
4. 会话内：Markdown/代码块、工具卡（Terminal/Read/Diff/Search/Web/子调用树）、审批/提问动作条、消息长按（复制/分享/分叉/重发/Like/Dislike）、会话内搜索与跳转。
5. 上下文：Todo 条、Goal 条、Plan chip、上下文用量、compaction 摘要、会话元信息头。
6. 控制：模型切换、agent preset、权限预设、/skill 与 @ 文件/会话引用、子代理面板。
7. 工作区：目录浏览、文件预览（文本分页/图片窗口/Markdown 相对图）、缓存复用、变更实时刷新、宿主机打开/定位。
8. 设置：主题、语言、回车发送、连接诊断、插件清单、解绑；Android 深链接 `dshmobile://new-session` 与桌面快捷方式。
9. 健壮性：断线横幅、自动重连、基线重拉、待审批/待提问重放、切换网络恢复。

## 三、用例矩阵

### A. 配对、连接与兼容性

| ID | 用例与操作流程 | 预期结果 | Web 参考 | 移动端覆盖 | 本轮 |
|---|---|---|---|---|---|
| A1 | 首次启动进入配对向导；相机扫码配对码 | 扫码成功，连接参数与 token 持久化，进入会话列表 | remote-welcome | ◐ PairingScreen tests | 既有 tests 通过 |
| A2 | 相机不可用/拒绝权限时粘贴二维码兜底 | 可手动粘贴，配对链路一致 | onboarding-deepseek-config | ◐ | 既有 tests 通过 |
| A3 | 错误/过期配对码、设备数超限 | 明确错误提示，不落 token | - | ● PairingScreen | 既有 tests 通过 |
| A4 | 配对成功后 `mobile.info` + `host.describe` 握手；插件版本/能力不符 | 阻断连接并提示“更新后重试” | built-boot | ◐ compatibility.spec | 既有 tests 通过 |
| A5 | 网络断开 → 自动重连 → 基线重拉 + hello 重放 | 状态一致，待处理审批/提问不丢 | smoke-real、lifecycle-chrome | ● connection-failure + nats-integration | 既有 tests 通过 |
| A6 | broker/宿主重启后恢复 | 退避重试成功，不再卡在 connecting | client-plugin-live | ● | 既有 tests 通过 |
| A7 | 无 token / 错误 token / 白名单外方法 | `unauthenticated` / `forbidden` | - | ● nats-integration | 既有 tests 通过 |
| A8 | WSS 私有 CA 握手、明文端口拒绝 | TLS 校验通过；非 TLS 不连 | - | ◐ | 需设备/链路验证 |

### B. 会话列表与工作区

| ID | 用例与操作流程 | 预期结果 | Web 参考 | 移动端覆盖 | 本轮 |
|---|---|---|---|---|---|
| B1 | 列表按 workspace 分组；无组会话归入“全部” | 分组正确、顺序稳定 | workspace-management | ● SessionListScreen | 既有 tests 通过 |
| B2 | 会话长按菜单：重命名/分叉/归档/取消归档 | 底部 ActionSheet 可点全部项 | session-unarchive | ● SessionListScreen | 既有 tests 通过 |
| B3 | 归档开关显示/隐藏归档会话；事件同步 | 两端一致 | session-unarchive | ● | 既有 tests 通过 |
| B4 | 新建会话（含“+”快捷方式） | 进入空白会话可立即输入 | workspace-new-session-folding | ● | 既有 tests 通过 |
| B5 | 会话搜索（结果上限 20/片段 120 字） | 命中片段可读，点击进入 | search-card | ○ | 需设备验证 |
| B6 | workspace 创建/重命名/删除/排序 | 操作成功并持久化 | workspace-management | ○ | 需设备验证 |
| B7 | 运行中任务徽章与 jobs 折叠条 | 状态正确、沉降后更新 | background-job-list | ○ | 需设备验证 |

### C. 对话：输入、发送、流式与历史

| ID | 用例与操作流程 | 预期结果 | Web 参考 | 移动端覆盖 | 本轮 |
|---|---|---|---|---|---|
| C1 | 输入文本点击发送；运行中自动排队 | 文本进入队列，轮转后处理 | replay-round-trip | ○ ChatScreen 无 jest | 需设备验证 |
| C2 | 流式渲染 `assistant/chunk`（节流） | 正文/reasoning 增量渲染，50ms 节流 | chat-long-interactions | ● turns.spec | 既有 tests 通过 |
| C3 | 发送失败回填草稿并提示 | 草稿不丢，错误可见 | live-interactions | ○ | 需设备验证 |
| C4 | Markdown/代码块渲染；代码块复制/分享 | 样式正确、横向滚动、复制可用 | markdown-*、clickable-links | ◐ | 需设备验证 |
| C5 | 历史分页加载更早记录；锚点保持 | 尾页加载、滚动位置稳定 | stats-paged-history、seeded-history | ● session-store | 既有 tests 通过 |
| C6 | 会话内搜索与消息跳转 | 命中高亮、点击跳转 | rail-search-expand | ○ | 需设备验证 |
| C7 | 取消进行中的生成 | 取消生效，turn 以 aborted 收尾 | live-interactions | ○ | 需设备验证 |

### D. 附件：图片与文件

| ID | 用例与操作流程 | 预期结果 | Web 参考 | 移动端覆盖 | 本轮 |
|---|---|---|---|---|---|
| D1 | `+` 相册多选/拍照添加图片，待发送排序 | 图片 rail 按序展示、可移除 | image-display | ○ | 本轮新增单测（校验/追加） |
| D2 | 纯图片发送（无文本）；文本+图片混合 | payload `type:image`+mediaType+data+name；会话日志只存 attachment 引用 | queue-image、command-image-envelope | ○ | 本轮新增发送 payload 单测 |
| D3 | 图片限制预检：格式/单张大小/边长/像素/张数/消息总字节 | 超限拒绝并提示，不追加 | image-display | ○ | 本轮新增单测 |
| D4 | 历史 attachment 图片加载；失败时给出失败态 | 成功渲染并可点灯箱；失败不永远显示“加载中” | image-display、trajectory-image-display | ○ | 本轮修复 + 新增单测 |
| D5 | 工具/轨迹图片（ToolImage）加载与失败态 | 同上 | trajectory-image-display | ○ | 本轮修复 |
| D6 | 通用文件选择 → `fileUploads.upload` → receipt → 发送 | 上传中禁用发送，receipt 后走 filePrompts | file-upload-round | ● file-upload.spec | 既有 tests 通过 |
| D7 | 文件上传失败显示错误并可重选 | 错误 chip、发送不被卡住 | file-upload-round | ○ | 需设备验证 |
| D8 | 图片+不支持图片的命令（如非 declaring） | 拒绝并保留草稿和图片 | command-image-envelope | ◐ runMenuCommand | 需设备验证 |

### E. 执行控制：队列、取消、审批、命令

| ID | 用例与操作流程 | 预期结果 | Web 参考 | 移动端覆盖 | 本轮 |
|---|---|---|---|---|---|
| E1 | 运行中发送 → 队列 dock 出现并实时更新 | 队列项数量/状态正确 | queue-actions、queue-image | ○ | 需设备验证 |
| E2 | 队列项编辑/引导/删除 | 操作生效并同步宿主 | queue-actions、steering | ○ | 需设备验证 |
| E3 | 审批/提问动作条回答 | `/respond` 成功，Web 端即时更新 | approval-composer、question-composer | ○ | 需设备验证 |
| E4 | 斜杠命令执行、带参命令、动态目录 | 命令结果提示条；旧宿主回退常用命令 | feedback-command、goal-command-presentation | ◐ | 需设备验证 |
| E5 | `/plan`、`/goal`、`/compact` 等命令入口 | 命令槽正确提示 | plan-control-row | ◐ | 需设备验证 |

### F. 消息操作：反馈、分叉、重发、搜索

| ID | 用例与操作流程 | 预期结果 | Web 参考 | 移动端覆盖 | 本轮 |
|---|---|---|---|---|---|
| F1 | 长按消息：复制/分享/从这里分叉/重发新会话 | 各操作可用 | message-actions、turn-tail-actions | ○ | 需设备验证 |
| F2 | 分叉边界精确（不再顺延 turn/start） | 选中边界处切开 | subagent-conversation | ● mobile-workspace | 既有 tests 通过 |
| F3 | 长按 assistant 消息 Like/Dislike/取消 | 评分持久化、徽标显示、version CAS 冲突重试 | message-feedback | ● mobile-feedback.spec | 既有 tests 通过 |
| F4 | 会话重命名 | 标题更新并持久化 | - | ○ | 需设备验证 |

### G. 任务上下文：Todo/Goal/Plan/Stats/Compaction

| ID | 用例与操作流程 | 预期结果 | Web 参考 | 移动端覆盖 | 本轮 |
|---|---|---|---|---|---|
| G1 | Todo 条三态折叠与状态更新 | 折叠/计数正确 | todo-row | ○ | 需设备验证 |
| G2 | Goal 创建/编辑/暂停/恢复/完成/清除 | 状态同步、activation 事件刷新 | goal-bar、goal-multi-turn-actions | ◐ | 需设备验证 |
| G3 | Plan chip 进入/退出 | 状态正确、与模型 chip 不重叠 | plan-review、plan-control-row | ○ | 需设备验证 |
| G4 | 上下文用量条与 token 统计 | 统计正确，历史翻页不丢失 | context-meter、stats-paged-history | ● stats.spec | 既有 tests 通过 |
| G5 | compaction 摘要与标记 | 摘要显示、折叠正确 | max-tokens-notice | ○ | 需设备验证 |
| G6 | 会话元信息头（cwd、preset、父会话、更新时间） | 展示正确 | details-session-lifecycle | ○ | 需设备验证 |

### H. 模型、预设、权限、技能、子代理

| ID | 用例与操作流程 | 预期结果 | Web 参考 | 移动端覆盖 | 本轮 |
|---|---|---|---|---|---|
| H1 | 模型 chip 切换、provider 分组、effort 子菜单 | 选择生效并持久化为默认 | models-settings、default-model | ○ | 需设备验证 |
| H2 | 模型路由不可用提示 | 失败 provider 可见、可换模型 | models-settings-recovery | ○ | 需设备验证 |
| H3 | agent preset 选择；宿主关掉模式选择时禁用选择器 | 按 `modeSelectionEnabled` 策略 | agent-preset-selection | ◐ | 需设备验证 |
| H4 | 权限预设 chips 与 Full access 确认 | 确认后才启用 | access-confirmation | ○ | 需设备验证 |
| H5 | /skill 候选与 @ 文件/会话引用 | 候选正确、插入为 chip | skill-user-invoke、reference-composer | ◐ session-references | 既有 tests 通过 |
| H6 | 子代理列表/查看/继续/打断 | 打断后 follow-up FIFO 恢复 | subagent-conversation、subagent-interrupt-ui | ○ | 需设备验证 |
| H7 | 技能行显示 SKILL.md 来源路径 | 路径可见 | skill-tool-row | ◐ | 需设备验证 |

### I. 工作区文件与引用

| ID | 用例与操作流程 | 预期结果 | Web 参考 | 移动端覆盖 | 本轮 |
|---|---|---|---|---|---|
| I1 | 目录浏览：面包屑/上级/目录优先/刷新/截断提示 | 列表正确、超限有提示 | workspace-management | ◐ mobile-workspace | 既有 tests 通过 |
| I2 | 文本预览按 400 行分页续读 | 可续读、缓存复用 | document-preview | ◐ | 既有 tests 通过 |
| I3 | 图片预览（512KB 窗口）与非文本失败提示 | 不渲染半张图 | document-preview、image-display | ○ | 需设备验证 |
| I4 | Markdown 文中相对图片 `readRelated`（最多 4 张） | 就地渲染、单张失败不阻断 | markdown-images | ○ | 需设备验证 |
| I5 | 变更流实时刷新（按目录过滤、300ms 去抖） | 受影响目录自动刷新 | changed-files-turn | ◐ mobile-workspace | 既有 tests 通过 |
| I6 | 交付物/产物 chips | 收尾后展示 | produced-file-mentions | ○ | 需设备验证 |
| I7 | 宿主机打开/定位（`openWorkspacePath: reveal`） | 打开/定位成功；不支持时回显错误 | open-in-app-ssh | ○ | 需设备验证 |
| I8 | 路径复制/分享 | 复制完整路径 | home-path-tilde | ○ | 需设备验证 |

### J. 设置、主题、语言、诊断、插件、解绑

| ID | 用例与操作流程 | 预期结果 | Web 参考 | 移动端覆盖 | 本轮 |
|---|---|---|---|---|---|
| J1 | 主题：亮色/暗色/跟随系统并持久化 | 立即生效、重载保持 | settings-chrome | ◐ | 既有 tests 通过 |
| J2 | 语言中/英/跟随系统；各页文案切换 | 覆盖配对/列表/聊天/设置/菜单/工具卡/子代理 | settings-chrome | ◐ | 既有 tests 通过 |
| J3 | 回车发送开关 | 关闭后 Enter 换行 | settings-chrome | ● preferences | 既有 tests 通过 |
| J4 | 连接诊断：状态/版本/mobileApi/feature/最近事件/脱敏 JSON | 信息正确、可复制 | - | ◐ plugin-inventory | 既有 tests 通过 |
| J5 | 插件清单只读展示与刷新 | 模块名/启用状态/Fiber 阶段 | plugin-manager | ● plugin-inventory | 既有 tests 通过 |
| J6 | 解绑设备 | token 吊销即时生效、回到配对向导 | - | ◐ SettingsScreen | 既有 tests 通过 |

### K. Android 平台

| ID | 用例与操作流程 | 预期结果 | Web 参考 | 移动端覆盖 | 本轮 |
|---|---|---|---|---|---|
| K1 | `dshmobile://new-session` 深链接 | 进入新会话；连接未就绪时排队，上线后自动创建 | - | ◐ | 需设备验证 |
| K2 | 桌面“新会话”快捷方式 | 一键进入最近会话 | - | ○ | 需设备验证 |
| K3 | 系统返回键行为（输入态/弹窗态/页面栈） | 逐层退出，不误关 App | - | ● system-back | 既有 tests 通过 |
| K4 | release 明文网络禁用、debug 明文回环 | 网络策略按构建类型生效 | - | ◐ | 需设备验证 |
| K5 | 主题切换后重载保持 | 原生模式保存、JS 重载后一致 | - | ◐ | 需设备验证 |

### L. 健壮性与恢复

| ID | 用例与操作流程 | 预期结果 | Web 参考 | 移动端覆盖 | 本轮 |
|---|---|---|---|---|---|
| L1 | 弱网/WiFi 与蜂窝切换自动重连 | 状态一致、不丢待处理项 | lifecycle-chrome | ● | 既有 tests 通过 |
| L2 | 事件流任一断开即整体重建（generation 语义） | 订阅重建、无半连接状态 | client-plugin-live | ● | 既有 tests 通过 |
| L3 | 变更流断开显式提示 | 明确提示、可恢复 | - | ◐ | 既有 tests 通过 |
| L4 | 发送/加载失败有兜底（不静默卡住） | 失败态可见、可重试 | live-interactions | ◐ | 本轮修复图片失败态 |

## 四、图片附件专项（用户报告“图片状态卡住”）

现象：在图片状态下 App 卡住，点击提交无反应。

代码定位：

- `apps/mobile/src/screens/ChatScreen.tsx` 的 `MessageImage` 与
  `apps/mobile/src/components/ToolCard.tsx` 的 `ToolImage`：历史 attachment 图片经
  `sessions.attachment` 拉取，失败时 `.catch(() => undefined)` 静默吞掉，UI 永远
  渲染“图片加载中…”，没有失败态、没有重试——这是“图片卡住”的最直接候选。
- `send()`（ChatScreen）：连接不可用（`client === null`）或无可发送内容时直接
  return，无任何提示，也没有状态变化，表现为“提交了也没用”。
- 发送成功才清空 `pendingImages`，失败保留并回填草稿——该行为本身合理。

处置：

- 将两处重复实现收敛为共享 `AttachmentImage`（`apps/mobile/src/components/AttachmentImage.tsx`）：
  失败时显示“图片加载失败”并可点击重试，不再永久停留加载中；成功路径保留
  aspect ratio 与灯箱预览。
- 图片校验、追加、发送 payload 收敛为纯函数模块 `apps/mobile/src/chat-images.ts`，
  配套单测覆盖限制预检、批拒绝、payload 顺序（见五）。
- `client === null` 的发送分支在连接层已有横幅提示，属于连接态而非图片缺陷，
  真机验证时按 L1 观察。

## 五、自动化覆盖现状与缺口

现状：

- core/protocol 11 specs 覆盖连接生命周期、会话推导、流式、反馈、工作区、文件上传、统计、兼容性、NATS 集成。
- App 13 suites 覆盖纯逻辑（路径/偏好/文件类型/插件清单/会话分组/引用/返回键）与
  屏幕浅渲染（配对/列表/设置/附件图片）。
- 本轮新增：`chat-images.test.ts`（图片校验、追加拒绝、payload 组装）与
  `AttachmentImage.test.tsx`（data 图直出、attachment 成功、失败态、点击重试、
  断连快速失败、重连自动加载），共 17 条用例。

主要缺口（需真机/宿主环境手工验收）：

- 真实图片选择（原生 picker）→ base64 → 发送 → 宿主 vision 模型整链路。
- 队列编辑/引导/删除、审批/提问回答、取消生成、命令执行。
- 目录浏览器、文件预览续读、Markdown 相对图、宿主机打开/定位。
- 模型切换、preset、权限、技能、子代理、Goal/Todo/Plan/Stats 活体验证。
- 深链接、快捷方式、系统推送之外的平台项。

## 六、需要设备/宿主环境的手工验收项

以下项依赖 Android 模拟器/真机 + 运行中的 dsh Web profile（含 dsh-mobile-plugin）：

1. 扫码配对、弱网切换、broker 重启恢复（A5/A6/A8）。
2. 相册多选/拍照 → 多图发送 → 历史图片渲染 → 灯箱（D1/D2/D4）。
3. 附件失败路径（宿主拒绝图片、文件上传失败）（D3/D7/D8）。
4. 队列、审批、命令、子代理、Goal/Todo 活体验证（E/G/H）。
5. 工作区目录浏览与文件预览（I）。
6. Android 深链接、快捷方式、返回键、主题重载（K）。

> 2026-09-22：当前环境无连接设备/宿主，上述项标记"需设备验证"；自动化可执行面
> 已全部跑通并在本轮补齐图片回归。

## 七、问答弹窗卡住（截图确认为交互式提问，非图片附件）

用户提供截图后确认：截图中的"卡住"不是图片附件加载问题，而是 harness 的
交互式提问弹窗（`QuestionCard`）在选中选项后"提交回答"按钮永远禁用。

根因链路：

1. `ChatScreen.answerQuestion` 调用 `client.respond()` 发送 client-response，
   但不检查返回的 `RpcReceipt` 是否为 `{ accepted: true }`。
2. bridge 侧如果 `pendingEvents` 已丢失（流断开重建、clientId 重置等），
   `GatewayEventAdapter.respond()` 返回 `false`，bridge 回复
   `{ accepted: false, reason: 'not-pending' }`，不发 `$events/result`，
   harness 永远不会推 `question/resolved`。
3. mobile 的 `respond()` 成功解析 `{ accepted: false }` 为合法 RpcReceipt，
   不抛异常。`QuestionCard.submitDrafts` 的成功路径从不重置 `busy`（设计上
   假设父组件会移除卡片），而 `pendingQuestions` 条目永远不被清除，卡片
   永远停留在 `busy='answer'` 禁用状态——这就是截图中的现象。

修复：

- `SessionStore` 新增 `resolveQuestion(sessionId, rpcId)` 方法，供客户端
  乐观清除单条 pendingQuestion（服务端后续的 `question/resolved` 帧删除
  是幂等的，不冲突）。
- `ChatScreen.answerQuestion` / `cancelQuestion` 检查 respond 返回值：
  `accepted: false` 时抛错（用户看到"回答已过期"提示，可重试或关闭）；
  accepted 时调用 `store.resolveQuestion` 立即移除卡片，不再依赖服务端
  回帧。
- 新增 `chat.questionStale` i18n key（中/英）。
- 新增 `session-store.spec.ts` 的 `resolveQuestion` 测试（幂等清除、
  未知 session/rpcId 安全）。
