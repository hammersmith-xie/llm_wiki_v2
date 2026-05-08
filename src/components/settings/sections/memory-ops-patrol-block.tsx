import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Loader2,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AuditEvent } from "@/lib/audit-timeline"
import type { MetadataPatchPlan } from "@/lib/memory-ops-executor"
import type { MemoryOpsBatchItem, MemoryOpsBatchResult } from "@/lib/memory-ops-batch"
import type {
  MemoryOpsRollbackPreview,
  MemoryOpsRollbackResult,
} from "@/lib/memory-ops-rollback"
import type { MemoryOpsMaintenanceStatus, MemoryOpsPatrolReport } from "@/lib/memory-ops"
import type { MemoryOpsSuggestion } from "@/lib/memory-ops-rules"
import {
  auditEventTargetLabel,
  groupMemoryOpsSuggestionsByCategory,
  summarizeMemoryOpsPatrolReport,
  visibleMemoryOpsSuggestions,
} from "@/lib/memory-ops-ui"
import type { PersistedSchemaQualitySummaryState } from "@/lib/project-store"
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
  lastBatchResult: MemoryOpsBatchResult | null
  rollbackPreviews: Record<string, MemoryOpsRollbackPreview>
  rollbackResults: Record<string, MemoryOpsRollbackResult>
  rollbackErrors: Record<string, string>
  workingRollbackId: string | null
  onRun: () => void
  onToggleSelection: (suggestion: MemoryOpsSuggestion) => void
  onSelectCategory: (suggestions: MemoryOpsSuggestion[]) => void
  onClearSelection: () => void
  onBatchPreview: () => void
  onBatchApply: () => void
  onBatchIgnore: () => void
  onPreviewRollback: (item: MemoryOpsBatchItem) => void
  onApplyRollback: (item: MemoryOpsBatchItem) => void
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
  lastBatchResult,
  rollbackPreviews,
  rollbackResults,
  rollbackErrors,
  workingRollbackId,
  onRun,
  onToggleSelection,
  onSelectCategory,
  onClearSelection,
  onBatchPreview,
  onBatchApply,
  onBatchIgnore,
  onPreviewRollback,
  onApplyRollback,
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
        <MaintenanceStatusNotice maintenanceStatus={maintenanceStatus} />
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
            <span>
              Claims: {summary.claimCount}
              {summary.staleClaimCount + summary.contradictedClaimCount + summary.supersededClaimCount + summary.orphanClaimCount > 0
                ? ` · ${summary.staleClaimCount} stale · ${summary.contradictedClaimCount} contradicted · ${summary.supersededClaimCount} superseded · ${summary.orphanClaimCount} orphan`
                : ""}
              {summary.reinforcedClaimCount > 0 ? ` · ${summary.reinforcedClaimCount} reinforced` : ""}
            </span>
            {handledSuggestionCount > 0 && (
              <span>
                {t("settings.sections.maintenance.memoryOps.handledSuggestions", {
                  n: handledSuggestionCount,
                })}
              </span>
            )}
          </div>

          <SchemaQualitySummaryBlock summary={summary.schemaQualitySummary} />

          {lastBatchResult && (
            <MemoryOpsBatchSummaryBlock
              result={lastBatchResult}
              rollbackPreviews={rollbackPreviews}
              rollbackResults={rollbackResults}
              rollbackErrors={rollbackErrors}
              workingRollbackId={workingRollbackId}
              onPreviewRollback={onPreviewRollback}
              onApplyRollback={onApplyRollback}
            />
          )}

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

