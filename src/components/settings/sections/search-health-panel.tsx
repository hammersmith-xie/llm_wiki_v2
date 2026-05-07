import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  SearchCheck,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SearchHealthRunResult } from "@/lib/search-health"

interface SearchHealthPanelProps {
  projectReady: boolean
  running: boolean
  result: SearchHealthRunResult | null
  error: string | null
  onRun: () => void
  onOpenReport: (path: string) => void
}

export function SearchHealthPanel({
  projectReady,
  running,
  result,
  error,
  onRun,
  onOpenReport,
}: SearchHealthPanelProps) {
  const { t } = useTranslation()
  const streamCounts = useMemo(
    () => Object.entries(result?.summary?.streamCounts ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [result],
  )
  const failedScenarios = result?.summary?.failedScenarios ?? []
  const skippedScenarios = result?.skippedScenarios ?? []

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchCheck className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {t("settings.sections.maintenance.searchHealth.title")}
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
            <SearchCheck className="h-3.5 w-3.5" />
          )}
          {running
            ? t("settings.sections.maintenance.searchHealth.running")
            : t("settings.sections.maintenance.searchHealth.run")}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("settings.sections.maintenance.searchHealth.description")}
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
          {t("settings.sections.maintenance.searchHealth.notRun")}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <SearchHealthStatusBlock result={result} />

          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {t("settings.sections.maintenance.searchHealth.scenarios", {
                n: result.scenarioCount,
              })}
            </span>
            {result.summary && (
              <>
                <span>
                  {t("settings.sections.maintenance.searchHealth.passed", {
                    n: result.summary.passedCount,
                  })}
                </span>
                <span>
                  {t("settings.sections.maintenance.searchHealth.failed", {
                    n: result.summary.failedCount,
                  })}
                </span>
              </>
            )}
          </div>

          {result.writtenPath && (
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
              <code className="break-all font-mono text-muted-foreground">{result.writtenPath}</code>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => result.writtenPath && onOpenReport(result.writtenPath)}
              >
                <ExternalLink className="h-3 w-3" />
                {t("settings.sections.maintenance.searchHealth.openReport")}
              </Button>
            </div>
          )}

          {result.writeError && (
            <div className="rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
              {t("settings.sections.maintenance.searchHealth.writeError", {
                error: result.writeError,
              })}
            </div>
          )}

          {result.auditError && (
            <div className="rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
              {t("settings.sections.maintenance.searchHealth.auditError", {
                error: result.auditError,
              })}
            </div>
          )}

          {skippedScenarios.length > 0 && (
            <div className="space-y-1 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
              <div className="font-medium">
                {t("settings.sections.maintenance.searchHealth.skippedTitle")}
              </div>
              {skippedScenarios.slice(0, 5).map((scenario) => (
                <div key={scenario.id} className="break-words text-muted-foreground">
                  <code className="font-mono">{scenario.id}</code>: {scenario.reason}
                </div>
              ))}
            </div>
          )}

          {streamCounts.length > 0 && (
            <div className="space-y-1 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
              <div className="font-medium">
                {t("settings.sections.maintenance.searchHealth.streams")}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                {streamCounts.map(([name, count]) => (
                  <span key={name}>
                    <code className="font-mono">{name}</code>: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {failedScenarios.length > 0 && (
            <div className="space-y-1 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
              <div className="font-medium">
                {t("settings.sections.maintenance.searchHealth.failures")}
              </div>
              {failedScenarios.slice(0, 4).map((scenario) => (
                <div key={scenario.id} className="space-y-0.5 border-t border-rose-500/30 pt-1 first:border-t-0 first:pt-0">
                  <div className="break-words">
                    <code className="font-mono">{scenario.id}</code>: {scenario.query}
                  </div>
                  {scenario.topKPaths.length > 0 && (
                    <div className="break-words">
                      {t("settings.sections.maintenance.searchHealth.topK", {
                        paths: scenario.topKPaths.join(", "),
                      })}
                    </div>
                  )}
                  {scenario.failures.slice(0, 3).map((failure) => (
                    <div key={`${failure.kind}:${failure.expectedPath}`} className="break-words">
                      <span>{failure.message}</span>
                      <span className="ml-1">
                        {t("settings.sections.maintenance.searchHealth.failureMeta", {
                          expected: failure.expectedPath,
                          actualRank: failure.actualRank ?? "-",
                          expectedRank: failure.expectedRank ?? failure.expectedTopK ?? "-",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SearchHealthStatusBlock({ result }: { result: SearchHealthRunResult }) {
  const { t } = useTranslation()

  if (result.status === "pass") {
    return (
      <div className="flex items-start gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>{t("settings.sections.maintenance.searchHealth.pass")}</div>
      </div>
    )
  }

  if (result.status === "skipped") {
    return (
      <div className="flex items-start gap-1.5 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>{t("settings.sections.maintenance.searchHealth.skipped")}</div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>{t("settings.sections.maintenance.searchHealth.fail")}</div>
    </div>
  )
}
