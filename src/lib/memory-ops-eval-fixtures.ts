import type { MemoryOpsEvalCase } from "@/lib/memory-ops-eval-types"
import { normalizeClaimRecord, type ClaimRecord } from "@/lib/claims"
import { attachPageEvidence, summarizeClaimHealth, summarizeEvidenceStats } from "@/lib/memory-ops-evidence"
import { DEFAULT_MEMORY_OPS_POLICY, type MemoryOpsPolicy } from "@/lib/memory-ops-policy"
import type {
  MemoryOpsProjectSnapshot,
  MemoryOpsWikiPage,
} from "@/lib/memory-ops-types"
import { extractTypedGraphFromPages } from "@/lib/typed-graph"

export const BUILT_IN_MEMORY_OPS_EVAL_CASES: MemoryOpsEvalCase[] = [
  {
    id: "stale-page",
    title: "Stale page should be marked for review",
    description: "A page whose lifecycle metadata resolves stale should generate a lifecycle suggestion.",
    snapshot: snapshot([wikiPage("stale", [
      "---",
      "type: concept",
      "title: Stale",
      "sources: [paper.md]",
      "last_confirmed: 2025-01-01",
      "---",
      "",
      "# Stale",
    ].join("\n"))]),
    expectedSuggestions: [
      { id: "lifecycle:-project-wiki-stale-md:stale", kind: "metadata-update", targetPath: "wiki/stale.md" },
    ],
  },
  {
    id: "low-confidence",
    title: "Low-confidence page should request review",
    description: "Weak confidence evidence should produce a needs-review metadata patch.",
    snapshot: snapshot([wikiPage("low-confidence", [
      "---",
      "type: concept",
      "title: Low Confidence",
      "last_confirmed: 2026-05-22",
      "---",
      "",
      "# Low Confidence",
    ].join("\n"))]),
    expectedSuggestions: [
      { id: "lifecycle:-project-wiki-low-confidence-md:low-confidence", kind: "metadata-update", targetPath: "wiki/low-confidence.md" },
    ],
  },
  {
    id: "claim-provenance",
    title: "Claim without source refs should be review-only",
    description: "Missing claim provenance should not patch markdown automatically.",
    snapshot: snapshot([healthyPage("claim", "Claim")], {
      claims: [claim({
        claim_id: "claim_1o8e2bd",
        text: "Claim with no source refs.",
        page_path: "wiki/claim.md",
        status: "ok",
      })],
    }),
    expectedSuggestions: [
      { id: "claim:claim_1o8e2bd:missing-source-refs", kind: "review-action", targetPath: "wiki/claim.md" },
    ],
  },
  {
    id: "claim-contradicted",
    title: "Contradicted claim should request review",
    description: "A contradicted claim should be visible as a warning-level review suggestion.",
    snapshot: snapshot([healthyPage("claim", "Claim")], {
      claims: [claim({
        claim_id: "claim_contradicted",
        text: "Contradicted claim.",
        page_path: "wiki/claim.md",
        status: "contradicted",
        source_refs: [{ path: "raw/source.md", snippet_hash: "abc" }],
      })],
    }),
    expectedSuggestions: [
      { id: "claim:claim_contradicted:contradicted", kind: "review-action", targetPath: "wiki/claim.md" },
    ],
  },
  {
    id: "claim-superseded",
    title: "Superseded claim should request review",
    description: "A superseded claim should be visible for lifecycle cleanup.",
    snapshot: snapshot([healthyPage("claim", "Claim")], {
      claims: [claim({
        claim_id: "claim_superseded",
        text: "Superseded claim.",
        page_path: "wiki/claim.md",
        status: "superseded",
        source_refs: [{ path: "raw/source.md", snippet_hash: "abc" }],
      })],
    }),
    expectedSuggestions: [
      { id: "claim:claim_superseded:superseded", kind: "review-action", targetPath: "wiki/claim.md" },
    ],
  },
  {
    id: "archive-unsupported",
    title: "Unsupported stale page should be archived",
    description: "A stale page with no support should produce an archive metadata patch.",
    snapshot: snapshot([wikiPage("archive", [
      "---",
      "type: note",
      "title: Archive",
      "lifecycle: semantic",
      "last_confirmed: 2024-01-01",
      "review_status: stale",
      "---",
      "",
      "# Archive",
    ].join("\n"))]),
    expectedSuggestions: [
      { id: "lifecycle:-project-wiki-archive-md:archive", kind: "metadata-update", targetPath: "wiki/archive.md" },
    ],
  },
  {
    id: "semantic-promotion",
    title: "Well-supported page should be promoted",
    description: "A page with enough sources and reinforcement should be promoted to semantic lifecycle.",
    snapshot: snapshot([wikiPage("promote", [
      "---",
      "type: query",
      "title: Promote",
      "lifecycle: episodic",
      "sources: [a.md, b.md]",
      "last_confirmed: 2026-05-20",
      "reinforcement_count: 3",
      "---",
      "",
      "# Promote",
    ].join("\n"))]),
    expectedSuggestions: [
      { id: "promote:-project-wiki-promote-md:semantic", kind: "metadata-update", targetPath: "wiki/promote.md" },
    ],
  },
  {
    id: "relation-cleanup",
    title: "Dangling relation should be flagged",
    description: "A typed relation pointing to a missing page should create a relation cleanup suggestion.",
    snapshot: snapshot([wikiPage("relation", [
      "---",
      "type: concept",
      "title: Relation",
      "sources: [paper.md]",
      "uses: [missing-page]",
      "last_confirmed: 2026-05-20",
      "---",
      "",
      "# Relation",
    ].join("\n"))]),
    expectedSuggestions: [
      { id: "relation:-project-wiki-relation-md:uses:missing-page", kind: "relation-cleanup", targetPath: "wiki/relation.md" },
    ],
  },
  {
    id: "research-contradiction",
    title: "Research-backed contradiction should be visible",
    description: "A contradicted page should produce a warning-level lifecycle suggestion ready for research evidence.",
    snapshot: snapshot([wikiPage("research-risk", [
      "---",
      "type: concept",
      "title: Research Risk",
      "sources: [paper.md]",
      "last_confirmed: 2026-05-20",
      "contradicts: [legacy-risk]",
      "---",
      "",
      "# Research Risk",
    ].join("\n"))]),
    expectedSuggestions: [
      { id: "lifecycle:-project-wiki-research-risk-md:contradicted", kind: "metadata-update", targetPath: "wiki/research-risk.md" },
      { id: "relation:-project-wiki-research-risk-md:contradicts:legacy-risk", kind: "relation-cleanup", targetPath: "wiki/research-risk.md" },
    ],
  },
  {
    id: "clean-control",
    title: "Clean project should not produce suggestions",
    description: "A healthy control fixture guards false positives.",
    snapshot: snapshot([healthyPage("clean", "Clean")]),
    expectedSuggestions: [],
  },
]

