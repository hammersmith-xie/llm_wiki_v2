import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import {
  readPostIngestLintHints,
  type IngestLintHints,
} from "@/lib/ingest-lint-hints"
import { getFileName } from "@/lib/path-utils"
import { useWikiStore } from "@/stores/wiki-store"

export function PostIngestLintBadge({ projectPath }: { projectPath: string }) {
  const [hints, setHints] = useState<IngestLintHints | null>(null)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const dataVersion = useWikiStore((s) => s.dataVersion)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const next = await readPostIngestLintHints(projectPath)
      if (!cancelled) setHints(next)
    }

    void check()
    const timer = setInterval(check, 3_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [projectPath, dataVersion])

  return (
    <PostIngestLintBadgeView
      hints={hints}
      onOpenLint={() => setActiveView("lint")}
    />
  )
}

export function PostIngestLintBadgeView({
  hints,
  onOpenLint,
}: {
  hints: IngestLintHints | null
  onOpenLint: () => void
}) {
  if (!shouldShowPostIngestLintBadge(hints)) return null

  const count = hints.totalCount
  const label = `${count} lint hint${count === 1 ? "" : "s"} from last ingest`
  const sourceName = getFileName(hints.sourcePath)

  return (
    <button
      type="button"
      onClick={onOpenLint}
      className="mx-3 mt-2 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900 hover:bg-amber-100"
      title="Open Lint panel"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{label}</span>
        <span className="block truncate text-amber-800/80">{sourceName}</span>
      </span>
    </button>
  )
}

export function shouldShowPostIngestLintBadge(
  hints: IngestLintHints | null,
): hints is IngestLintHints {
  return Boolean(hints && hints.totalCount > 0)
}
