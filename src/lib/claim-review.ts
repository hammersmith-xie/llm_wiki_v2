import type { ClaimRecord } from "./claims"
import type { ReviewItem } from "@/stores/review-store"

export type ClaimReviewItemDraft = Omit<ReviewItem, "id" | "resolved" | "createdAt">

export function claimToReviewItem(claim: ClaimRecord): ClaimReviewItemDraft | null {
  const kind = claimReviewKind(claim)
  if (!kind) return null

  return {
    type: "confirm",
    title: `Review ${kind} claim`,
    description: [
      `Claim ${claim.claim_id} is ${kind} and needs human review.`,
      "This is review-only; no automatic content merge or deletion is applied.",
      `Claim: ${claim.scope === "private" ? "[private claim text redacted]" : claim.text}`,
    ].join("\n"),
    sourcePath: claim.page_path,
    affectedPages: [claim.page_path],
    options: [
      { label: "Open page", action: `open:${claim.page_path}` },
      { label: "Mark reviewed", action: `claim.review:${claim.claim_id}` },
    ],
  }
}

function claimReviewKind(claim: ClaimRecord): "contradicted" | "superseded" | null {
  if (claim.status === "superseded" || claim.superseded_by.length > 0) return "superseded"
  if (claim.status === "contradicted" || claim.contradicts.length > 0) return "contradicted"
  return null
}
