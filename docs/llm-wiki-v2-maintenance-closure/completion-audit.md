# Completion Audit — LLM Wiki v2 Maintenance Closure

**日期**: 2026-05-08
**状态**: 开发完成，等待最终 5 轮审核
**范围**: `docs/llm-wiki-v2-maintenance-closure/requirements.md` F1-F11

---

## F1-F11 验收矩阵

| 需求 | 结论 | 证据 |
|------|------|------|
| F1 Memory Ops maintenance candidate | ✅ 完成 | `src/lib/memory-ops-conflicts.ts` 将现有 `MemoryOpsWikiPage` 转为 `maintenance-page` candidate；`src/lib/prewrite-conflict.ts` 支持该 kind。 |
| F2 Historical conflict patrol | ✅ 完成 | `previewMemoryOpsHistoricalConflicts` 复用 pre-write conflict resolver/cache，保留 duplicate / possible-contradiction / supersession / uncertain，过滤 same-target update/new/reinforcement。 |
| F3 Historical conflict suggestions | ✅ 完成 | `preWritePreviewToMemoryOpsSuggestion` 生成 `review-action` suggestion，不带 `proposedOperation`，不能 batch apply。 |
| F4 Patrol stats and audit | ✅ 完成 | `runMemoryOpsPatrol` 合并 historical conflict suggestions，并在 stats/audit/UI summary 中记录 candidate/suggestion/warning counts。 |
| F5 Custom Search Health scenario model | ✅ 完成 | `src/lib/search-health-scenarios.ts` normalize `id/query/expectedTopPaths/expectedInTopK/expectedOutsideTopK/excludedPaths/topK`，坏配置转 skipped/warning。 |
| F6 Custom Search Health storage | ✅ 完成 | `loadSearchHealthScenarioConfig` / `saveSearchHealthScenarioConfig` 读写 `.llm-wiki/search-health-scenarios.json` pretty JSON。 |
| F7 Search Health combined run | ✅ 完成 | `combineSearchHealthScenarios` 合并 built-in/custom/skipped；`runSearchHealth` 把 sourceCounts 写入结果和 audit。 |
| F8 Search Health custom scenario UI | ✅ 完成 | `SearchHealthPanel` 支持新增、编辑、删除、保存 custom scenarios；`MaintenanceSection` 负责加载、normalize、保存。 |
| F9 Patrol reminder status model | ✅ 完成 | `MemoryOpsMaintenanceStatusKind = clean | dirty | reminder-due`；summary reducer 测试覆盖 threshold/cooldown/reset。 |
| F10 Patrol reminder UI | ✅ 完成 | `MemoryOpsPatrolBlock` 用三态 notice 展示 clean/dirty/reminder-due；reminder due 有明确文本标题和运行入口。 |
| F11 Documentation and completion audit | ✅ 完成 | README/README_CN、deep-dive plan、completion audit 和本文件说明三项闭环已落地，且仍无 daemon/自动裁决/自动合并。 |

---

## 边界确认

- Markdown pages 仍是 source of truth；claim index、search reports、audit、maintenance state 都是 derived/local maintenance layer。
- Historical conflict patrol 是显式 Memory Ops patrol 的一部分，不在 project open、render、query/search 高频路径自动运行。
- Historical conflict suggestions 是 review-only，不自动合并页面、不自动判断事实真假、不 batch apply。
- Search Health custom scenarios 是项目本地配置，用于回归评估和调权依据，不改变 ranking 算法。
- Patrol reminder 只保存 marker/cooldown state 并显示提醒；没有 cron、daemon、scheduled patrol 或后台全量扫描。

---

## 已通过的阶段性验证

- `npx vitest run src/lib/memory-ops-conflicts.test.ts`
- `npx vitest run src/lib/memory-ops.test.ts src/lib/memory-ops-rules.test.ts src/components/settings/sections/memory-ops-patrol-block.test.tsx`
- `npx vitest run src/lib/search-health-scenarios.test.ts src/lib/search-health.test.ts src/lib/search-eval.test.ts`
- `npx vitest run src/components/settings/sections/search-health-panel.test.tsx`
- `npx vitest run src/lib/wiki-automation-events.test.ts src/lib/chat-session-events.test.ts`
- `npx vitest run src/lib/memory-ops-ui.test.ts src/components/settings/sections/memory-ops-patrol-block.test.tsx src/lib/memory-ops.test.ts src/lib/memory-ops-conflicts.test.ts`
- `npm run typecheck`

最终 `npm run test:mocks` 和 5 轮审核将在 M5/M6 记录。
