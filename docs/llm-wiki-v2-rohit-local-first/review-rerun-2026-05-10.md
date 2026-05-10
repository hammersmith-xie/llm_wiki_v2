# 二次 dev-spec-flow 复核 — 2026-05-10

## 复核范围

- Rohit LLM Wiki v2 gist 的 automation / lifecycle / quality controls / output formats 方向。
- `requirements.md`、`tasks.md`、5 轮最终审核报告。
- 当前实现中的 local-first daemon、stale confidence、Maintenance 设置入口、post-ingest lint hints、Marp/CSV export。

## 结论

本期 local-first 收口方向仍成立：Markdown 是 source of truth，`.llm-wiki/` 是可重建派生状态；daemon 是 app-resident 本地维护循环，默认每 15 分钟做轻量 due check，不是远程服务或 OS 常驻进程。

二次复核发现 2 个闭环遗漏，均已补齐：

1. `Run patrol` / `Open Settings` 只切到 Settings 顶层，用户仍会落在默认 LLM 设置页；已补为 Settings -> Maintenance 深链路。
2. `requirements.md` 的验收标准仍保持未勾选状态，不能反映已通过的交付；已按实际实现和验证状态勾选本期已完成项，保留下一期开放问题。

## 修复记录

### RR6-F1: Maintenance 入口没有深链路

**风险**: 用户看到 stale confidence 或 daemon reminder 后，点击入口不能直接到维护操作区，Rohit gist 强调的 periodic maintenance / human-in-loop review 会在 UX 上断开。

**修复**:

- 新增 `settings-navigation-store` 保存一次性 settings 子分类请求。
- 新增 `openMaintenanceSettings` helper，统一“请求 Maintenance 分类 + 切到 Settings”。
- `ConfidenceStaleBadge` 和 `LocalMaintenanceBanner` 都复用该 helper。
- `SettingsView` 挂载或已打开时消费请求并切到 Maintenance。

**验证**:

- `npm run test:mocks -- src/lib/open-maintenance-settings.test.ts`

### RR6-F2: dev-spec-flow 文档状态未闭环

**风险**: 实现已经完成，但 requirements 的验收框仍是 `[ ]`，后续 review 容易误判为未完成。

**修复**:

- `requirements.md` 状态改为“已完成（二次 dev-spec-flow 复核通过）”。
- F1-F6 本期已实现验收项改为 `[x]`。
- daemon 默认 15 分钟、复用 `autoPatrolEnabled` 的用户决策改为已确认。
- `tasks.md` 增加二次复核记录和 review 索引。

## 保留的下一期问题

- OS 级本地 daemon / LaunchAgent 是否独立推进。
- Marp theme 是否从固定 `default` 扩展为可选 `gaia` / `uncover`。

## 验证结果

- Focused test: `npm run test:mocks -- src/lib/open-maintenance-settings.test.ts src/stores/settings-navigation-store.test.ts src/components/layout/local-maintenance-banner.test.tsx src/components/editor/confidence-stale-badge.test.tsx` 通过，4 个 test files / 7 个 tests。
- Static type check: `npm run typecheck` 通过。
- Full mock regression: `npm run test:mocks` 通过，147 个 test files / 1420 个 tests。
