import type { PreWriteConflictPreview } from "@/lib/prewrite-conflict"
import type { ReviewItem } from "@/stores/review-store"

export type PreWriteConflictReviewItemDraft = Omit<
  ReviewItem,
  "id" | "resolved" | "createdAt"
>

export function preWriteConflictToReviewItem(
  preview: PreWriteConflictPreview,
): PreWriteConflictReviewItemDraft {
  const candidate = preview.candidate
  const title = `Pre-write conflict: ${candidate.title || candidate.targetPath}`
  const affectedPages = uniqueStrings([
    candidate.targetPath,
    ...preview.evidence.flatMap((item) => item.pagePath ? [item.pagePath] : []),
  ])
  return {
    type: reviewType(preview.classification),
    title,
    description: [
      `Classification: ${preview.classification}`,
      `Decision: ${preview.decision}`,
      "",
      "Reasons:",
      ...preview.reasons.map((reason) => `- ${reason}`),
      "",
      "Evidence:",
      ...preview.evidence.slice(0, 5).map(formatEvidence),
    ].join("\n").trim(),
    sourcePath: candidate.sourcePath,
    affectedPages,
    searchQueries: searchQueries(candidate.title || candidate.targetPath),
    options: [
      { label: "Review conflict", action: `open:${candidate.targetPath}` },
      { label: "Skip write", action: "Skip" },
    ],
  }
}

function reviewType(
  classification: PreWriteConflictPreview["classification"],
): ReviewItem["type"] {
  if (classification === "possible-contradiction") return "contradiction"
  return "confirm"
}

function formatEvidence(evidence: PreWriteConflictPreview["evidence"][number]): string {
  const target = evidence.claimId ?? evidence.pagePath ?? evidence.kind
  const status = evidence.status ? ` status=${evidence.status}` : ""
  const relation = evidence.relation ? ` relation=${evidence.relation}` : ""
  const score = Number.isFinite(evidence.score) ? ` score=${evidence.score.toFixed(2)}` : ""
  const reasons = evidence.reasons.length > 0 ? ` — ${evidence.reasons.join("; ")}` : ""
  return `- ${target}${status}${relation}${score}${reasons}`
}

function searchQueries(topic: string): string[] {
  const normalized = topic.replace(/\s+/g, " ").trim()
  return uniqueStrings([
    `${normalized} pre-write conflict`,
    `${normalized} contradiction evidence`,
    `${normalized} supersession duplicate knowledge`,
  ]).slice(0, 3)
}

function uniqueStrings(values: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}
