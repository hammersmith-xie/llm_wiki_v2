import { readFile, writeFile } from "@/commands/fs"
import {
  appendLifecycleAuditEvent,
  enrichLifecycleFrontmatter,
} from "@/lib/lifecycle"
import { normalizePath } from "@/lib/path-utils"

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
  tags?: string[]
  references?: CrystallizeReference[]
  candidate?: CrystallizeCandidateAuditMetadata
}

export interface CrystallizeQueryResult {
  content: string
  relativePath: string
  supports: string[]
  sources: string[]
}

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

  const frontmatter = [
    "---",
    "type: query",
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

  const enriched = enrichLifecycleFrontmatter(frontmatter + input.body.trimEnd() + "\n")
  await writeFile(filePath, enriched.content)
  await appendLifecycleAuditEvent(pp, {
    action: "crystallize.query",
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

  return {
    content: enriched.content,
    relativePath,
    supports,
    sources,
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
