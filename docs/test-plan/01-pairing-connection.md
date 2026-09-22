# A. 配对、连接与兼容性

## 自动化验证

```bash
cd packages/core
pnpm --config.verify-deps-before-run=false vitest run tests/compatibility.spec.ts tests/connection-failure.spec.ts tests/nats-integration.spec.ts
```

```bash
cd apps/mobile
pnpm --config.verify-deps-before-run=false jest --runInBand --testPathPattern PairingScreen
```

## 用例

### A1 首次启动进入配对向导；扫码配对

- 前置条件：App 已安装，无已保存 token。
- 操作步骤：启动 App → 扫描 dsh 桌面端显示的二维码。
- 预期结果：扫码成功，`pairingStore` 写入连接参数与 device token，跳转会话列表。
- 自动化验证：`PairingScreen.test.tsx` 验证渲染与输入处理。
- 设备验证：需真机相机。

### A2 相机不可用/拒绝权限时粘贴兜底

- 前置条件：同 A1，但拒绝相机权限或设备无相机。
- 操作步骤：配对页点击"粘贴"→ 粘贴二维码 JSON 载荷 → 提交。
- 预期结果：与扫码路径一致，成功后进入会话列表。
- 自动化验证：`PairingScreen.test.tsx` 验证粘贴输入。
- 设备验证：需真机验证权限拒绝路径。

### A3 错误/过期配对码、设备数超限

- 前置条件：无有效 token。
- 操作步骤：输入已过期或错误的配对码；在已有 maxDevices 台设备绑定后尝试新设备。
- 预期结果：显示明确的错误文案（"配对码已过期" / "设备数已达上限"），不写入 token。
- 自动化验证：`PairingScreen.test.tsx` 覆盖错误状态。
- 设备验证：验证设备上限需多台设备。

### A4 配对后 `mobile.info` + `host.describe` 握手

- 前置条件：有效 token，宿主运行中。
- 操作步骤：配对成功后观察连接流程。
- 预期结果：`mobile.info` 与 `host.describe` 均成功，版本/能力匹配，进入 online 状态。
- 自动化验证：`compatibility.spec.ts` 验证版本匹配逻辑。
- 设备验证：需宿主 + 真机。

### A5 插件版本/能力不符阻断

- 前置条件：dsh-mobile-plugin 版本低于 App 要求或缺少 required feature。
- 操作步骤：连接时观察结果。
- 预期结果：阻断连接并提示"更新后重试"，不进入会话列表。
- 自动化验证：`compatibility.spec.ts` 覆盖。
- 设备验证：需降级 plugin 版本。

### A6 网络断开自动重连 + 基线重拉 + hello 重放

- 前置条件：已连接，有 pending approval/question。
- 操作步骤：关闭 WiFi 5 秒后重新打开。
- 预期结果：状态 disconnected → connecting → online；`resetLiveSnapshots()` 清空旧状态；服务端 hello 重放 pending approval/question；事件流重建。
- 自动化验证：`connection-failure.spec.ts` 验证重连与基线；`nats-integration.spec.ts` 验证 hello 重放。
- 设备验证：验证弱网切换的真实时序。

### A7 broker/宿主重启恢复

- 前置条件：已连接。
- 操作步骤：重启 NATS broker 或 dsh 宿主进程。
- 预期结果：指数退避重试最终成功，不卡在 connecting。
- 自动化验证：`connection-failure.spec.ts` + `nats-integration.spec.ts`。
- 设备验证：需控制 broker 生命周期。

### A8 无 token / 错误 token / 白名单外方法

- 前置条件：宿主运行中。
- 操作步骤：不带 token 请求、带错误 token 请求、带有效 token 请求白名单外方法。
- 预期结果：分别返回 `unauthenticated` / `unauthenticated` / `forbidden`。
- 自动化验证：`nats-integration.spec.ts` 覆盖。
- 设备验证：不适用（纯协议层）。

### A9 WSS TLS 与明文拒绝

- 前置条件：宿主配置了 HTTPS/WSS。
- 操作步骤：用 WSS 连接；用 ws:// 明文端口连接。
- 预期结果：WSS 成功；明文被拒绝或回显错误。
- 自动化验证：无（依赖网络层）。
- 设备验证：需真机网络环境。
