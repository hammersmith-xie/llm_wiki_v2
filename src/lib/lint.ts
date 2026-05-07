import { readFile, listDirectory } from "@/commands/fs"
import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"
import { useActivityStore } from "@/stores/activity-store"
import { getFileName, getRelativePath, normalizePath } from "@/lib/path-utils"
import { buildLanguageDirective } from "@/lib/output-language"
import { lifecycleLintIssues } from "@/lib/lifecycle"
import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import { unwrapWikilink } from "@/lib/wiki-page-resolver"
import { WIKI_REFERENCE_ARRAY_FIELDS } from "@/lib/wiki-frontmatter-fields"
import {
  buildWikiAliasIndexFromPages,
  normalizeWikiReferenceKey,
} from "@/lib/wiki-alias-index"

export interface LintResult {
  type: "orphan" | "broken-link" | "no-outlinks" | "semantic"
  severity: "warning" | "info"
  page: string
  detail: string
  affectedPages?: string[]
}

// ── helpers ───────────────────────────────────────────────────────────────────

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

function extractWikilinks(content: string): string[] {
  const links: string[] = []
  const regex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].trim())
  }
  return links
}

function extractFrontmatterReferences(content: string): string[] {
  const frontmatter = parseFrontmatter(content).frontmatter
  if (!frontmatter) return []
  const refs: string[] = []
  for (const field of WIKI_REFERENCE_ARRAY_FIELDS) {
    for (const raw of frontmatterValues(frontmatter[field])) {
      const ref = unwrapWikilink(raw).slug.trim()
      if (ref) refs.push(ref)
    }
  }
  return refs
}

function frontmatterValues(value: FrontmatterValue | undefined): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : []
  if (Array.isArray(value)) return value.map((v) => v.trim()).filter(Boolean)
  return []
}

function extractWikiReferences(content: string): string[] {
  return uniqueStrings([
    ...extractWikilinks(content),
    ...extractFrontmatterReferences(content),
  ])
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

function relativeToSlug(relativePath: string): string {
  // relativePath relative to wiki/ dir, e.g. "entities/foo-bar" or "queries/my-page-2024-01-01"
  return relativePath.replace(/\.md$/, "")
}

function buildReferenceMap(
  pages: readonly { path: string; content: string }[],
  wikiRoot: string,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const page of pages) {
    const rel = getRelativePath(page.path, wikiRoot).replace(/\.md$/, "")
    const basename = getFileName(page.path).replace(/\.md$/, "")
    addReferenceKey(map, rel, page.path)
    addReferenceKey(map, `${rel}.md`, page.path)
    addReferenceKey(map, `wiki/${rel}`, page.path)
    addReferenceKey(map, `wiki/${rel}.md`, page.path)
    addReferenceKey(map, basename, page.path)
    addReferenceKey(map, `${basename}.md`, page.path)
  }

  const aliases = buildWikiAliasIndexFromPages(
    pages.map((page) => ({ path: page.path, content: page.content })),
    wikiRoot,
  )
  for (const [key, path] of aliases) {
    if (!map.has(key)) map.set(key, path)
  }

  return map
}

function addReferenceKey(map: Map<string, string>, raw: string, path: string): void {
  const lower = raw.toLowerCase()
  if (!map.has(lower)) map.set(lower, path)
  const normalized = normalizeWikiReferenceKey(raw.replace(/\.md$/, ""))
  if (normalized && !map.has(normalized)) map.set(normalized, path)
}

function resolveReferencePath(
  raw: string,
  referenceMap: ReadonlyMap<string, string>,
): string | null {
  const trimmed = raw.trim()
  const noMd = trimmed.replace(/\.md$/, "")
  const basename = getFileName(trimmed).replace(/\.md$/, "")
  const candidates = [
    trimmed.toLowerCase(),
    noMd.toLowerCase(),
    basename.toLowerCase(),
    `${basename}.md`.toLowerCase(),
    normalizeWikiReferenceKey(noMd),
    normalizeWikiReferenceKey(basename),
  ].filter((candidate) => candidate.length > 0)

  for (const candidate of candidates) {
    const path = referenceMap.get(candidate)
    if (path) return path
  }
  return null
}

