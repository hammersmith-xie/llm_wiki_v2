import { useMemo, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  Save,
  SearchCheck,
  Trash2,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SearchEvalScenario } from "@/lib/search-eval"
import type { SearchHealthRunResult } from "@/lib/search-health"

interface SearchHealthPanelProps {
  projectReady: boolean
  running: boolean
  result: SearchHealthRunResult | null
  error: string | null
  customScenarios: readonly SearchEvalScenario[]
  customScenarioDirty: boolean
  customScenarioSaving: boolean
  customScenarioError: string | null
  customScenarioSaved: boolean
  onRun: () => void
  onOpenReport: (path: string) => void
  onAddCustomScenario: () => void
  onUpdateCustomScenario: (index: number, scenario: SearchEvalScenario) => void
  onRemoveCustomScenario: (index: number) => void
  onSaveCustomScenarios: () => void
}

export function SearchHealthPanel({
  projectReady,
  running,
  result,
  error,
  customScenarios,
  customScenarioDirty,
  customScenarioSaving,
  customScenarioError,
  customScenarioSaved,
  onRun,
  onOpenReport,
  onAddCustomScenario,
  onUpdateCustomScenario,
  onRemoveCustomScenario,
  onSaveCustomScenarios,
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
            {result.sourceCounts && (
              <>
                <span>
                  {t("settings.sections.maintenance.searchHealth.builtInCount", {
                    n: result.sourceCounts.builtInScenarioCount,
                  })}
                </span>
                <span>
                  {t("settings.sections.maintenance.searchHealth.customCount", {
                    n: result.sourceCounts.customScenarioCount,
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

      <div className="space-y-2 rounded border border-border/60 bg-background/80 px-2 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs font-medium">
            {t("settings.sections.maintenance.searchHealth.customTitle")}
          </div>
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            onClick={onAddCustomScenario}
            disabled={!projectReady || customScenarioSaving}
          >
            <Plus className="h-3 w-3" />
            {t("settings.sections.maintenance.searchHealth.addScenario")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={onSaveCustomScenarios}
            disabled={!projectReady || customScenarioSaving || !customScenarioDirty}
          >
            {customScenarioSaving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            {t("settings.sections.maintenance.searchHealth.saveScenarios")}
          </Button>
        </div>

        {customScenarioError && (
          <div className="rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
            {customScenarioError}
          </div>
        )}
        {customScenarioSaved && !customScenarioDirty && (
          <div className="rounded border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            {t("settings.sections.maintenance.searchHealth.scenariosSaved")}
          </div>
        )}

        {customScenarios.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            {t("settings.sections.maintenance.searchHealth.noCustomScenarios")}
          </div>
        ) : (
          <div className="space-y-2">
            {customScenarios.map((scenario, index) => (
              <CustomScenarioRow
                key={`${scenario.id}:${index}`}
                scenario={scenario}
                index={index}
                disabled={!projectReady || customScenarioSaving}
                onUpdate={onUpdateCustomScenario}
                onRemove={onRemoveCustomScenario}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CustomScenarioRow({
  scenario,
  index,
  disabled,
  onUpdate,
  onRemove,
}: {
  scenario: SearchEvalScenario
  index: number
  disabled: boolean
  onUpdate: (index: number, scenario: SearchEvalScenario) => void
  onRemove: (index: number) => void
}) {
  const { t } = useTranslation()
  const expectation = scenarioExpectation(scenario)

  return (
    <div className="grid grid-cols-1 gap-2 rounded border border-border/60 px-2 py-2 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_5rem_auto]">
      <CompactField label={t("settings.sections.maintenance.searchHealth.scenarioId")}>
        <Input
          value={scenario.id}
          onChange={(event) => onUpdate(index, { ...scenario, id: event.target.value })}
          disabled={disabled}
          className="h-7 text-xs"
        />
      </CompactField>
      <CompactField label={t("settings.sections.maintenance.searchHealth.scenarioQuery")}>
        <Input
          value={scenario.query}
          onChange={(event) => onUpdate(index, { ...scenario, query: event.target.value })}
          disabled={disabled}
          className="h-7 text-xs"
        />
      </CompactField>
      <CompactField label={t("settings.sections.maintenance.searchHealth.expectationType")}>
        <select
          value={expectation.type}
          onChange={(event) =>
            onUpdate(index, setScenarioExpectation(
              scenario,
              event.target.value as ScenarioExpectationType,
              expectation.path,
              expectation.topK,
            ))
          }
          disabled={disabled}
          className={selectClassName}
        >
          <option value="expectedInTopK">
            {t("settings.sections.maintenance.searchHealth.expectedInTopK")}
          </option>
          <option value="expectedOutsideTopK">
            {t("settings.sections.maintenance.searchHealth.expectedOutsideTopK")}
          </option>
          <option value="expectedTopPaths">
            {t("settings.sections.maintenance.searchHealth.expectedTopPaths")}
          </option>
          <option value="excludedPaths">
            {t("settings.sections.maintenance.searchHealth.excludedPaths")}
          </option>
        </select>
      </CompactField>
      <CompactField label={t("settings.sections.maintenance.searchHealth.expectedPath")}>
        <Input
          value={expectation.path}
          onChange={(event) =>
            onUpdate(index, setScenarioExpectation(
              scenario,
              expectation.type,
              event.target.value,
              expectation.topK,
            ))
          }
          disabled={disabled}
          className="h-7 text-xs"
        />
      </CompactField>
      <CompactField label={t("settings.sections.maintenance.searchHealth.topKValue")}>
        <Input
          value={String(expectation.topK)}
          onChange={(event) =>
            onUpdate(index, setScenarioExpectation(
              scenario,
              expectation.type,
              expectation.path,
              Number.parseInt(event.target.value, 10) || 1,
            ))
          }
          disabled={disabled}
          className="h-7 text-xs"
          inputMode="numeric"
        />
      </CompactField>
      <div className="flex items-end">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onRemove(index)}
          disabled={disabled}
          title={t("settings.sections.maintenance.searchHealth.removeScenario")}
          aria-label={t("settings.sections.maintenance.searchHealth.removeScenario")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

function CompactField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="flex min-w-0 flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </Label>
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

type ScenarioExpectationType =
  | "expectedInTopK"
  | "expectedOutsideTopK"
  | "expectedTopPaths"
  | "excludedPaths"

function scenarioExpectation(scenario: SearchEvalScenario): {
  type: ScenarioExpectationType
  path: string
  topK: number
} {
  if (scenario.expectedOutsideTopK?.[0]) {
    return {
      type: "expectedOutsideTopK",
      path: scenario.expectedOutsideTopK[0].path,
      topK: scenario.expectedOutsideTopK[0].topK,
    }
  }
  if (scenario.expectedTopPaths?.[0]) {
    return {
      type: "expectedTopPaths",
      path: scenario.expectedTopPaths[0],
      topK: scenario.topK ?? 5,
    }
  }
  if (scenario.excludedPaths?.[0]) {
    return {
      type: "excludedPaths",
      path: scenario.excludedPaths[0],
      topK: scenario.topK ?? 5,
    }
  }
  return {
    type: "expectedInTopK",
    path: scenario.expectedInTopK?.[0]?.path ?? "",
    topK: scenario.expectedInTopK?.[0]?.topK ?? scenario.topK ?? 3,
  }
}

function setScenarioExpectation(
  scenario: SearchEvalScenario,
  type: ScenarioExpectationType,
  path: string,
  topK: number,
): SearchEvalScenario {
  const nextTopK = Math.max(1, Math.floor(topK))
  const base = {
    id: scenario.id,
    query: scenario.query,
    topK: nextTopK,
  }
  if (type === "expectedOutsideTopK") {
    return { ...base, expectedOutsideTopK: [{ path, topK: nextTopK }] }
  }
  if (type === "expectedTopPaths") {
    return { ...base, expectedTopPaths: path ? [path] : [] }
  }
  if (type === "excludedPaths") {
    return { ...base, excludedPaths: path ? [path] : [] }
  }
  return { ...base, expectedInTopK: [{ path, topK: nextTopK }] }
}

const selectClassName =
  "h-7 w-full min-w-0 rounded-lg border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
