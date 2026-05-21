# Review Round 9: Source Size And Module Boundaries

Status: Pass with fixes applied

Checks:

- New or heavily modified source files should stay below 400 lines where practical.
- Large UI form logic should be separated from policy helpers.

Findings:

- `memory-ops-policy-panel.tsx` grew to 545 lines after adding research/eval controls.

Fixes:

- Extracted draft helper logic to `memory-ops-policy-draft.ts`.
- Extracted shared input controls to `memory-ops-policy-fields.tsx`.
- `memory-ops-policy-panel.tsx` is now 394 lines.
