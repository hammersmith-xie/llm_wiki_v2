# LLM Wiki v2 Deep Dive Goal Prompt

## Short `/goal` Command

Use this as the actual Codex slash command. Do not pass `--tokens`; this goal
is intentionally unbudgeted so Codex can work until the completion gates are
actually satisfied. The command stays under the local `/goal` objective limit
and points Codex at the detailed spec below.

```text
/goal Deep dive Rohit's LLM Wiki v2 gist against this Tauri/React llm_wiki implementation, then implement the highest-value v2 iteration in this repo. Follow plans/llm-wiki-v2-goal-prompt.md exactly: first write and gate plans/llm-wiki-v2-SPEC.md, then compare original Karpathy LLM Wiki, v2, and current code; produce deep-dive/plan artifacts; implement the SPEC-selected v2 slice with focused tests; verify with typecheck and relevant Vitest suites; do not mark complete until every SPEC and goal acceptance gate is evidenced.
```

## Detailed Goal Spec For Codex

You are working in `/Users/xieao/code/tna-epc/llm_wiki`, a Tauri 2 desktop
app with a Vite/React frontend. The app is an engineering implementation of
Karpathy's LLM Wiki pattern. Your task is not merely to summarize LLM Wiki v2;
your task is to deeply understand it, compare it with the current codebase, and
ship a coherent v2 iteration inside this repository.

Primary sources:

- Original LLM Wiki: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- LLM Wiki v2: https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2
- Codex `/goal` implementation: `/Users/xieao/code/codex`
- Current app repository: `/Users/xieao/code/tna-epc/llm_wiki`

Important `/goal` mechanics discovered from local Codex source:

- `/goal` creates persistent thread goal state and can continue work across
  turns while the goal is active.
- Bare `/goal` shows goal status. `/goal pause`, `/goal resume`, and
  `/goal clear` are user-level controls.
- The goal objective is limited to 4000 characters, so long specs must live in
  a file and the slash command should reference that file.
- For this task, do not set a token budget. Continue until the acceptance gates
  are genuinely met or the user explicitly pauses/stops the goal.
- Model-side goal tools can create a goal and mark it complete, but `update_goal`
  can only set status `complete`; pause/resume/budget-limited transitions are
  controlled by user/system.
- Goal continuation is skipped in Plan mode; do the work in Default/execute-like
  mode unless the user explicitly changes mode.
- Before completion, perform a concrete audit against files, tests, and
  artifacts. Do not call `update_goal` until the implementation and verification
  truly satisfy this spec.

## Mandatory SPEC Gate

Before implementing code, create `plans/llm-wiki-v2-SPEC.md`. This SPEC controls
the implementation scope. Do not proceed to implementation until the SPEC is
specific, falsifiable, and internally consistent.

Use the intent of `$gsd-spec-phase`, adapted to this non-GSD task:

- Scout the codebase before writing the SPEC.
- Clarify WHAT this iteration delivers, WHY it matters, and how success is
  objectively recognized.
- Score ambiguity across four dimensions:
  - `Scope`: what is in/out of this iteration.
  - `Behavior`: exact user-visible and data-model behavior.
  - `Integration`: files/modules/surfaces affected and compatibility rules.
  - `Verification`: tests, commands, fixtures, and manual checks.
- Each dimension is scored from 0.00 to 1.00 ambiguity, where lower is clearer.
- The gate passes only when total weighted ambiguity is `<= 0.20` and no single
  dimension is above `0.25`.
- If the gate fails, refine the SPEC once using codebase evidence and reasonable
  assumptions. Ask the user only if a product decision is impossible to infer.

`plans/llm-wiki-v2-SPEC.md` must include:

- Problem statement.
- User/product outcomes.
- In-scope requirements with stable IDs, e.g. `V2-SPEC-001`.
- Explicit non-goals.
- Data model contract and migration/backward-compatibility rules.
- UI/UX requirements if any visible surface changes.
- Test and verification matrix mapped to each requirement.
- Risk and rollback notes.
- Ambiguity score table and final gate result.

After the SPEC gate passes, implementation must map back to SPEC requirement IDs.
If code exploration later proves the SPEC wrong, update the SPEC with a dated
change note before changing implementation scope.

