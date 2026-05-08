import { appendAuditEvent } from "@/lib/audit-timeline"
import type { ClaimExtractionResult } from "@/lib/claim-extract"
import { appendClaimRecords, claimRecordAuditSummary } from "@/lib/claims"

export interface ClaimWriteArtifactResult {
  claimCount: number
  warnings: string[]
  error?: string
  auditError?: string
}

export async function writeExtractedClaimArtifacts(input: {
  projectPath: string
  relativePath: string
  extraction: ClaimExtractionResult
}): Promise<ClaimWriteArtifactResult> {
  const claimCount = input.extraction.claims.length
  const warnings = [...input.extraction.warnings]
  if (claimCount === 0) return { claimCount, warnings }

  try {
    const appendResult = await appendClaimRecords(
      input.projectPath,
      input.extraction.claims.map((candidate) => candidate.claim),
    )
    warnings.push(...appendResult.warnings)
  } catch (err) {
    return {
      claimCount,
      warnings,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  try {
    await appendAuditEvent(input.projectPath, {
      action: "claim.write",
      category: "lifecycle",
      actor: "system",
      pagePath: input.relativePath,
      targetPath: ".llm-wiki/claims.jsonl",
      changes: { status: "applied" },
      after: {
        claimCount,
        claims: input.extraction.claims.map((candidate) =>
          claimRecordAuditSummary(candidate.claim),
        ),
      },
      reasons: [`wrote ${claimCount} claim record${claimCount === 1 ? "" : "s"}`],
    })
  } catch (err) {
    return {
      claimCount,
      warnings,
      auditError: err instanceof Error ? err.message : String(err),
    }
  }

  return { claimCount, warnings }
}
