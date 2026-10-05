# 多连接（多点切换）计划

> 2026-10-05 起草。目标：一个 App 保存多台电脑 / 多个 Hub 的配对，随时切换当前连接；
> 插件侧为每个实例配置显示名，App 用它识别"这条连接是哪台机器"。
>
> 实施状态（2026-10-05）：§8 的 1–4 步已落地并通过单测/组件测，5 待真机验证，
> 6 尚未执行（按「先验证」的要求，两个仓库都还没提交）。与本计划的偏差见 §10。

## 1. 现状（代码事实，先确认底座）

- 配对记录只有一条：`apps/mobile/src/pairing-store.ts` 的 `dsh-mobile/pairing/v1`，存单个 `PairingRecord`。
- `apps/mobile/src/App.tsx` 里 `pairing` 是单个 state，`useEffect([pairing, …])` 负责
  `createManager(pairing)`，清理时 `manager.stop()` 并把 `managerRef` 置空。
  **换句话说：把 `pairing` 换成另一条记录，整套连接就已经会拆掉重建，切换不需要新写连接逻辑。**
- 原生 TLS 锚点本来就是按 host 存的（Android `HubTlsStore` 的 `anchor:<host>`、
  iOS `DshHubTlsModule.mm` 的 `NSUserDefaults` 字典），多个 Hub 的 CA 可以并存。
- 但 Android 的信任管理器只认 `activeHost` 那一个锚点（`HubTlsTrust.anchorsFor`），
  而 `activateHub` 现在只在开机和配对时各调一次 —— 这是多点切换唯一的硬约束（见 §5 坑 1）。
- 插件 `mobile.info` 目前只回 `pluginVersion` / `mobileApi` / `features`；App 侧解析走
  `packages/protocol/src/pairing.ts` 的宽松逐字段校验，**加可选字段不会破坏兼容**，
  也不牵动 `packages/protocol/src/vendor`（那是冻结的 harness wire，与插件响应无关）。
- 插件每个实例 `maxDevices` 默认 10、token 90 天（`dsh-mobile-plugin/src/config.ts`）。

## 2. 数据模型

`pairing-store.ts` 升到 v2，键名与内容一起换：

```ts
interface Profile {
  id: string          // 去重键：`${hub}|${instance}|${user}`
  label: string       // 显示名；见下方优先级
  hub: string
  user: string
  pass: string
  instance: string
  ca?: string
  caFp: string
  token: string
  deviceId: string
  expiresAt: string
  addedAt: string
}

interface PairingV2 {
  version: 2
  activeId: string | null
  profiles: Profile[]
}
```

- **迁移**：读到 v1 的单个记录时包成一条 profile、`activeId` 指向它，写回 v2；失败就当没配对。
- **label 优先级**：App 内重命名 > 插件上报的 `instanceName` > `instance`。
- 仍然存 AsyncStorage（沿用 v1 的口径）；token 从"一条"变"多条"是同一份 JSON，v2 里一并记一笔。

## 3. 插件侧（dsh-mobile-plugin）

1. `src/config.ts` 新增 `instanceName: z.string().default('').volatile()`，进 `configValues`。
2. 设置卡 / 控制台加一个「本机名称」输入（`src/console.ts` 的表单、prefill、patch 三处），
   占位提示写明"留空则用实例 ID"；patch 端加 `if (typeof body.instanceName === 'string')`。
3. `mobile.info` 增加 `instanceName`（空值回退 `instanceId`）；`status()` 与控制台一并展示。
4. 顺带把设备名做得可读：App 配对时上报的名字从 `android`/`ios` 改成带平台与后缀的可读名；
   控制台设备列表支持重命名（**第二阶段，可选**）。
5. 版本三处同步 bump（`package.json` / `src/bridge.ts` 的 `PLUGIN_VERSION` / `tests/bridge.spec.ts` 里那条
   `mobile.info` 断言），并补一条"`instanceName` 为空时回退实例 ID"的用例。
6. 兼容性：老 App 忽略新字段；新 App 连老插件 → `instanceName` 缺失，label 回退到实例 ID。

## 4. App 侧（dsh-mobile）

1. `pairing-store.ts`：v2 结构 + 迁移 + `addProfile` / `removeProfile` / `setActiveProfile` / `loadProfiles`。
2. `connection.ts`：`connect` 回调里先 `await activateHub(pairing.hub, pairing.ca)` 再 `connect(...)`，
   让"每次（重）连都激活当前 host 的锚点"成为不变式（修掉 §5 坑 1）。
3. `App.tsx`：状态从 `pairing` 变成 `profiles` + `activeId`，派生出当前的 `pairing`。
   - `onPaired`：新增一条（同 id 则覆盖，即重新配对同一实例）并切过去。
   - 删除：移除当前条 → 还有别的就切到第一条，没有就回落配对屏。
   - 切换：先 `stop()` 旧 manager，再激活新 host / 建新的；同时把 `route` 重置回列表。
   - 删除时若还有别的 profile 指向同一个 host，**不要** `clearHubAnchor`（见 §5 坑 2）。
4. 新页面 `ConnectionSwitcherScreen`：列表（名称 + `hub · instance` 副标题）、当前项标记、
   点击切换、删除二次确认（复用 `ConfirmModal`）、底部「扫描添加连接」。
5. 配对成功时把 `mobile.info` 里的 `instanceName` 写进 profile；每次连上后用实时值刷新，
   离线时显示上次缓存的名字。
6. i18n 新增键：`connections.title` / `connections.current` / `connections.switch` /
   `connections.add` / `connections.rename` / `connections.remove` / `connections.removeConfirm*`
   / `connections.empty`，中英各一份。

