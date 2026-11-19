import { useTranslation } from "react-i18next"
import type { MemoryOpsSuggestionDecision } from "@/lib/memory-ops-types"

interface MemoryOpsDecisionGateProps {
  decision: MemoryOpsSuggestionDecision | undefined
}

export function MemoryOpsDecisionBadge({ decision }: MemoryOpsDecisionGateProps) {
  const { t } = useTranslation()
  if (!decision) return null

  return (
    <span className="text-muted-foreground">
      {t(`settings.sections.maintenance.memoryOps.decisions.${decision.kind}`)}
    </span>
  )
}

export function MemoryOpsDecisionGate({ decision }: MemoryOpsDecisionGateProps) {
  const { t } = useTranslation()
  if (!decision || decision.reasons.length === 0) return null

  return (
    <div className="space-y-1 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-muted-foreground">
      <div className="font-medium text-foreground/80">
        {t("settings.sections.maintenance.memoryOps.decision")}
      </div>
      <ul className="list-disc space-y-0.5 pl-4">
        {decision.reasons.slice(0, 2).map((reason) => (
          <li key={reason} className="break-words">
            {reason}
          </li>
        ))}
      </ul>
    </div>
  )
}
