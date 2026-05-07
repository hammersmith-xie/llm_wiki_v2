# Round 1 Review - Functional Closure

## Findings

### Fixed: search audit did not preserve all retrieval stream contributions

- **Severity**: Important
- **Files**: `src/lib/audit-events.ts`, `src/lib/audit-events.test.ts`
- **Issue**: `appendSearchAuditEvent` summarized streams from `graphPath` only, so results with `SearchResult.retrieval.token/bm25/vector/graph` were audited as only `lexical` plus optional `graph`.
- **Impact**: The audit timeline could not fully explain BM25/vector/RRF participation, which weakened F1/F5 and the README/schema claim that retrieval contributions are inspectable.
- **Fix**: `streamsForSearchResult` now reads `result.retrieval` first and records `token`, `bm25`, `vector`, and `graph` when present, with the older `lexical`/`graphPath` fallback kept for legacy callers.

## Functional Checklist

- F1 audit events: query, search, review, crystallize, Memory Ops patrol/preview/apply/ignore all have code paths and tests or UI integration.
- F2/F3 lifecycle and typed relation suggestions: covered by Memory Ops evidence/rules tests and patrol UI.
- F4/F5 search: BM25 scorer, lexical adapter, RRF contribution fields, and search eval summaries are present.
- F6 maintenance hooks: high-frequency query/search/review paths record lightweight maintenance events, not full scans.
- F7 governance: security review exists and HTTP capability was simplified; broad asset scope is documented.
- F8 UI: Maintenance page exposes categories, preview/apply/ignore/open, recent audit, loading/error/empty states.
- F9 docs/schema: README, README_CN, TS templates, and Rust new-project schema describe the local v2 loop.

## Verification

- `npx vitest run src/lib/audit-events.test.ts` - 4 tests passed.
- `npm run typecheck` - passed.
