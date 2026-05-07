import { useCallback } from "react"
import { queueResearch } from "@/lib/deep-research"
import {
  CheckCircle2,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useReviewStore } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"
import { writeFile, readFile, listDirectory, deleteFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { appendReviewResolveAuditEvent } from "@/lib/audit-events"
import { writeCrystallizedQueryPage } from "@/lib/crystallize"
import {
  scoreCrystallizationCandidate,
  writeConfirmedCrystallizationCandidate,
} from "@/lib/crystallize-candidates"
import { makeQueryFileName } from "@/lib/wiki-filename"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import {
  buildReviewCreatedPageContent,
  buildReviewCreatedPageTarget,
} from "@/lib/review-page"
import { ReviewCard } from "./review-card"

export function ReviewView() {
  const items = useReviewStore((s) => s.items)
  const resolveItem = useReviewStore((s) => s.resolveItem)
  const dismissItem = useReviewStore((s) => s.dismissItem)
  const clearResolved = useReviewStore((s) => s.clearResolved)
  const project = useWikiStore((s) => s.project)
  const setFileTree = useWikiStore((s) => s.setFileTree)

  const handleResolve = useCallback(async (id: string, action: string) => {
    const pp = project ? normalizePath(project.path) : ""
    const reviewItem = items.find((i) => i.id === id)
    const resolveWithAudit = (resolvedAction: string, outcome: string = "resolved") => {
      resolveItem(id, resolvedAction)
      if (!project || !reviewItem) return
      appendReviewResolveAuditEvent(pp, {
        item: reviewItem,
        resolvedAction,
        outcome,
      }).catch((err) => {
        console.warn(`[audit] review.resolve failed: ${err instanceof Error ? err.message : err}`)
      })
    }

    // Deep Research — must be checked FIRST before any fuzzy matching
    if (action === "__deep_research__" && project) {
      const searchConfig = useWikiStore.getState().searchApiConfig
      if (searchConfig.provider === "none" || !searchConfig.apiKey) {
        window.alert("Web Search not configured. Go to Settings → Web Search to add a Tavily or SerpApi API key first.")
        return
      }
      const item = items.find((i) => i.id === id)
      if (item) {
        const llmConfig = useWikiStore.getState().llmConfig
        // Use pre-generated search queries if available, otherwise fall back to title
        const topic = item.title.replace(/^(Save to Wiki|Create|Research)[:\s]*/i, "").trim() || item.description.split("\n")[0]
        queueResearch(pp, topic, llmConfig, searchConfig, item.searchQueries)
        resolveWithAudit("Queued for research", "queued")
      } else {
        resolveWithAudit(action)
      }
      return
    }

    if (action.startsWith("save:") && project) {
      // Decode and save the content to wiki
      try {
        const encoded = action.slice(5)
        const content = decodeURIComponent(atob(encoded))

        // Strip hidden comments
        const cleanContent = content
          .replace(/<!--\s*save-worthy:.*?-->/g, "")
          .replace(/<!--\s*sources:.*?-->/g, "")
          .trimEnd()

        // Generate filename
        const firstLine = cleanContent.split("\n").find((l) => l.trim() && !l.startsWith("<!--"))?.replace(/^#+\s*/, "").trim() ?? "Saved Query"
        const title = firstLine.slice(0, 60)
        const { date, fileName } = makeQueryFileName(title)
        const filePath = `${pp}/wiki/queries/${fileName}`

        const item = items.find((i) => i.id === id)
        const candidate = item
          ? scoreCrystallizationCandidate({
              origin: "review",
              sourceId: item.id,
              title,
              content: cleanContent,
              references: (item.affectedPages ?? []).map((path) => ({ path })),
              timestamp: item.createdAt,
            })
          : null

        if (candidate) {
          await writeConfirmedCrystallizationCandidate({
            projectPath: pp,
            filePath,
            date,
            candidate,
            origin: "review-candidate",
          })
        } else {
          await writeCrystallizedQueryPage({
            projectPath: pp,
            filePath,
            title,
            body: cleanContent,
            date,
            origin: "review-save",
            tags: [],
          })
        }

        // Update index
        const indexPath = `${pp}/wiki/index.md`
        let indexContent = ""
        try { indexContent = await readFile(indexPath) } catch { indexContent = "# Wiki Index\n" }
        const linkTarget = fileName.replace(/\.md$/, "")
        const entry = `- [[queries/${linkTarget}|${title}]]`
        if (indexContent.includes("## Queries")) {
          indexContent = indexContent.replace(/(## Queries\n)/, `$1${entry}\n`)
        } else {
          indexContent = indexContent.trimEnd() + "\n\n## Queries\n" + entry + "\n"
        }
        await writeFile(indexPath, indexContent)

        // Append log
        const logPath = `${pp}/wiki/log.md`
        let logContent = ""
        try { logContent = await readFile(logPath) } catch { logContent = "# Wiki Log\n" }
        await writeFile(logPath, logContent.trimEnd() + `\n- ${date}: Saved query page \`${fileName}\`\n`)

        // Refresh tree
        const tree = await listDirectory(pp)
        setFileTree(tree)
        useWikiStore.getState().bumpDataVersion()

        const llmConfig = useWikiStore.getState().llmConfig
        if (hasUsableLlm(llmConfig)) {
          const { autoIngest } = await import("@/lib/ingest")
          autoIngest(pp, filePath, llmConfig).catch((err) =>
            console.error("Failed to auto-ingest review-saved query:", err)
          )
        }

        resolveWithAudit("Saved to Wiki", "saved")
      } catch (err) {
        console.error("Failed to save to wiki from review:", err)
        resolveWithAudit("Save failed", "error")
      }
    } else if (action.startsWith("open:") && project) {
      // Open a page for editing
      const page = action.slice(5)
      const candidates = [
        `${pp}/wiki/${page}`,
        `${pp}/wiki/${page}.md`,
      ]
      for (const path of candidates) {
        try {
          const content = await readFile(path)
          useWikiStore.getState().setSelectedFile(path)
          useWikiStore.getState().setFileContent(content)
          useWikiStore.getState().setActiveView("wiki")
          break
        } catch {
          // try next
        }
      }
      resolveWithAudit(action, "opened")
    } else if (action.startsWith("delete:") && project) {
      // Delete a file
      const filePath = action.slice(7)
      try {
        await deleteFile(filePath)
        const tree = await listDirectory(pp)
        setFileTree(tree)
        resolveWithAudit("Deleted", "deleted")
      } catch (err) {
        console.error("Failed to delete:", err)
        resolveWithAudit("Delete failed", "error")
      }
    } else if (actionLooksLikeResearch(action) && project) {
      // Actions with "research" trigger deep research, not just page creation
      const searchConfig = useWikiStore.getState().searchApiConfig
      if (searchConfig.provider === "none" || !searchConfig.apiKey) {
        // No search API — fall through to create a page instead
        const item = items.find((i) => i.id === id)
        if (item) {
          handleResolve(id, "__create_page__:" + action)
        }
        return
      }
      const item = items.find((i) => i.id === id)
      if (item) {
        const llmConfig = useWikiStore.getState().llmConfig
        const topic = action.replace(/^research\s*/i, "").trim() || item.description.split("\n")[0]
        queueResearch(pp, topic, llmConfig, searchConfig)
        resolveWithAudit("Queued for deep research", "queued")
      } else {
        resolveWithAudit(action)
      }
    } else if (
      (action.startsWith("__create_page__:") || actionLooksLikeCreate(action))
      && project
    ) {
      // Create a wiki page from the review item's content. Accepts both
      // the `__create_page__:` sentinel (forced via the "no search API"
      // fallback branch above) and actions that heuristically look like
      // a create instruction.
      const realAction = action.startsWith("__create_page__:")
        ? action.slice("__create_page__:".length)
        : action
      const item = items.find((i) => i.id === id)
      if (item) {
        try {
          const title = item.title.replace(/^(Create|Save|Add)[:\s]*/i, "").trim() || "Untitled"
          const date = new Date().toISOString().slice(0, 10)

          // Determine page type from review type or action text
          const pageType = detectPageType(realAction, item.type)
          const { dir, fileName, filePath, linkTarget } = buildReviewCreatedPageTarget({
            projectPath: pp,
            pageType,
            title,
            date,
          })

          const content = buildReviewCreatedPageContent({
            pageType,
            title,
            description: item.description,
            date,
          })
          await writeFile(filePath, content)

          // Update index
          const indexPath = `${pp}/wiki/index.md`
          let indexContent = ""
          try { indexContent = await readFile(indexPath) } catch { indexContent = "# Wiki Index\n" }
          const sectionHeader = `## ${dir.charAt(0).toUpperCase() + dir.slice(1)}`
          const entry = `- [[${linkTarget}|${title}]]`
          if (indexContent.includes(sectionHeader)) {
            indexContent = indexContent.replace(new RegExp(`(${sectionHeader}\n)`), `$1${entry}\n`)
          } else {
            indexContent = indexContent.trimEnd() + `\n\n${sectionHeader}\n${entry}\n`
          }
          await writeFile(indexPath, indexContent)

          // Log
          const logPath = `${pp}/wiki/log.md`
          let logContent = ""
          try { logContent = await readFile(logPath) } catch { logContent = "# Wiki Log\n" }
          await writeFile(logPath, logContent.trimEnd() + `\n- ${date}: Created ${pageType} page \`${fileName}\` from review\n`)

          // Refresh
          const tree = await listDirectory(pp)
          setFileTree(tree)
          useWikiStore.getState().bumpDataVersion()

          resolveWithAudit(`Created: wiki/${dir}/${fileName}`, "created")
        } catch (err) {
          console.error("Failed to create page from review:", err)
          resolveWithAudit("Create failed", "error")
        }
      } else {
        resolveWithAudit(action)
      }
    } else {
      resolveWithAudit(action)
    }
  }, [project, items, resolveItem, setFileTree])

  const pending = items.filter((i) => !i.resolved)
  const resolved = items.filter((i) => i.resolved)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          Review
          {pending.length > 0 && (
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
              {pending.length}
            </span>
          )}
        </h2>
        {resolved.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearResolved} className="text-xs">
            <Trash2 className="mr-1 h-3 w-3" />
            Clear resolved
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-muted-foreground/30" />
            <p>All clear — nothing to review</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            {pending.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                onResolve={handleResolve}
                onDismiss={dismissItem}
              />
            ))}
            {resolved.length > 0 && pending.length > 0 && (
              <div className="my-2 text-center text-xs text-muted-foreground">
                — Resolved —
              </div>
            )}
            {resolved.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                onResolve={handleResolve}
                onDismiss={dismissItem}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Detect if an action implies deep research (web search + LLM synthesis) */
function actionLooksLikeResearch(action: string): boolean {
  // Skip internal action identifiers
  if (action.startsWith("__")) return false
  const lower = action.toLowerCase()
  return (
    lower.includes("research") ||
    lower.includes("investigate") ||
    lower.includes("explore") ||
    lower.includes("look into") ||
    lower.includes("研究") ||
    lower.includes("调研") ||
    lower.includes("探索")
  )
}

/** Detect if an action is a dismissal (no-op) or should create a page */
function actionIsDismissal(action: string): boolean {
  const lower = action.toLowerCase()
  return (
    lower === "skip" ||
    lower === "dismiss" ||
    lower === "ignore" ||
    lower === "跳过" ||
    lower === "忽略" ||
    lower === "approve" ||
    lower === "keep existing" ||
    lower === "no"
  )
}

function actionLooksLikeCreate(action: string): boolean {
  // Anything that isn't a dismissal should create a page
  return !actionIsDismissal(action)
}

/** Infer wiki page type from action text and review item type */
function detectPageType(action: string, reviewType: string): string {
  const lower = action.toLowerCase()
  if (lower.includes("entity") || lower.includes("实体")) return "entity"
  if (lower.includes("concept") || lower.includes("概念")) return "concept"
  if (lower.includes("comparison") || lower.includes("compare") || lower.includes("比较")) return "comparison"
  if (lower.includes("synthesis") || lower.includes("综合")) return "synthesis"
  if (reviewType === "missing-page") return "concept"
  if (reviewType === "contradiction") return "query"
  if (reviewType === "suggestion") return "query"
  // Default: research/investigate/create → query
  return "query"
}
