# Review Round 5 — UX 与可访问性

**日期**: 2026-05-10  
**视角**: UI 文案、可读性、按钮 label、i18n

## 结论

新增 UI 都有文本说明，不只靠颜色：post-ingest lint badge 显示数量和 source；confidence stale badge 显示天数和 half-life；local maintenance banner 显示 due reason、event count、dirty 天数和 last patrol 天数。

## 发现与修复

### R5-F1: 本 session dismiss 会被同一 due 状态反复打断

**严重度**: 中  
**影响**: daemon 每 15 分钟再次写入同一 reminder 时，早期 store 逻辑会重置 dismiss 状态，导致用户 dismiss 后同一 session 仍反复看到同一 banner。

**修复**:
- `src/stores/local-maintenance-store.ts` 的 dismiss key 改为 stable due key，不包含 `createdAt`。
- `setReminder` 在同一 due key 下保留 dismissed 状态；真正新的 due 状态仍会重新显示。
- `src/stores/local-maintenance-store.test.ts` 增加回归测试。

### R5-F2: Daemon policy UI 缺少轻量检查说明

**严重度**: 低  
**影响**: 用户可能把 15 分钟 check interval 理解成每 15 分钟跑完整 patrol。

**修复**:
- Settings policy 面板新增说明：“Lightweight due check only; not a full patrol interval.”
- 中文文案同步说明“这里只做轻量 due check，不代表每次都运行完整巡检。”

## i18n 状态

- Settings policy 新文案已同步 `en.json` / `zh.json`。
- 新增 banner/stale badge/export menu 仍有局部英文文案；本期已在 Task 5.2 备注中记录为后续 i18n 整理项，不影响 local-first 功能闭环。

## 验证

- `npm run test:mocks -- src/stores/local-maintenance-store.test.ts src/components/layout/local-maintenance-banner.test.tsx src/lib/local-maintenance-daemon.test.ts` 通过。
- `npm run test:mocks -- src/i18n/i18n-parity.test.ts` 通过。
