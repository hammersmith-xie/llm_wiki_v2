import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { appendAuditEvent } from "@/lib/audit-timeline"
import {
  claimIndexPath,
  readClaimIndex,
  type ClaimRecord,
  type ClaimSourceRef,
} from "@/lib/claims"
import {
  buildClaimSourceRefsForText,
  mergeClaimSourceRefs,
  summarizeClaimProvenance,
} from "@/lib/claim-provenance"
import { isAbsolutePath, normalizePath } from "@/lib/path-utils"

export type ClaimProvenanceRepairStatus =
  | "repairable"
  | "already-complete"
  | "no-source-refs"
  | "source-unreadable"
  | "no-match"

export interface ClaimProvenanceRepairItem {
  claimId: string
  pagePath: string
  status: ClaimProvenanceRepairStatus
  before: ClaimSourceRef[]
  after: ClaimSourceRef[]
  reasons: string[]
}

export interface ClaimProvenanceRepairStats {
  claimCount: number
  repairableCount: number
  repairedSourceRefCount: number
  alreadyCompleteCount: number
  noSourceRefsCount: number
  sourceUnreadableCount: number
  noMatchCount: number
  warningCount: number
}

export interface ClaimProvenanceRepairPlan {
  dryRun: boolean
  items: ClaimProvenanceRepairItem[]
  warnings: string[]
  stats: ClaimProvenanceRepairStats
}

interface SourceCacheEntry {
  content?: string
  error?: string
}

export async function planClaimProvenanceRepair(
  projectPath: string,
): Promise<ClaimProvenanceRepairPlan> {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const index = await readClaimIndex(pp)
  const sourceCache = new Map<string, SourceCacheEntry>()
  const items: ClaimProvenanceRepairItem[] = []

  for (const claim of index.claims) {
    items.push(await planClaimRepair(pp, claim, sourceCache))
  }

  return buildPlan(true, items, index.warnings.map((warning) => warning.message))
}

export async function applyClaimProvenanceRepair(
  projectPath: string,
): Promise<ClaimProvenanceRepairPlan> {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const index = await readClaimIndex(pp)
  const sourceCache = new Map<string, SourceCacheEntry>()
  const items: ClaimProvenanceRepairItem[] = []
  const repairedById = new Map<string, ClaimRecord>()

  for (const claim of index.claims) {
    const item = await planClaimRepair(pp, claim, sourceCache)
    items.push(item)
    repairedById.set(
      claim.claim_id,
      item.status === "repairable"
        ? { ...claim, source_refs: item.after }
        : claim,
    )
  }

  const plan = buildPlan(false, items, index.warnings.map((warning) => warning.message))
  await createDirectory(`${pp}/.llm-wiki`).catch(() => {})
  const claims = index.claims.map((claim) => repairedById.get(claim.claim_id) ?? claim)
  await writeFile(
    claimIndexPath(pp),
    claims.map((claim) => JSON.stringify(claim)).join("\n") + "\n",
  )
  await appendAuditEvent(pp, {
    action: "claim.provenance.repair",
    category: "claim",
    actor: "system",
    targetPath: ".llm-wiki/claims.jsonl",
    changes: { status: "applied" },
    after: {
      ...plan.stats,
      repairedClaimIds: plan.items
        .filter((item) => item.status === "repairable")
        .map((item) => item.claimId),
    },
    reasons: [
      `${plan.stats.repairableCount} claim${plan.stats.repairableCount === 1 ? "" : "s"} repaired`,
      "raw source snippets were hashed but not stored",
    ],
  })

  return plan
}