## 5. 必须处理的坑

1. **Android 的 active host**：`HubTlsTrust.anchorsFor` 只取 `activeHost` 的锚点。不在连接前
   `activate` 新 host，切到自签 Hub 会直接握手失败（`ws://` 的调试 Hub 不受影响，容易漏测）。
2. **删除误伤**：同一个 Hub 上挂两个实例（`home` / `home-mac`）共用同一份 host 锚点，
   删其中一条时若无条件 `clearHubAnchor`，另一条就再也连不上。
3. **切换顺序**：必须先 `stop()` 旧 manager 再 `activate` 新 host。两个 manager 同时在跑时，
   `activeHost` 是全局的，旧连接的重连尝试会拿到新 host 的锚点。

## 6. 明确不做

- 两个 Hub 同时在线（这套设计是一次一个连接）。
- 跨 Hub 的会话 / 草稿 / 路由状态迁移。
- 后台自动切换、按网络环境自动选 Hub。
- 删除 profile 时顺手吊销远端设备：现在仍是"只清本机"，远端记录要去插件控制台吊销。

## 7. 验证方案

- **单测**：v1→v2 迁移、去重键、add/remove/setActive、共享 host 的锚点保护、
  `connect` 回调里 `activateHub` 的调用顺序（mock 原生模块）。
- **组件测试**：设置页入口跳转、切换列表渲染与点击回调、删除二次确认。
- **真机（debug 包，允许 `ws://` 明文）**：
  1. 同一个 Hub 的两个实例（本机 `home-mac` + `leaf-dsh-pc`）各配一次 → 来回切换，
     会话列表内容不同、在线状态与实例 ID 正确。
  2. 第二个 Hub：本机起一个 nats-server（websocket + 一个临时插件实例）→ 跨 Hub 切换，
     验证两个锚点并存（坑 1 的回归）。
  3. 断线重连、杀掉进程重开，确认 `activeId` 与锚点都恢复正确。
- **回归**：`sync-protocol:check`、workspace `typecheck`/`test`、App `typecheck`/`lint`/`test` 全绿。

## 8. 实施顺序（每步可单独验收）

1. ✅ 插件：`instanceName` 配置 + `mobile.info` 上报 + 控制台显示 + 版本 bump + 测试。
2. ✅ App 数据层：`pairing-store` v2 + `connection.ts` 的 activate-on-connect + 单测。
3. ✅ App 状态层：`App.tsx` 的 profiles / 切换 / 删除 / 路由重置。
4. ✅ App UI：连接管理页 + 设置入口 + i18n + 组件测试。
5. ⏳ 真机联调（双实例 + 双 Hub）+ 全量回归。
6. ⏸ 发布：App bump 到 **0.1.0** 走 `release-prep`（用户改的版本号）；插件 0.2.23 只留工作区，
   未提交未打 tag（用户要求"插件先不发"）。

## 9. 已确认的口径

1. **两侧都要配名字**：电脑端（插件「本机名称」）与手机端（App 设置里的「本机设备名称」）各配各的。
   App 侧默认值是设备自己报的「系统 + 系统版本 + 型号」（`Android 16 · vivo V2405A` /
   `iOS 26.5 · iPhone`），可改；改了在下次 `hello` 同步给插件，不用重新配对。
2. 插件只在本机装来验证，不 bump tag、不发版；App 版本由用户定为 `0.1.0`。

## 10. 落地时的偏差与补记

- `pairing-store` 的 `id` **一律由 `(hub, instance, user)` 现算**，不读回存储里的 `id`：
  否则一份被改过的 v1/v2 文件能造出与去重键不符的行，重新配对就会多出一条。
- 切换连接必须在 `connect` 回调里 `activateHub`（每次拨号都激活当前 host 的锚点），
  而不是只在开机和配对时各做一次 —— 这是 §5 坑 1 的实现方式。
- `connections.summary` / `settings.deviceName*` 是为了让设置页能在一行里说明"现在连的是哪台"
  与"这台手机叫什么"，见 `apps/mobile/src/i18n.tsx`。
- **本机联调时抓到的真 bug（已修）**：插件 `src/index.ts` 的 `sameConfig` 是手写的逐字段比较，
  上一轮加了 `instanceName` 却漏了这一处，于是应用配置时它永远判定"没变" —— 控制台保存
  本机名称会正确写进 profile patch，但运行中的桥不会重建，手机上看不到新名字（表象是
  "要再存一次、或者重启 dsh 才生效"）。修法两条：
  1. 补上 `instanceName` 的比较；`tests/config.spec.ts` 增加一条**漂移守卫**——按 schema 的
     每个字段各改一次，`sameConfig` 必须全部判为不同，避免以后再加字段时重蹈覆辙。
  2. 控制台的 `/api/config` 在 `settings.update` 成功后直接用这次的 patch 应用一次
     （`applyConfig` 自带比较，等值的 `loader/volatile-update` 随后到达也是空操作），
     不再单纯依赖那个事件。
- 本机实测（2026-10-05，web profile 换成本仓库构建的 0.2.23）：
  保存「本机名称」立即生效（`/api/status` 的 `instanceName` 同步变化）；
  手机侧 `pair` 带设备名 → `mobile.info` 回 `instanceName` → `hello` 带新设备名后
  控制台设备列表那一行跟着改名（用 `nats://127.0.0.1:4222` 上的脚本探针验证，
  探针设备已 `revoke` + `forget`，配置里的临时值已还原）。
