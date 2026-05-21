# Review Round 3: Evidence Scoring Correctness

Status: Pass with fixes applied

Checks:

- Ledger supports support-only, contradiction-only, mixed, insufficient, and unavailable paths.
- Legacy summary-only research reports remain compatible.

Findings:

- Single strong local support evidence initially produced `review` because the apply threshold was too high.
- Legacy cached reports with zero evidence did not enrich suggestions.

Fixes:

- Lowered supported/apply recommendation threshold to `0.5`.
- Added summary-only ledger entries for legacy research results.
