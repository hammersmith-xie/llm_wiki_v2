# Review Round 2 — 类型 & 静态分析视角

**日期**: 2026-05-07
**视角**: 类型 & 静态分析
**审核范围**: LLM Wiki v2 产品化治理闭环全部已完成任务
**关联需求**: [`requirements.md`](./requirements.md)
**关联任务**: [`tasks.md`](./tasks.md)

---

## 审核清单

- [x] 运行 `npm run typecheck`。
- [x] 运行 `npx tsc --noEmit --pretty false`。
- [x] 扫描新增代码中的 `as`、`unknown`、`any`、`@ts-ignore`、eslint disable。
- [x] 运行 `npx vitest run src/lib/memory-ops-policy.test.ts src/lib/audit-timeline-ui.test.ts src/i18n/i18n-parity.test.ts`。

---

## 发现

### 🔴 P0 — 必须立刻修

无。

### 🟡 P1 — 应该尽快修

无。

### 🟢 P2 — 改进建议

#### Finding #1: Timeline select 使用当前 state 类型作断言

- **位置**: `src/components/settings/sections/audit-timeline-panel.tsx`
- **现象**: `event.target.value as typeof scope/status/limit` 可读性差，类型含义依赖当前变量名。
- **影响**: 不是运行时 bug，但后续维护者难以判断断言目标。
- **修复**: 增加 `AuditTimelineScopeOption`、`AuditTimelineStatusOption`、`AuditTimelineLimitOption` 显式 union 类型。

#### Finding #2: Policy dirty 判断依赖 JSON.stringify

- **位置**: `src/components/settings/sections/memory-ops-policy-panel.tsx`
- **现象**: dirty state 通过 `JSON.stringify(draft) !== JSON.stringify(policy)` 判断。
- **影响**: 当前结构稳定时可工作，但静态可读性弱，字段变动时不容易发现比较语义。
- **修复**: 改成 `memoryOpsPolicyEquals` 显式比较所有 policy 字段。

---

## 修复

| Finding | Commit | 状态 | 备注 |
|---------|--------|------|------|
| #1 | 本轮提交 | ✅ | 显式 option union |
| #2 | 本轮提交 | ✅ | 显式 policy equality |

---

## 修复后验证

- [x] `npm run typecheck` 通过。
- [x] `npx tsc --noEmit --pretty false` 通过。
- [x] `npx vitest run src/lib/memory-ops-policy.test.ts src/lib/audit-timeline-ui.test.ts src/i18n/i18n-parity.test.ts` 通过。

---

## 下一轮关注点

Round 3 性能视角重点看 timeline 渲染数量、policy 保存后 patrol rerun、Search Health 手动运行路径是否避免无谓高频计算。

---

## 总结

- 本轮共发现 2 个问题（P0: 0、P1: 0、P2: 2）。
- 已修 2 个，留 0 个到下一里程碑。
- 类型检查干净，新增代码没有发现未解释的 `any` 或 TS suppression。
