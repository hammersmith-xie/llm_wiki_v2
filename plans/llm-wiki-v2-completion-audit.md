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
| `V2-SPEC-012` preserve typed arrays across merge | Done | `src/lib/page-merge.ts` and `src/lib/dedup.ts` union v2 typed relationship arrays and graph seed arrays; tested by `src/lib/page-merge.test.ts` and `src/lib/dedup.test.ts`. |
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
- `npm run test:mocks`: passed, 80 files and 1082 tests.
- `cargo test` from `src-tauri/`: passed, 55 Rust tests passed, 1 local PDF
  probe ignored, and the previous Rust warnings were cleaned up.
- Follow-up focused tests for typed graph cache isolation, retrieval graph cache
  isolation, project reset cache clearing, lifecycle string-scalar output,
  review-status normalization, comparison-page vector materialization, and
  crystallization reinforcement passed. Project mutex tests cover lock cleanup,
  and template tests also guard against scalar redefinitions of v2 relationship
  arrays.

## Engineering Review Polish

- README now describes the implemented v2 local slice and names the search stack
  as lexical token search, optional LanceDB vectors, and typed graph RRF.
- `llm-wiki.md` now explicitly marks itself as the abstract pattern document, not
  the current desktop implementation spec.
- `plans/multimodal-images.md` now records that the image extraction/captioning
  plan has landed and points to the current implementation files.
- Code comments and tests no longer describe the current lexical fallback as
  BM25.
- Rust warning cleanup removed dead DOCX parsing state, replaced irrefutable
  table-pattern branches, removed an unused XLSX archive placeholder, renamed
  proxy tests to snake case, and preserved clip-server restart counting across
  unexpected server-loop exits.
- `cargo fmt` was applied to the Rust crate so `cargo fmt --check` is now clean.
- Visual knowledge graph now incorporates explicit v2 typed relationship arrays
  (`related`, `uses`, `depends_on`, `contradicts`, `supersedes`, `supports`) as
  graph edges, while keeping wikilinks and existing relevance/community helpers.
- Chat context graph expansion now also treats those explicit v2 typed
  relationship arrays as direct graph links via `src/lib/graph-relevance.ts`.
- Query-time typed graph traversal now seeds from lightweight frontmatter text
  (`alias`/`aliases`, `tags`, `keywords`, `summary`, `description`) in addition
  to page id/title, improving graph expansion for alias-style questions without
  caching full page bodies in graph nodes.
- Explicit typed relationship targets now also resolve through page
  `alias`/`aliases` metadata without overriding real page slugs/titles, so
  fields like `uses: [tavily]` can connect to `tavily-api.md`.
- Search result graph-path evidence now carries typed edge labels and original
  edge direction through `graphRankPages` and `searchWiki`, so the UI can show
  paths like `deep-research -[uses]-> tavily` or `tavily <-[uses]- deep-research`
  instead of only node ids.
- Page deletion cleanup now removes deleted slugs from v2 typed relationship
  arrays (`uses`, `depends_on`, `contradicts`, `supports`, `supersedes`,
  `superseded_by`) as well as `related`, preventing stale typed edges after
  user-driven deletes.
- Duplicate-page merge cleanup now rewrites those same v2 typed relationship
  arrays from merged-away slugs to the canonical slug, matching the existing
  wikilink and `related` rewrite behavior.
- Duplicate-page merge cleanup also normalizes frontmatter reference variants
  like `old_slug` and `old slug` when redirecting to the canonical slug, matching
  the wiki-delete cleanup's slug/title normalization behavior.
- Page deletion cleanup now uses the same slug/title normalized keyset for
  frontmatter reference arrays as it uses for wikilinks and index cleanup, so
  title-form references are removed as well as slug-form references.
- Re-ingest page merges now union lightweight graph seed arrays (`alias`,
  `aliases`, and `keywords`) so alias-based query-time graph expansion is not
  lost when a later ingest omits those fields.
