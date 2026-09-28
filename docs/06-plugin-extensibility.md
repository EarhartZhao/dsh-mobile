# 插件扩展下的移动端适配策略

本文回答一个问题：**dsh 接入新插件后，Web 端的交互会变，App 应该怎么跟？**

结论先说：App 跟的不是「插件」，而是**宿主契约**。插件装了什么、叫什么名字，App 一律不关心；它只认宿主词表里那些稳定、可扩展、有明确未知语义的面。按这个分层，插件带来的变化里绝大多数 App 不需要发版，只有极少数硬边界必须同步。

## 一、三类变化，三种应对

| 变化类型 | 例子 | 传递方式 | App 的策略 |
|---|---|---|---|
| 宿主声明式表达 | 工具卡的 `view.card`（terminal/diff/search/read/web/generic） | `session/event.view` 槽，`z.looseObject({ card: z.string() })` | 已按 `card` 分支渲染；未知 card 自动落通用卡 |
| 新事件 / 新投影 | 新 durable 事件、新 `session/projection` 键 | `event.type: z.string()` + `data: z.unknown()`；投影是 `record(string, unknown)` | 未知一律"存下来但不崩"，能降级就降级 |
| 插件自带 UI | 插件在 Web 上挂的 React 组件、自定义面板 | 不可传递 | 明确降级：工具名 + 参数/结果 + "该插件在桌面端有专用界面" |

关键判据是一条：**未知的东西会不会让 App 静默出错？**

- 会静默出错的（丢帧、卡死、看不到问题）→ 必须走版本门禁，或先把边界放宽（见第五节）。
- 不会的 → 一律走降级路径，不新增能力位、不动 App、不发版。

## 二、必须跟随 / 可以忽略（判据表）

| 面 | 传递方式 | App 现状 | 未知时的行为 | 结论 |
|---|---|---|---|---|
| 工具卡 `view.card` | `view: { for: 'call'\|'result', view: loose({card}) }` | 已渲染 generic/terminal/diff/search/read/web | 通用卡：title + rawInput/content + locations + 原始 result | ✅ 自动降级 |
| 工具名 → 工序分类 | App 本地词表（`packages/core/src/activity.ts`） | `toolActivity(name)` 13 类 | 落到 `tools` 泛类 | ✅ 自动降级 |
| 新 durable/transient 事件类型 | `type` 是 `z.string()`，`data` 是 `z.unknown()` | 未认领的 surface 事件走"未知事件"折叠行（`packages/core/src/unknown-event.ts`） | 显示类型 + 原始数据，不再隐形 | ✅ 已对齐 Web 的 `unknown-surface` |
| 新 `session/projection` 键 | `values: record(string, unknown)` | 通用值仓，按 key 取用 | 已存但不渲染 | 新投影要 App 主动消费 → 用可选能力位协商 |
| 新 mux/host 帧 `type` | 冻结的 `discriminatedUnion('type')` | 载体只认识已发布帧型 | **整帧被丢弃** | 硬边界：新面必须经桥翻译进既有帧型（`jobs`/`inbox` 就是这么做的） |
| `question/requested.items[].intent.kind` | 严格 `discriminatedUnion('kind')`，被拒时走 `mobile-questions.ts` 宽解析 | 只对 `plan-review` 有专用卡 | 未知 tag 不再丢帧：降级成通用问答卡并注明类型 | ✅ 已按"客户端不猜、但也绝不显示空白"处理 |
| 插件自定义 React UI | — | 无 | 只看到工具调用与文本结果 | L2：降级 + 提示，不追 |

## 三、三层阶梯：L0 稳定词表 / L1 可扩展面 / L2 不可移植面

**L0 稳定词表（改动即 App 发版）。** 已消费的 `card` 标签、`intent` 标签、已认识的 mux 帧类型、已消费的事件类型与投影键。它们进 `sync-protocol:check` 与 `verify-plugin-contract.mjs` 的校验面：上游改名/换语义会被门禁直接挡下，而不是在真机上表现成"某块 UI 突然空了"。

**L1 可扩展面（未知即降级，App 不动）。** 未知 card、未知工具名、未知投影键、未知事件类型。这里唯一的工程要求是"每一个消费点都必须有一个明确的未知分支"，并且这个分支是可读的（通用卡、泛类标签、折叠的原始 JSON），而不是空白。

**L2 不可移植面（App 只做提示）。** 插件在 Web 上直接挂的组件——表单、图谱、可视化面板。手机端不做等价复刻：那是插件自己的产品面，不是宿主的会话表达面。App 的责任是让用户知道"这里有东西，但要在桌面看"，而不是画一个半成品。

设计上的目标只有一个：**推动 L2 尽量变成 L1**。插件作者若把自定义面板表达成"宿主词表 + 数据"（一张卡 + 结构化内容），Web 与 App 就同时受益；反之每加一个插件，两个客户端都要各写一遍。

## 四、注册表式渲染（避免"每加一个插件就改 App"）

已落地（本轮 C）：`apps/mobile/src/components/tool-cards.tsx` 就是这张表。

