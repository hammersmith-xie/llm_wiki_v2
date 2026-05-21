import type { MemoryOpsEvalCase } from "@/lib/memory-ops-eval-types"

export const BUILT_IN_MEMORY_OPS_EVAL_CASES: MemoryOpsEvalCase[] = [
  {
    id: "stale-page",
    title: "Stale page should be marked for review",
    description: "A page whose lifecycle metadata resolves stale should generate a lifecycle suggestion.",
    expectedSuggestions: [
      { id: "lifecycle:wiki-stale-md:stale", kind: "metadata-update", targetPath: "wiki/stale.md" },
    ],
  },
  {
    id: "low-confidence",
    title: "Low-confidence page should request review",
    description: "Weak confidence evidence should produce a needs-review metadata patch.",
    expectedSuggestions: [
      { id: "lifecycle:wiki-low-confidence-md:low-confidence", kind: "metadata-update", targetPath: "wiki/low-confidence.md" },
    ],
  },
  {
    id: "claim-provenance",
    title: "Claim without source refs should be review-only",
    description: "Missing claim provenance should not patch markdown automatically.",
    expectedSuggestions: [
      { id: "claim:claim_missing_source:missing-source-refs", kind: "review-action", targetPath: "wiki/claim.md" },
    ],
  },
  {
    id: "claim-contradicted",
    title: "Contradicted claim should request review",
    description: "A contradicted claim should be visible as a warning-level review suggestion.",
    expectedSuggestions: [
      { id: "claim:claim_contradicted:contradicted", kind: "review-action", targetPath: "wiki/claim.md" },
    ],
  },
  {
    id: "claim-superseded",
    title: "Superseded claim should request review",
    description: "A superseded claim should be visible for lifecycle cleanup.",
    expectedSuggestions: [
      { id: "claim:claim_superseded:superseded", kind: "review-action", targetPath: "wiki/claim.md" },
    ],
  },
  {
    id: "archive-unsupported",
    title: "Unsupported stale page should be archived",
    description: "A stale page with no support should produce an archive metadata patch.",
    expectedSuggestions: [
      { id: "lifecycle:wiki-archive-md:archive", kind: "metadata-update", targetPath: "wiki/archive.md" },
    ],
  },
  {
    id: "semantic-promotion",
    title: "Well-supported page should be promoted",
    description: "A page with enough sources and reinforcement should be promoted to semantic lifecycle.",
    expectedSuggestions: [
      { id: "promote:wiki-promote-md:semantic", kind: "metadata-update", targetPath: "wiki/promote.md" },
    ],
  },
  {
    id: "relation-cleanup",
    title: "Dangling relation should be flagged",
    description: "A typed relation pointing to a missing page should create a relation cleanup suggestion.",
    expectedSuggestions: [
      { id: "relation:wiki-relation-md:uses:missing-page", kind: "relation-cleanup", targetPath: "wiki/relation.md" },
    ],
  },
  {
    id: "clean-control",
    title: "Clean project should not produce suggestions",
    description: "A healthy control fixture guards false positives.",
    expectedSuggestions: [],
  },
]
