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
| Ingest | `src/lib/ingest.ts`, `src/lib/page-merge.ts` | Two-stage LLM ingest, safe FILE parsing, page merging, review blocks, language guard, image captioning, embeddings; now prompts for v2 fields, enriches/audits deterministic metadata, and preserves graph seed arrays across re-ingests. |
| Frontmatter | `src/lib/frontmatter.ts` | Robust flat YAML parser with LLM corruption recovery; no v2 schema helpers. |
| Search | `src/lib/search.ts` | Lexical token scoring + vector search + graph traversal + RRF; graph-only pages can materialize with typed path evidence that preserves edge direction. |
| Embeddings | `src/lib/embedding.ts`, `src-tauri/src/commands/vectorstore.rs` | LanceDB chunk vectors with delete/count/search/upsert commands. |
| Typed graph | `src/lib/typed-graph.ts` | Extracts typed edges from v2 frontmatter and fallback `[[wikilink]]` mentions, including source-derived and supersession edges; relationship targets and traversal seeds can also match lightweight frontmatter aliases/tags/summary text. |
| Graph view / chat graph | `src/lib/wiki-graph.ts`, `src/lib/typed-graph.ts`, `src/lib/graph-relevance.ts`, `src/components/chat/chat-panel.tsx` | Visual graph and chat context expansion now include explicit v2 typed relationship arrays, while Louvain layout and relevance weighting still use the existing graph helpers. |
| Quality/review | `src/lib/lint.ts`, `src/stores/review-store.ts` | Structural lint, LLM semantic lint, review queue, plus deterministic lifecycle lint warnings. |
| Cleanup | `src/lib/wiki-page-delete.ts`, `src/lib/wiki-cleanup.ts`, `src/lib/dedup.ts`, `src/lib/sweep-reviews.ts` | Deletes pages/embeddings/media, rewrites wikilinks plus v2 typed relationship arrays, preserves graph seed/relationship arrays during duplicate merges, and resolves stale review items conservatively. |
| Crystallization | `src/lib/crystallize.ts`, `src/components/chat/chat-message.tsx`, `src/lib/deep-research.ts`, `src/components/review/review-view.tsx` | Saved answers/research/review outputs become v2 query pages with lifecycle metadata, typed supports links, source refs, and audit events. |
| UI evidence | `src/components/editor/frontmatter-panel.tsx`, `src/components/search/search-view.tsx` | Frontmatter shows lifecycle/confidence/review chips plus resolved typed relationship groups; search results show typed graph-path evidence, including reverse-traversal direction, when available. |
| Persistence | `src/lib/persist.ts`, `src/lib/lifecycle.ts` | `.llm-wiki/` review/chat persistence plus append-only `audit.jsonl` lifecycle/crystallization events. |

## Engineering Assessment

The current implementation is already past an MVP translation of Rohit's v2
ideas. It turns the important parts of the pattern into local, testable product
behavior: page lifecycle metadata, typed relationship extraction, lexical/BM25,
vector, and graph-aware retrieval, schema contracts, Memory Ops patrol,
auditable metadata operations, and explicit crystallization.

The main design choice still looks right: Markdown remains the durable source of
truth, while graph, vector search, schema scans, search evaluation, Memory Ops,
and audit timelines are derived or operational layers around that source. This
keeps the system inspectable and Git-friendly while avoiding a premature
Neo4j/LightRAG-style replacement of the wiki itself.

The next useful step is not to add a remote memory server or more generated
prose. Trust now has two local slices: high-value claims can be anchored back to
Markdown, indexed in `.llm-wiki/claims.jsonl`, scored, surfaced as search/chat
evidence, and included in Memory Ops claim health; controlled write paths also
run a bounded pre-write conflict gate before risky content lands.

## Gap Matrix

