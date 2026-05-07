# LLM Wiki v2 Completion Audit

## Scope

This audit maps `plans/llm-wiki-v2-SPEC.md` requirements to concrete files and
verification evidence in the repo.

## Requirement Evidence

| Requirement | Status | Evidence |
| --- | --- | --- |
| `V2-SPEC-001` lifecycle metadata model | Done | `src/lib/lifecycle.ts` defines lifecycle, confidence, reasons, confirmation, reinforcement, supersession, quality, review status, and scope. |
| `V2-SPEC-002` deterministic scoring | Done | `calculateLifecycleMetadata` in `src/lib/lifecycle.ts`; tested by `src/lib/lifecycle.test.ts`. |
| `V2-SPEC-003` typed graph extraction | Done | `src/lib/typed-graph.ts` extracts `related_to`, `uses`, `depends_on`, `contradicts`, `supersedes`, `supports`, `derived_from`, and `mentions`; tested by `src/lib/typed-graph.test.ts`. |
| `V2-SPEC-004` graph stream in RRF | Done | `src/lib/search.ts` builds typed graph, ranks graph traversal candidates, materializes graph-only pages, and fuses token/vector/graph ranks. |
| `V2-SPEC-005` preserve search behavior | Done | `src/lib/search-rrf.test.ts` covers vector-only, token-only, disabled embeddings, nonexistent vector ids, comparison-page materialization, and graph-only results; `npm run test:mocks` passed. |
| `V2-SPEC-006` ingest lifecycle hook | Done | `src/lib/ingest.ts` enriches merged content pages with lifecycle frontmatter and writes best-effort audit events without failing ingest. |
| `V2-SPEC-007` lifecycle lint signals | Done | `src/lib/lint.ts` appends deterministic lifecycle semantic warnings; `src/lib/lint.test.ts` covers superseded-page warning behavior. |
| `V2-SPEC-008` append-only audit helper | Done | `appendLifecycleAuditEvent` in `src/lib/lifecycle.ts`; tested in `src/lib/lifecycle.test.ts`; crystallization tested in `src/lib/crystallize.test.ts`. |
| `V2-SPEC-009` deep-dive artifact | Done | `plans/llm-wiki-v2-deep-dive.md` compares v1, v2, current code, gaps, chosen slice, non-goals, and verification evidence. |
| `V2-SPEC-010` deterministic tests | Done | Added lifecycle, typed graph, graph RRF, lifecycle lint, page merge, prompt/template, and crystallization tests. |
| `V2-SPEC-011` schema and prompt contract | Done | `src/lib/templates.ts`, `src-tauri/src/commands/project.rs`, and `src/lib/ingest.ts` describe v2 lifecycle and typed edge fields; tested by `src/lib/templates.test.ts` and `src/lib/ingest.prompt.test.ts`. |
| `V2-SPEC-012` preserve typed arrays across merge | Done | `src/lib/page-merge.ts` unions v2 typed relationship arrays; tested by `src/lib/page-merge.test.ts`. |
| `V2-SPEC-013` visible lifecycle/search evidence | Done | `src/components/editor/frontmatter-panel.tsx` surfaces lifecycle/confidence/review chips; `src/components/search/search-view.tsx` shows graph traversal path evidence. |
| `V2-SPEC-014` concrete crystallization | Done | `src/lib/crystallize.ts` writes v2 query pages for saved outputs; wired into `src/components/chat/chat-message.tsx`, `src/lib/deep-research.ts`, and `src/components/review/review-view.tsx`; tested by `src/lib/crystallize.test.ts`. |

## Follow-Up Patrol Fixes

The May 7 follow-up patrol passes found and fixed eleven concrete issues:

- Typed graph cache was keyed only by `dataVersion`; it is now keyed by both
  normalized project path and data version so switching projects cannot reuse
  another project's graph.
- Retrieval graph cache was also keyed only by `dataVersion`; it now uses the
  same normalized project path plus data version cache key so chat/wiki graph
  related-page suggestions cannot leak across projects.
- Project reset now clears the new typed graph cache as well as the older
  retrieval graph cache, preventing stale v2 graph traversal data after
  same-path project resets.
- Lifecycle enrichment now preserves the SPEC's string-scalar contract for
  `confidence`, `quality_score`, and `reinforcement_count` instead of rewriting
  them as bare YAML numbers.
- Lifecycle confidence scoring now normalizes `review_status` before applying
  contradiction penalties, so `Contradicted` and `contradicted` behave the same.
- Business/ADR templates no longer redefine `supersedes` as a scalar field; the
  v2 slug-array contract now stays consistent across all templates.
- Deep-research and review-save crystallization now use the same Unicode-safe,
  timestamped query filename policy as chat saves, avoiding empty CJK slugs and
  same-day filename collisions.
- Review-save crystallization now mirrors chat/deep-research by triggering
  guarded auto-ingest when an LLM provider is usable, so saved review answers can
  populate entity/concept pages and the knowledge graph.
- The per-project auto-ingest mutex now correctly removes settled tail locks,
  preventing lock-table growth as v2 crystallization entry points trigger more
  background ingest work.
- Vector-only materialization looked in `wiki/comparison/`; it now uses the
  actual `wiki/comparisons/` directory.
- Crystallized query pages now write `reinforcement_count` from cited wiki-page
  count so the lifecycle confidence model receives the session's reinforcement
  signal.

## Verification Commands

- `npm run typecheck`: passed.
- `npm run test:mocks`: passed, 73 files and 1047 tests.
- `zsh -lc 'cargo check'` from `src-tauri/`: passed with 8 existing Rust
  warnings unrelated to this v2 implementation.
- Follow-up focused tests for typed graph cache isolation, retrieval graph cache
  isolation, project reset cache clearing, lifecycle string-scalar output,
  review-status normalization, comparison-page vector materialization, and
  crystallization reinforcement passed. Project mutex tests cover lock cleanup,
  and template tests also guard against scalar redefinitions of v2 relationship
  arrays.

## Cargo Setup

`cargo` was present through rustup's installed stable toolchain but was not on
the default shell `PATH`. The local user environment was repaired by creating
standard rustup shims under `~/.cargo/bin` and adding that directory to zsh
login/interactive startup files. `zsh -lc 'cargo --version && rustc --version'`
now resolves both tools.

## Remaining Non-Goals

- No remote backend, database, auth, or multi-user ACL.
- No autonomous background crystallization of every chat session.
- No claim/span-level provenance.
- No rewrite of the existing visual graph view onto the typed graph helper.
- No destructive automatic stale-content repair.
