import { AlertTriangle } from "lucide-react"
import type { ConfidenceStalenessAssessment } from "@/lib/confidence-staleness"

interface ConfidenceStaleBadgeProps {
  assessment: ConfidenceStalenessAssessment
  onRunPatrol: () => void
}

export function ConfidenceStaleBadge({
  assessment,
  onRunPatrol,
}: ConfidenceStaleBadgeProps) {
  if (!shouldShowConfidenceStaleBadge(assessment)) return null
  return (
    <ConfidenceStaleBadgeView
      assessment={assessment}
      onRunPatrol={onRunPatrol}
    />
  )
}

export function ConfidenceStaleBadgeView({
  assessment,
  onRunPatrol,
}: ConfidenceStaleBadgeProps) {
  if (
    assessment.daysSinceConfirmed === null ||
    assessment.halfLifeDays === null
  ) {
    return null
  }

  return (
    <div className="mx-4 mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="font-medium">Last confirmed {assessment.daysSinceConfirmed}d ago</span>
      <span className="text-amber-700/80 dark:text-amber-200/80">
        {assessment.tier} half-life {assessment.halfLifeDays}d
      </span>
      <button
        type="button"
        onClick={onRunPatrol}
        className="ml-auto rounded border border-amber-500/30 bg-background/80 px-2 py-0.5 font-medium text-amber-800 transition-colors hover:bg-amber-500/15 dark:text-amber-100"
      >
        Run patrol
      </button>
    </div>
  )
}

export function shouldShowConfidenceStaleBadge(
  assessment: ConfidenceStalenessAssessment,
): boolean {
  return (
    assessment.isStale &&
    assessment.daysSinceConfirmed !== null &&
    assessment.halfLifeDays !== null
  )
}
