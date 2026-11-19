# Memory Ops Optimization for llm_wiki_v2

## Background

`llm_wiki_v2` already has a broad Memory Ops system: audit timeline, lifecycle patrol, claim health, provenance repair, historical conflict patrol, batch apply/ignore, rollback, schema quality summaries, search health, consolidation queue, policy tuning, and an app-resident local maintenance daemon.

The current optimization need is not a new product direction. The main pressure points are engineering shape and operational ergonomics:

- `src/lib/memory-ops.ts` is 1000+ lines and mixes scan orchestration, evidence construction, maintenance scheduling, auto-patrol, audit writing, and filesystem reading.
- `src/components/settings/sections/memory-ops-patrol-block.tsx` is 860+ lines and mixes patrol summary, claim repair/backfill, schema summary, batch result, rollback UI, and recent audit rendering.
- `src/components/settings/sections/maintenance-section.tsx` owns many unrelated Maintenance workflows and has duplicated patrol-reset logic.
- `scanMemoryOpsProject()` eagerly reads wiki pages, audit events, review state, conversations, chat messages, claims, typed graph, schema quality summary, and self-healing data for every patrol.
- Suggestion UI only renders the first 4 suggestions per category, which prevents large patrol output from being fully inspectable without a clear expand/search workflow.
- The patrol report does not expose stage timing, cache hit/miss, or scan scope details, so performance regressions are hard to diagnose.

This spec defines a focused optimization pass: preserve the existing user-facing behavior while making Memory Ops easier to maintain, faster to diagnose, and better at handling large projects.

## Goals

- Split Memory Ops core into smaller modules with stable pure-function boundaries.
- Add stage-level telemetry to Memory Ops scans and patrol reports.
- Add bounded scan options so callers can skip chat/self-healing/heavy conflict work when they only need a lightweight status or preview.
- Remove duplicated patrol reset logic in Maintenance UI.
- Make suggestion lists scalable with expand/show-all or local filtering while preserving batch actions.
- Improve policy explainability: show why a patrol is due, when the next patrol can run, and which gates are blocking auto-patrol.
- Add focused tests that lock in scan options, telemetry, UI list behavior, and policy explanation.

## Out Of Scope

- No new remote memory server, graph database, agentmemory runtime, or cloud sync.
- No change to source of truth: Markdown/frontmatter and `.llm-wiki/` files remain canonical.
- No automatic destructive rewrite or deletion.
- No redesign of the whole Settings -> Maintenance workbench.
- No change to claim provenance repair semantics or schema-quality rules.
- No visual overhaul beyond Memory Ops list/status ergonomics.

## Current Evidence

- `memory-ops.ts`: 1009 lines.
- `memory-ops-rules.ts`: 697 lines.
- `memory-ops-patrol-block.tsx`: 862 lines.
- `maintenance-section.tsx`: owns patrol, policy, audit, schema, search health, consolidation, dedup, claim repair, rollback, and queue state.
- `MemoryOpsSuggestionGroups` truncates each category to 4 rows with `suggestions.slice(0, 4)` and offers no show-all or search control.
- `handlePatrol()` and `runPatrolAfterPolicyChange()` duplicate reset/run/refresh state handling.
- `scanMemoryOpsProject()` calls `readChatMessages()` and `buildSelfHealingSummary()` unconditionally.

## User Stories

- As a large-project user, I can run Memory Ops and see which stage took time, rather than just waiting on a generic "Scanning wiki and memory state..." state.
- As a user reviewing many suggestions, I can inspect or filter all suggestions in a category instead of seeing only the first 4.
- As a cautious user, I can understand why auto-patrol did or did not run: event threshold, cooldown, min interval, time interval, daemon enabled, or auto-patrol disabled.
- As a developer, I can change lifecycle rules or UI pieces without editing 1000-line modules.
- As a developer, I can write tests for scan orchestration without mocking every Memory Ops subsystem.

## Functional Requirements

### F1. Core Module Boundaries

Split `src/lib/memory-ops.ts` responsibilities into smaller modules while preserving public exports:

- `memory-ops-scan.ts`: project snapshot scanning, wiki page reading, chat/message loading, claim health summary.
- `memory-ops-evidence.ts`: page evidence construction, audit path matching, recent use/reinforcement/source/risk summaries.
- `memory-ops-maintenance.ts`: maintenance event reduction, status summaries, cooldowns, due reasons.
- `memory-ops-autopatrol.ts`: in-flight guard, auto-patrol scheduling, failure audit.
- Keep `memory-ops.ts` as a thin facade that re-exports stable public types/functions.

Acceptance:

- Existing imports from `@/lib/memory-ops` continue to work.
- Focused Memory Ops tests still pass after module split.
- New module tests cover evidence and maintenance logic without filesystem mocks.

### F2. Scan Options and Stage Telemetry

Add `MemoryOpsScanOptions` fields:

- `includeChatMessages?: boolean` default `true`.
- `includeSelfHealing?: boolean` default `true`.
- `includeHistoricalConflicts?: boolean` default controlled at patrol layer.
- `maxChatConversations?: number` optional guardrail.
- `maxAuditEvents?: number` optional report/read cap if supported by audit helper.