| 注册表 | 键 | 未命中时 | 加一项的成本 |
|---|---|---|---|
| `CARD_REGISTRY` | `card` 标签 | `generic` 条目（宿主 title + 原始结果文本） | 一个条目 + 一条单测 |
| `intentRegistry` | `intent.kind` | 通用问题卡（见第五节：需要先放宽 schema） | 一个卡片变体 + 一条单测 |
| `projectionRegistry` | `session/projection` 键 | 忽略（不渲染） | 一个视图 + 可选能力位 |
| 事件兜底 | 事件 `type` | 折叠行 `未知事件：{type}`（展开显示 data、可复制/分享） | 已实现，无需改动 |

注册表的意义不是"少写几行 if"，而是把**未知语义**变成一个显式契约：每个表都必须声明"没命中时怎么办"。这也是 Web 端 `conversation-nodes/` 的做法（`register.ts` + `fallback.ts`）。

`CARD_REGISTRY` 的每个条目声明四个面：`title`（卡片自己的标题）、`meta`（展开时的次级行）、`summary`（折叠行尾的摘要）、`body`（展开后的结构化内容）。`body` 返回"没有内容"时由行回退到原始结果文本——所以"结构化数据缺失"不会变成一块空白。工具行自身（状态、展开、图片、产出文件、子调用）不属于注册表，它只负责调用注册表。

### 4.1 view 槽必须有人填：一处曾经断掉的链路

做完注册表后在真机上验发现：**所有结构化卡片都没生效**。原因是 `session/event` 帧的 `view` 槽从来没有人填——Web 端并不消费它（浏览器用自己的 `ui-tool` 卡片模型，从工具名、参数、结果 `meta` 现场推导），而手机没有宿主工具定义可推导，于是每种工具都退化成了原始文本。

修在桥里（插件 0.2.10，`src/tool-views.ts`）：宿主进程内可以拿到工具注册表，于是桥替宿主回答同一个问题——`presentCall(解析后的参数)` 与 `presentResult(解析后的参数, { content, isError, meta })`，其中 `result` 完全由 durable 事件重建（`tool/result` 的 `message.content` / `message.isError` / `data.meta`）。两条要点：

1. **工具注册表是按 Agent scope 注册的**（`ctx.tools.get(name, scope)`，内置 read/pwsh 等都在 scope 层），只查全局层会得到"未注册"。桥通过 `ctx.agents.get(sessionId)` 取该会话的 Agent 作为 scope，全局层仅作兜底。
2. **不猜**：没有注册表、工具未注册、没有对应 presenter、参数不是 JSON、presenter 抛错——任何一种都返回"没有 view"，由 App 回退到原始文本；同时按原因打一行日志（每个原因只打一次），这样"某个工具为什么显示成原文"在宿主日志里有答案。

于是插件新增一种卡不需要动 App，宿主新增一种工具（自带 presenter）也不需要动桥。

## 五、硬边界：会让整帧失效的两处

1. **`intent` 是严格标签联合。** 冻结 schema 里 `intent` 用 `z.discriminatedUnion('kind', [plan-review])`，源码注释写得很清楚：未知 tag 会被拒帧，而不是静默退化成通用问题。后果是"上游加了一种新的提问形态 → 手机端问题卡整块消失 → 用户卡住且没有任何提示"。

   **已按 App 侧方案修掉（本轮 B）**：冻结 schema 不动，`question/requested` 被它拒掉时由 `packages/protocol/src/mobile-questions.ts` 宽解析重读一次，`intent` 保持 `looseObject({ kind: string })`，其余字段仍按 vendor 形状校验；未知 `kind` 走通用问题卡，并在卡片上写明"本 App 尚无专用界面的交互类型（{kind}）"，未渲染的 kind 同时进诊断日志。这与我们对 `view` 的处理一致（宿主契约里"渲染意图"永远当作开放词表）。

   为什么不改桥：把未知 intent 剥在桥上，等于对所有客户端一刀切地丢掉宿主刻意表达的信息；而"拒帧"是客户端自己的解析策略，修在客户端才是修在对的地方。桥侧剥 intent 只适合"宿主版本比已发布 App 还新"的过渡场景，本项目两端同仓，直接改 App 更干净。

   残余边界：未知 intent 的**回答**只能按通用形态提交（`{id, selected/custom}`）。若该 intent 要求的回答形态不同，宿主会拒绝，App 按既有错误路径显示原因——这是"能降级"与"能完成"之间的真实差距，需要在插件侧决定是否接受通用答案。
2. **mux/host 帧类型是冻结联合。** 上游新增帧型时载体直接丢弃。所以任何新的交互面都要经桥翻译进既有帧型——`session/jobs`（0.1.7 起由 `job` 命名空间翻译回来）、`session/queue`（由 `inbox` 投影翻译）都是这个套路，App 侧零改动。

除这两处，其余扩展面都应当是"降级不崩"。这条规则反过来约束插件的表达设计：**能塞进既有帧的，就别开新帧；能声明成宿主 card 的，就别写自定义组件。**

## 六、能力协商：三条腿，尽量不加位