| v2 Capability | Current Support | Missing Piece | Risk | Priority |
| --- | --- | --- | --- | --- |
| Lifecycle metadata | Implemented page-level deterministic model plus claim-level credibility for high-value new write paths | Full span/PDF-coordinate provenance and exhaustive historical extraction remain future work | Medium: score semantics can be over-interpreted | Done for page scope and first claim slice |
| Typed graph | Implemented helper over frontmatter/wikilinks; explicit typed edges now appear in visual graph and chat context expansion; seed matching covers lightweight aliases/tags/summary text | Claim/span-level typed edges and a full graph pipeline rewrite remain future work | Medium: parsing conventions must remain simple | Done for page-level retrieval, graph view, and chat expansion |
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

## Current Trust Slice and Next Work

### 1. Fact-Level Credibility

Page-level confidence remains useful, but it is too coarse for long-lived
knowledge: one page can contain strong facts, weak interpretations, stale
claims, and unresolved contradictions at the same time.

The current implementation introduces claim-level credibility for high-value
facts:

- Important claims have stable IDs plus source references, optional source
  snippets/hashes, `last_confirmed`, `confidence`, `confidence_reasons`,
  `reinforcement_count`, `supersedes`, `superseded_by`, `contradicts`,
  `supports`, `status`, and `scope`.
- Markdown remains the source of truth. Claim anchors such as
  `<!-- claim:claim_xxx -->` point back into wiki pages, while
  `.llm-wiki/claims.jsonl` is a derived, rebuildable governance index.
- Search/chat surface claim evidence separately from page evidence, so an
  answer can say which claim was used and why it is trusted or downgraded.
- Memory Ops can patrol stale, contradicted, and superseded claims without demoting an entire
  page when only one claim is weak.
- Deterministic tests cover claim parsing, claim confidence scoring, stale and
  superseded claim handling, audit redaction, search evidence, Memory Ops
  suggestions, prompt/schema contracts, and rebuild behavior.

The boundaries remain intentionally narrow. Claims are created from controlled
new write paths such as ingest, crystallization, review-created pages, and
explicit save flows. The system does not retroactively extract every sentence
from every existing page, does not make claim confidence a truth verdict, and
does not replace Markdown with a claim database.

### 2. Pre-Write Conflict Handling

Current conflict handling now has a pre-write slice instead of relying only on
post-write patrol. Ingest content pages, crystallized query/synthesis saves, and
review-created pages build `PreWriteCandidate` objects before landing. A bounded
resolver checks target path, page title, nearby Markdown summaries, and
`.llm-wiki/claims.jsonl`, then classifies the candidate as `new`,
`reinforcement`, `update`, `duplicate`, `possible-contradiction`,
`supersession`, or `uncertain`.

Safe writes continue through the existing write path and record
`conflict.accept` audit events. Risky or uncertain writes do not silently
overwrite Markdown: ingest routes them to the existing review queue, crystallized
saves return an optional `conflict` preview to callers, and review-created pages
run the same preview before UI code writes the file. All conflict events use the
new `conflict` audit category and store only bounded evidence summaries, not full
candidate bodies.

The boundary remains intentionally conservative. The gate is local and
deterministic, treats a missing claim index as empty evidence for migration
safety, and does not become an LLM debate loop. Follow-up work can add richer
alias/BM25/vector/typed-graph evidence to the resolver, but risky writes should
continue to route through review rather than automatic truth adjudication.

## Non-Goals

- No remote backend or database.
- No full ACL/private sync product.
- No automatic rewrite/delete of stale content.
- No real-LLM test requirement.
- No autonomous background crystallization workflow in this pass.
- No exhaustive historical claim extraction or span/PDF-coordinate provenance.
- No automatic truth adjudication from claim confidence.
- No full historical conflict scan or automatic semantic truth adjudication in
  the pre-write gate.
- No full typed graph rewrite of the visual graph/chat graph pipeline in this
  pass; current graph consumers incorporate explicit page-level typed
  relationship edges but still rely on existing relevance/layout helpers.

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
