import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { MetadataPatchPlan } from "@/lib/memory-ops-executor"
import type { MemoryOpsBatchResult } from "@/lib/memory-ops-batch"
import type { MemoryOpsSuggestion } from "@/lib/memory-ops-rules"
import type { SchemaDriftFinding } from "@/lib/schema-drift"
import {
  groupMemoryOpsSuggestionsByCategory,
  visibleMemoryOpsSuggestions,
} from "@/lib/memory-ops-ui"
import type { ProjectSchemaQualityScanResult } from "@/lib/schema-quality-project"
import { MemoryOpsSuggestionGroups } from "./memory-ops-suggestion-groups"

interface SchemaQualityPanelProps {
  projectReady: boolean
  running: boolean
  error: string | null
  result: ProjectSchemaQualityScanResult | null
  ignoredSuggestionIds: ReadonlySet<string>
  appliedSuggestionIds: ReadonlySet<string>
  dryRunPlans: Record<string, MetadataPatchPlan>
  suggestionErrors: Record<string, string>
  workingSuggestionId: string | null
  selectedSuggestionIds: ReadonlySet<string>
  batchWorking: boolean
  lastBatchResult: MemoryOpsBatchResult | null
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

export function SchemaQualityPanel({
  projectReady,
  running,
  error,
  result,
  ignoredSuggestionIds,
  appliedSuggestionIds,
  dryRunPlans,
  suggestionErrors,
  workingSuggestionId,
  selectedSuggestionIds,
  batchWorking,
  lastBatchResult,
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
}: SchemaQualityPanelProps) {
  const { t } = useTranslation()
  const report = result?.report ?? null
  const auditError = result?.auditError
  const suggestions = useMemo(
    () =>
      visibleMemoryOpsSuggestions(result?.suggestions ?? [], {
        ignoredIds: ignoredSuggestionIds,
        appliedIds: appliedSuggestionIds,
      }),
    [result, ignoredSuggestionIds, appliedSuggestionIds],
  )
  const suggestionGroups = useMemo(
    () => groupMemoryOpsSuggestionsByCategory(suggestions),
    [suggestions],
  )
  const qualityScores = report?.qualityScores
  const qualityDistribution = useMemo(
    () => qualityBuckets(qualityScores?.map((score) => score.score) ?? []),
    [qualityScores],
  )
  const findingGroups = useMemo(
    () => groupFindingsBySeverity(report?.findings ?? []),
    [report],
  )

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {t("settings.sections.maintenance.schemaQuality.title")}
        </h3>
        <Button
          size="sm"
          className="ml-auto"
          onClick={onRun}
          disabled={!projectReady || running}
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ClipboardCheck className="h-3.5 w-3.5" />
          )}
          {running
            ? t("settings.sections.maintenance.schemaQuality.running")
            : t("settings.sections.maintenance.schemaQuality.run")}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("settings.sections.maintenance.schemaQuality.description")}
      </p>

      {!projectReady && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("settings.sections.maintenance.noProject")}
        </p>
      )}

      {error && (
        <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {!result && !error && (
        <div className="rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs text-muted-foreground">
          {t("settings.sections.maintenance.schemaQuality.notRun")}
        </div>
      )}

      {report && (
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            <MetricBlock
              label={t("settings.sections.maintenance.schemaQuality.contract")}
              value={`${report.summary.contractName} v${report.summary.contractVersion}`}
              detail={
                report.summary.schemaContractFound
                  ? t("settings.sections.maintenance.schemaQuality.contractFound")
                  : t("settings.sections.maintenance.schemaQuality.contractFallback")
              }
            />
            <MetricBlock
              label={t("settings.sections.maintenance.schemaQuality.pages")}
              value={String(report.summary.pageCount)}
              detail={t("settings.sections.maintenance.schemaQuality.averageQuality", {
                score: report.summary.averageQualityScore.toFixed(2),
              })}
            />
            <MetricBlock
              label={t("settings.sections.maintenance.schemaQuality.findings")}
              value={String(report.summary.findingCount)}
              detail={t("settings.sections.maintenance.schemaQuality.findingSplit", {
                warnings: report.summary.warningCount,
                info: report.summary.infoCount,
              })}
            />
            <MetricBlock
              label={t("settings.sections.maintenance.schemaQuality.lowQuality")}
              value={String(report.summary.lowQualityPageCount)}
              detail={qualityDistribution
                .map((bucket) =>
                  t("settings.sections.maintenance.schemaQuality.qualityBucket", bucket),
                )
                .join(" · ")}
            />
          </div>

          {(report.contractWarnings.length > 0 || auditError) && (
            <div className="space-y-1 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
              <div className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t("settings.sections.maintenance.schemaQuality.warnings")}
              </div>
              {report.contractWarnings.map((warning) => (
                <div key={warning} className="break-words">{warning}</div>
              ))}
              {auditError && (
                <div>
                  {t("settings.sections.maintenance.schemaQuality.auditError", {
                    error: auditError,
                  })}
                </div>
              )}
            </div>
          )}

          {findingGroups.length > 0 && (
            <div className="space-y-1 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
              <div className="font-medium">
                {t("settings.sections.maintenance.schemaQuality.topFindings")}
              </div>
              {findingGroups.map((group) => (
                <div key={group.severity} className="space-y-1 border-t border-border/50 pt-1 first:border-t-0 first:pt-0">
                  <div className="font-medium text-muted-foreground">
                    {group.severity} ({group.findings.length})
                  </div>
                  {group.findings.slice(0, 4).map((finding) => (
                    <div key={finding.id} className="space-y-0.5">
                      <div className="break-words">
                        <code className="font-mono">{finding.targetPath}</code>
                      </div>
                      <div className="break-words text-muted-foreground">{finding.title}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {lastBatchResult && (
            <SchemaBatchSummary result={lastBatchResult} />
          )}

          {suggestions.length === 0 ? (
            <div className="flex items-start gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>{t("settings.sections.maintenance.schemaQuality.noSuggestions")}</div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-xs font-medium">
                {t("settings.sections.maintenance.schemaQuality.suggestions")}
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
        </div>
      )}
    </div>
  )
}

function MetricBlock({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words text-sm font-medium">{value}</div>
      <div className="mt-0.5 break-words text-muted-foreground">{detail}</div>
    </div>
  )
}

function SchemaBatchSummary({ result }: { result: MemoryOpsBatchResult }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
      <div className="font-medium">
        {t("settings.sections.maintenance.schemaQuality.batchResult")}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span>{t("settings.sections.maintenance.memoryOps.batchPlanned", { n: result.summary.plannedCount })}</span>
        <span>{t("settings.sections.maintenance.memoryOps.batchApplied", { n: result.summary.appliedCount })}</span>
        <span>{t("settings.sections.maintenance.memoryOps.batchIgnored", { n: result.summary.ignoredCount })}</span>
        <span>{t("settings.sections.maintenance.memoryOps.batchErrors", { n: result.summary.errorCount })}</span>
      </div>
      {result.auditError && (
        <div className="text-amber-700 dark:text-amber-400">
          {t("settings.sections.maintenance.memoryOps.batchAuditFailed", {
            error: result.auditError,
          })}
        </div>
      )}
    </div>
  )
}

function qualityBuckets(scores: readonly number[]): Array<{ label: string; n: number }> {
  return [
    { label: "0-0.39", n: scores.filter((score) => score < 0.4).length },
    { label: "0.40-0.69", n: scores.filter((score) => score >= 0.4 && score < 0.7).length },
    { label: "0.70-1.00", n: scores.filter((score) => score >= 0.7).length },
  ]
}

function groupFindingsBySeverity(
  findings: readonly SchemaDriftFinding[],
): Array<{ severity: string; findings: SchemaDriftFinding[] }> {
  return ["warning", "info"]
    .map((severity) => ({
      severity,
      findings: findings.filter((finding) => finding.severity === severity),
    }))
    .filter((group) => group.findings.length > 0)
}
