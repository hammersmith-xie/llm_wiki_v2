# Review Round 1 - Functional, Type, Test, and Docs

**Date**: 2026-05-15
**Focus**: Functional correctness, type safety, tests, dependency metadata, and documentation alignment
**Scope**: All Leiden community detection migration changes
**Requirements**: [requirements.md](./requirements.md)
**Tasks**: [tasks.md](./tasks.md)

---

## Review Checklist

- [x] Verified production code no longer imports or references Louvain.
- [x] Verified README, README_CN, and planning notes no longer describe Louvain as the current clustering algorithm.
- [x] Reviewed dependency diff for package replacement and lockfile consistency.
- [x] Reviewed `src/lib/wiki-graph.ts` to confirm return shapes remain unchanged.
- [x] Reviewed `src/lib/wiki-graph.test.ts` to confirm tests assert semantic partition behavior rather than fragile raw community ids.
- [x] Ran `npm run typecheck`.
- [x] Ran `npm run test:mocks`.
- [x] Ran global search for `Louvain`, `louvain`, and `graphology-communities-louvain`.

---

## Findings

### P0

None.

### P1

None.

### P2

#### Finding #1: Lockfile resolved URL used local npm mirror

- **Location**: `package-lock.json`
- **Observation**: The new Leiden package entry used `https://registry.npmmirror.com/...`, reflecting local npm config rather than the dominant existing lockfile convention.
- **Impact**: Low. Installs would still work, but it creates avoidable churn and can confuse future lockfile updates.
- **Fix**: Changed the new package `resolved` URL to `https://registry.npmjs.org/...` while preserving the same integrity hash.

#### Finding #2: Leiden test did not directly verify weighted input

- **Location**: `src/lib/wiki-graph.test.ts`
- **Observation**: The new community fixture described a weak bridge, but the default relevance mock returned weight `1` for every edge. This still tested semantic grouping, but it did not prove `weighted: true` receives the intended relevance weights.
- **Impact**: Low. Runtime code passed weights to Leiden, but the regression test could miss a future change that dropped or disabled weighted clustering.
- **Fix**: Wrapped the Leiden import in the test to capture options and graph edge weights, then configured the relevance mock to return strong intra-cluster weights and a weak bridge weight.

---

## Fixes

| Finding | Commit | Status | Notes |
|---|---|---|---|
| #1 | `f726885` | ✅ | Lockfile URL normalized to npmjs. |
| #2 | Pending follow-up review commit | ✅ | Test now asserts `weighted: true` and observes both strong and weak edge weights. |

---

## Post-Fix Verification

- [x] `npm run typecheck` passed.
- [x] `npm run test:mocks` passed: 155 files, 1474 tests.
- [x] `npm run build` passed; existing chunk-size and ineffective dynamic-import warnings are unrelated to this change.
- [x] `git diff --check` passed.
- [x] Global Louvain search returned no matches.

---

## Summary

This review found 2 low-severity issues and fixed both. No functional, type-safety, build, or test coverage issues remain from the Leiden migration.