function wikiPage(id: string, content: string): MemoryOpsWikiPage {
  return {
    id,
    fileName: `${id}.md`,
    path: `/project/wiki/${id}.md`,
    content,
    frontmatter: null,
  }
}

function healthyPage(id: string, title: string): MemoryOpsWikiPage {
  return wikiPage(id, [
    "---",
    "type: concept",
    `title: ${title}`,
    "sources: [source.md]",
    "last_confirmed: 2026-05-20",
    "reinforcement_count: 1",
    "---",
    "",
    `# ${title}`,
  ].join("\n"))
}

function claim(input: Partial<ClaimRecord>): ClaimRecord {
  return normalizeClaimRecord({
    lifecycle: "semantic",
    confidence: "0.75",
    last_confirmed: "2026-05-20",
    reinforcement_count: "1",
    scope: "shared",
    ...input,
  }, {
    today: "2026-05-22",
  }).claim
}

function snapshot(
  rawPages: MemoryOpsWikiPage[],
  options: {
    claims?: ClaimRecord[]
    policy?: MemoryOpsPolicy
  } = {},
): MemoryOpsProjectSnapshot {
  const policy = options.policy ?? DEFAULT_MEMORY_OPS_POLICY
  const graph = extractTypedGraphFromPages(rawPages)
  const pages = attachPageEvidence(rawPages, {
    projectPath: "/project",
    graph,
    auditEvents: [],
    reviewItems: [],
    today: "2026-05-22",
    policy,
  })
  const claims = options.claims ?? []
  const evidenceStats = summarizeEvidenceStats(pages)
  const claimHealth = summarizeClaimHealth(claims, pages, "/project")
  return {
    projectPath: "/project",
    dataVersion: 0,
    policy,
    policyWarnings: [],
    scanTelemetry: {
      totalMs: 0,
      stages: [],
      options: {
        includeChatMessages: true,
        includeSelfHealing: true,
      },
    },
    pages,
    graph,
    audit: { events: [], warnings: [] },
    schemaQualitySummary: null,
    reviewItems: [],
    conversations: [],
    chatMessages: [],
    claims,
    claimHealth,
    selfHealingSummary: {
      candidateCount: 0,
      claimProvenanceCandidateCount: 0,
      claimIndexCandidateCount: 0,
      consolidationQueueCandidateCount: 0,
      relationCleanupCandidateCount: 0,
      schemaWarningCandidateCount: 0,
      policyWarningCandidateCount: 0,
      warnings: [],
      actions: [],
    },
    stats: {
      pageCount: pages.length,
      reviewItemCount: 0,
      conversationCount: 0,
      chatMessageCount: 0,
      auditEventCount: 0,
      auditWarningCount: 0,
      ...evidenceStats,
      claimCount: claimHealth.claimCount,
      staleClaimCount: claimHealth.staleCount,
      contradictedClaimCount: claimHealth.contradictedCount,
      supersededClaimCount: claimHealth.supersededCount,
      orphanClaimCount: claimHealth.orphanCount,
      reinforcedClaimCount: claimHealth.reinforcedCount,
      claimsMissingSourceRefCount: claimHealth.missingSourceRefCount,
      claimsMissingSnippetHashCount: claimHealth.missingSnippetHashCount,
      historicalConflictCandidateCount: 0,
      historicalConflictSuggestionCount: 0,
      historicalConflictWarningCount: 0,
      selfHealingCandidateCount: 0,
      selfHealingWarningCount: 0,
    },
  }
}