| 层级 | 来源 | 用途 | 变更成本 |
|---|---|---|---|
| 插件能力位 | `mobile.info.mobileApi` + `features` | 必需/可选门禁（`packages/core/src/compatibility.ts`） | 插件 + App 各发一版 |
| 宿主版本 | `host.describe.version` | 判断某个新面是否存在 | 无（只读） |
| 插件清单 | `pluginInventory/list` | 诊断与提示（"该功能需要插件 X"） | 无 |

默认策略：**能降级的都不加能力位**。只有"会静默出错"的面才值得新增位；`workspace-files`、`goal-state`、`open-path` 这类"缺了就少一个入口"的能力，全部按可选处理，旧插件继续共存。

## 七、落地清单

本轮已完成（对话工序细节，见 `04-feature-gap.md` A 区）：

1. 工序分类词表 + 运行/完成文案（与 Web `message.stepProcess.*` 同词表）。
2. 运行中表头显示"现在在做什么"：`正在调用工具 · job_output` 这类「分类 + 一行详情」，详情字段优先级与 Web 一致（`packages/core/src/activity.ts`）。
3. `assistant/chunk` 的具名 `tool-call-delta` → "准备调用工具"行（Web 的 preparing 阶段），被 `tool/call` 取代、随 `turn/end` 清除。
4. 完成后表头给分类汇总与用时：`执行了命令并已调用工具 · 用时 1分04秒`；取消/失败分别显示"已停止"/"处理失败"。
5. 转写底部实时指示：`深度求索中，用时 49秒…`（本行自持 1 秒定时器，不触发整表重渲染）。
6. 未知 surface 事件兜底行（对齐 Web 的 `unknown-surface`）：未认领的 append-origin surface 事件显示为「未知事件：{type}」折叠行，展开看原始数据。
7. 未知提问意图不再丢帧（本轮 B）：`question/requested` 的 `intent` 被冻结 schema 拒绝时，由 `packages/protocol/src/mobile-questions.ts` 宽解析重读，未知 `kind` 降级成通用问答卡并注明类型。
8. 工具卡注册表 + view 槽投影（本轮 C）：App 侧 `tool-cards.tsx` 表驱动（未知 card → generic，条目声明 title/meta/summary/body 四个面）；桥侧 0.2.10 用宿主工具注册表按 Agent scope 调 `presentCall`/`presentResult`，把声明式卡片真正送进 `session/event` 的 `view` 槽——此前该槽无人填，App 的 Terminal/Diff/Read/Search/Web 卡片在真机上从未生效。

第 6 条的判据值得单独写下来，因为它是"未知即降级"里唯一需要判断"什么算未知"的一条：

- **只认 `surfaceOp` 标记，不维护类型表。** 宿主自身拒绝把 `surfaceOp` 写在非 surface 类型上、又要求 surface 类型必须带它（`surface.ts` 的两条校验），所以带 `surfaceOp: 'append'` 的事件本身就声明了"我进了模型可见面"。这样新 dsh 加第六种 message 类型时，老客户端不需要一张同步过的类型表就能发现它——这正是兜底行的意义。
- **排除 `system/message` 与 `developer/message`。** 它们确实是 surface 事件，但宿主只写给模型（渲染后的系统提示词、开发者指令），Web 也投影成隐藏节点；不排除的话用户会看到一堆模型侧的样板文本。
- **排除替换副本**（`surfaceOp` 不是 `'append'`）：替换副本是给模型看的影子内容，读者已经看过它取代的那条原始事件。
- **非 surface 事件不显示**：`step`/`turn` 边界、attempt 记录、工具 dispatch 记账都属于日志面，Web 同样不渲染；这类事件在协议上也不允许带 `surfaceOp`，所以不会误入。

建议后续顺序：

| 序号 | 事项 | 价值 | 类型 |
|---|---|---|---|
| ~~A~~ | ~~未知事件兜底折叠行~~ | 已完成 | App |
| ~~B~~ | ~~`intent` 放宽 + 未知 intent 通用卡~~ | 已完成（本轮）：消除唯一会丢帧的交互面 | App |
| C | `cardRegistry` 表驱动 | 后续加卡不再改 if 链 | App |
| D | 工作区分组基线自动刷新 | 别的客户端新建会话后手机端列表不再过期 | App |

## 八、测试策略（新增扩展面时怎么做）

1. **先加"未知即降级"的测试，再加专用渲染。** 例如未知 card 必须落通用卡、未知工具名必须落 `tools` 类、未知投影键必须不渲染且不崩。
2. **契约门禁。** `pnpm sync-protocol:check` 校验冻结 vendor 哈希与当前 dsh 源码的 Remote 定义；`node scripts/verify-plugin-contract.mjs` 校验插件版本、`mobileApi` 与必需能力位。上游改名会在这里失败。
3. **每个 card 一条渲染单测**（`packages/core/tests/activity.spec.ts` 是本轮的样板：分类表、详情优先级、上限、降级分支都逐条覆盖）。
4. **真机验证不可替代。** 本轮工序细节全部在 Android 真机（`scripts/ui-drive.mjs`）上跑通：运行中表头、逐步行、底部实时指示、完成后汇总与用时都对着真实宿主确认过。
