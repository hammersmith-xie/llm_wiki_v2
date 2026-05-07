import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  Copy,
  FileQuestion,
  Lightbulb,
  MessageSquare,
  X,
  Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ReviewItem } from "@/stores/review-store"
import { scoreCrystallizationCandidate } from "@/lib/crystallize-candidates"

const typeConfig: Record<ReviewItem["type"], { icon: typeof AlertTriangle; label: string; color: string }> = {
  contradiction: { icon: AlertTriangle, label: "Contradiction", color: "text-amber-500" },
  duplicate: { icon: Copy, label: "Possible Duplicate", color: "text-blue-500" },
  "missing-page": { icon: FileQuestion, label: "Missing Page", color: "text-purple-500" },
  confirm: { icon: MessageSquare, label: "Needs Confirmation", color: "text-foreground" },
  suggestion: { icon: Lightbulb, label: "Suggestion", color: "text-emerald-500" },
}

export function ReviewCard({
  item,
  onResolve,
  onDismiss,
}: {
  item: ReviewItem
  onResolve: (id: string, action: string) => void
  onDismiss: (id: string) => void
}) {
  const { t } = useTranslation()
  const config = typeConfig[item.type]
  const Icon = config.icon
  const candidate = !item.resolved
    ? scoreCrystallizationCandidate({
        origin: "review",
        sourceId: item.id,
        title: item.title,
        content: [item.title, item.description].filter(Boolean).join("\n\n"),
        references: (item.affectedPages ?? []).map((path) => ({ path })),
        timestamp: item.createdAt,
      })
    : null

  return (
    <div
      className={`rounded-lg border p-3 text-sm transition-opacity ${
        item.resolved ? "opacity-50" : ""
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 shrink-0 ${config.color}`} />
          <span className="font-medium">{item.title}</span>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(item.id)}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
          aria-label={t("review.dismiss")}
          title={t("review.dismiss")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">{item.description}</p>

      {item.affectedPages && item.affectedPages.length > 0 && (
        <div className="mb-3 text-xs text-muted-foreground">
          Pages: {item.affectedPages.join(", ")}
        </div>
      )}

      {candidate && (
        <div className="mb-3 rounded border border-primary/20 bg-primary/5 px-2 py-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t("review.saveSuggested")}</span>{" "}
          {candidate.reasons.slice(0, 2).join(" · ")}
        </div>
      )}

      {!item.resolved ? (
        <div className="flex flex-wrap gap-1.5">
          {(item.type === "suggestion" || item.type === "missing-page") && (
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => onResolve(item.id, "__deep_research__")}
            >
              🔍 Deep Research
            </Button>
          )}
          {item.options.map((opt) => (
            <Button
              key={opt.action}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onResolve(item.id, opt.action)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1 text-xs text-emerald-600">
          <Check className="h-3 w-3" />
          {item.resolvedAction}
        </div>
      )}
    </div>
  )
}
