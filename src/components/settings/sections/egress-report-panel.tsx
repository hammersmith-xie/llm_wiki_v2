import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { EgressReport } from "@/lib/egress-log"

interface Props {
  projectReady: boolean
  report: EgressReport | null
  loading: boolean
  onRefresh: () => void
}

export function EgressReportPanel({ projectReady, report, loading, onRefresh }: Props) {
  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Egress report</h3>
          <p className="text-xs text-muted-foreground">
            Last 7 days of policy-aware outbound attempts. Hosts are logged without paths, query strings, headers, or payloads.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={!projectReady || loading}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {!projectReady ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Open a project to view egress history.
        </p>
      ) : loading ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Loading egress history...
        </p>
      ) : !report || report.groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          No policy-aware egress attempts recorded in the last 7 days.
        </p>
      ) : (
        <div className="space-y-2">
          {report.groups.map((group) => (
            <div key={group.key} className="rounded-lg border border-border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{group.host}</div>
                  <div className="text-xs text-muted-foreground">
                    {group.feature} / {group.provider} / {group.reason}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">
                    Allowed {group.allowedCount}
                  </span>
                  <span className="rounded-md bg-destructive/10 px-2 py-1 text-destructive">
                    Blocked {group.blockedCount}
                  </span>
                </div>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Last seen {formatTimestamp(group.lastSeenAt)}
              </div>
            </div>
          ))}
        </div>
      )}

      {report && report.warnings.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {report.warnings.length} malformed log {report.warnings.length === 1 ? "line" : "lines"} skipped.
        </p>
      )}
    </section>
  )
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
