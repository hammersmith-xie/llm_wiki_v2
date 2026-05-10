# Review Round 1 — 功能完整性

**日期**: 2026-05-10  
**视角**: 对照 requirements/tasks 检查功能是否落地

## 结论

本轮 local-first closure 的范围已经落地：文档边界、post-ingest lint hints、Marp/CSV 本地导出、confidence stale badge、app-resident local maintenance daemon、daemon reminder banner 都有实现和 focused tests。

## 发现与修复

### R1-F1: Policy 面板未暴露 daemon 开关和 15 分钟检查间隔

**严重度**: 中  
**影响**: `MemoryOpsAutomationPolicy` 已新增 `maintenanceDaemonEnabled` 和 `maintenanceCheckIntervalMinutes`，但 Settings 的 Lifecycle policy 面板最初没有可编辑控件，用户无法从 UI 调整 local daemon 策略。

**修复**:
- `src/components/settings/sections/memory-ops-policy-panel.tsx` 新增 local daemon 开关和 check interval 输入。
- `src/i18n/en.json` / `src/i18n/zh.json` 增加文案。
- `src/components/settings/sections/memory-ops-policy-panel.test.tsx` 覆盖显示。

## 核对

- F1/F2 文档收口: 已完成。
- F3 post-ingest lint hints: 已完成。
- F4 Marp/CSV export: 已完成。
- F5 confidence stale badge: 已完成。
- F6 local daemon: 已完成，并补齐 Settings policy UI。

## 验证

- `npm run test:mocks -- src/components/settings/sections/memory-ops-policy-panel.test.tsx src/i18n/i18n-parity.test.ts src/lib/memory-ops-policy.test.ts` 通过。
