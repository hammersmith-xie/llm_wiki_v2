import { appendAuditEvent, type AuditChangeSummary } from "@/lib/audit-timeline"
import type { PreWriteConflictPreview, PreWriteEvidence } from "@/lib/prewrite-conflict"

export type PreWriteConflictAuditOutcome = "preview" | "accept" | "review"

export interface PreWriteConflictAuditOptions {
  reviewItemId?: string
}

export async function appendPreWriteConflictAuditEvent(
  projectPath: string,
  preview: PreWriteConflictPreview,
  outcome: PreWriteConflictAuditOutcome,
  options: PreWriteConflictAuditOptions = {},
): Promise<void> {
  await appendAuditEvent(projectPath, {
    action: `conflict.${outcome}`,
    category: "conflict",
    actor: "system",
    targetPath: preview.candidate.targetPath,
    pagePath: preview.candidate.targetPath,
    sourcePath: preview.candidate.sourcePath,
    changes: changeSummary(outcome, preview),
    after: {
      candidateId: preview.candidate.id,
      candidateKind: preview.candidate.kind,
      title: preview.candidate.title,
      classification: preview.classification,
      decision: preview.decision,
      severity: preview.severity,
      evidenceCount: preview.evidence.length,
      evidence: preview.evidence.slice(0, 5).map(evidenceSummary),
      ...(options.reviewItemId ? { reviewItemId: options.reviewItemId } : {}),
    },
    reasons: preview.reasons,
  })
}

function changeSummary(
  outcome: PreWriteConflictAuditOutcome,
  preview: PreWriteConflictPreview,
): AuditChangeSummary {
  if (outcome === "accept") return { status: "applied" }
  if (outcome === "review") return { status: "review-only" }
  return { status: preview.decision === "allow" ? "dry-run" : "review-only" }
}

function evidenceSummary(evidence: PreWriteEvidence): Record<string, unknown> {
  return {
    kind: evidence.kind,
    pagePath: evidence.pagePath,
    pageTitle: evidence.pageTitle,
    claimId: evidence.claimId,
    status: evidence.status,
    relation: evidence.relation,
    score: Number.isFinite(evidence.score) ? Number(evidence.score.toFixed(3)) : undefined,
    reasons: evidence.reasons.slice(0, 4),
  }
}
