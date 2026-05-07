# LLM Wiki v2 Deep Dive

## Source Comparison

Karpathy's original LLM Wiki pattern is a disciplined "compile knowledge into
markdown" loop:

- Raw sources are immutable inputs.
- LLM ingest turns sources into structured wiki pages.
- A schema, index, overview, and log keep the wiki navigable.
- Queries and lint operate against the wiki as persistent context.
- The wiki becomes the project memory, not the chat transcript.

Rohit's LLM Wiki v2 keeps that foundation but pushes it toward an operating
system for memory:

- Lifecycle: knowledge ages, gets reinforced, becomes stale, or is superseded.
- Typed graph: edges have meaning, not only `[[wikilink]]` adjacency.
- Hybrid retrieval: keyword, vector, and graph traversal are fused.
- Event hooks: ingest/search/write/lint can maintain the wiki automatically.
- Quality: confidence, contradiction handling, and self-repair become first-class.
- Governance: local/private/shared memory, audit trails, and reversible ops.
- Crystallization: completed work sessions condense into durable semantic memory.

The useful engineering interpretation for this app: v2 is not "ask the LLM to
write more pages." It is adding deterministic metadata, graph structure,
retrieval signals, and review/audit mechanics around the existing markdown wiki.

## Current Implementation Map

| Area | Current Code | Observed Capability |
| --- | --- | --- |
| Project scaffold | `src-tauri/src/commands/project.rs`, `src/lib/templates.ts` | Creates `raw/`, `wiki/`, schema, purpose, index, overview, log conventions; now includes the v2 lifecycle and typed relationship contract. |
| Ingest | `src/lib/ingest.ts` | Two-stage LLM ingest, safe FILE parsing, page merging, review blocks, language guard, image captioning, embeddings; now prompts for v2 fields and enriches/audits deterministic metadata. |
| Frontmatter | `src/lib/frontmatter.ts` | Robust flat YAML parser with LLM corruption recovery; no v2 schema helpers. |
| Search | `src/lib/search.ts` | Lexical token scoring + vector search + graph traversal + RRF; graph-only pages can materialize with path evidence. |
| Embeddings | `src/lib/embedding.ts`, `src-tauri/src/commands/vectorstore.rs` | LanceDB chunk vectors with delete/count/search/upsert commands. |
| Typed graph | `src/lib/typed-graph.ts` | Extracts typed edges from v2 frontmatter and fallback `[[wikilink]]` mentions, including source-derived and supersession edges. |
| Graph view | `src/lib/wiki-graph.ts`, `src/lib/graph-relevance.ts` | Existing visual graph remains untyped; search uses typed graph helper as the v2 retrieval layer. |
| Quality/review | `src/lib/lint.ts`, `src/stores/review-store.ts` | Structural lint, LLM semantic lint, review queue, plus deterministic lifecycle lint warnings. |
| Cleanup | `src/lib/wiki-page-delete.ts`, `src/lib/wiki-cleanup.ts`, `src/lib/sweep-reviews.ts` | Deletes pages/embeddings/media and resolves stale review items conservatively. |
| Crystallization | `src/lib/crystallize.ts`, `src/components/chat/chat-message.tsx`, `src/lib/deep-research.ts`, `src/components/review/review-view.tsx` | Saved answers/research/review outputs become v2 query pages with lifecycle metadata, typed supports links, source refs, and audit events. |
| UI evidence | `src/components/editor/frontmatter-panel.tsx`, `src/components/search/search-view.tsx` | Frontmatter shows lifecycle/confidence/review chips; search results show graph-path evidence. |
| Persistence | `src/lib/persist.ts`, `src/lib/lifecycle.ts` | `.llm-wiki/` review/chat persistence plus append-only `audit.jsonl` lifecycle/crystallization events. |

## Gap Matrix

