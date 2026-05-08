import { readFile, writeFile } from "@/commands/fs"
import { insertClaimAnchor } from "@/lib/claim-anchors"
import {
  extractClaimCandidates,
  type ClaimExtractionDigestInput,
} from "@/lib/claim-extract"
import {
  writeExtractedClaimArtifacts,
  type ClaimWriteArtifactResult,
} from "@/lib/claim-write"
import {
  appendLifecycleAuditEvent,
  enrichLifecycleFrontmatter,
} from "@/lib/lifecycle"
import { normalizePath } from "@/lib/path-utils"
import {
  buildPreWriteCandidate,
  type PreWriteConflictPreview,
} from "@/lib/prewrite-conflict"
import { appendPreWriteConflictAuditEvent } from "@/lib/prewrite-conflict-audit"
import { previewPreWriteConflict } from "@/lib/prewrite-conflict-resolver"
import { recordWikiAutomationEvent } from "@/lib/wiki-automation-events"

export interface CrystallizeReference {
  title?: string
  path: string
}

export interface CrystallizeQueryInput {
  projectPath: string
  filePath: string
  title: string
  body: string
  date: string
  origin: string
  pageType?: "query" | "synthesis"
  tags?: string[]
  references?: CrystallizeReference[]
  candidate?: CrystallizeCandidateAuditMetadata
  claimExtraction?: CrystallizeClaimExtractionOptions
}

export interface CrystallizeQueryResult {
  content: string
  relativePath: string
  supports: string[]
  sources: string[]
  claimWrite?: CrystallizeClaimWriteResult
  conflict?: PreWriteConflictPreview
}

export interface CrystallizeClaimExtractionOptions {
  digest?: ClaimExtractionDigestInput
  maxClaims?: number
}

export type CrystallizeClaimWriteResult = ClaimWriteArtifactResult

export interface CrystallizeCandidateAuditMetadata {
  origin: string
  sourceId: string
  score: number
  reasons: string[]
  dedupeKey: string
}

export async function writeCrystallizedQueryPage(
  input: CrystallizeQueryInput,
): Promise<CrystallizeQueryResult> {
  const pp = normalizePath(input.projectPath)
  const filePath = normalizePath(input.filePath)
  const relativePath = toProjectRelativePath(pp, filePath)
  const supports = uniqueStrings(
    (input.references ?? [])
      .map((ref) => slugFromWikiPath(ref.path))
      .filter((slug): slug is string => slug !== null),
  )
  const sourceValues = await Promise.all(
    (input.references ?? []).map((ref) => sourceNameFromReference(ref, pp)),
  )
  const sources = uniqueStrings(
    sourceValues.filter((source): source is string => source !== null),
  )
  const candidate = input.candidate ? normalizeCandidateAudit(input.candidate) : undefined
  const claimExtraction = extractClaimCandidates({
    pagePath: relativePath,
    pageTitle: input.title,
    content: input.body,
    digest: input.claimExtraction?.digest,
    sourceRefs: (input.references ?? []).map((ref) => ({
      path: toProjectRelativePath(pp, resolveReferencePath(ref.path, pp)),
      ...(ref.title ? { title: ref.title } : {}),
    })),
    supports,
    maxClaims: input.claimExtraction?.maxClaims,
    today: input.date,
    lifecycle: input.pageType === "synthesis" ? "semantic" : "episodic",
  })
  let body = input.body.trimEnd()
  for (const candidate of claimExtraction.claims) {
    body = insertClaimAnchor(body, {
      claimId: candidate.claim.claim_id,
      claimText: candidate.anchorText,
      pageAnchor: candidate.claim.page_anchor,
    })
  }

  const frontmatter = [
    "---",
    `type: ${input.pageType ?? "query"}`,
    `title: ${quoteYaml(input.title)}`,
    `created: ${input.date}`,
    `updated: ${input.date}`,
    `origin: ${quoteYaml(input.origin)}`,
    `tags: [${uniqueStrings(input.tags ?? []).map(quoteYaml).join(", ")}]`,
    `related: [${supports.map(quoteYaml).join(", ")}]`,
    `supports: [${supports.map(quoteYaml).join(", ")}]`,
    `sources: [${sources.map(quoteYaml).join(", ")}]`,
    `reinforcement_count: "${supports.length}"`,
    "---",
    "",
  ].join("\n")

  const enriched = enrichLifecycleFrontmatter(frontmatter + body + "\n")
  const conflictResult = await previewPreWriteConflict(
    pp,
    buildPreWriteCandidate({
      kind: "crystallization-page",
      targetPath: relativePath,
      title: input.title,
      content: enriched.content,
      sourcePath: input.origin,
      claimSummaries: claimExtraction.claims.map((candidate) => ({
        claimId: candidate.claim.claim_id,
        text: candidate.claim.text,
        status: candidate.claim.status,
        pagePath: candidate.claim.page_path,
      })),
    }),
  )
  if (conflictResult.preview.decision === "review-only") {
    await appendPreWriteConflictAuditEvent(pp, conflictResult.preview, "review").catch((err) => {
      console.warn(
        `[conflict] audit write failed for ${relativePath}: ${err instanceof Error ? err.message : err}`,
      )
    })
    return {
      content: enriched.content,
      relativePath,
      supports,
      sources,
      conflict: conflictResult.preview,
    }
  }
  await appendPreWriteConflictAuditEvent(pp, conflictResult.preview, "accept").catch((err) => {
    console.warn(
      `[conflict] audit write failed for ${relativePath}: ${err instanceof Error ? err.message : err}`,
    )
  })
  await writeFile(filePath, enriched.content)
  const claimWrite = await writeExtractedClaimArtifacts({
    projectPath: pp,
    relativePath,
    extraction: claimExtraction,
  })
  await appendLifecycleAuditEvent(pp, {
    action: "crystallize.query",
    actor: "system",
    pagePath: relativePath,
    sourcePath: input.origin,
    after: {
      lifecycle: enriched.metadata.lifecycle,
      confidence: enriched.metadata.confidence,
      qualityScore: enriched.metadata.qualityScore,
      reviewStatus: enriched.metadata.reviewStatus,
      supports,
      sources,
      ...(candidate ? { candidate } : {}),
    },
    reasons: enriched.metadata.confidenceReasons,
  }).catch((err) => {
    console.warn(
      `[crystallize] audit write failed for ${relativePath}: ${err instanceof Error ? err.message : err}`,
    )
  })
  const automationResult = await recordWikiAutomationEvent({
    type: "memory.write",
    projectPath: pp,
    actor: "system",
    targetPath: relativePath,
    pagePath: relativePath,
    status: "applied",
    reasons: ["crystallized query page written"],
    summary: {
      origin: input.origin,
      supportCount: supports.length,
      sourceCount: sources.length,
      candidateDedupeKey: candidate?.dedupeKey,
    },
  }).catch((err) => ({
    action: "memory.write" as const,
    auditEvent: { action: "memory.write" },
    auditError: err instanceof Error ? err.message : String(err),
    maintenanceError: undefined,
  }))
  if (automationResult.auditError || automationResult.maintenanceError) {
    console.warn(
      `[crystallize] automation event failed for ${relativePath}: ${[
        automationResult.auditError,
        automationResult.maintenanceError,
      ].filter(Boolean).join("; ")}`,
    )
  }

  return {
    content: enriched.content,
    relativePath,
    supports,
    sources,
    claimWrite,
  }
}

