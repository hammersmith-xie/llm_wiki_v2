import { useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  ExternalLink,
  History,
  ListFilter,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type {
  AuditEvent,
  AuditEventCategory,
  AuditTimelineWarning,
} from "@/lib/audit-timeline"
import {
  filterAuditTimelineEvents,
  summarizeAuditTimelineEvent,
  summarizeAuditTimelineWarnings,
  type AuditTimelineEventSummary,
  type AuditTimelineUiFilter,
} from "@/lib/audit-timeline-ui"

const CATEGORY_OPTIONS: Array<AuditEventCategory | "all"> = [
  "all",
  "memory_ops",
  "search",
  "query",
  "ingest",
  "review",
  "crystallize",
  "lifecycle",
  "schema",
  "quality",
  "other",
]

const SCOPE_OPTIONS = ["all", "shared", "private"] as const
const STATUS_OPTIONS = [
  "all",
  "dry-run",
  "applied",
  "ignored",
  "error",
  "restored",
  "conflict",
  "missing",
] as const
const LIMIT_OPTIONS = ["25", "100", "250"] as const
type AuditTimelineScopeOption = (typeof SCOPE_OPTIONS)[number]
type AuditTimelineStatusOption = (typeof STATUS_OPTIONS)[number]
type AuditTimelineLimitOption = (typeof LIMIT_OPTIONS)[number]

interface AuditTimelinePanelProps {
  projectReady: boolean
  events: readonly AuditEvent[]
  warnings: readonly AuditTimelineWarning[]
  openError: string | null
  onRefresh: () => void
  onOpenPath: (path: string) => void
}

export function AuditTimelinePanel({
  projectReady,
  events,
  warnings,
  openError,
  onRefresh,
  onOpenPath,
}: AuditTimelinePanelProps) {
  const { t } = useTranslation()
  const [category, setCategory] = useState<AuditEventCategory | "all">("all")
  const [action, setAction] = useState("")
  const [path, setPath] = useState("")
  const [scope, setScope] = useState<AuditTimelineScopeOption>("all")
  const [status, setStatus] = useState<AuditTimelineStatusOption>("all")
  const [text, setText] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [limit, setLimit] = useState<AuditTimelineLimitOption>("100")

  const filter = useMemo<AuditTimelineUiFilter>(() => ({
    category,
    action: trimmedOrUndefined(action),
    path: trimmedOrUndefined(path),
    scope: scope === "all" ? undefined : scope,
    status: status === "all" ? undefined : status,
    text: trimmedOrUndefined(text),
    dateFrom: datetimeLocalOrUndefined(dateFrom),
    dateTo: datetimeLocalOrUndefined(dateTo),
    limit: Number.parseInt(limit, 10),
  }), [category, action, path, scope, status, text, dateFrom, dateTo, limit])

  const filteredSummaries = useMemo(
    () => filterAuditTimelineEvents(events, filter).map(summarizeAuditTimelineEvent),
    [events, filter],
  )
  const warningSummary = useMemo(() => summarizeAuditTimelineWarnings(warnings), [warnings])
  const hasActiveFilters =
    category !== "all" ||
    !!action.trim() ||
    !!path.trim() ||
    scope !== "all" ||
    status !== "all" ||
    !!text.trim() ||
    !!dateFrom ||
    !!dateTo ||
    limit !== "100"

  const clearFilters = () => {
    setCategory("all")
    setAction("")
    setPath("")
    setScope("all")
    setStatus("all")
    setText("")
    setDateFrom("")
    setDateTo("")
    setLimit("100")
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {t("settings.sections.maintenance.auditTimeline.title")}
        </h3>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={onRefresh}
          disabled={!projectReady}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("settings.sections.maintenance.auditTimeline.refresh")}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("settings.sections.maintenance.auditTimeline.description")}
      </p>

      {!projectReady && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("settings.sections.maintenance.noProject")}
        </p>
      )}

      {warningSummary.count > 0 && (
        <div className="space-y-1 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t("settings.sections.maintenance.auditTimeline.warningTitle", {
              n: warningSummary.count,
            })}
          </div>
          {warnings.slice(0, 5).map((warning) => (
            <div key={`${warning.line}:${warning.message}`} className="break-words">
              {t("settings.sections.maintenance.auditTimeline.warningLine", {
                line: warning.line,
                message: warning.message,
              })}
            </div>
          ))}
        </div>
      )}

      {openError && (
        <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>{openError}</div>
        </div>
      )}

      <div className="space-y-2 rounded border border-border/60 bg-background/80 px-2 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <ListFilter className="h-3.5 w-3.5 text-muted-foreground" />
          {t("settings.sections.maintenance.auditTimeline.filters")}
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <FilterField label={t("settings.sections.maintenance.auditTimeline.category")}>
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as AuditEventCategory | "all")
              }
              className={selectClassName}
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`settings.sections.maintenance.auditTimeline.categories.${option}`)}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label={t("settings.sections.maintenance.auditTimeline.action")}>
            <Input
              value={action}
              onChange={(event) => setAction(event.target.value)}
              placeholder={t("settings.sections.maintenance.auditTimeline.actionPlaceholder")}
              className="h-7 text-xs"
            />
          </FilterField>
          <FilterField label={t("settings.sections.maintenance.auditTimeline.path")}>
            <Input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="wiki/concepts/example.md"
              className="h-7 text-xs"
            />
          </FilterField>
          <FilterField label={t("settings.sections.maintenance.auditTimeline.scope")}>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as AuditTimelineScopeOption)}
              className={selectClassName}
            >
              {SCOPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`settings.sections.maintenance.auditTimeline.scopes.${option}`)}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label={t("settings.sections.maintenance.auditTimeline.status")}>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as AuditTimelineStatusOption)}
              className={selectClassName}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`settings.sections.maintenance.auditTimeline.statuses.${option}`)}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label={t("settings.sections.maintenance.auditTimeline.text")}>
            <Input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("settings.sections.maintenance.auditTimeline.textPlaceholder")}
              className="h-7 text-xs"
            />
          </FilterField>
          <FilterField label={t("settings.sections.maintenance.auditTimeline.dateFrom")}>
            <Input
              type="datetime-local"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-7 text-xs"
            />
          </FilterField>
          <FilterField label={t("settings.sections.maintenance.auditTimeline.dateTo")}>
            <Input
              type="datetime-local"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="h-7 text-xs"
            />
          </FilterField>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <FilterField label={t("settings.sections.maintenance.auditTimeline.limit")}>
            <select
              value={limit}
              onChange={(event) => setLimit(event.target.value as AuditTimelineLimitOption)}
              className={selectClassName}
            >
              {LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </FilterField>
          <Button size="sm" variant="ghost" onClick={clearFilters} disabled={!hasActiveFilters}>
            {t("settings.sections.maintenance.auditTimeline.clearFilters")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {t("settings.sections.maintenance.auditTimeline.matchingEvents", {
            shown: filteredSummaries.length,
            total: events.length,
          })}
        </span>
      </div>

      {filteredSummaries.length === 0 ? (
        <div className="flex items-start gap-1.5 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs text-muted-foreground">
          <Search className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>{t("settings.sections.maintenance.auditTimeline.empty")}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredSummaries.map((summary, index) => (
            <AuditTimelineEventRow
              key={`${summary.timestamp ?? index}:${summary.action}:${summary.targetLabel}`}
              summary={summary}
              projectReady={projectReady}
              onOpenPath={onOpenPath}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FilterField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Label className="flex min-w-0 flex-col items-stretch gap-1 text-xs">
      <span className="block text-muted-foreground">{label}</span>
      {children}
    </Label>
  )
}

function AuditTimelineEventRow({
  summary,
  projectReady,
  onOpenPath,
}: {
  summary: AuditTimelineEventSummary
  projectReady: boolean
  onOpenPath: (path: string) => void
}) {
  const { t } = useTranslation()
  const retrievalResults = summary.event.retrieval?.results?.slice(0, 2) ?? []

  return (
    <div className="space-y-1.5 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <code className="break-all font-mono">{summary.action}</code>
        <span className="text-muted-foreground">
          {t(`settings.sections.maintenance.auditTimeline.categories.${summary.category}`)}
        </span>
        {summary.status && <StatusPill status={summary.status} />}
        {summary.scope && (
          <span className="rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground">
            {summary.scope}
          </span>
        )}
        {summary.timestamp && (
          <span className="text-muted-foreground">{formatTimestamp(summary.timestamp)}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <code className="break-all font-mono text-muted-foreground">{summary.targetLabel}</code>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => onOpenPath(summary.targetLabel)}
          disabled={!projectReady}
        >
          <ExternalLink className="h-3 w-3" />
          {t("settings.sections.maintenance.auditTimeline.openTarget")}
        </Button>
      </div>
      {summary.reasonText && (
        <div className="break-words text-muted-foreground">
          {t("settings.sections.maintenance.auditTimeline.reason", {
            reason: summary.reasonText,
          })}
        </div>
      )}
      {summary.retrievalText && (
        <div className="break-words text-muted-foreground">{summary.retrievalText}</div>
      )}
      {summary.diffText && (
        <div className="break-words text-muted-foreground">
          {t("settings.sections.maintenance.auditTimeline.diff", {
            fields: summary.diffText,
          })}
        </div>
      )}
      {retrievalResults.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {retrievalResults.map((result) => (
            <Button
              key={`${result.path}:${result.rank ?? ""}`}
              size="xs"
              variant="ghost"
              onClick={() => onOpenPath(result.path)}
              disabled={!projectReady}
            >
              <ExternalLink className="h-3 w-3" />
              <span className="max-w-64 truncate">{result.path}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "error" || status === "conflict" || status === "missing"
      ? "border-rose-500/40 text-rose-700 dark:text-rose-400"
      : status === "applied" || status === "restored"
        ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
        : "border-border/60 text-muted-foreground"

  return <span className={`rounded border px-1.5 py-0.5 ${tone}`}>{status}</span>
}

function trimmedOrUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function datetimeLocalOrUndefined(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString()
}

const selectClassName =
  "h-7 w-full min-w-0 rounded-lg border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
