import { listDirectory, readFile } from "@/commands/fs"
import {
  appendAuditEvent,
  readAuditTimeline,
  type AuditEvent,
  type AuditTimelineResult,
} from "@/lib/audit-timeline"
import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import { lifecycleMetadataFromFrontmatter } from "@/lib/lifecycle"
import { readClaimIndex, type ClaimRecord } from "@/lib/claims"
import {
  evaluateClaimSuggestions,
  evaluateLifecycleSuggestions,
  evaluateRelationCleanupSuggestions,
  type MemoryOpsSuggestion,
} from "@/lib/memory-ops-rules"
import { getFileStem, normalizePath } from "@/lib/path-utils"
import {
  extractTypedGraphFromPages,
  type TypedGraph,
} from "@/lib/typed-graph"
import {
  loadMemoryOpsMaintenanceState,
  loadSchemaQualitySummaryState,
  saveMemoryOpsMaintenanceState,
  type PersistedMemoryOpsMaintenanceState,
  type PersistedSchemaQualitySummaryState,
} from "@/lib/project-store"
import {
  DEFAULT_MEMORY_OPS_POLICY,
  loadMemoryOpsPolicy,
  memoryOpsHalfLifeForLifecycle,
  type MemoryOpsPolicy,
} from "@/lib/memory-ops-policy"
import { useActivityStore } from "@/stores/activity-store"
import type { Conversation, DisplayMessage } from "@/stores/chat-store"
import type { ReviewItem } from "@/stores/review-store"
import type { FileNode } from "@/types/wiki"

export type MemoryOpsEvidenceRiskFlag =
  | "stale"
  | "contradicted"
  | "superseded"
  | "open-review"

export interface MemoryOpsRecentUseEvidence {
  eventCount: number
  lastUsedAt?: string
}

export interface MemoryOpsReinforcementEvidence {
  frontmatterCount: number
  auditEventCount: number
  totalCount: number
  lastReinforcedAt?: string
}

export interface MemoryOpsSourceSupportEvidence {
  sourceCount: number
  supportingRelationCount: number
}

export interface MemoryOpsStalenessEvidence {
  lastConfirmed?: string
  ageDays?: number
  stale: boolean
}

export interface MemoryOpsRiskEvidence {
  contradictionCount: number
  supersededByCount: number
  openReviewItemCount: number
  flags: MemoryOpsEvidenceRiskFlag[]
}

export interface MemoryOpsPageEvidenceSummary {
  pagePath: string
  recentUse: MemoryOpsRecentUseEvidence
  reinforcement: MemoryOpsReinforcementEvidence
  sourceSupport: MemoryOpsSourceSupportEvidence
  staleness: MemoryOpsStalenessEvidence
  risk: MemoryOpsRiskEvidence
}

export interface MemoryOpsWikiPage {
  id: string
  fileName: string
  path: string
  content: string
  frontmatter: Record<string, FrontmatterValue> | null
  evidence?: MemoryOpsPageEvidenceSummary
}

export interface MemoryOpsSnapshotStats {
  pageCount: number
  reviewItemCount: number
  conversationCount: number
  chatMessageCount: number
  auditEventCount: number
  auditWarningCount: number
  pageEvidenceCount: number
  pagesWithRecentUseCount: number
  pagesWithReinforcementCount: number
  pagesWithSourceSupportCount: number
  stalePageCount: number
  riskPageCount: number
  claimCount: number
  staleClaimCount: number
  contradictedClaimCount: number
  supersededClaimCount: number
  orphanClaimCount: number
  reinforcedClaimCount: number
}

export interface MemoryOpsClaimHealthSummary {
  claimCount: number
  staleCount: number
  contradictedCount: number
  supersededCount: number
  orphanCount: number
  reinforcedCount: number
}

