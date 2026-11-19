# Review Round 14: Normalization + Variant Deltas

Date: 2026-05-22
Status: Passed

## Scope

- Verify legacy Deep Research reports normalize into the new quorum/source-diversity model.
- Verify AutoResearch variants explain regressions at case level, not only aggregate score level.
- Verify UI surfaces variant regressions without breaking old eval reports.
- Re-run focused tests, typecheck, mock suite, and source size scan.

## Findings

### R14-F1. Research store loaded legacy reports without rebuilding new source diversity fields

Severity: High

Fix:

- Added load-time research report normalization.
- Rebuilt evidence matrices from persisted provider results.
- Recomputed summary quorum counts, unique source count, and average source diversity.

### R14-F2. Research audit did not expose cross-validation strength

Severity: Medium

Fix:

- Added unique source count and average source diversity to research audit reasons.

### R14-F3. Variant score deltas did not identify which eval cases regressed

Severity: High

Fix:

- Added per-case baseline/candidate comparisons for policy variants.
- Added regression/improvement counts.
- Added variant gate failure reason when cases regress.
- Surfaced top variant regressions in the eval panel.

### R14-F4. Eval runner exceeded source size boundary after diagnostics expansion

Severity: Medium

Fix:

- Split scoring, failure reasons, and variant case comparison helpers into `memory-ops-eval-diagnostics.ts`.

## Verification

- `npx vitest run src/lib/memory-ops-eval.test.ts src/lib/memory-ops-eval-store.test.ts src/lib/memory-ops-research-store.test.ts` passed: 3 files, 12 tests.
- `npm run typecheck` passed.
- `npm run test:mocks` passed: 172 files, 1576 tests.
- Source size scan passed for touched files; largest touched source is `src/lib/memory-ops-eval.ts` at 326 lines after splitting diagnostics.