## Product Interpretation

Karpathy v1's key idea is compile-first knowledge: immutable raw sources feed an
LLM-maintained markdown wiki; the wiki plus schema becomes persistent, compounding
knowledge; ingest/query/lint/index/log are the operating loop.

Rohit's v2 keeps that foundation but adds production pressure:

- Memory lifecycle: confidence, recency, reinforcement, supersession, forgetting,
  and consolidation tiers.
- Typed knowledge graph: structured entities and named relationships, not just
  prose and untyped wikilinks.
- Scalable retrieval: BM25/keyword, vector search, and graph traversal fused with
  reciprocal rank fusion.
- Event-driven automation: ingest/search/session/write/scheduled hooks so the
  wiki does maintenance work automatically.
- Quality and self-correction: scoring, lint repair, contradiction resolution.
- Multi-agent/collaboration: scope, merge, coordination, shared/private memory.
- Privacy/governance: ingest filtering, audit trails, reversible bulk ops.
- Crystallization: completed research/debug/chat threads become first-class wiki
  digests and strengthen semantic/procedural knowledge.
- Schema as product: AGENTS/schema conventions define the disciplined knowledge
  worker behavior.

Treat v2 as a design direction, not gospel. Some comments on the gist call out
real gaps: unclear metrics, magical crystallization, no rollback/provenance,
LLM reliability, latency, auth, and evaluation. Your implementation must turn
the valuable ideas into deterministic, testable, local-first code that fits this
app's existing architecture.

## Current Codebase Baseline To Inspect

Start by reading, at minimum:

- `src/lib/ingest.ts`: two-stage LLM ingest, FILE/REVIEW parsing, cache, language
  guard, image/caption pipeline, embedding after ingest.
- `src/lib/search.ts`: current token search plus LanceDB vector search fused with
  RRF. It is hybrid, but not true BM25 and does not include graph traversal.
- `src/lib/wiki-graph.ts`: page graph from wikilinks, Louvain communities, simple
  relevance weighting. It is not a typed relationship graph.
- `src/lib/graph-relevance.ts` and `src/lib/graph-filters.ts`: existing graph
  scoring/visibility helpers.
- `src/lib/lint.ts`: structural lint and LLM semantic lint. Currently suggestion
  oriented, not a lifecycle/supersession engine.
- `src/lib/frontmatter.ts`: flat frontmatter parser; likely needs schema-aware
  extension without breaking legacy pages.
- `src/stores/review-store.ts`: review queue for duplicate/missing/contradiction
  style items.
- `src-tauri/src/commands/project.rs`: project scaffold and schema defaults.
- `src-tauri/src/commands/vectorstore.rs`: LanceDB page/chunk vector support.
- UI surfaces under `src/components/search`, `src/components/graph`,
  `src/components/lint`, `src/components/review`, and settings sections.

Record what already exists before proposing changes. Do not duplicate features
that are already working; integrate and extend them.

## Required Deliverables

1. Create `plans/llm-wiki-v2-SPEC.md` and pass the SPEC gate above.

2. Create or update a deep-dive artifact under `plans/`, for example
   `plans/llm-wiki-v2-deep-dive.md`. It must include:
   - v1 vs v2 conceptual delta.
   - current implementation map with file-level evidence.
   - gap matrix: capability, current support, missing pieces, risk, priority.
   - chosen implementation slice for this iteration and why it is the best slice.
   - explicit non-goals.

3. Implement a coherent v2 iteration. Prefer a vertical slice over scattered
   half-features. The preferred scope is:
   - lifecycle metadata and confidence model,
   - schema/template and ingest prompt contract for v2 frontmatter,
   - typed graph extraction from markdown/frontmatter/wikilinks,
   - graph-aware hybrid search fusion,
   - quality/provenance hooks that run on ingest and lint,
   - user-visible lifecycle/search/audit evidence,
   - explicit user-triggered crystallization for saved chat/research/review
     outputs.

4. Add tests that make the new behavior trustworthy:
   - unit tests for lifecycle/confidence math,
   - parser/frontmatter backward compatibility tests,
   - typed graph extraction tests,
   - graph traversal and RRF fusion tests,
   - lint/review/provenance behavior tests,
   - integration/scenario tests when behavior spans ingest/search/store.

