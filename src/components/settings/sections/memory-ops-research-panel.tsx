import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Microscope,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SaveMemoryOpsResearchReportResult } from "@/lib/memory-ops-research-store"
import type { MemoryOpsResearchEvidenceReport } from "@/lib/memory-ops-research-types"

interface MemoryOpsResearchPanelProps {
  projectReady: boolean
  running: boolean
  report: MemoryOpsResearchEvidenceReport | null
  saveResult: SaveMemoryOpsResearchReportResult | null
  error: string | null
  currentPatrolSuggestionCount: number
  onRun: () => void
  onOpenReport: (path: string) => void
}

export function MemoryOpsResearchPanel({
  projectReady,
  running,
  report,
  saveResult,
  error,
  currentPatrolSuggestionCount,
  onRun,
  onOpenReport,
}: MemoryOpsResearchPanelProps) {
  const { t } = useTranslation()
  const failedResults = useMemo(
    () => report?.results.filter((result) =>
      result.verdict === "contradicted" || result.verdict === "mixed",
    ) ?? [],
    [report],
  )

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Microscope className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {t("settings.sections.maintenance.research.title")}
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
            <Microscope className="h-3.5 w-3.5" />
          )}
          {running
            ? t("settings.sections.maintenance.research.running")
            : t("settings.sections.maintenance.research.run")}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("settings.sections.maintenance.research.description")}
      </p>

      {!projectReady && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("settings.sections.maintenance.noProject")}
        </p>
      )}

      {currentPatrolSuggestionCount > 0 && (
        <div className="rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs text-muted-foreground">
          {t("settings.sections.maintenance.research.currentPatrol", {
            n: currentPatrolSuggestionCount,
          })}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {!report && !error && (
        <div className="rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs text-muted-foreground">
          {t("settings.sections.maintenance.research.notRun")}
        </div>
      )}

      {report && (
        <div className="space-y-2">
          <ResearchSummary report={report} />

          {saveResult?.path && (
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
              <code className="break-all font-mono text-muted-foreground">{saveResult.path}</code>
              <Button size="xs" variant="ghost" onClick={() => onOpenReport(saveResult.path)}>
                <ExternalLink className="h-3 w-3" />
                {t("settings.sections.maintenance.research.openReport")}
              </Button>
            </div>
          )}

          {saveResult?.writeError && (
            <WarningText
              text={t("settings.sections.maintenance.research.writeError", {
                error: saveResult.writeError,
              })}
            />
          )}

          {saveResult?.auditError && (
            <WarningText
              text={t("settings.sections.maintenance.research.auditError", {
                error: saveResult.auditError,
              })}
            />
          )}

          {report.warnings.length > 0 && (
            <div className="space-y-1 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
              <div className="font-medium">
                {t("settings.sections.maintenance.research.warnings")}
              </div>
              {report.warnings.slice(0, 4).map((warning) => (
                <div key={warning} className="break-words">{warning}</div>
              ))}
            </div>
          )}

          {failedResults.length > 0 && (
            <div className="space-y-1 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs">
              <div className="font-medium text-amber-700 dark:text-amber-400">
                {t("settings.sections.maintenance.research.needsReview")}
              </div>
              {failedResults.slice(0, 4).map((result) => (
                <div key={result.candidate.id} className="break-words text-muted-foreground">
                  <code className="font-mono">{result.verdict}</code>{" "}
                  {result.candidate.title} · {result.evidence.length}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
            <div className="font-medium">
              {t("settings.sections.maintenance.research.results")}
            </div>
            {report.results.slice(0, 6).map((result) => (
              <div key={result.candidate.id} className="flex flex-wrap gap-x-2 gap-y-0.5 border-t border-border/60 pt-1 first:border-t-0 first:pt-0">
                <span className="break-words">{result.candidate.title}</span>
                <span className="text-muted-foreground">
                  {t(`settings.sections.maintenance.research.verdicts.${result.verdict}`)}
                </span>
                <span className="text-muted-foreground">
                  {Math.round(result.confidence * 100)}%
                </span>
                <span className="text-muted-foreground">
                  {t("settings.sections.maintenance.research.evidence", {
                    n: result.evidence.length,
                  })}
                </span>
                <span className="text-muted-foreground">
                  {t("settings.sections.maintenance.research.sources", {
                    n: result.evidenceMatrix.uniqueSourceCount,
                  })}
                </span>
                <span className="text-muted-foreground">
                  {t("settings.sections.maintenance.research.diversity", {
                    n: formatPct(result.evidenceMatrix.sourceDiversityScore),
                  })}
                </span>
                <span className="text-muted-foreground">
                  {result.providerResults.map((provider) => provider.provider).join(", ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ResearchSummary({ report }: { report: MemoryOpsResearchEvidenceReport }) {
  const { t } = useTranslation()
  const counts = report.summary.verdictCounts
  const hasContradictions = counts.contradicted + counts.mixed > 0
  return (
    <div className="rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium">
        {hasContradictions ? (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        )}
        {hasContradictions
          ? t("settings.sections.maintenance.research.summaryNeedsReview")
          : t("settings.sections.maintenance.research.summaryOk")}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span>{t("settings.sections.maintenance.research.candidates", { n: report.summary.candidateCount })}</span>
        <span>{t("settings.sections.maintenance.research.providers", { n: report.summary.providerCount })}</span>
        <span>{t("settings.sections.maintenance.research.evidence", { n: report.summary.evidenceCount })}</span>
        <span>{t("settings.sections.maintenance.research.sources", { n: report.summary.uniqueSourceCount })}</span>
        <span>{t("settings.sections.maintenance.research.diversity", { n: formatPct(report.summary.averageSourceDiversityScore) })}</span>
        <span>{t("settings.sections.maintenance.research.supported", { n: counts.supported })}</span>
        <span>{t("settings.sections.maintenance.research.contradicted", { n: counts.contradicted })}</span>
        <span>{t("settings.sections.maintenance.research.mixed", { n: counts.mixed })}</span>
        <span>{t("settings.sections.maintenance.research.insufficient", { n: counts.insufficient })}</span>
        <span>{t("settings.sections.maintenance.research.unavailable", { n: counts.unavailable })}</span>
        <span>{t("settings.sections.maintenance.research.quorumMet", { n: report.summary.quorumCounts.met })}</span>
        <span>{t("settings.sections.maintenance.research.quorumWeak", { n: report.summary.quorumCounts.weak })}</span>
        <span>{t("settings.sections.maintenance.research.quorumConflict", { n: report.summary.quorumCounts.conflict })}</span>
      </div>
    </div>
  )
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function WarningText({ text }: { text: string }) {
  return (
    <div className="rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
      {text}
    </div>
  )
}
