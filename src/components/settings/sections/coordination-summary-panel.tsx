import { Children, useMemo, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  Activity,
  AlertTriangle,
  ExternalLink,
  Filter,
  GitPullRequest,
  History,
  Shield,
  UserRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type {
  CoordinationBlockedFinding,
  CoordinationPendingReview,
  CoordinationSummary,
} from "@/lib/coordination-summary"

interface CoordinationSummaryPanelProps {
  projectReady: boolean
  summary: CoordinationSummary
  onOpenPath: (path: string) => void
  onFilterTimeline: (path: string) => void
}

export function CoordinationSummaryPanel({
  projectReady,
  summary,
  onOpenPath,
  onFilterTimeline,
}: CoordinationSummaryPanelProps) {
  const { t } = useTranslation()
  const generatedAt = useMemo(
    () => new Date(summary.generatedAt).toLocaleString(),
    [summary.generatedAt],
  )

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {t("settings.sections.maintenance.coordination.title")}
        </h3>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("settings.sections.maintenance.coordination.description")}
      </p>

      {!projectReady && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("settings.sections.maintenance.noProject")}
        </p>
      )}

      <div className="grid gap-2 md:grid-cols-3">
        <Metric
          label={t("settings.sections.maintenance.coordination.auditEvents")}
          value={summary.totals.auditEventCount}
          detail={t("settings.sections.maintenance.coordination.generatedAt", {
            time: generatedAt,
          })}
        />
        <Metric
          label={t("settings.sections.maintenance.coordination.pendingReviews")}
          value={summary.totals.pendingReviewCount}
          detail={t("settings.sections.maintenance.coordination.blockedFindings", {
            n: summary.totals.blockedFindingCount,
          })}
        />
        <Metric
          label={t("settings.sections.maintenance.coordination.privateEvents")}
          value={summary.totals.privateEventCount}
          detail={t("settings.sections.maintenance.coordination.targets", {
            n: summary.totals.targetCount,
          })}
        />
      </div>

      {summary.totals.auditEventCount === 0 &&
        summary.totals.pendingReviewCount === 0 &&
        summary.totals.blockedFindingCount === 0 && (
          <div className="rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs text-muted-foreground">
            {t("settings.sections.maintenance.coordination.empty")}
          </div>
        )}

      <Section
        icon={<UserRound className="h-3.5 w-3.5 text-muted-foreground" />}
        title={t("settings.sections.maintenance.coordination.actors")}
        empty={t("settings.sections.maintenance.coordination.noActors")}
      >
        {summary.actors.slice(0, 5).map((actor) => (
          <div
            key={actor.actor}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs"
          >
            <span className="font-medium">{actor.actor}</span>
            <span className="text-muted-foreground">
              {t("settings.sections.maintenance.coordination.actorEvents", {
                n: actor.eventCount,
              })}
            </span>
            {actor.lastAction && <code className="font-mono">{actor.lastAction}</code>}
            {actor.lastTimestamp && (
              <span className="text-muted-foreground">
                {new Date(actor.lastTimestamp).toLocaleString()}
              </span>
            )}
          </div>
        ))}
      </Section>

      <Section
        icon={<History className="h-3.5 w-3.5 text-muted-foreground" />}
        title={t("settings.sections.maintenance.coordination.recentEvents")}
        empty={t("settings.sections.maintenance.coordination.noRecentEvents")}
      >
        {summary.recentEvents.slice(0, 5).map((event, index) => (
          <PathRow
            key={`${event.timestamp ?? index}:${event.action}:${event.targetPath}`}
            title={event.action}
            path={event.targetPath}
            detail={
              event.private
                ? t("settings.sections.maintenance.coordination.privateRedacted")
                : event.reasonText
            }
            meta={[
              event.actor,
              event.status,
              event.scope,
              event.timestamp ? new Date(event.timestamp).toLocaleString() : undefined,
            ]}
            projectReady={projectReady}
            onOpenPath={onOpenPath}
            onFilterTimeline={onFilterTimeline}
          />
        ))}
      </Section>

      <Section
        icon={<GitPullRequest className="h-3.5 w-3.5 text-muted-foreground" />}
        title={t("settings.sections.maintenance.coordination.pendingReviewsTitle")}
        empty={t("settings.sections.maintenance.coordination.noPendingReviews")}
      >
        {summary.pendingReviews.slice(0, 5).map((review) => (
          <ReviewRow
            key={review.id}
            review={review}
            projectReady={projectReady}
            onOpenPath={onOpenPath}
            onFilterTimeline={onFilterTimeline}
          />
        ))}
      </Section>

      <Section
        icon={<AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />}
        title={t("settings.sections.maintenance.coordination.blockedFindingsTitle")}
        empty={t("settings.sections.maintenance.coordination.noBlockedFindings")}
      >
        {summary.blockedFindings.slice(0, 5).map((finding) => (
          <FindingRow
            key={finding.id}
            finding={finding}
            projectReady={projectReady}
            onOpenPath={onOpenPath}
            onFilterTimeline={onFilterTimeline}
          />
        ))}
      </Section>

      <Section
        icon={<Shield className="h-3.5 w-3.5 text-muted-foreground" />}
        title={t("settings.sections.maintenance.coordination.promotionCandidatesTitle")}
        empty={t("settings.sections.maintenance.coordination.noPromotionCandidates")}
      >
        {summary.promotionCandidates.slice(0, 5).map((candidate) => (
          <PathRow
            key={candidate.targetPath}
            title={t("settings.sections.maintenance.coordination.promotionCandidate")}
            path={candidate.targetPath}
            detail={candidate.reason}
            meta={[
              candidate.lastTimestamp
                ? new Date(candidate.lastTimestamp).toLocaleString()
                : undefined,
            ]}
            projectReady={projectReady}
            onOpenPath={onOpenPath}
            onFilterTimeline={onFilterTimeline}
          />
        ))}
      </Section>
    </div>
  )
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string
  value: number
  detail: string
}) {
  return (
    <div className="rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
      <div className="text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold leading-tight">{value}</div>
      <div className="text-muted-foreground">{detail}</div>
    </div>
  )
}

