import type { ClaimRecord } from "@/lib/claims"
import { parseFrontmatter } from "@/lib/frontmatter"
import type {
  MemoryOpsResearchCandidate,
} from "@/lib/memory-ops-research-types"
import type {
  MemoryOpsProjectSnapshot,
  MemoryOpsWikiPage,
} from "@/lib/memory-ops-types"
import { normalizePath } from "@/lib/path-utils"

export interface MemoryOpsResearchPlanProbe {
  kind: "local-page" | "graph-neighbor" | "claim" | "web-confirm" | "web-disconfirm"
  query: string
  targetPath?: string
  claimId?: string
  reason: string
}

export interface MemoryOpsResearchPlan {
  candidateId: string
  baseQuery: string
  probes: MemoryOpsResearchPlanProbe[]
}

export function buildMemoryOpsResearchPlan(
  candidate: MemoryOpsResearchCandidate,
  snapshot?: MemoryOpsProjectSnapshot,
): MemoryOpsResearchPlan {
  const baseQuery = normalizeQuery(candidate.query || candidate.title || candidate.summary)
  const probes: MemoryOpsResearchPlanProbe[] = [
    {
      kind: "web-confirm",
      query: baseQuery,
      targetPath: candidate.targetPath,
      reason: "candidate base query",
    },
    {
      kind: "web-confirm",
      query: normalizeQuery(`${baseQuery} latest evidence source`),
      targetPath: candidate.targetPath,
      reason: "fresh external support check",
    },
    {
      kind: "web-disconfirm",
      query: normalizeQuery(`${baseQuery} contradiction obsolete deprecated superseded`),
      targetPath: candidate.targetPath,
      reason: "disconfirming contradiction check",
    },
  ]

  if (candidate.targetPath) {
    probes.unshift({
      kind: "local-page",
      query: baseQuery,
      targetPath: candidate.targetPath,
      reason: "target wiki page",
    })
  }

  if (snapshot) {
    probes.push(...graphNeighborProbes(candidate, snapshot, baseQuery))
    probes.push(...claimProbes(candidate, snapshot, baseQuery))
  }

  return {
    candidateId: candidate.id,
    baseQuery,
    probes: uniqueProbes(probes),
  }
}

export function localPagesForResearchPlan(
  plan: MemoryOpsResearchPlan,
  snapshot: MemoryOpsProjectSnapshot | undefined,
): MemoryOpsWikiPage[] {
  if (!snapshot) return []
  const paths = new Set(
    plan.probes
      .filter((probe) => probe.kind === "local-page" || probe.kind === "graph-neighbor")
      .map((probe) => probe.targetPath)
      .filter((path): path is string => Boolean(path))
      .map(normalizePath),
  )
  return snapshot.pages.filter((page) => {
    const relative = toProjectRelativePath(snapshot.projectPath, page.path)
    return paths.has(normalizePath(page.path)) || paths.has(relative)
  })
}

export function claimsForResearchPlan(
  plan: MemoryOpsResearchPlan,
  snapshot: MemoryOpsProjectSnapshot | undefined,
): ClaimRecord[] {
  if (!snapshot) return []
  const claimIds = new Set(
    plan.probes
      .filter((probe) => probe.kind === "claim")
      .map((probe) => probe.claimId)
      .filter((id): id is string => Boolean(id)),
  )
  return snapshot.claims.filter((claim) => claimIds.has(claim.claim_id))
}

export function webQueriesForResearchPlan(
  plan: MemoryOpsResearchPlan,
  mode: "all" | "deep" = "all",
): string[] {
  const probes = plan.probes.filter((probe) =>
    probe.kind === "web-confirm" || probe.kind === "web-disconfirm"
  )
  const selected = mode === "deep"
    ? probes
    : probes.filter((probe) => probe.kind === "web-confirm").slice(0, 1)
  return uniqueStrings(selected.map((probe) => probe.query)).map((query) => query.slice(0, 240))
}

export function pageTitleForResearch(page: MemoryOpsWikiPage): string {
  const parsed = parseFrontmatter(page.content)
  return scalar(parsed.frontmatter?.title) ?? firstHeading(parsed.body) ?? page.id
}

function graphNeighborProbes(
  candidate: MemoryOpsResearchCandidate,
  snapshot: MemoryOpsProjectSnapshot,
  baseQuery: string,
): MemoryOpsResearchPlanProbe[] {
  const targetPage = findPage(snapshot, candidate.targetPath)
  if (!targetPage) return []
  const neighborIds = snapshot.graph.adjacency.get(targetPage.id)
    ?.slice(0, 4)
    .map((edge) => edge.target) ?? []
  return neighborIds
    .map((id) => snapshot.graph.nodes.get(id))
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .map((node) => ({
      kind: "graph-neighbor",
      query: normalizeQuery(`${baseQuery} ${node.title} ${node.type}`),
      targetPath: toProjectRelativePath(snapshot.projectPath, node.path),
      reason: `typed graph neighbor ${node.id}`,
    }))
}

function claimProbes(
  candidate: MemoryOpsResearchCandidate,
  snapshot: MemoryOpsProjectSnapshot,
  baseQuery: string,
): MemoryOpsResearchPlanProbe[] {
  const targetPath = normalizePath(candidate.targetPath)
  return snapshot.claims
    .filter((claim) =>
      claim.claim_id === candidate.claimId ||
      samePath(claim.page_path, targetPath),
    )
    .slice(0, 6)
    .map((claim) => ({
      kind: "claim",
      query: normalizeQuery(`${baseQuery} ${claim.text}`),
      targetPath: claim.page_path,
      claimId: claim.claim_id,
      reason: `claim ${claim.claim_id}`,
    }))
}

function findPage(
  snapshot: MemoryOpsProjectSnapshot,
  targetPath: string,
): MemoryOpsWikiPage | undefined {
  const normalized = normalizePath(targetPath)
  return snapshot.pages.find((page) => {
    const relative = toProjectRelativePath(snapshot.projectPath, page.path)
    return samePath(page.path, normalized) || samePath(relative, normalized)
  })
}

function uniqueProbes(
  probes: readonly MemoryOpsResearchPlanProbe[],
): MemoryOpsResearchPlanProbe[] {
  const seen = new Set<string>()
  const unique: MemoryOpsResearchPlanProbe[] = []
  for (const probe of probes) {
    const key = `${probe.kind}:${probe.query}:${probe.targetPath ?? ""}:${probe.claimId ?? ""}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(probe)
  }
  return unique
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(value)
  }
  return unique
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left).toLowerCase() === normalizePath(right).toLowerCase()
}

function toProjectRelativePath(projectPath: string, path: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(path)
  return normalized.startsWith(`${pp}/`) ? normalized.slice(pp.length + 1) : normalized
}

function scalar(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value || undefined
}

function firstHeading(content: string): string | undefined {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim()
}
