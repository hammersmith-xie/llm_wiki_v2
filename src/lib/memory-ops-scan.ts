import { listDirectory, readFile } from "@/commands/fs"
import { readAuditTimeline } from "@/lib/audit-timeline"
import { readClaimIndex } from "@/lib/claims"
import { parseFrontmatter } from "@/lib/frontmatter"
import {
  attachPageEvidence,
  summarizeClaimHealth,
  summarizeEvidenceStats,
} from "@/lib/memory-ops-evidence"
import {
  DEFAULT_MEMORY_OPS_POLICY,
  loadMemoryOpsPolicy,
} from "@/lib/memory-ops-policy"
import type {
  MemoryOpsProjectSnapshot,
  MemoryOpsResolvedScanOptions,
  MemoryOpsScanOptions,
  MemoryOpsScanStage,
  MemoryOpsScanStageTiming,
  MemoryOpsScanTelemetry,
  MemoryOpsSnapshotStats,
  MemoryOpsWikiPage,
} from "@/lib/memory-ops-types"
import { getFileStem, normalizePath } from "@/lib/path-utils"
import { loadSchemaQualitySummaryState } from "@/lib/project-store"
import {
  buildSelfHealingSummary,
  type SelfHealingSummary,
} from "@/lib/self-healing-summary"
import { extractTypedGraphFromPages } from "@/lib/typed-graph"
import type { Conversation, DisplayMessage } from "@/stores/chat-store"
import type { ReviewItem } from "@/stores/review-store"
import type { FileNode } from "@/types/wiki"

export async function scanMemoryOpsProject(
  projectPath: string,
  options: MemoryOpsScanOptions = {},
): Promise<MemoryOpsProjectSnapshot> {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const dataVersion = options.dataVersion ?? 0
  const scanStartedAt = nowMs()
  const scanStages: MemoryOpsScanStageTiming[] = []
  const scanOptions = resolveMemoryOpsScanOptions(options)

  const [policyLoad, schemaQualitySummary] = await measureScanStage(
    scanStages,
    "policy-schema",
    () => Promise.all([
      options.policy
        ? Promise.resolve({ policy: options.policy, warnings: [] })
        : loadMemoryOpsPolicy(pp).catch((err) => ({
            policy: DEFAULT_MEMORY_OPS_POLICY,
            warnings: [
              `Memory Ops policy could not be loaded; using defaults: ${err instanceof Error ? err.message : String(err)}`,
            ],
          })),
      loadSchemaQualitySummaryState(pp).catch(() => null),
    ]),
    () => 2,
  )
  const wikiPages = await measureScanStage(
    scanStages,
    "wiki-pages",
    () => readWikiPages(pp),
    (pages) => pages.length,
  )
  const graph = measureSyncScanStage(
    scanStages,
    "graph",
    () => extractTypedGraphFromPages(
      wikiPages.map((page) => ({
        id: page.id,
        fileName: page.fileName,
        path: page.path,
        content: page.content,
      })),
      dataVersion,
    ),
    (typedGraph) => typedGraph.nodes.size,
  )
  const audit = await measureScanStage(
    scanStages,
    "audit",
    () => readAuditTimeline(pp),
    (result) => result.events.length,
  )
  const reviewItems = await measureScanStage(
    scanStages,
    "review-items",
    () => readJsonFile<ReviewItem[]>(`${pp}/.llm-wiki/review.json`, []),
    (items) => items.length,
  )
  const conversations = await measureScanStage(
    scanStages,
    "conversations",
    () => readJsonFile<Conversation[]>(`${pp}/.llm-wiki/conversations.json`, []),
    (items) => items.length,
  )
  const chatConversations = limitChatConversations(
    conversations,
    scanOptions.maxChatConversations,
  )
  const chatMessages = scanOptions.includeChatMessages
    ? await measureScanStage(
        scanStages,
        "chat-messages",
        () => readChatMessages(pp, chatConversations),
        (messages) => messages.length,
      )
    : recordSkippedScanStage(scanStages, "chat-messages", [] as DisplayMessage[])
  const claimRead = await measureScanStage(
    scanStages,
    "claims",
    () => readClaimIndex(pp),
    (result) => result.claims.length,
  )
  const pages = measureSyncScanStage(
    scanStages,
    "evidence",
    () => attachPageEvidence(wikiPages, {
      projectPath: pp,
      graph,
      auditEvents: audit.events,
      reviewItems,
      today: options.today,
      policy: policyLoad.policy,
    }),
    (items) => items.length,
  )
  const evidenceStats = summarizeEvidenceStats(pages)
  const claimHealth = summarizeClaimHealth(claimRead.claims, pages, pp)
  const baseSnapshot: Omit<MemoryOpsProjectSnapshot, "selfHealingSummary" | "stats"> = {
    projectPath: pp,
    dataVersion,
    policy: policyLoad.policy,
    policyWarnings: policyLoad.warnings,
    scanTelemetry: buildScanTelemetry(scanStartedAt, scanStages, scanOptions),
    pages,
    graph,
    audit,
    schemaQualitySummary,
    reviewItems,
    conversations,
    chatMessages,
    claims: claimRead.claims,
    claimHealth,
  }
  const baseStats: MemoryOpsSnapshotStats = {
    pageCount: pages.length,
    reviewItemCount: reviewItems.length,
    conversationCount: conversations.length,
    chatMessageCount: chatMessages.length,
    auditEventCount: audit.events.length,
    auditWarningCount: audit.warnings.length + claimRead.warnings.length,
    ...evidenceStats,
    claimCount: claimHealth.claimCount,
    staleClaimCount: claimHealth.staleCount,
    contradictedClaimCount: claimHealth.contradictedCount,
    supersededClaimCount: claimHealth.supersededCount,
    orphanClaimCount: claimHealth.orphanCount,
    reinforcedClaimCount: claimHealth.reinforcedCount,
    claimsMissingSourceRefCount: claimHealth.missingSourceRefCount,
    claimsMissingSnippetHashCount: claimHealth.missingSnippetHashCount,
    historicalConflictCandidateCount: 0,
    historicalConflictSuggestionCount: 0,
    historicalConflictWarningCount: 0,
    researchEvidenceCandidateCount: 0,
    researchEvidenceMatchedSuggestionCount: 0,
    researchEvidenceItemCount: 0,
    researchEvidenceWarningCount: 0,
    selfHealingCandidateCount: 0,
    selfHealingWarningCount: 0,
  }
  const interimSnapshot: MemoryOpsProjectSnapshot = {
    ...baseSnapshot,
    selfHealingSummary: emptySelfHealingSummary(),
    stats: baseStats,
  }
  const selfHealingSummary = scanOptions.includeSelfHealing
    ? await measureScanStage(
        scanStages,
        "self-healing",
        () => buildSelfHealingSummary(interimSnapshot),
        (summary) => summary.candidateCount,
      )
    : recordSkippedScanStage(scanStages, "self-healing", emptySelfHealingSummary())

  return {
    ...baseSnapshot,
    scanTelemetry: buildScanTelemetry(scanStartedAt, scanStages, scanOptions),
    selfHealingSummary,
    stats: {
      ...baseStats,
      selfHealingCandidateCount: selfHealingSummary.candidateCount,
      selfHealingWarningCount: selfHealingSummary.warnings.length,
    },
  }
}