5. Run verification:
   - `npm run typecheck`
   - focused Vitest suites for changed modules
   - `npm run test:mocks` if the blast radius is broad enough
   - do not run real-LLM tests unless explicitly configured and necessary

6. Final answer must summarize:
   - what was implemented,
   - which files changed,
   - which tests ran and their result,
  - what remains out of scope,
  - any migration/backward-compatibility notes.

## Implementation Principles

Work with existing patterns:

- Keep markdown/frontmatter as the durable source of truth where practical.
- Preserve Obsidian-compatible wikilinks and existing wiki page types.
- Do not introduce a server/database unless the current Tauri/local filesystem
  architecture genuinely needs it.
- Use deterministic parsers and structured data for graph/lifecycle metadata.
- LLM output may suggest claims, but deterministic validators decide whether
  data is accepted, flagged, superseded, or left for human review.
- Keep old pages readable. Missing new metadata should degrade gracefully.
- Avoid expensive background work unless it is bounded, cancellable, and visible.
- Do not make destructive bulk changes without audit trail and reversibility.
- Keep real provider calls opt-in; default tests must be deterministic.

## Recommended Data Model Direction

Design before implementing, then adjust to code reality.

Candidate page-level frontmatter fields:

- `type`: existing page type, preserved.
- `title`, `created`, `updated`, `tags`, `related`, `sources`: existing fields.
- `lifecycle`: `working | episodic | semantic | procedural | archived`.
- `confidence`: stringified decimal 0..1, deterministic derived score where possible.
- `confidence_reasons`: compact string array explaining support/recency/conflicts.
- `last_confirmed`: ISO date.
- `reinforcement_count`: integer string.
- `supersedes`: page/claim IDs this page supersedes.
- `superseded_by`: page/claim IDs that supersede this page.
- `quality_score`: stringified decimal 0..1.
- `review_status`: `ok | needs-review | stale | contradicted`.
- `scope`: `private | shared` if useful, default shared/local.

Candidate claim/evidence model:

- Prefer claim blocks or structured frontmatter only if the code can parse and
  update them reliably.
- Each claim should have a stable human-readable ID, source references, optional
  source spans/hashes, confidence, last confirmed date, and supersession links.
- If span-level provenance is too large for this iteration, implement page-level
  provenance now and leave claim-level spans as a documented next step.

Candidate relationship model:

- Extract typed edges from explicit frontmatter or inline conventions, while
  preserving plain wikilinks as fallback edges.
- Supported edge types should start small: `related_to`, `uses`, `depends_on`,
  `contradicts`, `supersedes`, `supports`, `derived_from`, `mentions`.
- Edge attributes: source page, target page, confidence, evidence/source count,
  created/updated, and whether the edge is inferred or explicit.

## Search Requirements

Current search already does lexical + vector RRF. Extend it thoughtfully:

- Add a true or approximate BM25 score/rank over markdown pages, or refactor the
  existing token search into a BM25-like ranked lexical stream with tests.
- Add graph traversal as a third retrieval stream:
  - resolve query terms to likely entity/page nodes,
  - walk typed edges with bounded depth and edge weights,
  - return candidate pages with graph ranks,
  - include edge/path explanation in debug or result metadata if feasible.
- Fuse lexical/BM25, vector, and graph ranks using RRF.
- Preserve fast exact filename/title matches.
- Preserve image result behavior.
- Keep search responsive; bound IO and graph traversal.
- Add tests proving a graph-connected page can surface even when lexical/vector
  evidence is weaker.

## Lifecycle And Quality Requirements

Implement a deterministic lifecycle/confidence core before LLM embellishment.

- Confidence should increase with supporting source count and reinforcement.
- Confidence should decrease with age, contradiction, and stale/superseded state.
- Different content types may decay at different rates; decisions/procedures
  decay slowly, transient observations decay faster.
- Supersession should preserve old knowledge but mark it stale/superseded.
- Lint should identify and, where safe, repair broken links/orphans/stale metadata.
- Unsafe/semantic fixes should create review items rather than silently rewrite.
- Every automated update should be explainable in a log/audit surface.

## Automation Hooks

Use what exists before adding new infrastructure.

