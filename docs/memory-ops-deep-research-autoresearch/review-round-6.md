# Review Round 6: Backwards Compatibility

Status: Pass

Checks:

- Old memory ops policy shapes load with defaults for new `research` and `eval` fields.
- Existing report schema remains optional-field compatible.
- Existing patrol UI tests still pass.

Findings:

- Tests with hand-built policy objects needed to use `DEFAULT_MEMORY_OPS_POLICY`.

Fixes:

- Updated the affected test fixture to reference `DEFAULT_MEMORY_OPS_POLICY`.
