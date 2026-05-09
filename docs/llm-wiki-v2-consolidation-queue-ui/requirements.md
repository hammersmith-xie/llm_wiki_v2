# Consolidation Queue UI Requirements

## Background

The final 5 percent audit found that consolidation queue persistence exists, but the user-facing review path is weak: queued digest plans are stored and audited, yet there is no dedicated Maintenance panel for inspecting and triaging them.

## Goals

- Add a Maintenance workbench tab for the local consolidation queue.
- Let the user refresh the queue, inspect queued/applied/dismissed items, and update item status.
- Keep behavior local-first and non-destructive.
- Add tests for rendering and status actions.

## Non-Goals

- Do not auto-save queued candidates as wiki pages.
- Do not build a full editor for digest page content.
- Do not introduce new persistence outside `.llm-wiki/consolidation-queue.json`.

## Functional Requirements

1. Queue Panel
   - Displays queue item count, warnings, status, source title/origin/score, target paths, reasons, and summary counts.
   - Shows an empty state when no candidates exist.
   - Supports refresh.

2. Status Actions
   - Supports marking an item `accepted`, `dismissed`, or `applied`.
   - Status updates write through existing `updateConsolidationQueueStatus`.
   - Refreshes audit/timeline state after successful updates.

3. Integration
   - Adds a `consolidation` Maintenance workbench tab.
   - Loads queue data when a project opens and after data version changes.

4. Verification
   - Add component tests for panel rendering and button availability.
   - Run TypeScript and mocked tests.

## Risks

- Queue items do not include full source body by design; the panel can explain candidates but cannot preview the full generated answer.
- An item marked `applied` from this panel is a status marker, not a page write operation.