function MaintenanceStatusNotice({
  maintenanceStatus,
}: {
  maintenanceStatus: MemoryOpsMaintenanceStatus
}) {
  const { t } = useTranslation()

  if (maintenanceStatus.status === "reminder-due") {
    return (
      <div className="flex items-start gap-1.5 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="space-y-0.5">
          <div className="font-medium">
            {t("settings.sections.maintenance.memoryOps.patrolReminderTitle")}
          </div>
          <div>
            {t("settings.sections.maintenance.memoryOps.patrolDue", {
              n: maintenanceStatus.eventCountSincePatrol,
            })}
          </div>
        </div>
      </div>
    )
  }

  if (maintenanceStatus.status === "dirty") {
    return (
      <div className="flex items-start gap-1.5 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs text-muted-foreground">
        <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="space-y-0.5">
          <div className="font-medium text-foreground">
            {t("settings.sections.maintenance.memoryOps.patrolDirtyTitle")}
          </div>
          <div>
            {t("settings.sections.maintenance.memoryOps.patrolDirty", {
              n: maintenanceStatus.eventCountSincePatrol,
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-1.5 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs text-muted-foreground">
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
      <div className="space-y-0.5">
        <div className="font-medium text-foreground">
          {maintenanceStatus.lastPatrolAt
            ? t("settings.sections.maintenance.memoryOps.patrolCleanTitle")
            : t("settings.sections.maintenance.memoryOps.patrolNeverTitle")}
        </div>
        <div>
          {maintenanceStatus.lastPatrolAt
            ? t("settings.sections.maintenance.memoryOps.patrolClean", {
                time: new Date(maintenanceStatus.lastPatrolAt).toLocaleString(),
              })
            : t("settings.sections.maintenance.memoryOps.patrolNever")}
        </div>
      </div>
    </div>
  )
}

function SchemaQualitySummaryBlock({
  summary,
}: {
  summary: PersistedSchemaQualitySummaryState | null
}) {
  const { t } = useTranslation()

  if (!summary) {
    return (
      <div className="rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
        <div className="flex items-center gap-1.5 font-medium">
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          {t("settings.sections.maintenance.memoryOps.schemaSummaryTitle")}
        </div>
        <div className="mt-1 text-muted-foreground">
          {t("settings.sections.maintenance.memoryOps.schemaSummaryMissing")}
        </div>
      </div>
    )
  }

  const hasFindings =
    summary.findingCount > 0 ||
    summary.warningCount > 0 ||
    summary.lowQualityPageCount > 0
  const titleTone = hasFindings
    ? "text-amber-700 dark:text-amber-400"
    : "text-emerald-700 dark:text-emerald-400"

  return (
    <div className="space-y-1.5 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
      <div className={`flex items-center gap-1.5 font-medium ${titleTone}`}>
        {hasFindings ? (
          <AlertTriangle className="h-3.5 w-3.5" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        {t("settings.sections.maintenance.memoryOps.schemaSummaryTitle")}
      </div>
      <div className="text-muted-foreground">
        {t(
          summary.dataVersion === undefined
            ? "settings.sections.maintenance.memoryOps.schemaSummaryLatest"
            : "settings.sections.maintenance.memoryOps.schemaSummaryLatestWithVersion",
          {
            time: new Date(summary.scannedAt).toLocaleString(),
            version: summary.dataVersion,
          },
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span>
          {t("settings.sections.maintenance.memoryOps.schemaSummaryContract", {
            name: summary.contractName,
            version: summary.contractVersion,
          })}
          {!summary.schemaContractFound
            ? ` · ${t("settings.sections.maintenance.memoryOps.schemaSummaryFallback")}`
            : ""}
        </span>
        <span>{t("settings.sections.maintenance.memoryOps.pages", { n: summary.pageCount })}</span>
        <span>
          {t("settings.sections.maintenance.memoryOps.schemaSummaryFindings", {
            n: summary.findingCount,
          })}
        </span>
        <span>
          {t("settings.sections.maintenance.memoryOps.schemaSummaryWarnings", {
            n: summary.warningCount,
          })}
        </span>
        <span>
          {t("settings.sections.maintenance.memoryOps.schemaSummaryAverageQuality", {
            score: summary.averageQualityScore.toFixed(2),
          })}
        </span>
        <span>
          {t("settings.sections.maintenance.memoryOps.schemaSummaryLowQuality", {
            n: summary.lowQualityPageCount,
          })}
        </span>
        <span>
          {t("settings.sections.maintenance.memoryOps.schemaSummarySuggestions", {
            n: summary.suggestionCount,
          })}
        </span>
      </div>
      {summary.auditError && (
        <div className="text-amber-700 dark:text-amber-400">
          {t("settings.sections.maintenance.memoryOps.schemaSummaryAuditFailed", {
            error: summary.auditError,
          })}
        </div>
      )}
    </div>
  )
}

function MemoryOpsBatchSummaryBlock({
  result,
  rollbackPreviews,
  rollbackResults,
  rollbackErrors,
  workingRollbackId,
  onPreviewRollback,
  onApplyRollback,
}: {
  result: MemoryOpsBatchResult
  rollbackPreviews: Record<string, MemoryOpsRollbackPreview>
  rollbackResults: Record<string, MemoryOpsRollbackResult>
  rollbackErrors: Record<string, string>
  workingRollbackId: string | null
  onPreviewRollback: (item: MemoryOpsBatchItem) => void
  onApplyRollback: (item: MemoryOpsBatchItem) => void
}) {
  const { t } = useTranslation()
  const summary = result.summary
  const errorItems = result.items.filter((item) => item.status === "error")
  const restorableItems = result.items.filter((item) => item.status === "applied" && item.plan)

  return (
    <div className="space-y-1 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
      <div className="font-medium">
        {t("settings.sections.maintenance.memoryOps.batchResultTitle")}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span>{t("settings.sections.maintenance.memoryOps.batchPlanned", { n: summary.plannedCount })}</span>
        <span>{t("settings.sections.maintenance.memoryOps.batchApplied", { n: summary.appliedCount })}</span>
        <span>{t("settings.sections.maintenance.memoryOps.batchUnchanged", { n: summary.unchangedCount })}</span>
        <span>{t("settings.sections.maintenance.memoryOps.batchIgnored", { n: summary.ignoredCount })}</span>
        <span>{t("settings.sections.maintenance.memoryOps.batchErrors", { n: summary.errorCount })}</span>
      </div>
      {result.auditError && (
        <div className="text-amber-700 dark:text-amber-400">
          {t("settings.sections.maintenance.memoryOps.batchAuditFailed", {
            error: result.auditError,
          })}
        </div>
      )}
      {errorItems.length > 0 && (
        <div className="space-y-0.5 text-rose-700 dark:text-rose-400">
          {errorItems.slice(0, 3).map((item) => (
            <div key={item.suggestionId} className="break-words">
              <code className="font-mono">{item.targetPath}</code>: {item.error}
            </div>
          ))}
        </div>
      )}
      {restorableItems.length > 0 && (
        <div className="space-y-1 border-t border-border/60 pt-1.5">
          <div className="font-medium">
            {t("settings.sections.maintenance.memoryOps.rollbackTitle")}
          </div>
          {restorableItems.slice(0, 3).map((item) => (
            <MemoryOpsRollbackRow
              key={item.suggestionId}
              item={item}
              preview={rollbackPreviews[item.suggestionId]}
              result={rollbackResults[item.suggestionId]}
              error={rollbackErrors[item.suggestionId]}
              working={workingRollbackId === item.suggestionId}
              onPreviewRollback={() => onPreviewRollback(item)}
              onApplyRollback={() => onApplyRollback(item)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MemoryOpsRollbackRow({
  item,
  preview,
  result,
  error,
  working,
  onPreviewRollback,
  onApplyRollback,
}: {
  item: MemoryOpsBatchItem
  preview: MemoryOpsRollbackPreview | undefined
  result: MemoryOpsRollbackResult | undefined
  error: string | undefined
  working: boolean
  onPreviewRollback: () => void
  onApplyRollback: () => void
}) {
  const { t } = useTranslation()
  const restored = result?.status === "restored"
  const canApply = preview?.status === "safe" && !restored && !working
  const statusTone =
    preview?.status === "safe" || restored
      ? "text-emerald-700 dark:text-emerald-400"
      : preview
        ? "text-amber-700 dark:text-amber-400"
        : "text-muted-foreground"

  return (
    <div className="space-y-1 rounded border border-border/50 px-2 py-1.5">
      <div className="min-w-0 break-words">
        <code className="break-all font-mono">{item.targetPath}</code>
      </div>
      {preview && (
        <div className={`flex items-start gap-1.5 ${statusTone}`}>
          {preview.status === "safe" || restored ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <div>
            {rollbackStatusLabel(preview, t)}
            {preview.error ? `: ${preview.error}` : ""}
          </div>
        </div>
      )}
      {result?.auditError && (
        <div className="text-amber-700 dark:text-amber-400">
          {t("settings.sections.maintenance.memoryOps.rollbackAuditFailed", {
            error: result.auditError,
          })}
        </div>
      )}
      {error && !restored && (
        <div className="text-rose-700 dark:text-rose-400">{error}</div>
      )}
      {restored && (
        <div className="text-emerald-700 dark:text-emerald-400">
          {t("settings.sections.maintenance.memoryOps.rollbackRestored")}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={onPreviewRollback} disabled={working || restored}>
          {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t("settings.sections.maintenance.memoryOps.previewRollback")}
        </Button>
        <Button size="sm" onClick={onApplyRollback} disabled={!canApply}>
          {working ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          {t("settings.sections.maintenance.memoryOps.applyRollback")}
        </Button>
      </div>
    </div>
  )
}

function rollbackStatusLabel(
  preview: MemoryOpsRollbackPreview,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (preview.status === "safe") {
    return t("settings.sections.maintenance.memoryOps.rollbackSafe")
  }
  if (preview.status === "conflict") {
    return t("settings.sections.maintenance.memoryOps.rollbackConflict")
  }
  if (preview.status === "missing") {
    return t("settings.sections.maintenance.memoryOps.rollbackMissing")
  }
  return t("settings.sections.maintenance.memoryOps.rollbackError")
}
