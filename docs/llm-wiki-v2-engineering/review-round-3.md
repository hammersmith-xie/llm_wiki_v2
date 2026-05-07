# Round 3 Review - Performance

## Findings

No blocking or important performance regressions found in the v2 engineering slice.

## Checks

- High-frequency paths (`search.run`, `query.answer`, `review.resolve`) call `recordMemoryOpsMaintenanceEvent`, which updates persisted cooldown state and may add an activity reminder. They do not call `scanMemoryOpsProject` or `runMemoryOpsPatrol`.
- `runMemoryOpsPatrol` remains behind the Settings -> Maintenance manual action.
- Search still lists and reads `wiki/` markdown pages only for lexical/BM25 ranking; it does not restore the previous raw-source token scan.
- RRF explanation is attached while iterating already-materialized candidates and does not introduce additional file reads.

## Residual Risk

- There is no automated p95 benchmark for search latency, so this round relies on code-path inspection and deterministic tests rather than measured latency budgets.
- Memory Ops patrol is still an O(number of wiki pages + audit events) operation. It is acceptable as a manual maintenance action, but large projects may need pagination or incremental patrol later.

## Verification

- `npx vitest run src/lib/search-bm25.test.ts src/lib/search-eval.test.ts src/lib/search-rrf.test.ts src/lib/memory-ops.test.ts` - 4 test files passed, 22 tests passed.
- `rg -n "runMemoryOpsPatrol\\(|scanMemoryOpsProject\\(|recordMemoryOpsMaintenanceEvent\\(" src` - only Maintenance UI and tests call full patrol/scan; audit hooks call the lightweight maintenance event reducer.