async function planClaimRepair(
  projectPath: string,
  claim: ClaimRecord,
  sourceCache: Map<string, SourceCacheEntry>,
): Promise<ClaimProvenanceRepairItem> {
  const provenance = summarizeClaimProvenance(claim)
  if (provenance.missingSourceRefs) {
    return itemForClaim(claim, "no-source-refs", claim.source_refs, [
      "claim has no source_refs; repair pass will not infer a source",
    ])
  }
  if (!provenance.missingSnippetHash) {
    return itemForClaim(claim, "already-complete", claim.source_refs, [
      "at least one source ref already has snippet_hash",
    ])
  }

  const enrichedRefs: ClaimSourceRef[] = []
  const reasons: string[] = []
  let unreadableCount = 0

  for (const ref of claim.source_refs) {
    if (ref.snippet_hash) {
      enrichedRefs.push(ref)
      continue
    }
    const source = await readSourceRef(projectPath, ref.path, sourceCache)
    if (source.error || !source.content) {
      unreadableCount++
      enrichedRefs.push(ref)
      reasons.push(`source unreadable: ${ref.path}`)
      continue
    }
    const enriched = buildClaimSourceRefsForText({
      baseRefs: [ref],
      claimText: claim.text,
      sourceContent: source.content,
      sourceTitle: ref.title,
    })
    enrichedRefs.push(...enriched)
  }

  const after = mergeClaimSourceRefs(enrichedRefs)
  const repairedCount = countNewSnippetHashes(claim.source_refs, after)
  if (repairedCount > 0) {
    return itemForClaim(claim, "repairable", after, [
      `${repairedCount} source ref${repairedCount === 1 ? "" : "s"} received snippet_hash`,
      ...reasons,
    ])
  }

  if (unreadableCount > 0) {
    return itemForClaim(claim, "source-unreadable", after, reasons)
  }

  return itemForClaim(claim, "no-match", after, [
    "source refs were readable but no credible supporting snippet was found",
  ])
}

async function readSourceRef(
  projectPath: string,
  refPath: string,
  cache: Map<string, SourceCacheEntry>,
): Promise<SourceCacheEntry> {
  const candidates = sourcePathCandidates(projectPath, refPath)
  for (const candidate of candidates) {
    const cached = cache.get(candidate)
    if (cached) {
      if (cached.content) return cached
      continue
    }
    try {
      const content = await readFile(candidate)
      const entry = { content }
      cache.set(candidate, entry)
      return entry
    } catch (err) {
      cache.set(candidate, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { error: `could not read ${refPath}` }
}

function sourcePathCandidates(projectPath: string, refPath: string): string[] {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(refPath).trim()
  if (!normalized) return []
  const candidate = isAbsolutePath(normalized) ? normalized : `${pp}/${normalized}`
  return isPathInsideProject(candidate, pp) ? [candidate] : []
}

function isPathInsideProject(candidate: string, projectPath: string): boolean {
  const normalizedCandidate = normalizePath(candidate)
  const normalizedProject = normalizePath(projectPath).replace(/\/$/, "")
  return normalizedCandidate === normalizedProject ||
    normalizedCandidate.startsWith(`${normalizedProject}/`)
}

function itemForClaim(
  claim: ClaimRecord,
  status: ClaimProvenanceRepairStatus,
  after: readonly ClaimSourceRef[],
  reasons: readonly string[],
): ClaimProvenanceRepairItem {
  return {
    claimId: claim.claim_id,
    pagePath: claim.page_path,
    status,
    before: claim.source_refs,
    after: [...after],
    reasons: [...reasons],
  }
}

function buildPlan(
  dryRun: boolean,
  items: readonly ClaimProvenanceRepairItem[],
  warnings: readonly string[],
): ClaimProvenanceRepairPlan {
  let repairedSourceRefCount = 0
  for (const item of items) {
    if (item.status !== "repairable") continue
    repairedSourceRefCount += countNewSnippetHashes(item.before, item.after)
  }

  return {
    dryRun,
    items: [...items],
    warnings: [...warnings],
    stats: {
      claimCount: items.length,
      repairableCount: countStatus(items, "repairable"),
      repairedSourceRefCount,
      alreadyCompleteCount: countStatus(items, "already-complete"),
      noSourceRefsCount: countStatus(items, "no-source-refs"),
      sourceUnreadableCount: countStatus(items, "source-unreadable"),
      noMatchCount: countStatus(items, "no-match"),
      warningCount: warnings.length,
    },
  }
}

function countStatus(
  items: readonly ClaimProvenanceRepairItem[],
  status: ClaimProvenanceRepairStatus,
): number {
  return items.filter((item) => item.status === status).length
}

function countNewSnippetHashes(
  before: readonly ClaimSourceRef[],
  after: readonly ClaimSourceRef[],
): number {
  const beforeHashes = new Set(before.map((ref) => ref.snippet_hash).filter(Boolean))
  return after.filter((ref) =>
    ref.snippet_hash && !beforeHashes.has(ref.snippet_hash)
  ).length
}
