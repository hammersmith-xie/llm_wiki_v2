# LLM Wiki v2 Final 5 Percent Requirements

## Background

The repository already implements most of the LLM Wiki v2 engineering baseline: lifecycle metadata, claim index, Memory Ops patrol, provenance health, audit timeline/export, session-end crystallization candidates, and typed graph extraction from Markdown/frontmatter.

The remaining work is not a new product direction. It is the last local single-user hardening layer needed to make the implementation feel complete against Rohit's LLM Wiki v2 gist: precise source grounding, scheduled maintenance policy, knowledge consolidation queueing, typed graph metadata, conservative self-healing, and stronger final verification.

## Goals

- Improve claim provenance from path-level evidence to deterministic source anchors with page and offset hints when source text supports them.
- Add a durable Memory Ops schedule policy so automatic patrol has time/event cadence, cooldown, and auditable due reasons.
- Promote session/research/review crystallization from one-off previews into a local consolidation queue with durable dedupe.
- Enrich the typed graph with node properties and relationship provenance/confidence metadata while keeping Markdown/frontmatter as the source of truth.
- Add conservative self-healing planning that can preview safe repairs before applying them.
- Provide final engineering verification for the local single-user target: typecheck, mocked tests, Rust tests, and focused coverage.

## Non-Goals

- No hosted service, account system, cloud sync, ACL, workspace sharing, or remote collaboration.
- No new graph database. Markdown/frontmatter, JSONL, and existing local stores remain canonical.
- No automatic destructive rewrite of user wiki pages without explicit apply action or existing safe repair path.
- No real-LLM test requirement in the default verification path.

## User Stories

- As a local user, I can see whether a claim is grounded to a specific source location, not just a file path.
- As a local user, I can configure whether Memory Ops patrol runs by event count, elapsed time, or both.
- As a local user, I can inspect crystallization/consolidation candidates before turning them into synthesis/query pages.
- As a local user, graph views and graph traversal can explain where relationship edges came from and how confident they are.
- As a local user, maintenance tools suggest safe repairs and clearly distinguish dry-run from applied changes.

## Functional Requirements

1. Source Map Provenance
   - Build deterministic source-map helpers for Markdown-like extracted text.
   - Detect PDF-style page headings emitted as `## Page N`.
   - Return char offsets, line numbers, page numbers, snippet anchors, and snippet hashes for supporting snippets.
   - Enrich claim `source_refs` with compact metadata without storing raw private snippets.
   - Keep legacy claim records readable.

2. Scheduled Memory Ops Policy
   - Extend Memory Ops policy with scheduling fields: event threshold, reminder cooldown, minimum patrol interval, and time-based interval.
   - Normalize invalid policy values to defaults with warnings.
   - Make maintenance event reduction report why a patrol/reminder is due.
   - Auto-patrol only when policy permits it and cadence says it is due.

3. Consolidation Queue
   - Add a local `.llm-wiki/consolidation-queue.json` store.
   - Queue high-value digest plans with dedupe keys, source metadata, summary counts, reasons, status, timestamps, and optional target paths.
   - Record audit events for queue preview/add/status changes.
   - Integrate session-end crystallization with the queue without auto-writing wiki pages.

4. Typed Graph Metadata
   - Extend typed graph nodes with aliases, tags, lifecycle, last-confirmed date, source count, and review flags.
   - Extend typed graph edges with provenance: frontmatter field, explicit/implicit source, direction, and source path.
   - Keep traversal behavior compatible with existing callers.

5. Conservative Self-Healing
   - Add a self-healing planner that aggregates safe repair opportunities: claim provenance repair, claim index backfill, relation cleanup, and policy/schema warnings.
   - Expose dry-run counts and warnings through Memory Ops stats and audit records.
   - Do not apply page rewrites from the new planner automatically.

6. Verification
   - Add focused unit/component tests for every new helper and policy branch.
   - Run `npm run typecheck`.
   - Run `npm run test:mocks`.
   - Run `cargo test --manifest-path src-tauri/Cargo.toml`.

## Non-Functional Requirements

- Privacy: source snippets are hashed and anchored, not copied into audit records or claim refs.
- Determinism: provenance anchors and queue IDs must be stable for the same inputs.
- Performance: new scans must be linear over local files and reuse existing indexes/stores where possible.
- Compatibility: existing JSONL claim rows and policy files remain valid.
- Observability: automated maintenance and queue actions must be represented in audit events.

## Technical Decisions

- Implement source-map helpers in TypeScript first because existing claim extraction and repair logic is TypeScript-side.
- Avoid Rust PDF layout changes for now; current Rust extraction already emits `## Page N`, which is enough for page-level anchors.
- Keep consolidation as a reviewable local queue instead of automatically writing synthesis pages.
- Enrich typed graph interfaces in a backward-compatible way by adding optional fields.
- Use existing `project-store`, `audit-timeline`, and Memory Ops modules rather than introducing new persistence abstractions.

## Risks

- Extracted PDF text lacks geometric coordinates. Mitigation: page + char/line offsets are implemented now; coordinates remain a future Rust/PDFium enhancement.
- Auto-patrol can feel noisy. Mitigation: policy controls include event threshold, elapsed interval, minimum interval, and cooldown.
- Consolidation queues can grow stale. Mitigation: queued items carry dedupe keys, status, timestamps, and audit events.
- Graph metadata can create API churn. Mitigation: add optional fields and preserve current traversal rank shape.
