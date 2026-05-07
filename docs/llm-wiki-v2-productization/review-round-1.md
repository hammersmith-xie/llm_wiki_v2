# Review Round 1 — 功能视角

**日期**: 2026-05-07
**视角**: 功能
**审核范围**: LLM Wiki v2 产品化治理闭环全部已完成任务
**关联需求**: [`requirements.md`](./requirements.md)
**关联任务**: [`tasks.md`](./tasks.md)

---

## 审核清单

- [x] 对照 F1-F7 功能需求逐项核对实现。
- [x] 复盘用户场景：batch、rollback、timeline、policy、search health。
- [x] 检查任务验收项是否真正满足，而不是只完成备注。
- [x] 运行 `npm run typecheck`。
- [x] 运行 `npx vitest run src/lib/audit-timeline-ui.test.ts src/lib/search-health.test.ts src/i18n/i18n-parity.test.ts`。

---

## 发现

### 🔴 P0 — 必须立刻修

无。

### 🟡 P1 — 应该尽快修

#### Finding #1: Timeline 面板未暴露时间范围过滤

- **位置**: `src/components/settings/sections/audit-timeline-panel.tsx`
- **现象**: 纯函数支持 `dateFrom/dateTo`，需求也写了 time range，但 UI 只暴露 category/action/path/scope/status/text/limit。
- **影响**: 用户无法按时间窗口追踪操作因果链。
- **修复**: 增加 `datetime-local` 的 From/To 控件，并传入 `AuditTimelineUiFilter`。

#### Finding #2: Lifecycle Policy 保存未写 policy update audit

- **位置**: `src/components/settings/sections/maintenance-section.tsx`
- **现象**: Search Health、batch、rollback 都写 audit；policy 保存只写 project store。
- **影响**: 治理策略变更没有审计链，和可观测性要求不一致。
- **修复**: 保存 policy 后 best-effort 写入 `memory_ops.policy_update` audit；audit 失败不阻断已保存策略和 patrol rerun。

#### Finding #3: Search Health 失败详情未明确 expected/actual

- **位置**: `src/components/settings/sections/search-health-panel.tsx`
- **现象**: UI 展示 failure message 和 top-k paths，但 expected path、expected rank/top-k、actual rank 没有结构化呈现。
- **影响**: 用户排查搜索退化时需要反读 message。
- **修复**: 在 failure 行补充 expected、expected rank/top-k、actual rank 元信息。

#### Finding #4: Maintenance Workbench 没有按 spec 分区

- **位置**: `src/components/settings/sections/maintenance-section.tsx`
- **现象**: Patrol、Timeline、Policy、Search Health 串行堆叠在 Maintenance 页面中。
- **影响**: 页面过重，和 F6 的 tabs/segmented control 分区目标不一致。
- **修复**: 增加轻量 workbench tabs：Patrol、Timeline、Policy、Search Health。

### 🟢 P2 — 改进建议

无。

---

## 修复

| Finding | Commit | 状态 | 备注 |
|---------|--------|------|------|
| #1 | 本轮提交 | ✅ | Timeline UI 增加 From/To |
| #2 | 本轮提交 | ✅ | Policy update audit best-effort |
| #3 | 本轮提交 | ✅ | Search Health failure meta |
| #4 | 本轮提交 | ✅ | Maintenance Workbench tabs |

---

## 修复后验证

- [x] `npm run typecheck` 通过。
- [x] `npx vitest run src/lib/audit-timeline-ui.test.ts src/lib/search-health.test.ts src/i18n/i18n-parity.test.ts` 通过。
- [x] 重新对照 F1-F7，Round 1 发现已修复。

---

## 下一轮关注点

Round 2 类型 & 静态分析重点检查新增 UI 的类型断言、动态 i18n key、`unknown`/`as` 使用是否有合理边界。

---

## 总结

- 本轮共发现 4 个问题（P0: 0、P1: 4、P2: 0）。
- 已修 4 个，留 0 个到下一里程碑。
- 整体功能闭环达成，下一轮进入类型和静态分析。
