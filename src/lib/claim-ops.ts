import { createDirectory, listDirectory, readFile, writeFile } from "@/commands/fs"
import { appendAuditEvent } from "@/lib/audit-timeline"
import { extractClaimCandidates } from "@/lib/claim-extract"
import { parseClaimAnchors } from "@/lib/claim-anchors"
import {
  mergeClaimRecords,
  normalizeClaimRecord,
  readClaimIndex,
  type ClaimRecord,
  type ClaimIndexWarning,
} from "@/lib/claims"
import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import { getFileStem, normalizePath } from "@/lib/path-utils"
import type { FileNode } from "@/types/wiki"

export interface ClaimIndexRebuildStats {
  recoveredCount: number
  backfilledCount: number
  orphanCount: number
  staleCount: number
  warningCount: number
}

export interface ClaimIndexRebuildResult {
  dryRun: boolean
  recovered: ClaimRecord[]
  backfilled: ClaimRecord[]
  orphanClaims: ClaimRecord[]
  staleClaims: ClaimRecord[]
  warnings: ClaimIndexWarning[]
  stats: ClaimIndexRebuildStats
}

export async function scanClaimIndexRebuild(
  projectPath: string,
): Promise<ClaimIndexRebuildResult> {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const pages = await readWikiMarkdownPages(pp)
  const existing = await readClaimIndex(pp)
  const existingIds = new Set(existing.claims.map((claim) => claim.claim_id))
  const pagePaths = new Set(pages.map((page) => page.relativePath))
  const recovered: ClaimRecord[] = []
  const backfilled: ClaimRecord[] = []

  for (const page of pages) {
    const anchors = parseClaimAnchors(page.content)
    for (const anchor of anchors) {
      if (existingIds.has(anchor.claimId)) continue
      const text = claimTextAfterAnchor(page.content, anchor.line)
      const normalized = normalizeClaimRecord({
        claim_id: anchor.claimId,
        text: text || `Claim anchored in ${page.relativePath}`,
        page_path: page.relativePath,
        page_title: page.title,
        page_anchor: anchor.claimId,
        lifecycle: "working",
        status: "needs-review",
      })
      recovered.push(normalized.claim)
      existingIds.add(normalized.claim.claim_id)
    }
    for (const candidate of extractLegacyClaimCandidates(page, existingIds)) {
      backfilled.push(candidate)
      existingIds.add(candidate.claim_id)
    }
  }

  const orphanClaims = existing.claims.filter((claim) =>
    !pagePaths.has(toProjectRelativePath(pp, claim.page_path))
  )
  const staleClaims = existing.claims.filter((claim) => claim.status === "stale")

  return {
    dryRun: true,
    recovered,
    backfilled,
    orphanClaims,
    staleClaims,
    warnings: existing.warnings,
    stats: {
      recoveredCount: recovered.length,
      backfilledCount: backfilled.length,
      orphanCount: orphanClaims.length,
      staleCount: staleClaims.length,
      warningCount: existing.warnings.length,
    },
  }
}

export async function applyClaimIndexRebuild(
  projectPath: string,
): Promise<ClaimIndexRebuildResult> {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const dryRun = await scanClaimIndexRebuild(pp)
  const existing = await readClaimIndex(pp)
  const claims = mergeClaimRecords(existing.claims, [
    ...dryRun.recovered,
    ...dryRun.backfilled,
  ])

  await createDirectory(`${pp}/.llm-wiki`).catch(() => {})
  await writeFile(`${pp}/.llm-wiki/claims.jsonl`, claims.map((claim) => JSON.stringify(claim)).join("\n") + "\n")
  await appendAuditEvent(pp, {
    action: "claim.rebuild",
    category: "claim",
    actor: "system",
    targetPath: ".llm-wiki/claims.jsonl",
    changes: { status: "applied" },
    after: {
      ...dryRun.stats,
      writtenCount: claims.length,
    },
    reasons: [
      "claim index rebuild applied",
      `${dryRun.stats.recoveredCount} anchored claim${dryRun.stats.recoveredCount === 1 ? "" : "s"} recovered`,
      `${dryRun.stats.backfilledCount} legacy claim${dryRun.stats.backfilledCount === 1 ? "" : "s"} backfilled`,
    ],
  })

  return {
    ...dryRun,
    dryRun: false,
  }
}

interface WikiMarkdownPage {
  relativePath: string
  content: string
  title: string
  frontmatter: Record<string, FrontmatterValue> | null
}

async function readWikiMarkdownPages(projectPath: string): Promise<WikiMarkdownPage[]> {
  let tree: FileNode[]
  try {
    tree = await listDirectory(`${projectPath}/wiki`)
  } catch {
    return []
  }

  const pages: WikiMarkdownPage[] = []
  for (const file of flattenMdFiles(tree)) {
    try {
      const content = await readFile(file.path)
      const parsed = parseFrontmatter(content)
      pages.push({
        relativePath: toProjectRelativePath(projectPath, file.path),
        content,
        title: scalar(parsed.frontmatter?.title) ?? headingTitle(content) ?? getFileStem(file.name),
        frontmatter: parsed.frontmatter,
      })
    } catch {
      // Ignore unreadable pages during maintenance scan.
    }
  }
  return pages
}

function extractLegacyClaimCandidates(
  page: WikiMarkdownPage,
  existingIds: ReadonlySet<string>,
): ClaimRecord[] {
  const sourceRefs = pageSourceRefs(page)
  const extraction = extractClaimCandidates({
    pagePath: page.relativePath,
    pageTitle: page.title,
    content: page.content,
    sourceRefs,
    lifecycle: lifecycleForPage(page),
    maxClaims: 4,
  })
  return extraction.claims
    .map((candidate) => candidate.claim)
    .filter((claim) => !existingIds.has(claim.claim_id))
}

function lifecycleForPage(page: WikiMarkdownPage): "working" | "episodic" | "semantic" | "procedural" | "archived" {
  const lifecycle = scalar(page.frontmatter?.lifecycle)
  if (
    lifecycle === "working" ||
    lifecycle === "episodic" ||
    lifecycle === "semantic" ||
    lifecycle === "procedural" ||
    lifecycle === "archived"
  ) {
    return lifecycle
  }
  return "semantic"
}

function pageSourceRefs(page: WikiMarkdownPage) {
  return arrayValue(page.frontmatter?.sources).map((path) => ({ path }))
}

function flattenMdFiles(nodes: readonly FileNode[]): FileNode[] {
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

function claimTextAfterAnchor(content: string, anchorLine: number): string {
  const lines = content.split(/\r?\n/)
  for (let index = anchorLine; index < lines.length; index++) {
    const line = lines[index]?.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim()
    if (line && !line.startsWith("<!--")) return line
  }
  return ""
}

function headingTitle(content: string): string | undefined {
  const match = content.match(/^\s{0,3}#\s+(.+?)\s*$/m)
  return match?.[1]?.trim()
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

function toProjectRelativePath(projectPath: string, path: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(path)
  return normalized.startsWith(`${pp}/`) ? normalized.slice(pp.length + 1) : normalized
}
