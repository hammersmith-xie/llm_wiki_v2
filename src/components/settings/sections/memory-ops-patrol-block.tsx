import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CircleDot,
  GitBranch,
  History,
  Loader2,
  RefreshCcw,
  SearchCheck,
  ShieldCheck,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AuditEvent } from "@/lib/audit-timeline"
import type { MetadataPatchPlan } from "@/lib/memory-ops-executor"
import type { MemoryOpsPatrolReport } from "@/lib/memory-ops"
import type { MemoryOpsSuggestion } from "@/lib/memory-ops-rules"
import {
  auditEventTargetLabel,
  groupMemoryOpsSuggestionsByCategory,
  metadataPatchDiffLabel,
  summarizeMemoryOpsPatrolReport,
  visibleMemoryOpsSuggestions,
  type MemoryOpsSuggestionCategory,
} from "@/lib/memory-ops-ui"

interface MemoryOpsPatrolBlockProps {
  projectReady: boolean
  running: boolean
  error: string | null
  report: MemoryOpsPatrolReport | null
  recentAuditEvents: readonly AuditEvent[]
  ignoredSuggestionIds: ReadonlySet<string>
  appliedSuggestionIds: ReadonlySet<string>
  dryRunPlans: Record<string, MetadataPatchPlan>
  suggestionErrors: Record<string, string>
  workingSuggestionId: string | null
  onRun: () => void
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
  recentAuditEvents,
  ignoredSuggestionIds,
  appliedSuggestionIds,
  dryRunPlans,
  suggestionErrors,
  workingSuggestionId,
  onRun,
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
              {suggestionGroups.map((group) => (
                <SuggestionCategoryGroup
                  key={group.category}
                  category={group.category}
                  suggestions={group.suggestions}
                  dryRunPlans={dryRunPlans}
                  suggestionErrors={suggestionErrors}
                  workingSuggestionId={workingSuggestionId}
                  onPreview={onPreview}
                  onApply={onApply}
                  onIgnore={onIgnore}
                  onOpen={onOpen}
                />
              ))}
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

function SuggestionCategoryGroup({
  category,
  suggestions,
  dryRunPlans,
  suggestionErrors,
  workingSuggestionId,
  onPreview,
  onApply,
  onIgnore,
  onOpen,
}: {
  category: MemoryOpsSuggestionCategory
  suggestions: MemoryOpsSuggestion[]
  dryRunPlans: Record<string, MetadataPatchPlan>
  suggestionErrors: Record<string, string>
  workingSuggestionId: string | null
  onPreview: (suggestion: MemoryOpsSuggestion) => void
  onApply: (suggestion: MemoryOpsSuggestion) => void
  onIgnore: (suggestion: MemoryOpsSuggestion) => void
  onOpen: (suggestion: MemoryOpsSuggestion) => void
}) {
  const { t } = useTranslation()
  const visibleSuggestions = suggestions.slice(0, 4)
  const extraSuggestionCount = Math.max(0, suggestions.length - visibleSuggestions.length)

  return (
    <div className="space-y-1.5 border-t border-border/60 pt-2 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
        <SuggestionCategoryIcon category={category} />
        <span className="min-w-0 break-words">
          {t(`settings.sections.maintenance.memoryOps.categories.${category}`)}
        </span>
        <span className="text-muted-foreground">({suggestions.length})</span>
      </div>
      {visibleSuggestions.map((suggestion) => (
        <MemoryOpsSuggestionRow
          key={suggestion.id}
          suggestion={suggestion}
          plan={dryRunPlans[suggestion.id]}
          error={suggestionErrors[suggestion.id]}
          working={workingSuggestionId === suggestion.id}
          onPreview={() => onPreview(suggestion)}
          onApply={() => onApply(suggestion)}
          onIgnore={() => onIgnore(suggestion)}
          onOpen={() => onOpen(suggestion)}
        />
      ))}
      {extraSuggestionCount > 0 && (
        <div className="text-xs text-muted-foreground">
          {t("settings.sections.maintenance.memoryOps.moreInCategory", {
            n: extraSuggestionCount,
          })}
        </div>
      )}
    </div>
  )
}

function SuggestionCategoryIcon({ category }: { category: MemoryOpsSuggestionCategory }) {
  const className = "h-3.5 w-3.5 shrink-0 text-muted-foreground"
  if (category === "lifecycle") return <RefreshCcw className={className} />
  if (category === "relation") return <GitBranch className={className} />
  if (category === "contradiction") return <AlertTriangle className={className} />
  if (category === "retention") return <Archive className={className} />
  if (category === "search-health") return <SearchCheck className={className} />
  return <CircleDot className={className} />
}

function MemoryOpsSuggestionRow({
  suggestion,
  plan,
  error,
  working,
  onPreview,
  onApply,
  onIgnore,
  onOpen,
}: {
  suggestion: MemoryOpsSuggestion
  plan: MetadataPatchPlan | undefined
  error: string | undefined
  working: boolean
  onPreview: () => void
  onApply: () => void
  onIgnore: () => void
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const tone =
    suggestion.severity === "warning"
      ? "text-amber-700 dark:text-amber-400"
      : "text-muted-foreground"
  const canApply = !!suggestion.proposedOperation
  const canConfirm = !!plan && canApply && !working

  return (
    <div className="min-w-0 space-y-2 border-t border-border/50 pt-2 text-xs first:border-t-0 first:pt-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="min-w-0 break-words font-medium">{suggestion.title}</div>
        <span className={tone}>{suggestion.severity}</span>
      </div>
      <div className={`${tone} min-w-0`}>
        <code className="break-all font-mono">{suggestion.targetPath}</code>
      </div>
      <div className="break-words text-muted-foreground">{suggestion.detail}</div>

      {suggestion.relation && (
        <div className="break-words text-muted-foreground">
          {t("settings.sections.maintenance.memoryOps.relation")}{" "}
          <code className="break-all font-mono">{suggestion.relation.field}</code>
          {" -> "}
          <code className="break-all font-mono">{suggestion.relation.target}</code>
          {suggestion.relation.candidateTarget ? (
            <>
              {" · "}
              {t("settings.sections.maintenance.memoryOps.candidateTarget", {
                target: suggestion.relation.candidateTarget,
              })}
            </>
          ) : null}
        </div>
      )}

      {suggestion.reasons.length > 0 && (
        <div className="space-y-1 text-muted-foreground">
          <div className="font-medium text-foreground/80">
            {t("settings.sections.maintenance.memoryOps.reasons")}
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {suggestion.reasons.slice(0, 3).map((reason) => (
              <li key={reason} className="break-words">
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan && (
        <div className="space-y-1 rounded border border-border/60 bg-background/80 px-2 py-1.5">
          <div className="font-medium">
            {t("settings.sections.maintenance.memoryOps.diffTitle")}
          </div>
          {plan.diff.length === 0 ? (
            <div className="text-muted-foreground">
              {t("settings.sections.maintenance.memoryOps.noDiff")}
            </div>
          ) : (
            plan.diff.map((diff) => (
              <div key={diff.field} className="font-mono text-[11px] text-muted-foreground">
                {metadataPatchDiffLabel(diff)}
              </div>
            ))
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-rose-700 dark:text-rose-400">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={onOpen}>
          {t("settings.sections.maintenance.memoryOps.openTarget")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onIgnore}>
          {t("settings.sections.maintenance.memoryOps.ignore")}
        </Button>
        {canApply ? (
          <>
            <Button size="sm" variant="ghost" onClick={onPreview} disabled={working}>
              {working ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {t("settings.sections.maintenance.memoryOps.previewDiff")}
            </Button>
            <Button size="sm" onClick={onApply} disabled={!canConfirm}>
              {working ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("settings.sections.maintenance.memoryOps.applying")}
                </>
              ) : (
                t("settings.sections.maintenance.memoryOps.applyMetadata")
              )}
            </Button>
          </>
        ) : (
          <span className="self-center text-xs text-muted-foreground">
            {t("settings.sections.maintenance.memoryOps.reviewOnly")}
          </span>
        )}
      </div>
    </div>
  )
}
