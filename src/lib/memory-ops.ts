import { listDirectory, readFile } from "@/commands/fs"
import {
  appendAuditEvent,
  readAuditTimeline,
  type AuditTimelineResult,
} from "@/lib/audit-timeline"
import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import {
  evaluateLifecycleSuggestions,
  evaluateRelationCleanupSuggestions,
  type MemoryOpsSuggestion,
} from "@/lib/memory-ops-rules"
import { getFileStem, normalizePath } from "@/lib/path-utils"
import {
  extractTypedGraphFromPages,
  type TypedGraph,
} from "@/lib/typed-graph"
import { useActivityStore } from "@/stores/activity-store"
import type { Conversation, DisplayMessage } from "@/stores/chat-store"
import type { ReviewItem } from "@/stores/review-store"
import type { FileNode } from "@/types/wiki"

export interface MemoryOpsWikiPage {
  id: string
  fileName: string
  path: string
  content: string
  frontmatter: Record<string, FrontmatterValue> | null
}

export interface MemoryOpsSnapshotStats {
  pageCount: number
  reviewItemCount: number
  conversationCount: number
  chatMessageCount: number
  auditEventCount: number
  auditWarningCount: number
}

export interface MemoryOpsProjectSnapshot {
  projectPath: string
  dataVersion: number
  pages: MemoryOpsWikiPage[]
  graph: TypedGraph
  audit: AuditTimelineResult
  reviewItems: ReviewItem[]
  conversations: Conversation[]
  chatMessages: DisplayMessage[]
  stats: MemoryOpsSnapshotStats
}

export interface MemoryOpsPatrolStats extends MemoryOpsSnapshotStats {
  suggestionCount: number
}

export interface MemoryOpsPatrolReport {
  snapshot: MemoryOpsProjectSnapshot
  suggestions: MemoryOpsSuggestion[]
  warnings: AuditTimelineResult["warnings"]
  stats: MemoryOpsPatrolStats
}

export async function scanMemoryOpsProject(
  projectPath: string,
  options: { dataVersion?: number } = {},
): Promise<MemoryOpsProjectSnapshot> {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const dataVersion = options.dataVersion ?? 0
  const pages = await readWikiPages(pp)
  const graph = extractTypedGraphFromPages(
    pages.map((page) => ({
      id: page.id,
      fileName: page.fileName,
      path: page.path,
      content: page.content,
    })),
    dataVersion,
  )
  const audit = await readAuditTimeline(pp)
  const reviewItems = await readJsonFile<ReviewItem[]>(`${pp}/.llm-wiki/review.json`, [])
  const conversations = await readJsonFile<Conversation[]>(
    `${pp}/.llm-wiki/conversations.json`,
    [],
  )
  const chatMessages = await readChatMessages(pp, conversations)

  return {
    projectPath: pp,
    dataVersion,
    pages,
    graph,
    audit,
    reviewItems,
    conversations,
    chatMessages,
    stats: {
      pageCount: pages.length,
      reviewItemCount: reviewItems.length,
      conversationCount: conversations.length,
      chatMessageCount: chatMessages.length,
      auditEventCount: audit.events.length,
      auditWarningCount: audit.warnings.length,
    },
  }
}

export async function runMemoryOpsPatrol(
  projectPath: string,
  options: { dataVersion?: number; today?: string } = {},
): Promise<MemoryOpsPatrolReport> {
  const activity = useActivityStore.getState()
  const activityId = activity.addItem({
    type: "maintenance",
    title: "Memory Ops patrol",
    status: "running",
    detail: "Scanning wiki and memory state...",
    filesWritten: [],
  })

  try {
    const snapshot = await scanMemoryOpsProject(projectPath, {
      dataVersion: options.dataVersion,
    })
    const suggestions = [
      ...evaluateLifecycleSuggestions(snapshot, { today: options.today }),
      ...evaluateRelationCleanupSuggestions(snapshot),
    ]
    const report: MemoryOpsPatrolReport = {
      snapshot,
      suggestions,
      warnings: snapshot.audit.warnings,
      stats: {
        ...snapshot.stats,
        suggestionCount: suggestions.length,
      },
    }

    await appendAuditEvent(snapshot.projectPath, {
      action: "memory_ops.patrol",
      targetPath: ".llm-wiki/audit.jsonl",
      after: { stats: report.stats },
      reasons: [
        `${report.stats.pageCount} pages scanned`,
        `${report.stats.suggestionCount} suggestions generated`,
      ],
    })

    useActivityStore.getState().updateItem(activityId, {
      status: "done",
      detail: `Patrol complete: ${report.stats.suggestionCount} suggestion${report.stats.suggestionCount === 1 ? "" : "s"}.`,
    })
    return report
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    useActivityStore.getState().updateItem(activityId, {
      status: "error",
      detail: `Patrol failed: ${message}`,
    })
    throw err
  }
}

async function readWikiPages(projectPath: string): Promise<MemoryOpsWikiPage[]> {
  let tree: FileNode[]
  try {
    tree = await listDirectory(`${projectPath}/wiki`)
  } catch {
    return []
  }

  const pages: MemoryOpsWikiPage[] = []
  for (const file of flattenMdFiles(tree)) {
    try {
      const content = await readFile(file.path)
      const parsed = parseFrontmatter(content)
      pages.push({
        id: getFileStem(file.name),
        fileName: file.name,
        path: normalizePath(file.path),
        content,
        frontmatter: parsed.frontmatter,
      })
    } catch {
      // Unreadable pages should not block project-level maintenance scans.
    }
  }
  return pages
}

async function readChatMessages(
  projectPath: string,
  conversations: readonly Conversation[],
): Promise<DisplayMessage[]> {
  const messages: DisplayMessage[] = []
  for (const conversation of conversations) {
    const filePath = `${projectPath}/.llm-wiki/chats/${conversation.id}.json`
    const conversationMessages = await readJsonFile<DisplayMessage[]>(filePath, [])
    messages.push(...conversationMessages)
  }
  return messages
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path)) as T
  } catch {
    return fallback
  }
}

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}