| v2 Capability | Current Support | Missing Piece | Risk | Priority |
| --- | --- | --- | --- | --- |
| Lifecycle metadata | Implemented page-level deterministic model | Claim/span-level provenance remains future work | Medium: score semantics can be over-interpreted | Done for page scope |
| Typed graph | Implemented helper over frontmatter/wikilinks | Main graph visualization still uses existing untyped graph | Medium: parsing conventions must remain simple | Done for retrieval |
| Hybrid retrieval | Lexical + vector + graph RRF | Full BM25 remains future improvement | Medium: search latency | Done for v2 slice |
| Event hooks | Ingest, explicit save/crystallization, lint | Scheduled background maintenance remains future work | Medium: avoid failing ingest due to metadata | Done for local hooks |
| Quality/self-repair | Structural/semantic lint and deterministic lifecycle lint | Automatic safe repair not added | Low | Done for warning/audit |
| Crystallization | Explicit save paths produce v2 query pages | Autonomous session digestion remains future work | Medium-high UI/product scope | Done for explicit user actions |
| Governance | Audit log and scope metadata | Multi-user ACL/private sync not implemented | Low for local audit, high for ACL | Done for local audit |
| Multi-agent mesh | None | Shared/private memory sync | High | Later |

## Chosen Implementation Slice

This iteration implements the highest-value local slice:

- `V2-SPEC-001`/`002`: lifecycle metadata and confidence scoring utilities.
- `V2-SPEC-003`: typed graph extraction from existing frontmatter and wikilinks.
- `V2-SPEC-004`/`005`: graph-aware RRF search without regressing lexical/vector
  behavior.
- `V2-SPEC-006`/`007`/`008`: ingest metadata enrichment, lifecycle lint, and audit
  logging.
- `V2-SPEC-011`/`012`: schema/prompt contract and v2 typed-array merge
  preservation.
- `V2-SPEC-013`: UI evidence in frontmatter and search result cards.
- `V2-SPEC-014`: explicit crystallization path for saved chat/research/review
  outputs.
- `V2-SPEC-010`: deterministic tests and full mock regression verification.

Why this slice: it turns v2's core thesis into code while staying inside existing
boundaries: markdown, frontmatter, graph/search helpers, lint, review queue, and
`.llm-wiki/` persistence. It avoids the high-ambiguity parts of v2 such as full
multi-agent memory sync and autonomous background crystallization.

## Non-Goals

- No remote backend or database.
- No full ACL/private sync product.
- No automatic rewrite/delete of stale content.
- No real-LLM test requirement.
- No autonomous background crystallization workflow in this pass.
- No claim/span-level provenance in this pass.
- No typed graph rewrite of the visual graph view in this pass.

## Implementation Plan

1. Add `src/lib/lifecycle.ts` with pure metadata defaults, confidence scoring,
   frontmatter enrichment, lint issue extraction, and audit event shape.
2. Add `src/lib/typed-graph.ts` with pure parsing/extraction plus async project
   graph construction.
3. Extend `src/lib/search.ts` to add a graph rank stream to existing RRF fusion.
4. Extend ingest writes to enrich content page frontmatter and append best-effort
   audit events under `.llm-wiki/audit.jsonl`.
5. Extend structural lint with lifecycle warnings.
6. Add schema/prompt updates so new projects and generated pages know the v2
   contract.
7. Add `src/lib/crystallize.ts` and wire saved chat, deep research, and review
   saves into explicit v2 query-page crystallization.
8. Surface lifecycle metadata in the frontmatter panel and graph-path evidence
   in search results.
9. Add focused Vitest suites, run `npm run typecheck`, run `npm run test:mocks`,
   and note that `cargo check` could not run when `cargo` was unavailable.

## Verification Evidence

- `npm run typecheck`: passed.
- Focused Vitest suites:
  `src/lib/lifecycle.test.ts`,
  `src/lib/typed-graph.test.ts`,
  `src/lib/search-rrf.test.ts`,
  `src/lib/lint.test.ts`,
  `src/lib/crystallize.test.ts`,
  `src/lib/page-merge.test.ts`,
  `src/lib/ingest.prompt.test.ts`,
  `src/lib/templates.test.ts`: passed.
- `npm run test:mocks`: passed, 72 files and 1039 tests.
- `zsh -lc 'cargo check'` from `src-tauri/`: passed. The run reported 8
  pre-existing warnings in Rust files outside this v2 change.