- On ingest: update lifecycle metadata, provenance, typed graph/index/search data,
  review items, and audit log.
- On search/query where feasible: reinforce accessed pages/claims.
- On lint/review: compute quality/staleness and generate actionable review items.
- On deletion/merge: preserve existing cleanup behavior and add audit/provenance
  cleanup as needed.
- Scheduled maintenance can be a manual UI action for this iteration if true
  background scheduling is too risky.

## Crystallization Requirements

If implementing crystallization in this iteration, keep it concrete:

- Identify existing chat/research outputs that can be saved to wiki.
- Create a structured digest page type or extend `query`/`synthesis`.
- Capture: question, answer/decision, involved pages/sources, claims changed,
  follow-up questions, and confidence/review status.
- Update graph/search metadata after crystallization.
- Add deterministic tests around digest generation/parsing where possible.

If crystallization is too large for the chosen vertical slice, document the
exact next implementation path in the deep-dive artifact.

## Governance And Privacy Requirements

- Reuse and extend existing ingest sanitization. Do not let API keys, credentials,
  private tokens, or obviously sensitive secrets enter generated wiki pages.
- Keep audit logs append-only where practical.
- Bulk operations must be reversible or at least auditable with before/after
  evidence.
- Multi-agent mesh sync is not required for this iteration unless current code
  already has a natural hook; document it as future work.

## Acceptance Gates

The goal is complete only when all applicable gates are satisfied:

- A deep-dive comparison artifact exists under `plans/` and is specific to this
  codebase.
- `plans/llm-wiki-v2-SPEC.md` exists, has requirement IDs, has an ambiguity score
  table, passes the SPEC gate, and implementation maps back to it.
- Implemented code maps to a clear v2 capability slice, not just docs.
- Existing v1 behavior still works: ingest, search, graph, lint, reviews, and
  embeddings must not regress.
- New metadata is backward compatible with old wiki pages.
- Search fusion includes graph-aware retrieval or a documented reason why the
  selected vertical slice implemented lifecycle first.
- New project templates and ingest prompts describe the v2 lifecycle and typed
  edge contract.
- Re-ingest merges preserve v2 typed relationship arrays.
- Saved chat/research/review outputs have a concrete crystallization path, not
  only a future-work note.
- Existing UI surfaces show lifecycle/search graph evidence without adding a
  large new workflow.
- Confidence/lifecycle behavior has deterministic tests.
- Typed graph extraction or relationship parsing has deterministic tests.
- Lint/review/provenance behavior has tests or a focused manual verification.
- TypeScript builds successfully.
- Relevant Vitest suites pass.
- Real-LLM tests are not required unless explicitly enabled; if skipped, explain.
- Final completion audit maps every requirement in this spec to evidence.

## Non-Goals Unless Strongly Justified

- Do not rewrite the app around a remote backend.
- Do not replace markdown as the durable knowledge layer.
- Do not implement full multi-user auth/ACL unless a minimal local scope flag is
  enough for the chosen slice.
- Do not make every v2 idea in one pass if that would produce shallow code.
- Do not rely on LLM self-evaluation as the only validator.
- Do not silently delete stale knowledge; deprioritize, supersede, or archive.
- Do not run paid/external real-LLM tests by default.

## Completion Protocol

Before marking the goal complete:

1. Build a checklist from this file.
2. Build a second checklist from `plans/llm-wiki-v2-SPEC.md`.
3. Inspect actual changed files and generated artifacts.
4. Run the verification commands.
5. Confirm no unrelated user changes were reverted.
6. Confirm all new behavior has tests or clearly explained manual verification.
7. Confirm every `V2-SPEC-001` through `V2-SPEC-014` requirement has file-level
   evidence.
8. Only then call `update_goal` with status `complete`.
9. Report final elapsed time if Codex provides it.

## Periodic Goal Patrol Note

Codex model-side goal tools are not shell commands and cannot be safely run from
a background cron/task. If the user asks for periodic goal checks, keep the
active turn running, call `get_goal` about once per minute while work remains,
and if the native goal is not active/running, continue executing this file and
the SPEC directly. Do not mark the work complete merely because native `/goal`
state says `complete`; complete only after the acceptance gates above are
evidenced.
