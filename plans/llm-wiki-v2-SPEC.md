# LLM Wiki v2 SPEC

## Problem Statement

The current app has a solid LLM Wiki v1 implementation: source ingest, generated
markdown pages, frontmatter, review queue, structural/semantic lint, graph view,
chunk embeddings, and lexical/vector RRF search. Rohit's LLM Wiki v2 argues that
the next useful step is not more generated prose, but memory lifecycle, typed
relationships, graph-aware retrieval, quality controls, and auditability.

This iteration must turn that direction into a local-first, deterministic,
testable slice that fits the existing Tauri/React markdown wiki architecture.

## User/Product Outcomes

- Users can trust wiki pages more because generated pages carry explicit
  lifecycle, confidence, quality, and supersession metadata.
- Search can surface structurally connected pages even when keyword/vector
  evidence is weak.
- The graph layer has typed edges, not only untyped wikilinks.
- Lint can identify stale/superseded/low-confidence knowledge using deterministic
  metadata instead of only LLM judgment.
- Automated metadata changes leave an audit trail under `.llm-wiki/`.

## In-Scope Requirements

- `V2-SPEC-001`: Add a deterministic lifecycle metadata model for wiki markdown
  pages. It must support `lifecycle`, `confidence`, `confidence_reasons`,
  `last_confirmed`, `reinforcement_count`, `supersedes`, `superseded_by`,
  `quality_score`, `review_status`, and `scope`, while preserving existing
  `type`, `title`, `created`, `updated`, `tags`, `related`, and `sources`.

- `V2-SPEC-002`: Add pure lifecycle/confidence scoring utilities. Confidence
  must increase with source count and reinforcement, decrease with age and
  supersession/contradiction signals, and produce human-readable reasons.

- `V2-SPEC-003`: Add a typed graph extraction layer over existing markdown pages.
  It must emit typed edges from frontmatter fields and body wikilinks:
  `related_to`, `uses`, `depends_on`, `contradicts`, `supersedes`, `supports`,
  `derived_from`, and `mentions`. Missing fields on legacy pages must degrade to
  ordinary `mentions`/`related_to` edges.

- `V2-SPEC-004`: Extend search to include a graph traversal retrieval stream in
  RRF fusion alongside existing lexical and vector streams. The graph stream
  must be bounded, deterministic, and able to materialize graph-only candidate
  pages.

- `V2-SPEC-005`: Preserve current search behavior: exact filename/title matches
  remain strong, image references still populate search results, vector-only
  results still surface, and embedding-disabled projects still work.

- `V2-SPEC-006`: Hook lifecycle metadata into ingest writes for generated content
  pages without requiring real LLM/provider calls in tests. Existing pages without
  v2 metadata must remain readable and mergeable.

- `V2-SPEC-007`: Add deterministic lifecycle lint signals. Structural lint must
  flag stale, superseded, contradicted, or low-confidence pages as actionable
  semantic warnings/info without silently rewriting user content.

- `V2-SPEC-008`: Add an append-only audit helper for lifecycle/quality metadata
  operations under `.llm-wiki/`. Ingest should record lifecycle metadata updates
  best-effort, without failing the ingest if audit logging fails.

- `V2-SPEC-009`: Create `plans/llm-wiki-v2-deep-dive.md` comparing Karpathy v1,
  Rohit v2, and this codebase, including a gap matrix and chosen slice rationale.

- `V2-SPEC-010`: Add focused deterministic tests for lifecycle scoring,
  frontmatter/backward compatibility, typed graph extraction, graph-aware RRF
  search, and lifecycle lint/audit behavior.

- `V2-SPEC-011`: Update project schema templates and ingest generation prompts
  so new projects and LLM-generated pages explicitly know the v2 lifecycle and
  typed relationship contract. Deterministic enrichment remains the fallback
  when the model omits fields.

- `V2-SPEC-012`: Preserve v2 typed relationship arrays across re-ingest merges.
  `uses`, `depends_on`, `contradicts`, `supports`, `supersedes`, and
  `superseded_by` must union like `sources`, `tags`, and `related`.

- `V2-SPEC-013`: Surface lifecycle and graph-retrieval evidence in existing UI.
  The frontmatter panel must show lifecycle/confidence/review metadata as first
  class metadata instead of burying it under "More"; search results with graph
  traversal evidence must show the path that caused the result to surface.

- `V2-SPEC-014`: Add a concrete crystallization helper for saved
  chat/research/review outputs. Saved query pages must receive lifecycle
  metadata, typed `supports` links from cited wiki pages, `sources` where
  raw/source refs are available, and a best-effort audit event under
  `.llm-wiki/audit.jsonl`.

