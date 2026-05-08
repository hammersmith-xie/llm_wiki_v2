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
                {t("claims.source")}: {claim.sourceRefs[0].path}
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
