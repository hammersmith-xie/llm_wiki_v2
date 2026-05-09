import type { ClaimEvidence } from "@/lib/search-types"
import { useTranslation } from "react-i18next"

export function ClaimEvidenceList({
  evidence,
  label,
  limit = 3,
  compact = false,
}: {
  evidence: readonly ClaimEvidence[] | undefined
  label?: string
  limit?: number
  compact?: boolean
}) {
  const { t } = useTranslation()
  const visible = (evidence ?? []).slice(0, Math.max(0, limit))
  if (visible.length === 0) return null
  const title = label ?? t("claims.evidence")

  return (
    <div
      className={compact
        ? "min-w-0 rounded border border-border/60 bg-background px-1.5 py-1 text-[10px]"
        : "mt-2 flex flex-col gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-1"
      }
      aria-label={title}
    >
      <div className={compact
        ? "mb-0.5 font-medium text-muted-foreground"
        : "text-[11px] font-medium text-muted-foreground"
      }>
        {title} ({visible.length})
      </div>
      <div className="flex flex-col gap-1">
        {visible.map((claim) => (
          <div key={claim.claimId} className="min-w-0 text-muted-foreground">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <span className="rounded border border-border/60 px-1">
                {t("claims.status")}: {claim.status}
              </span>
              <span className="rounded border border-border/60 px-1">
                {t("claims.confidence")}: {claim.confidence}
              </span>
              {claim.redacted && (
                <span className="rounded border border-border/60 px-1">{t("claims.redacted")}</span>
              )}
            </div>
            <div className="mt-0.5 break-words leading-snug">{claim.text}</div>
            {claim.sourceRefs.length > 0 && (
              <div className="mt-0.5 truncate text-muted-foreground/80">
                {t("claims.source")}: {formatSourceRef(claim.sourceRefs[0], {
                  anchorLabel: t("claims.anchor"),
                  hashLabel: t("claims.hash"),
                  pageLabel: t("claims.page"),
                  lineLabel: t("claims.line"),
                  charsLabel: t("claims.chars"),
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      {(evidence?.length ?? 0) > visible.length && (
        <div className="text-muted-foreground/80">
          {t("claims.more", { count: (evidence?.length ?? 0) - visible.length })}
        </div>
      )}
    </div>
  )
}

function formatSourceRef(
  ref: ClaimEvidence["sourceRefs"][number],
  labels: {
    anchorLabel: string
    hashLabel: string
    pageLabel: string
    lineLabel: string
    charsLabel: string
  },
): string {
  const parts = [ref.path]
  if (typeof ref.page === "number") parts.push(`${labels.pageLabel} ${ref.page}`)
  if (typeof ref.line_start === "number") {
    const line = typeof ref.line_end === "number" && ref.line_end !== ref.line_start
      ? `${ref.line_start}-${ref.line_end}`
      : `${ref.line_start}`
    parts.push(`${labels.lineLabel} ${line}`)
  }
  if (typeof ref.char_start === "number" && typeof ref.char_end === "number") {
    parts.push(`${labels.charsLabel} ${ref.char_start}-${ref.char_end}`)
  }
  if (ref.anchor) parts.push(`${labels.anchorLabel} ${ref.anchor}`)
  if (ref.snippet_hash) parts.push(`${labels.hashLabel} ${ref.snippet_hash}`)
  return parts.join(" · ")
}