- Duplicate-page merges now also union v2 typed relationship arrays and
  lightweight graph seed arrays, so manual deduplication cannot discard explicit
  graph edges or alias/keyword traversal seeds that came from merged-away pages.
- The shared `src/lib/wiki-frontmatter-fields.ts` registry now keeps graph seed,
  typed relationship, reference-cleanup, and deterministic merge field lists in
  one place to reduce schema drift across ingest, dedup, delete, and UI code.
- Frontmatter relation chips and rendered body wikilinks can now resolve through
  target-page `title`, `alias`, and `aliases` metadata via the derived
  `wiki-alias-index`, so references like `uses: [tavily]` can navigate to
  `tavily-api.md` even when the visible relation uses an alias rather than the
  file slug.
- Page deletion cleanup now also includes deleted-page `alias`/`aliases` values
  in its normalized keyset, so alias-form refs such as `related: [tavily]` or
  `uses: [web_search_api]` are removed when `tavily-api.md` is deleted.
- Duplicate-page merge cleanup now redirects merged-away page titles and
  `alias`/`aliases` values to the canonical slug, so alias-form body wikilinks
  and typed relationship arrays do not keep pointing at pages that will be
  deleted after the merge.
- Duplicate-page body wikilink rewrites now use the same normalized
  space/hyphen/underscore matching as frontmatter arrays, so links like
  `[[web_search_api]]` are redirected when the merged-away alias is
  `web search api`.
- New-project schemas from both the TypeScript templates and Rust project
  scaffold now document graph seed arrays (`alias`, `aliases`, `keywords`) and
  the full v2 typed relationship array set, including supersession fields.
- Ingest generation prompts now document graph seed arrays (`alias`, `aliases`,
  `keywords`) and the full v2 typed relationship array set, so new LLM-generated
  pages are instructed to emit the same lightweight graph schema that the local
  search/merge/delete paths already preserve.
- Review-panel "Create Page" actions now route through a tested v2 page builder
  instead of hand-rolled legacy frontmatter, so review-created pages include
  `updated`, `sources`, graph seed arrays, full typed relationship arrays, and
  lifecycle/confidence metadata; the same helper maps `comparison` and
  `synthesis` pages to their schema directories and uses the shared
  Unicode-safe slug generator.
- Ingest fallback source-summary writes now use a tested v2 source-summary
  builder, so the "LLM omitted wiki/sources page" fallback and image-stub
  fallback both include lifecycle metadata, graph seed arrays, full typed
  relationship arrays, and explicit source provenance.
- Chat-driven `executeIngestWrites` now reuses the same FILE-block write
  pipeline as auto-ingest instead of hand-writing raw LLM output, so sanitize,
  deterministic merge, lifecycle enrichment, and lifecycle audit behavior apply
  to chat-generated wiki pages too.
- The frontmatter panel now groups v2 typed relationship fields as navigable
  chips, so unresolved `uses`/`supports`/supersession edges surface with the
  same visible broken-reference treatment as generic `related` links.
- Frontmatter relationship display now treats scalar relation values as
  single-item arrays, matching the typed graph's scalar-tolerant parser instead
  of hiding malformed-but-recoverable `uses: tavily` style metadata.
- Structural lint now treats `related` and v2 typed relationship frontmatter
  arrays as graph references alongside body wikilinks, including title/alias
  resolution, so pages connected only by `uses`/`supports` are not falsely
  reported as orphan/no-outlink/broken-link cases.
- Semantic lint prompts now explicitly tell the LLM to use v2 lifecycle,
  confidence/review status, supersession, and typed relationship metadata as
  quality/freshness signals.
- Frontmatter relationship chips now resolve title-form and underscore-form
  references to hyphenated wiki filenames, reducing false broken-link warnings
  when humans or the LLM write display-title-style frontmatter refs.

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
- No full rewrite of the existing visual/chat graph pipeline onto the typed graph
  helper; page-level explicit typed edges are now included, but visual layout,
  insights, and weighting still use the existing graph pipeline.
- No destructive automatic stale-content repair.
