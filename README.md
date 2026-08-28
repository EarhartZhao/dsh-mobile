# dsh-mobile

deepseek-harness 的移动端（Android / iOS）：实时查看本地 harness 的任务与会话，并能对话、审批。

方案文档见 [docs/](docs/)：

- [00-overview.md](docs/00-overview.md) — 总体方案与评估结论（外网拓扑 + NATS 内网穿透）
- [01-tech-stack.md](docs/01-tech-stack.md) — 技术选型（RN，Android/iOS）
- [02-protocol.md](docs/02-protocol.md) — 复用 harness `/api` 信封、NATS 传输映射
- [03-build-plan.md](docs/03-build-plan.md) — 构建计划（阶段、验收点、立即行动项）

配套桥接插件：[dsh-mobile-plugin](../dsh-mobile-plugin)。