export interface MemoryOpsProjectSnapshot {
  projectPath: string
  dataVersion: number
  policy: MemoryOpsPolicy
  policyWarnings: string[]
  pages: MemoryOpsWikiPage[]
  graph: TypedGraph
  audit: AuditTimelineResult
  schemaQualitySummary: PersistedSchemaQualitySummaryState | null
  reviewItems: ReviewItem[]
  conversations: Conversation[]
  chatMessages: DisplayMessage[]
  claims: ClaimRecord[]
  claimHealth: MemoryOpsClaimHealthSummary
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

export interface MemoryOpsMaintenanceEventOptions {
  now?: number
  eventThreshold?: number
  reminderCooldownMs?: number
}

export interface MemoryOpsMaintenanceEventResult {
  state: PersistedMemoryOpsMaintenanceState
  reminderDue: boolean
}

export interface MemoryOpsMaintenanceStatus extends PersistedMemoryOpsMaintenanceState {
  needsPatrol: boolean
  reminderDue: boolean
}

const MEMORY_OPS_EVENT_THRESHOLD = 5
const MEMORY_OPS_REMINDER_COOLDOWN_MS = 30 * 60 * 1000

export async function scanMemoryOpsProject(
  projectPath: string,
  options: { dataVersion?: number; today?: string; policy?: MemoryOpsPolicy } = {},
): Promise<MemoryOpsProjectSnapshot> {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const dataVersion = options.dataVersion ?? 0
  const [policyLoad, schemaQualitySummary] = await Promise.all([
    options.policy
      ? Promise.resolve({ policy: options.policy, warnings: [] })
      : loadMemoryOpsPolicy(pp).catch((err) => ({
          policy: DEFAULT_MEMORY_OPS_POLICY,
          warnings: [
            `Memory Ops policy could not be loaded; using defaults: ${err instanceof Error ? err.message : String(err)}`,
          ],
        })),
    loadSchemaQualitySummaryState(pp).catch(() => null),
  ])
  const wikiPages = await readWikiPages(pp)
  const graph = extractTypedGraphFromPages(
    wikiPages.map((page) => ({
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
  const claimRead = await readClaimIndex(pp)
  const pages = attachPageEvidence(wikiPages, {
    projectPath: pp,
    graph,
    auditEvents: audit.events,
    reviewItems,
    today: options.today,
    policy: policyLoad.policy,
  })
  const evidenceStats = summarizeEvidenceStats(pages)
  const claimHealth = summarizeClaimHealth(claimRead.claims, pages, pp)

  return {
    projectPath: pp,
    dataVersion,
    policy: policyLoad.policy,
    policyWarnings: policyLoad.warnings,
    pages,
    graph,
    audit,
    schemaQualitySummary,
    reviewItems,
    conversations,
    chatMessages,
    claims: claimRead.claims,
    claimHealth,
    stats: {
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
    },
  }
}

export async function runMemoryOpsPatrol(
  projectPath: string,
  options: { dataVersion?: number; today?: string; policy?: MemoryOpsPolicy } = {},
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
      today: options.today,
      policy: options.policy,
    })
    const suggestions = [
      ...evaluateLifecycleSuggestions(snapshot, {
        today: options.today,
        policy: snapshot.policy,
      }),
      ...evaluateClaimSuggestions(snapshot, {
        today: options.today,
      }),
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
      after: {
        stats: report.stats,
        policy: {
          name: snapshot.policy.name,
          version: snapshot.policy.version,
          warnings: snapshot.policyWarnings,
        },
      },
      reasons: [
        `${report.stats.pageCount} pages scanned`,
        `${report.stats.suggestionCount} suggestions generated`,
        `policy ${snapshot.policy.name} v${snapshot.policy.version}`,
      ],
    })
    await saveMaintenanceStateSafely(
      snapshot.projectPath,
      completeMemoryOpsPatrolCooldown(undefined, Date.now()),
    )

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

export function reduceMemoryOpsMaintenanceEvent(
  state: PersistedMemoryOpsMaintenanceState | null | undefined,
  options: MemoryOpsMaintenanceEventOptions = {},
): MemoryOpsMaintenanceEventResult {
  const now = options.now ?? Date.now()
  const eventThreshold = options.eventThreshold ?? MEMORY_OPS_EVENT_THRESHOLD
  const reminderCooldownMs = options.reminderCooldownMs ?? MEMORY_OPS_REMINDER_COOLDOWN_MS
  const current = normalizeMaintenanceState(state)
  const eventCountSincePatrol = current.eventCountSincePatrol + 1
  const dirtySince = current.dirtySince ?? now
  const reminderCooldownElapsed =
    current.lastReminderAt === undefined || now - current.lastReminderAt >= reminderCooldownMs
  const reminderDue = eventCountSincePatrol >= eventThreshold && reminderCooldownElapsed

  return {
    state: {
      ...current,
      dirtySince,
      eventCountSincePatrol,
      lastReminderAt: reminderDue ? now : current.lastReminderAt,
    },
    reminderDue,
  }
}

export function completeMemoryOpsPatrolCooldown(
  _state: PersistedMemoryOpsMaintenanceState | null | undefined,
  now = Date.now(),
): PersistedMemoryOpsMaintenanceState {
  return {
    lastPatrolAt: now,
    eventCountSincePatrol: 0,
  }
}

export function summarizeMemoryOpsMaintenanceStatus(
  state: PersistedMemoryOpsMaintenanceState | null | undefined,
  options: MemoryOpsMaintenanceEventOptions = {},
): MemoryOpsMaintenanceStatus {
  const now = options.now ?? Date.now()
  const reminderCooldownMs = options.reminderCooldownMs ?? MEMORY_OPS_REMINDER_COOLDOWN_MS
  const eventThreshold = options.eventThreshold ?? MEMORY_OPS_EVENT_THRESHOLD
  const current = normalizeMaintenanceState(state)
  const reminderCooldownElapsed =
    current.lastReminderAt === undefined || now - current.lastReminderAt >= reminderCooldownMs
  return {
    ...current,
    needsPatrol: current.eventCountSincePatrol > 0,
    reminderDue: current.eventCountSincePatrol >= eventThreshold && reminderCooldownElapsed,
  }
}

export async function getMemoryOpsMaintenanceStatus(
  projectPath: string,
): Promise<MemoryOpsMaintenanceStatus> {
  const state = await loadMemoryOpsMaintenanceState(projectPath).catch(() => null)
  return summarizeMemoryOpsMaintenanceStatus(state)
}

export async function recordMemoryOpsMaintenanceEvent(
  projectPath: string,
  action: string,
  options: MemoryOpsMaintenanceEventOptions = {},
): Promise<void> {
  const state = await loadMemoryOpsMaintenanceState(projectPath).catch(() => null)
  const next = reduceMemoryOpsMaintenanceEvent(state, options)
  await saveMaintenanceStateSafely(projectPath, next.state)
  if (!next.reminderDue) return

  useActivityStore.getState().addItem({
    type: "maintenance",
    title: "Memory Ops patrol recommended",
    status: "done",
    detail: `${next.state.eventCountSincePatrol} wiki activity events since the last patrol. Latest event: ${action}.`,
    filesWritten: [],
  })
}

function normalizeMaintenanceState(
  state: PersistedMemoryOpsMaintenanceState | null | undefined,
): PersistedMemoryOpsMaintenanceState {
  return {
    lastPatrolAt: state?.lastPatrolAt,
    dirtySince: state?.dirtySince,
    eventCountSincePatrol: state?.eventCountSincePatrol ?? 0,
    lastReminderAt: state?.lastReminderAt,
  }
}

async function saveMaintenanceStateSafely(
  projectPath: string,
  state: PersistedMemoryOpsMaintenanceState,
): Promise<void> {
  await saveMemoryOpsMaintenanceState(projectPath, state).catch(() => {})
}

const RECENT_USE_ACTION_PREFIXES = ["query.", "search.", "chat."]
const REINFORCING_ACTION_PREFIXES = [
  "chat.",
  "query.",
  "search.",
  "crystallize.",
  "review.resolve",
  "memory_ops.apply",
]

interface PageEvidenceContext {
  projectPath: string
  graph: TypedGraph
  auditEvents: readonly AuditEvent[]
  reviewItems: readonly ReviewItem[]
  today?: string
  policy: MemoryOpsPolicy
}

function attachPageEvidence(
  pages: readonly MemoryOpsWikiPage[],
  context: PageEvidenceContext,
): MemoryOpsWikiPage[] {
  return pages.map((page) => ({
    ...page,
    evidence: buildPageEvidenceSummary(page, context),
  }))
}

function buildPageEvidenceSummary(
  page: MemoryOpsWikiPage,
  context: PageEvidenceContext,
): MemoryOpsPageEvidenceSummary {
  const frontmatter = page.frontmatter ?? parseFrontmatter(page.content).frontmatter
  const pageKeys = pagePathKeys(context.projectPath, page)
  const relevantEvents = context.auditEvents.filter((event) =>
    auditEventReferencesPage(event, context.projectPath, pageKeys),
  )
  const recentUseEvents = relevantEvents.filter((event) =>
    hasActionPrefix(event, RECENT_USE_ACTION_PREFIXES),
  )
  const reinforcingEvents = relevantEvents.filter((event) =>
    hasActionPrefix(event, REINFORCING_ACTION_PREFIXES),
  )
  const metadata = lifecycleMetadataFromFrontmatter(frontmatter, context.today)
  const lastConfirmed =
    scalar(frontmatter?.last_confirmed) ??
    scalar(frontmatter?.updated) ??
    scalar(frontmatter?.created)
  const ageDays = lastConfirmed
    ? daysBetween(lastConfirmed, context.today ?? new Date().toISOString().slice(0, 10))
    : undefined
  const contradictionCount = arrayValue(frontmatter?.contradicts).length
  const supersededByCount = arrayValue(frontmatter?.superseded_by).length
  const openReviewItemCount = countOpenReviewItems(
    context.reviewItems,
    context.projectPath,
    pageKeys,
  )
  const stale =
    metadata.reviewStatus === "stale" ||
    metadata.reviewStatus === "contradicted" ||
    isStaleByAge(metadata.lifecycle, ageDays, context.policy)
  const flags: MemoryOpsEvidenceRiskFlag[] = []

  if (stale) flags.push("stale")
  if (metadata.reviewStatus === "contradicted" || contradictionCount > 0) {
    flags.push("contradicted")
  }
  if (supersededByCount > 0) flags.push("superseded")
  if (openReviewItemCount > 0) flags.push("open-review")

  const frontmatterReinforcementCount = parseInteger(
    scalar(frontmatter?.reinforcement_count),
  )
  const auditReinforcementCount = reinforcingEvents.length

  return {
    pagePath: toProjectRelativePath(context.projectPath, page.path),
    recentUse: {
      eventCount: recentUseEvents.length,
      lastUsedAt: latestTimestamp(recentUseEvents),
    },
    reinforcement: {
      frontmatterCount: frontmatterReinforcementCount,
      auditEventCount: auditReinforcementCount,
      totalCount: frontmatterReinforcementCount + auditReinforcementCount,
      lastReinforcedAt: latestTimestamp(reinforcingEvents),
    },
    sourceSupport: {
      sourceCount: arrayValue(frontmatter?.sources).length,
      supportingRelationCount: countSupportingRelations(context.graph, page.id),
    },
    staleness: {
      lastConfirmed,
      ageDays,
      stale,
    },
    risk: {
      contradictionCount,
      supersededByCount,
      openReviewItemCount,
      flags,
    },
  }
}

function summarizeEvidenceStats(
  pages: readonly MemoryOpsWikiPage[],
): Pick<
  MemoryOpsSnapshotStats,
  | "pageEvidenceCount"
  | "pagesWithRecentUseCount"
  | "pagesWithReinforcementCount"
  | "pagesWithSourceSupportCount"
  | "stalePageCount"
  | "riskPageCount"
> {
  let pagesWithRecentUseCount = 0
  let pagesWithReinforcementCount = 0
  let pagesWithSourceSupportCount = 0
  let stalePageCount = 0
  let riskPageCount = 0

  for (const page of pages) {
    const evidence = page.evidence
    if (!evidence) continue
    if (evidence.recentUse.eventCount > 0) pagesWithRecentUseCount++
    if (evidence.reinforcement.totalCount > 0) pagesWithReinforcementCount++
    if (evidence.sourceSupport.sourceCount + evidence.sourceSupport.supportingRelationCount > 0) {
      pagesWithSourceSupportCount++
    }
    if (evidence.staleness.stale) stalePageCount++
    if (evidence.risk.flags.length > 0) riskPageCount++
  }

  return {
    pageEvidenceCount: pages.length,
    pagesWithRecentUseCount,
    pagesWithReinforcementCount,
    pagesWithSourceSupportCount,
    stalePageCount,
    riskPageCount,
  }
}

function summarizeClaimHealth(
  claims: readonly ClaimRecord[],
  pages: readonly MemoryOpsWikiPage[],
  projectPath: string,
): MemoryOpsClaimHealthSummary {
  const pagePaths = new Set(pages.map((page) => toProjectRelativePath(projectPath, page.path)))
  let staleCount = 0
  let contradictedCount = 0
  let supersededCount = 0
  let orphanCount = 0
  let reinforcedCount = 0

  for (const claim of claims) {
    if (claim.status === "stale") staleCount++
    if (claim.status === "contradicted") contradictedCount++
    if (claim.status === "superseded") supersededCount++
    if (!pagePaths.has(toProjectRelativePath(projectPath, claim.page_path))) orphanCount++
    if (parseInteger(claim.reinforcement_count) > 0) reinforcedCount++
  }

  return {
    claimCount: claims.length,
    staleCount,
    contradictedCount,
    supersededCount,
    orphanCount,
    reinforcedCount,
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

function pagePathKeys(projectPath: string, page: MemoryOpsWikiPage): Set<string> {
  const relativePath = toProjectRelativePath(projectPath, page.path)
  return new Set([normalizePath(page.path), relativePath])
}

function auditEventReferencesPage(
  event: AuditEvent,
  projectPath: string,
  pageKeys: ReadonlySet<string>,
): boolean {
  return auditEventPaths(event)
    .map((path) => normalizeEvidencePath(projectPath, path))
    .some((path) => pageKeys.has(path))
}

function auditEventPaths(event: AuditEvent): string[] {
  const directPaths = [event.pagePath, event.targetPath, event.sourcePath].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  )
  const retrievalPaths =
    event.retrieval?.results
      ?.map((result) => result.path)
      .filter((value): value is string => typeof value === "string" && value.length > 0) ?? []
  return [...directPaths, ...retrievalPaths]
}

function countOpenReviewItems(
  reviewItems: readonly ReviewItem[],
  projectPath: string,
  pageKeys: ReadonlySet<string>,
): number {
  let count = 0
  for (const item of reviewItems) {
    if (item.resolved) continue
    const paths = [...(item.affectedPages ?? []), item.sourcePath].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    if (paths.some((path) => pageKeys.has(normalizeEvidencePath(projectPath, path)))) {
      count++
    }
  }
  return count
}

function countSupportingRelations(graph: TypedGraph, pageId: string): number {
  return graph.edges.filter((edge) => edge.type === "supports" && edge.target === pageId).length
}

function isStaleByAge(
  lifecycle: string,
  ageDays: number | undefined,
  policy: MemoryOpsPolicy = DEFAULT_MEMORY_OPS_POLICY,
): boolean {
  if (ageDays === undefined) return false
  const halfLifeDays = memoryOpsHalfLifeForLifecycle(lifecycle, policy)
  return ageDays > halfLifeDays * policy.staleMultiplier
}

function hasActionPrefix(event: AuditEvent, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => event.action.startsWith(prefix))
}

function latestTimestamp(events: readonly AuditEvent[]): string | undefined {
  let latest: string | undefined
  let latestTime = Number.NEGATIVE_INFINITY
  for (const event of events) {
    if (!event.timestamp) continue
    const time = Date.parse(event.timestamp)
    if (!Number.isFinite(time) || time <= latestTime) continue
    latest = event.timestamp
    latestTime = time
  }
  return latest
}

function normalizeEvidencePath(projectPath: string, path: string): string {
  return toProjectRelativePath(projectPath, path)
}

function toProjectRelativePath(projectPath: string, path: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(path)
  return normalized.startsWith(`${pp}/`) ? normalized.slice(pp.length + 1) : normalized
}

function scalar(value: FrontmatterValue | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value || undefined
}

function arrayValue(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return value
  if (value) return [value]
  return []
}

function parseInteger(value: string | undefined): number {
  if (!value) return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(startDate)
  const end = Date.parse(endDate)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.floor((end - start) / 86_400_000)
}