## Non-Goals

- No remote backend, new database, auth system, or multi-user ACL.
- No full multi-agent mesh sync.
- No autonomous crystallization of every arbitrary chat session in this pass.
  The pass does include explicit user-triggered crystallization from saved chat,
  deep-research, and review outputs.
- No span-level claim provenance unless it falls out naturally from page-level
  metadata.
- No paid/external real-LLM tests.
- No destructive bulk delete or automatic rewriting of stale content.

## Data Model Contract

The durable source of truth remains markdown with YAML frontmatter. New fields are
flat scalars or arrays so the existing frontmatter UI and parser can display them.

New page-level fields:

- `lifecycle`: `working | episodic | semantic | procedural | archived`
- `confidence`: stringified decimal between `0` and `1`
- `confidence_reasons`: array of short strings
- `last_confirmed`: ISO date
- `reinforcement_count`: integer string
- `supersedes`: slug array
- `superseded_by`: slug array
- `quality_score`: stringified decimal between `0` and `1`
- `review_status`: `ok | needs-review | stale | contradicted`
- `scope`: `private | shared`
- typed edge arrays: `uses`, `depends_on`, `contradicts`, `supports`,
  `supersedes`, `superseded_by`

Backward compatibility rules:

- Missing v2 fields imply sensible defaults and must not break parsing, graph
  view, search, lint, editor, or merge code.
- Existing `related` stays valid and maps to `related_to` edges.
- Existing wikilinks stay valid and map to `mentions` edges.
- Existing `sources` stay valid and contribute to confidence.

## UI/UX Requirements

No mandatory new screen is required. Existing surfaces reflect the behavior
through:

- Search ranking.
- Search result graph-path evidence.
- Graph behavior via existing graph/search data.
- Frontmatter panel lifecycle/confidence/review metadata.
- Lint results.
- Review/audit artifacts on disk.

Keep UI changes consistent with the current frontmatter panel and search result
cards instead of adding a large new workflow.

## Verification Matrix

- `V2-SPEC-001`, `V2-SPEC-006`: frontmatter/lifecycle tests and existing ingest
  parser tests.
- `V2-SPEC-002`: lifecycle scoring unit tests.
- `V2-SPEC-003`: typed graph extraction unit tests.
- `V2-SPEC-004`, `V2-SPEC-005`: `searchWiki` RRF tests with mocked vector search
  and real temp wiki files.
- `V2-SPEC-007`: `runStructuralLint` lifecycle warning tests.
- `V2-SPEC-008`: audit helper unit/integration test with temp project path.
- `V2-SPEC-009`: inspect the plans artifact.
- `V2-SPEC-010`: run focused Vitest suites plus `npm run typecheck`; run
  `npm run test:mocks` if changes are broad enough.
- `V2-SPEC-011`: prompt/template tests asserting the v2 field contract is
  present.
- `V2-SPEC-012`: page-merge tests asserting typed arrays are unioned.
- `V2-SPEC-013`: typecheck plus search result tests for graph-path metadata.
- `V2-SPEC-014`: crystallization helper tests asserting frontmatter fields,
  typed citations, and audit calls.

## Risks And Rollback

- Risk: frontmatter rewriting could churn generated markdown. Mitigation: limit
  automatic enrichment to ingest-written content pages and use flat YAML fields.
- Risk: graph traversal could slow search or leak stale results across project
  switches. Mitigation: cache by normalized project path plus `dataVersion`, and
  bound traversal depth and candidate count.
- Risk: lifecycle scores may look over-precise. Mitigation: store reasons and
  deterministic factors; treat score as ranking/review aid, not truth.
- Rollback: remove new files and search/lint/ingest hooks; existing markdown pages
  with extra flat frontmatter fields remain readable.

## Ambiguity Score

| Dimension | Score | Notes |
| --- | ---: | --- |
| Scope | 0.12 | Full local-first v2 practice includes schema/prompt, lifecycle, graph retrieval, lint, audit, UI evidence, and explicit crystallization; still excludes remote governance and autonomous background agents. |
| Behavior | 0.15 | Scoring formulas are deterministic; UI evidence is display-only; model prompts request fields but deterministic enrichment remains authoritative. |
| Integration | 0.14 | Touches known modules: templates, ingest, merge, search, lint, graph helpers, chat/research saves, editor/search UI, tests. |
| Verification | 0.11 | Deterministic tests cover all new non-visual behavior; UI is covered by typecheck and existing rendering constraints. |

Weighted ambiguity: `0.13`.

Gate result: `PASS` because weighted ambiguity is `<= 0.20` and no dimension is
above `0.25`.