async function sourceNameFromReference(
  ref: CrystallizeReference,
  projectPath: string,
): Promise<string | null> {
  const path = resolveReferencePath(ref.path, projectPath)
  if (path.includes("/raw/sources/")) {
    return path.split("/").pop() ?? null
  }

  if (!path.includes("/wiki/sources/")) return null

  try {
    const content = await readFile(path)
    const match = content.match(/^sources:\s*\[(.*?)\]\s*$/m)
    if (match) {
      const first = match[1]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .find(Boolean)
      if (first) return first
    }
  } catch {
    // Fall back to the summary filename below.
  }

  return path.split("/").pop() ?? null
}

function resolveReferencePath(path: string, projectPath: string): string {
  const normalized = normalizePath(path)
  if (normalized.startsWith("wiki/") || normalized.startsWith("raw/")) {
    return `${projectPath.replace(/\/$/, "")}/${normalized}`
  }
  return normalized
}

function slugFromWikiPath(path: string): string | null {
  const normalized = normalizePath(path)
  const rel = wikiRelativePath(normalized)
  if (!rel) return null
  if (!rel.endsWith(".md")) return null
  if (rel === "index.md" || rel === "log.md") return null
  return rel.replace(/\.md$/, "").split("/").pop() ?? null
}

function wikiRelativePath(path: string): string | null {
  const idx = path.indexOf("/wiki/")
  if (idx !== -1) return path.slice(idx + "/wiki/".length)
  if (path.startsWith("wiki/")) return path.slice("wiki/".length)
  return null
}

function toProjectRelativePath(projectPath: string, filePath: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const fp = normalizePath(filePath)
  return fp.startsWith(`${pp}/`) ? fp.slice(pp.length + 1) : fp
}

function quoteYaml(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = String(value).trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

function normalizeCandidateAudit(
  candidate: CrystallizeCandidateAuditMetadata,
): CrystallizeCandidateAuditMetadata {
  return {
    origin: candidate.origin,
    sourceId: candidate.sourceId,
    score: Math.max(0, Math.min(1, Number(candidate.score.toFixed(2)))),
    reasons: uniqueStrings(candidate.reasons),
    dedupeKey: candidate.dedupeKey,
  }
}