// ── Structural lint ───────────────────────────────────────────────────────────

export async function runStructuralLint(projectPath: string): Promise<LintResult[]> {
  const wikiRoot = `${normalizePath(projectPath)}/wiki`
  let tree: FileNode[]
  try {
    tree = await listDirectory(wikiRoot)
  } catch {
    return []
  }

  const wikiFiles = flattenMdFiles(tree)
  // Exclude index.md and log.md from orphan checks
  const contentFiles = wikiFiles.filter(
    (f) => f.name !== "index.md" && f.name !== "log.md"
  )

  // Read all content files
  type PageData = { path: string; slug: string; content: string; outlinks: string[] }
  const pages: PageData[] = []

  for (const f of contentFiles) {
    try {
      const content = await readFile(f.path)
      const slug = relativeToSlug(getRelativePath(f.path, wikiRoot))
      const outlinks = extractWikiReferences(content)
      pages.push({ path: f.path, slug, content, outlinks })
    } catch {
      // skip unreadable files
    }
  }

  const referenceMap = buildReferenceMap(pages, wikiRoot)

  // Build inbound link count. Lookups are case-insensitive — [[Transformer]]
  // should match transformer.md (slug "transformer"), while v2 typed refs can
  // also resolve through target title/alias metadata.
  const inboundCounts = new Map<string, number>()
  for (const p of pages) {
    for (const link of p.outlinks) {
      const targetPath = resolveReferencePath(link, referenceMap)
      const target = targetPath
        ? relativeToSlug(getRelativePath(targetPath, wikiRoot)).toLowerCase()
        : link.toLowerCase()
      inboundCounts.set(target, (inboundCounts.get(target) ?? 0) + 1)
    }
  }

  const results: LintResult[] = []

  for (const p of pages) {
    const shortName = getRelativePath(p.path, wikiRoot)

    // Orphan: no inbound links (lowercased slug for case-insensitive match)
    const inbound = inboundCounts.get(p.slug.toLowerCase()) ?? 0
    if (inbound === 0) {
      results.push({
        type: "orphan",
        severity: "info",
        page: shortName,
        detail: "No other pages link to this page.",
      })
    }

    // No outbound links
    if (p.outlinks.length === 0) {
      results.push({
        type: "no-outlinks",
        severity: "info",
        page: shortName,
        detail: "This page has no body wikilinks or frontmatter relationship references to other pages.",
      })
    }

    // Broken links — case-insensitive matching.
    for (const link of p.outlinks) {
      const exists = resolveReferencePath(link, referenceMap) !== null
      if (!exists) {
        results.push({
          type: "broken-link",
          severity: "warning",
          page: shortName,
          detail: `Broken link: [[${link}]] — target page not found.`,
        })
      }
    }

    for (const issue of lifecycleLintIssues(p.content)) {
      results.push({
        type: "semantic",
        severity: issue.severity,
        page: shortName,
        detail: `[${issue.kind}] ${issue.detail}`,
      })
    }
  }

  return results
}

// ── Semantic lint ─────────────────────────────────────────────────────────────

const LINT_BLOCK_REGEX =
  /---LINT:\s*([^\n|]+?)\s*\|\s*([^\n|]+?)\s*\|\s*([^\n-]+?)\s*---\n([\s\S]*?)---END LINT---/g

