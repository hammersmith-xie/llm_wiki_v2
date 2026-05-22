import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Loader2,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SaveMemoryOpsEvalReportResult } from "@/lib/memory-ops-eval-store"
import type { MemoryOpsEvalReport } from "@/lib/memory-ops-eval-types"

interface MemoryOpsEvalPanelProps {
  projectReady: boolean
  running: boolean
  report: MemoryOpsEvalReport | null
  saveResult: SaveMemoryOpsEvalReportResult | null
  error: string | null
  onRun: () => void
  onOpenReport: (path: string) => void
}

export function MemoryOpsEvalPanel({
  projectReady,
  running,
  report,
  saveResult,
  error,
  onRun,
  onOpenReport,
}: MemoryOpsEvalPanelProps) {
  const { t } = useTranslation()
  const failedCases = report?.cases.filter((item) => !item.passed) ?? []

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {t("settings.sections.maintenance.eval.title")}
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
            <BarChart3 className="h-3.5 w-3.5" />
          )}
          {running
            ? t("settings.sections.maintenance.eval.running")
            : t("settings.sections.maintenance.eval.run")}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("settings.sections.maintenance.eval.description")}
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

      {!report && !error && (
        <div className="rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs text-muted-foreground">
          {t("settings.sections.maintenance.eval.notRun")}
        </div>
      )}

      {report && (
        <div className="space-y-2">
          <EvalSummary report={report} />

          {report.variants && report.variants.length > 0 && (
            <div className="space-y-1 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
              <div className="font-medium">
                {t("settings.sections.maintenance.eval.variants")}
              </div>
              {report.variants.map((variant) => {
                const regressions = variant.caseComparisons.filter((item) => item.regressed)
                return (
                  <div key={variant.id} className="space-y-1 border-t border-border/60 pt-1 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                      <span className="break-words">{variant.title}</span>
                      <span className="text-muted-foreground">
                        {t("settings.sections.maintenance.eval.score", {
                          n: formatPct(variant.metrics.patrolScore),
                        })}
                      </span>
                      <span className="text-muted-foreground">
                        Δ {formatSignedPct(variant.scoreDelta)}
                      </span>
                      <span className="text-muted-foreground">
                        {t("settings.sections.maintenance.eval.f1", {
                          n: formatPct(variant.metrics.f1),
                        })}
                      </span>
                      <span className="text-muted-foreground">
                        Δ {formatSignedPct(variant.f1Delta)}
                      </span>
                      <span className={variant.regressionCount > 0 ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground"}>
                        {t("settings.sections.maintenance.eval.variantRegressions", {
                          n: variant.regressionCount,
                        })}
                      </span>
                      <span className="text-muted-foreground">
                        {t("settings.sections.maintenance.eval.variantImprovements", {
                          n: variant.improvementCount,
                        })}
                      </span>
                    </div>
                    {regressions.slice(0, 3).map((item) => (
                      <div key={item.id} className="text-muted-foreground">
                        {t("settings.sections.maintenance.eval.caseDelta", {
                          title: item.title,
                          delta: formatSignedPct(item.scoreDelta),
                          score: formatPct(item.candidateScore),
                        })}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}

          {saveResult?.path && (
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
              <code className="break-all font-mono text-muted-foreground">{saveResult.path}</code>
              <Button size="xs" variant="ghost" onClick={() => onOpenReport(saveResult.path)}>
                <ExternalLink className="h-3 w-3" />
                {t("settings.sections.maintenance.eval.openReport")}
              </Button>
            </div>
          )}

          {saveResult?.writeError && (
            <WarningText
              text={t("settings.sections.maintenance.eval.writeError", {
                error: saveResult.writeError,
              })}
            />
          )}

          {saveResult?.auditError && (
            <WarningText
              text={t("settings.sections.maintenance.eval.auditError", {
                error: saveResult.auditError,
              })}
            />
          )}

          {failedCases.length > 0 && (
            <div className="space-y-1 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
              <div className="font-medium">
                {t("settings.sections.maintenance.eval.failures")}
              </div>
              {failedCases.slice(0, 5).map((item) => (
                <div key={item.id} className="space-y-0.5 border-t border-rose-500/30 pt-1 first:border-t-0 first:pt-0">
                  <div>
                    <code className="font-mono">{item.id}</code>: {item.title}
                  </div>
                  <div>
                    {t("settings.sections.maintenance.eval.caseCounts", {
                      matched: item.matchedCount,
                      expected: item.expectedCount,
                      fp: item.falsePositiveCount,
                      fn: item.falseNegativeCount,
                    })}
                  </div>
                  {item.failureReasons.length > 0 && (
                    <div>{item.failureReasons.join(" · ")}</div>
                  )}
                  <div>
                    {t("settings.sections.maintenance.eval.caseScore", {
                      score: formatPct(item.scoreBreakdown.total),
                      match: formatPct(item.scoreBreakdown.match),
                      safety: formatPct(item.scoreBreakdown.safety),
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
            <div className="font-medium">
              {t("settings.sections.maintenance.eval.cases")}
            </div>
            {report.cases.map((item) => (
              <div key={item.id} className="flex flex-wrap gap-x-2 gap-y-0.5 border-t border-border/60 pt-1 first:border-t-0 first:pt-0">
                <span className="break-words">{item.title}</span>
                <span className={item.passed ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}>
                  {item.passed
                    ? t("settings.sections.maintenance.eval.passed")
                    : t("settings.sections.maintenance.eval.failed")}
                </span>
                <span className="text-muted-foreground">
                  {t("settings.sections.maintenance.eval.caseCounts", {
                    matched: item.matchedCount,
                    expected: item.expectedCount,
                    fp: item.falsePositiveCount,
                    fn: item.falseNegativeCount,
                  })}
                </span>
                <span className="text-muted-foreground">
                  {t("settings.sections.maintenance.eval.score", {
                    n: formatPct(item.scoreBreakdown.total),
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EvalSummary({ report }: { report: MemoryOpsEvalReport }) {
  const { t } = useTranslation()
  const failed = report.metrics.failedCaseCount > 0
  const gateFailed = report.gate.status === "fail"
  return (
    <div className="rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium">
        {failed || gateFailed ? (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        )}
        {failed || gateFailed
          ? t("settings.sections.maintenance.eval.summaryNeedsReview")
          : t("settings.sections.maintenance.eval.summaryOk")}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span>{t("settings.sections.maintenance.eval.caseTotal", { n: report.metrics.caseCount })}</span>
        <span>{t("settings.sections.maintenance.eval.passedCount", { n: report.metrics.passedCaseCount })}</span>
        <span>{t("settings.sections.maintenance.eval.failedCount", { n: report.metrics.failedCaseCount })}</span>
        <span>{t("settings.sections.maintenance.eval.precision", { n: formatPct(report.metrics.precision) })}</span>
        <span>{t("settings.sections.maintenance.eval.recall", { n: formatPct(report.metrics.recall) })}</span>
        <span>{t("settings.sections.maintenance.eval.f1", { n: formatPct(report.metrics.f1) })}</span>
        <span>{t("settings.sections.maintenance.eval.score", { n: formatPct(report.metrics.patrolScore) })}</span>
        <span>{t("settings.sections.maintenance.eval.scoreBreakdown", {
          match: formatPct(report.metrics.scoreBreakdown.match),
          safety: formatPct(report.metrics.scoreBreakdown.safety),
        })}</span>
        <span>{t("settings.sections.maintenance.eval.safePatches", { n: report.metrics.safePatchCount })}</span>
        <span>{t(`settings.sections.maintenance.eval.decisions.${report.gate.decision}`)}</span>
      </div>
      {report.gate.reasons.length > 0 && (
        <div className="mt-1 text-muted-foreground">
          {report.gate.reasons.slice(0, 2).join(" · ")}
        </div>
      )}
    </div>
  )
}

function WarningText({ text }: { text: string }) {
  return (
    <div className="rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
      {text}
    </div>
  )
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatSignedPct(value: number): string {
  const percent = Math.round(value * 100)
  return `${percent >= 0 ? "+" : ""}${percent}%`
}