export function auditScanTelemetry(
  telemetry: MemoryOpsScanTelemetry,
): MemoryOpsScanTelemetry {
  return {
    totalMs: telemetry.totalMs,
    options: { ...telemetry.options },
    stages: telemetry.stages.map((stage) => ({ ...stage })),
  }
}

function resolveMemoryOpsScanOptions(
  options: MemoryOpsScanOptions,
): MemoryOpsResolvedScanOptions {
  const maxChatConversations = normalizeNonNegativeInteger(options.maxChatConversations)
  return {
    includeChatMessages: options.includeChatMessages ?? true,
    includeSelfHealing: options.includeSelfHealing ?? true,
    ...(maxChatConversations === undefined ? {} : { maxChatConversations }),
  }
}

async function measureScanStage<T>(
  stages: MemoryOpsScanStageTiming[],
  stage: MemoryOpsScanStage,
  work: () => Promise<T>,
  itemCount?: (result: T) => number,
): Promise<T> {
  const startedAt = nowMs()
  const result = await work()
  stages.push(scanStageTiming(stage, startedAt, itemCount?.(result)))
  return result
}

function measureSyncScanStage<T>(
  stages: MemoryOpsScanStageTiming[],
  stage: MemoryOpsScanStage,
  work: () => T,
  itemCount?: (result: T) => number,
): T {
  const startedAt = nowMs()
  const result = work()
  stages.push(scanStageTiming(stage, startedAt, itemCount?.(result)))
  return result
}

function recordSkippedScanStage<T>(
  stages: MemoryOpsScanStageTiming[],
  stage: MemoryOpsScanStage,
  fallback: T,
): T {
  stages.push({ stage, ms: 0, itemCount: 0, skipped: true })
  return fallback
}

function scanStageTiming(
  stage: MemoryOpsScanStage,
  startedAt: number,
  itemCount: number | undefined,
): MemoryOpsScanStageTiming {
  return {
    stage,
    ms: elapsedMs(startedAt),
    ...(itemCount === undefined ? {} : { itemCount }),
  }
}

function buildScanTelemetry(
  startedAt: number,
  stages: readonly MemoryOpsScanStageTiming[],
  options: MemoryOpsResolvedScanOptions,
): MemoryOpsScanTelemetry {
  return {
    totalMs: elapsedMs(startedAt),
    stages: stages.map((stage) => ({ ...stage })),
    options,
  }
}

function limitChatConversations(
  conversations: readonly Conversation[],
  maxChatConversations: number | undefined,
): readonly Conversation[] {
  if (maxChatConversations === undefined) return conversations
  return conversations.slice(0, maxChatConversations)
}

function normalizeNonNegativeInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

function nowMs(): number {
  return performance.now()
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round((nowMs() - startedAt) * 100) / 100)
}

function emptySelfHealingSummary(): SelfHealingSummary {
  return {
    candidateCount: 0,
    claimProvenanceCandidateCount: 0,
    claimIndexCandidateCount: 0,
    consolidationQueueCandidateCount: 0,
    relationCleanupCandidateCount: 0,
    schemaWarningCandidateCount: 0,
    policyWarningCandidateCount: 0,
    warnings: [],
    actions: [],
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
