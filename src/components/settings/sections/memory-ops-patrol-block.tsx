import { useTranslation } from "react-i18next"
import {
  CheckCircle2,
  History,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AuditEvent } from "@/lib/audit-timeline"
import type { MetadataPatchPlan } from "@/lib/memory-ops-executor"
import type { MemoryOpsMaintenanceStatus, MemoryOpsPatrolReport } from "@/lib/memory-ops"
import type { MemoryOpsSuggestion } from "@/lib/memory-ops-rules"
import {
  auditEventTargetLabel,
  groupMemoryOpsSuggestionsByCategory,
  summarizeMemoryOpsPatrolReport,
  visibleMemoryOpsSuggestions,
} from "@/lib/memory-ops-ui"
import { MemoryOpsSuggestionGroups } from "./memory-ops-suggestion-groups"

interface MemoryOpsPatrolBlockProps {
  projectReady: boolean
  running: boolean
  error: string | null
  report: MemoryOpsPatrolReport | null
  maintenanceStatus: MemoryOpsMaintenanceStatus | null
  recentAuditEvents: readonly AuditEvent[]
  ignoredSuggestionIds: ReadonlySet<string>
  appliedSuggestionIds: ReadonlySet<string>
  dryRunPlans: Record<string, MetadataPatchPlan>
  suggestionErrors: Record<string, string>
  workingSuggestionId: string | null
  selectedSuggestionIds: ReadonlySet<string>
  batchWorking: boolean
  onRun: () => void
  onToggleSelection: (suggestion: MemoryOpsSuggestion) => void
  onSelectCategory: (suggestions: MemoryOpsSuggestion[]) => void
  onClearSelection: () => void
  onBatchPreview: () => void
  onBatchApply: () => void
  onBatchIgnore: () => void
  onPreview: (suggestion: MemoryOpsSuggestion) => void
  onApply: (suggestion: MemoryOpsSuggestion) => void
  onIgnore: (suggestion: MemoryOpsSuggestion) => void
  onOpen: (suggestion: MemoryOpsSuggestion) => void
}

export function MemoryOpsPatrolBlock({
  projectReady,
  running,
  error,
  report,
  maintenanceStatus,
  recentAuditEvents,
  ignoredSuggestionIds,
  appliedSuggestionIds,
  dryRunPlans,
  suggestionErrors,
  workingSuggestionId,
  selectedSuggestionIds,
  batchWorking,
  onRun,
  onToggleSelection,
  onSelectCategory,
  onClearSelection,
  onBatchPreview,
  onBatchApply,
  onBatchIgnore,
  onPreview,
  onApply,
  onIgnore,
  onOpen,
}: MemoryOpsPatrolBlockProps) {
  const { t } = useTranslation()
  const summary = report ? summarizeMemoryOpsPatrolReport(report) : null
  const activeSuggestions = visibleMemoryOpsSuggestions(report?.suggestions ?? [], {
    ignoredIds: ignoredSuggestionIds,
    appliedIds: appliedSuggestionIds,
  })
  const suggestionGroups = groupMemoryOpsSuggestionsByCategory(activeSuggestions)
  const handledSuggestionCount = Math.max(0, (report?.suggestions.length ?? 0) - activeSuggestions.length)

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {t("settings.sections.maintenance.memoryOps.title")}
        </h3>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("settings.sections.maintenance.memoryOps.description")}
      </p>

      {!projectReady && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("settings.sections.maintenance.noProject")}
        </p>
      )}

      <Button onClick={onRun} disabled={running || !projectReady}>
        {running ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("settings.sections.maintenance.memoryOps.running")}
          </>
        ) : (
          <>
            <ShieldCheck className="h-3.5 w-3.5" />
            {t("settings.sections.maintenance.memoryOps.runButton")}
          </>
        )}
      </Button>

      {maintenanceStatus && (
        <div className="rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs text-muted-foreground">
          {maintenanceStatus.needsPatrol ? (
            t("settings.sections.maintenance.memoryOps.patrolDue", {
              n: maintenanceStatus.eventCountSincePatrol,
            })
          ) : maintenanceStatus.lastPatrolAt ? (
            t("settings.sections.maintenance.memoryOps.patrolClean", {
              time: new Date(maintenanceStatus.lastPatrolAt).toLocaleString(),
            })
          ) : (
            t("settings.sections.maintenance.memoryOps.patrolNever")
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            {t("settings.sections.maintenance.memoryOps.failed")} {error}
          </div>
        </div>
      )}

      {summary && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{t("settings.sections.maintenance.memoryOps.pages", { n: summary.pageCount })}</span>
            <span>{t("settings.sections.maintenance.memoryOps.suggestions", { n: activeSuggestions.length })}</span>
            <span>{t("settings.sections.maintenance.memoryOps.auditEvents", { n: summary.auditEventCount })}</span>
            <span>{t("settings.sections.maintenance.memoryOps.warnings", { n: summary.warningCount })}</span>
            <span>{t("settings.sections.maintenance.memoryOps.stalePages", { n: summary.stalePageCount })}</span>
            <span>{t("settings.sections.maintenance.memoryOps.riskPages", { n: summary.riskPageCount })}</span>
            {handledSuggestionCount > 0 && (
              <span>
                {t("settings.sections.maintenance.memoryOps.handledSuggestions", {
                  n: handledSuggestionCount,
                })}
              </span>
            )}
          </div>

          {activeSuggestions.length === 0 ? (
            <div className="flex items-start gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>{t("settings.sections.maintenance.memoryOps.noSuggestions")}</div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-xs font-medium">
                {t("settings.sections.maintenance.memoryOps.suggestionPreview")}
              </div>
              <MemoryOpsSuggestionGroups
                groups={suggestionGroups}
                dryRunPlans={dryRunPlans}
                suggestionErrors={suggestionErrors}
                workingSuggestionId={workingSuggestionId}
                selectedSuggestionIds={selectedSuggestionIds}
                batchWorking={batchWorking}
                onToggleSelection={onToggleSelection}
                onSelectCategory={onSelectCategory}
                onClearSelection={onClearSelection}
                onBatchPreview={onBatchPreview}
                onBatchApply={onBatchApply}
                onBatchIgnore={onBatchIgnore}
                onPreview={onPreview}
                onApply={onApply}
                onIgnore={onIgnore}
                onOpen={onOpen}
              />
            </div>
          )}

          {report && report.warnings.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
                {t("settings.sections.maintenance.memoryOps.auditWarnings")}
              </div>
              {report.warnings.slice(0, 3).map((warning) => (
                <div
                  key={`${warning.line}:${warning.message}`}
                  className="text-xs text-amber-700 dark:text-amber-400"
                >
                  {t("settings.sections.maintenance.memoryOps.auditWarningLine", {
                    line: warning.line,
                    message: warning.message,
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5 border-t border-border/60 pt-3">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          {t("settings.sections.maintenance.memoryOps.recentAudit")}
        </div>
        {recentAuditEvents.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            {t("settings.sections.maintenance.memoryOps.noAudit")}
          </div>
        ) : (
          <div className="space-y-1">
            {recentAuditEvents.map((event, idx) => (
              <div
                key={`${event.timestamp ?? idx}:${event.action}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
              >
                <code className="font-mono">{event.action}</code>
                <span className="text-muted-foreground">{auditEventTargetLabel(event)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