export async function runSemanticLint(
  projectPath: string,
  llmConfig: LlmConfig,
): Promise<LintResult[]> {
  const pp = normalizePath(projectPath)
  const activity = useActivityStore.getState()
  const activityId = activity.addItem({
    type: "lint",
    title: "Semantic wiki lint",
    status: "running",
    detail: "Reading wiki pages...",
    filesWritten: [],
  })

  const wikiRoot = `${pp}/wiki`
  let tree: FileNode[]
  try {
    tree = await listDirectory(wikiRoot)
  } catch {
    activity.updateItem(activityId, { status: "error", detail: "Failed to read wiki directory." })
    return []
  }

  const wikiFiles = flattenMdFiles(tree).filter(
    (f) => f.name !== "log.md"
  )

  // Build a compact summary of each page (frontmatter + first 500 chars)
  const summaries: string[] = []
  for (const f of wikiFiles) {
    try {
      const content = await readFile(f.path)
      const preview = content.slice(0, 500) + (content.length > 500 ? "..." : "")
      const shortPath = getRelativePath(f.path, wikiRoot)
      summaries.push(`### ${shortPath}\n${preview}`)
    } catch {
      // skip
    }
  }

  if (summaries.length === 0) {
    activity.updateItem(activityId, { status: "done", detail: "No wiki pages to lint." })
    return []
  }

  activity.updateItem(activityId, { detail: "Running LLM semantic analysis..." })

  // For auto-mode language detection, sample the concatenated summaries
  // so non-English wikis get a matching language directive.
  const summarySample = summaries.join("\n").slice(0, 2000)

  const prompt = [
    "You are a wiki quality analyst. Review the following wiki page summaries and identify issues.",
    "",
    buildLanguageDirective(summarySample),
    "",
    "For each issue, output exactly this format:",
    "",
    "---LINT: type | severity | Short title---",
    "Description of the issue.",
    "PAGES: page1.md, page2.md",
    "---END LINT---",
    "",
    "Types:",
    "- contradiction: two or more pages make conflicting claims",
    "- stale: information that appears outdated or superseded",
    "- missing-page: an important concept is heavily referenced but has no dedicated page",
    "- suggestion: a question or source worth adding to the wiki",
    "",
    "LLM Wiki v2 metadata:",
    "- Treat lifecycle, confidence, review_status, last_confirmed, supersedes, and superseded_by as quality and freshness signals.",
    "- Treat typed relationship arrays as explicit graph edges: uses, depends_on, contradicts, supports, supersedes, superseded_by.",
    "- A low-confidence, stale, contradicted, or superseded page is only an issue when the metadata and page content make that concern actionable.",
    "",
    "Severities:",
    "- warning: should be addressed",
    "- info: nice to have",
    "",
    "Only report genuine issues. Do not invent problems. Output ONLY the ---LINT--- blocks, no other text.",
    "",
    "## Wiki Pages",
    "",
    summaries.join("\n\n"),
  ].join("\n")

  let raw = ""
  let hadError = false

  await streamChat(
    llmConfig,
    [{ role: "user", content: prompt }],
    {
      onToken: (token) => { raw += token },
      onDone: () => {},
      onError: (err) => {
        hadError = true
        activity.updateItem(activityId, {
          status: "error",
          detail: `LLM error: ${err.message}`,
        })
      },
    },
  )

  if (hadError) return []

  const results: LintResult[] = []
  const matches = raw.matchAll(LINT_BLOCK_REGEX)

  for (const match of matches) {
    const rawType = match[1].trim().toLowerCase()
    const severity = match[2].trim().toLowerCase()
    const title = match[3].trim()
    const body = match[4].trim()

    // semantic results always use type "semantic"
    void rawType

    const pagesMatch = body.match(/^PAGES:\s*(.+)$/m)
    const affectedPages = pagesMatch
      ? pagesMatch[1].split(",").map((p) => p.trim())
      : undefined

    const detail = body.replace(/^PAGES:.*$/m, "").trim()

    results.push({
      type: "semantic",
      severity: (severity === "warning" ? "warning" : "info") as LintResult["severity"],
      page: title,
      detail: `[${rawType}] ${detail}`,
      affectedPages,
    })
  }

  activity.updateItem(activityId, {
    status: "done",
    detail: `Found ${results.length} semantic issue(s).`,
  })

  return results
}