Add telemetry:

- `MemoryOpsScanStageTiming { stage, ms, itemCount? }`.
- `snapshot.scanTelemetry` with stage timings for policy/schema load, wiki read, graph extraction, audit read, review read, chat read, claim read, evidence attach, self-healing.
- `MemoryOpsPatrolReport.stats.scanDurationMs`.
- `memory_ops.patrol` audit `after.stats` includes total duration and stage timing summary without paths or content.

Acceptance:

- Tests can assert chat loading is skipped when `includeChatMessages: false`.
- Tests can assert self-healing summary is empty/skipped when `includeSelfHealing: false`.
- Patrol report includes non-negative stage timing values.

### F3. Lightweight Status / Preview Mode

Provide a lightweight scan mode for UI/status checks:

- `scanMemoryOpsProject(projectPath, { includeChatMessages: false, includeSelfHealing: false })`.
- `runMemoryOpsPatrol()` keeps full behavior by default.
- Auto-patrol may use full patrol, but local maintenance due checks must not trigger heavy scans.

Acceptance:

- Existing `getMemoryOpsMaintenanceStatus()` remains lightweight and does not read wiki/chat/audit.
- A new focused test proves lightweight scan does not call chat file reads.
- README or docs clarify that due checks are cheap; patrol is the heavy operation.

### F4. Maintenance UI State Consolidation

Reduce duplication in `maintenance-section.tsx`:

- Extract `resetMemoryOpsRunState()` helper for ignored/applied/dry-run/selection/batch/rollback state.
- Extract `runMemoryOpsPatrolAndRefresh()` helper used by manual patrol and policy-change patrol.
- Keep existing event handlers behavior unchanged.

Acceptance:

- No duplicated reset block between manual patrol and policy-change patrol.
- Focused UI tests still pass.
- Typecheck passes.

### F5. Scalable Suggestions UI

Improve `MemoryOpsSuggestionGroups` for large suggestion sets:

- Category header shows total, visible, selected, and batch-applicable counts.
- Replace hard `slice(0, 4)` truncation with one of:
  - per-category expand/collapse with "show all / show less", or
  - local text filter plus default collapsed preview.
- Batch category selection can select all eligible suggestions in the category, not only currently visible rows.
- Preserve no-overlap dense layout.

Acceptance:

- Tests cover a category with more than 4 suggestions and verify hidden suggestions can be revealed or filtered.
- Tests cover "select category" selecting all eligible suggestions.
- Existing batch preview/apply/ignore semantics remain unchanged.

### F6. Policy Explanation

Add a pure helper such as `explainMemoryOpsMaintenanceStatus(status, policy, now)` that returns:

- `summary`.
- `dueReasons`.
- `blockingGates`: auto patrol disabled, daemon disabled, cooldown not elapsed, min interval not elapsed, threshold not reached, time interval not reached.
- `nextEligibleAt?`.

Use it in `MemoryOpsPatrolBlock` and/or `MemoryOpsPolicyPanel` to show concise, actionable text.

Acceptance:

- Tests cover event threshold due, time interval due, cooldown blocked, min interval blocked, auto patrol disabled, and clean state.
- UI shows at least one concrete reason/gate when patrol is dirty or due.

### F7. Review / Audit Output

Document the optimization with a completion report:

- Updated task notes.
- Review round covering functionality, performance, maintainability, and UI behavior.
- Validation commands and results.

Acceptance:

- `docs/llm-wiki-v2-memory-ops-optimization/review-round-1.md` exists.
- `requirements.md` and `tasks.md` reflect implementation decisions if the plan changes.

## Non-Functional Requirements

- Backward compatibility: public imports from `@/lib/memory-ops` must remain stable.
- Privacy: telemetry must not include page content, chat content, claims text, snippets, or secrets.
- Performance: telemetry collection should use cheap `performance.now()` / `Date.now()` timing and should not add extra filesystem reads.
- UI: Memory Ops cards must remain usable in a narrow Settings panel; text wraps rather than overflowing.
- Testability: new pure helpers should not depend on Zustand stores or Tauri fs mocks.

## Suggested Implementation Order

1. Add telemetry types and pure timing helper without behavior change.
2. Add scan options and tests for skipping chat/self-healing.
3. Split evidence and maintenance pure helpers from `memory-ops.ts`.
4. Split scan/autopatrol orchestration while preserving facade exports.
5. Consolidate Maintenance UI patrol reset/run helpers.
6. Add suggestion group expand/filter behavior.
7. Add policy explanation helper and UI text.
8. Run focused Memory Ops/UI tests, typecheck, and full mock regression.

## Risks

- Module split can create import cycles because `memory-ops-rules.ts` imports snapshot/page types from `memory-ops`. Mitigation: move shared types to `memory-ops-types.ts` first, then re-export from facade.
- UI tests may need updates if visible suggestion counts change. Mitigation: preserve labels and add explicit tests for show-all behavior.
- Stage telemetry could make tests flaky if exact durations are asserted. Mitigation: assert non-negative numbers and stage names only.
- Skipping chat/self-healing could accidentally change full patrol behavior. Mitigation: full patrol defaults remain unchanged and existing patrol tests continue to cover default path.
