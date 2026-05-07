import { useCallback, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Loader2,
  Sparkles,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { listDirectory } from "@/commands/fs"
import {
  buildCrystallizationDigestPlan,
  recordCrystallizationDigestPreview,
  saveCrystallizationDigestPage,
} from "@/lib/crystallization-digest"
import type { CrystallizationCandidate } from "@/lib/crystallize-candidates"
import { normalizePath } from "@/lib/path-utils"
import { useWikiStore } from "@/stores/wiki-store"

interface CrystallizationDigestPreviewProps {
  candidate: CrystallizationCandidate | null
  compact?: boolean
  allowSave?: boolean
  savedPath?: string | null
  onSaved?: (dedupeKey: string) => void
}

export function CrystallizationDigestPreview({
  candidate,
  compact = false,
  allowSave = true,
  savedPath: initialSavedPath = null,
  onSaved,
}: CrystallizationDigestPreviewProps) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const [open, setOpen] = useState(false)
  const [previewRecorded, setPreviewRecorded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(initialSavedPath)
  const [error, setError] = useState<string | null>(null)
  const plan = useMemo(
    () => candidate ? buildCrystallizationDigestPlan({ candidate }) : null,
    [candidate],
  )

  useEffect(() => {
    setSavedPath(initialSavedPath)
  }, [candidate?.dedupeKey, initialSavedPath])

  const handleToggle = useCallback(async () => {
    const nextOpen = !open
    setOpen(nextOpen)
    if (!nextOpen || !project || !plan || previewRecorded) return
    const result = await recordCrystallizationDigestPreview(project.path, plan)
    if (result.auditError) {
      console.warn(`[digest-preview] audit failed: ${result.auditError}`)
    }
    setPreviewRecorded(true)
  }, [open, project, plan, previewRecorded])

  const handleSaveDigest = useCallback(async () => {
    if (!project || !candidate || !plan || saving) return
    const pp = normalizePath(project.path)
    setSaving(true)
    setError(null)
    try {
      const result = await saveCrystallizationDigestPage({
        projectPath: pp,
        candidate,
        plan,
      })
      const tree = await listDirectory(pp)
      setFileTree(tree)
      bumpDataVersion()
      setSavedPath(result.relativePath)
      setSelectedFile(result.filePath)
      setActiveView("wiki")
      onSaved?.(candidate.dedupeKey)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [
    project,
    candidate,
    plan,
    saving,
    setFileTree,
    bumpDataVersion,
    setSelectedFile,
    setActiveView,
    onSaved,
  ])

  if (!candidate || !plan) return null

  return (
    <div className={`${compact ? "max-w-full text-[11px]" : "text-xs"} rounded border border-border/60 bg-background/80`}>
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-muted-foreground hover:bg-accent/50"
        title={t("digest.preview")}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="font-medium text-foreground">{t("digest.preview")}</span>
        <span className="truncate">
          {t("digest.summary", {
            lessons: plan.summary.lessonCount,
            decisions: plan.summary.decisionCount,
            entities: plan.summary.entityCount,
            relations: plan.summary.relationCount,
          })}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-border/60 px-2 py-2">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
            <span>{t("digest.score", { score: plan.source.score.toFixed(2) })}</span>
            {plan.pageCandidates[0] && (
              <span>
                {t("digest.target", {
                  type: plan.pageCandidates[0].type,
                  path: plan.pageCandidates[0].targetPath,
                })}
              </span>
            )}
          </div>

          <DigestList
            title={t("digest.decisions")}
            items={plan.decisions.map((decision) => decision.statement)}
          />
          <DigestList
            title={t("digest.lessons")}
            items={plan.lessons.map((lesson) => lesson.text)}
          />
          <DigestList
            title={t("digest.entities")}
            items={plan.entities.map((entity) =>
              entity.targetPath ? `${entity.name} · ${entity.targetPath}` : entity.name,
            )}
          />
          <DigestList
            title={t("digest.relations")}
            items={plan.relations.map((relation) =>
              `${relation.source} ${relation.field} ${relation.target}`,
            )}
            icon={<GitBranch className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />}
          />

          {plan.warnings.length > 0 && (
            <div className="space-y-0.5 text-amber-700 dark:text-amber-400">
              {plan.warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-1.5 text-rose-700 dark:text-rose-400">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>{error}</div>
            </div>
          )}

          {savedPath ? (
            <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              {t("digest.saved", { path: savedPath })}
            </div>
          ) : allowSave ? (
            <Button size="sm" className="h-7 gap-1 text-xs" onClick={handleSaveDigest} disabled={saving}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <BookmarkPlus className="h-3.5 w-3.5" />
              )}
              {saving ? t("digest.saving") : t("digest.save")}
            </Button>
          ) : (
            <div className="text-muted-foreground">{t("digest.previewOnly")}</div>
          )}
        </div>
      )}
    </div>
  )
}

function DigestList({
  title,
  items,
  icon,
}: {
  title: string
  items: string[]
  icon?: ReactNode
}) {
  if (items.length === 0) return null

  return (
    <div className="space-y-1">
      <div className="font-medium text-foreground">{title}</div>
      <div className="space-y-0.5 text-muted-foreground">
        {items.slice(0, 4).map((item) => (
          <div key={item} className="flex items-start gap-1.5">
            {icon ?? <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />}
            <span className="min-w-0 break-words">{item}</span>
          </div>
        ))}
        {items.length > 4 && <div>+ {items.length - 4}</div>}
      </div>
    </div>
  )
}