function Section({
  icon,
  title,
  empty,
  children,
}: {
  icon: ReactNode
  title: string
  empty: string
  children: ReactNode
}) {
  const hasChildren = Children.count(children) > 0

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        {icon}
        {title}
      </div>
      <div className="space-y-1.5">
        {hasChildren ? children : (
          <div className="rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs text-muted-foreground">
            {empty}
          </div>
        )}
      </div>
    </div>
  )
}

function ReviewRow({
  review,
  projectReady,
  onOpenPath,
  onFilterTimeline,
}: {
  review: CoordinationPendingReview
  projectReady: boolean
  onOpenPath: (path: string) => void
  onFilterTimeline: (path: string) => void
}) {
  return (
    <PathRow
      title={review.title}
      path={review.targetPath ?? review.sourcePath ?? ".llm-wiki/review.json"}
      detail={review.type}
      meta={[`${review.optionCount} options`, new Date(review.createdAt).toLocaleString()]}
      projectReady={projectReady}
      onOpenPath={onOpenPath}
      onFilterTimeline={onFilterTimeline}
    />
  )
}

function FindingRow({
  finding,
  projectReady,
  onOpenPath,
  onFilterTimeline,
}: {
  finding: CoordinationBlockedFinding
  projectReady: boolean
  onOpenPath: (path: string) => void
  onFilterTimeline: (path: string) => void
}) {
  return (
    <PathRow
      title={finding.title}
      path={finding.targetPath}
      detail={finding.kind}
      meta={[
        finding.severity,
        finding.field,
        finding.candidateTarget,
        finding.reviewOnly ? "review-only" : "patchable",
      ]}
      projectReady={projectReady}
      onOpenPath={onOpenPath}
      onFilterTimeline={onFilterTimeline}
    />
  )
}

function PathRow({
  title,
  path,
  detail,
  meta,
  projectReady,
  onOpenPath,
  onFilterTimeline,
}: {
  title: string
  path: string
  detail?: string
  meta: Array<string | undefined>
  projectReady: boolean
  onOpenPath: (path: string) => void
  onFilterTimeline: (path: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1 rounded border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{title}</span>
        {meta.filter(Boolean).map((value) => (
          <span key={value} className="text-muted-foreground">{value}</span>
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <code className="break-all font-mono text-muted-foreground">{path}</code>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => onOpenPath(path)}
          disabled={!projectReady}
        >
          <ExternalLink className="h-3 w-3" />
          {t("settings.sections.maintenance.coordination.open")}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => onFilterTimeline(path)}
          disabled={!projectReady}
        >
          <Filter className="h-3 w-3" />
          {t("settings.sections.maintenance.coordination.filterTimeline")}
        </Button>
      </div>
      {detail && <div className="break-words text-muted-foreground">{detail}</div>}
    </div>
  )
}
