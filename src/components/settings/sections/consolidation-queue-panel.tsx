import { Archive, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import type {
  ConsolidationQueueItem,
  ConsolidationQueueStatus,
} from "@/lib/consolidation-queue"

interface ConsolidationQueuePanelProps {
  projectReady: boolean
  loading: boolean
  workingItemId: string | null
  error: string | null
  items: readonly ConsolidationQueueItem[]
  warnings: readonly string[]
  onRefresh: () => void
  onStatusChange: (item: ConsolidationQueueItem, status: ConsolidationQueueStatus) => void
}

export function ConsolidationQueuePanel({
  projectReady,
  loading,
  workingItemId,
  error,
  items,
  warnings,
  onRefresh,
  onStatusChange,
}: ConsolidationQueuePanelProps) {
  const { t } = useTranslation()
  const queuedCount = items.filter((item) => item.status === "queued").length

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Archive className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {t("settings.sections.maintenance.consolidation.title")}
        </h3>
        <span className="rounded border border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {t("settings.sections.maintenance.consolidation.counts", {
            queued: queuedCount,
            total: items.length,
          })}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={onRefresh}
          disabled={!projectReady || loading}
          className="ml-auto"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t("settings.sections.maintenance.consolidation.refresh")}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("settings.sections.maintenance.consolidation.description")}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("settings.sections.maintenance.consolidation.statusNote")}
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
      {warnings.length > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          <div className="font-medium">
            {t("settings.sections.maintenance.consolidation.warnings")}
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {warnings.map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex items-start gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>{t("settings.sections.maintenance.consolidation.empty")}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const working = workingItemId === item.id
            return (
              <div
                key={item.id}
                className="space-y-2 rounded border border-border/60 bg-background/80 p-3 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.sourceTitle}</span>
                  <span className="rounded border border-border/60 px-1 text-muted-foreground">
                    {item.status}
                  </span>
                  <span className="text-muted-foreground">
                    {item.sourceOrigin} · {item.sourceScore.toFixed(2)}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  {t("settings.sections.maintenance.consolidation.summary", {
                    decisions: item.counts.decisionCount,
                    lessons: item.counts.lessonCount,
                    entities: item.counts.entityCount,
                    relations: item.counts.relationCount,
                  })}
                </div>
                {item.targetPaths.length > 0 && (
                  <div className="break-words text-muted-foreground/90">
                    {t("settings.sections.maintenance.consolidation.targets")}:{" "}
                    {item.targetPaths.join(", ")}
                  </div>
                )}
                {item.sourceReasons.length > 0 && (
                  <div className="break-words text-muted-foreground/90">
                    {t("settings.sections.maintenance.consolidation.reasons")}:{" "}
                    {item.sourceReasons.slice(0, 4).join("; ")}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <StatusButton
                    item={item}
                    status="accepted"
                    disabled={working}
                    loading={working}
                    onStatusChange={onStatusChange}
                  />
                  <StatusButton
                    item={item}
                    status="dismissed"
                    disabled={working}
                    loading={working}
                    onStatusChange={onStatusChange}
                  />
                  <StatusButton
                    item={item}
                    status="applied"
                    disabled={working}
                    loading={working}
                    onStatusChange={onStatusChange}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatusButton({
  item,
  status,
  disabled,
  loading,
  onStatusChange,
}: {
  item: ConsolidationQueueItem
  status: ConsolidationQueueStatus
  disabled: boolean
  loading: boolean
  onStatusChange: (item: ConsolidationQueueItem, status: ConsolidationQueueStatus) => void
}) {
  const { t } = useTranslation()
  return (
    <Button
      size="sm"
      variant={item.status === status ? "secondary" : "outline"}
      disabled={disabled || item.status === status}
      onClick={() => onStatusChange(item, status)}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {t(`settings.sections.maintenance.consolidation.${status}`)}
    </Button>
  )
}
