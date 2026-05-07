import { createDirectory, listDirectory, readFile, writeFile } from "@/commands/fs"
import { appendAuditEvent } from "@/lib/audit-timeline"
import { parseFrontmatter } from "@/lib/frontmatter"
import {
  runSearchWikiEval,
  summarizeSearchEvalForMemoryOps,
  type SearchEvalMemoryOpsSummary,
  type SearchEvalReport,
  type SearchEvalScenario,
} from "@/lib/search-eval"
import { normalizePath } from "@/lib/path-utils"
import type { FileNode } from "@/types/wiki"

export type SearchHealthStatus = "skipped" | "pass" | "fail"

export interface SearchHealthRunResult {
  status: SearchHealthStatus
  scenarioCount: number
  skippedScenarios?: SearchHealthSkippedScenario[]
  report?: SearchEvalReport
  summary?: SearchEvalMemoryOpsSummary
  writtenPath?: string
  writeError?: string
  auditError?: string
}

export interface RunSearchHealthOptions {
  writeReport?: boolean
  skippedScenarios?: readonly SearchHealthSkippedScenario[]
}

export interface SearchHealthSkippedScenario {
  id: string
  reason: string
}

export interface BuiltInSearchHealthScenarios {
  scenarios: SearchEvalScenario[]
  skipped: SearchHealthSkippedScenario[]
}

interface SmokePage {
  path: string
  title: string
  frontmatter: Record<string, string | string[]> | null
  content: string
}

export async function runSearchHealth(
  projectPath: string,
  scenarios: readonly SearchEvalScenario[],
  options: RunSearchHealthOptions = {},
): Promise<SearchHealthRunResult> {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  if (scenarios.length === 0) {
    const result: SearchHealthRunResult = {
      status: "skipped",
      scenarioCount: 0,
      skippedScenarios: [...(options.skippedScenarios ?? [])],
    }
    result.auditError = await appendSearchHealthAuditSafely(pp, result)
    return result
  }

  const report = await runSearchWikiEval(pp, scenarios)
  const summary = summarizeSearchEvalForMemoryOps(report)
  const result: SearchHealthRunResult = {
    status: summary.status,
    scenarioCount: scenarios.length,
    skippedScenarios: [...(options.skippedScenarios ?? [])],
    report,
    summary,
  }

  if (options.writeReport ?? true) {
    const writeResult = await writeSearchHealthReport(pp, report)
    result.writtenPath = writeResult.path
    result.writeError = writeResult.error
  }
  result.auditError = await appendSearchHealthAuditSafely(pp, result)
  return result
}

export async function buildBuiltInSearchHealthScenarios(
  projectPath: string,
): Promise<BuiltInSearchHealthScenarios> {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const pages = await readSmokePages(pp)
  const scenarios: SearchEvalScenario[] = []
  const skipped: SearchHealthSkippedScenario[] = []

  const titlePage = pages.find((page) => page.title.trim().length > 0)
  if (titlePage) {
    scenarios.push({
      id: "builtin-title-exact",
      query: titlePage.title,
      expectedInTopK: [{ path: titlePage.path, topK: 3 }],
    })
  } else {
    skipped.push({ id: "builtin-title-exact", reason: "No titled wiki page found." })
  }

  const aliasPage = pages.find((page) => firstArrayValue(page.frontmatter?.alias) || firstArrayValue(page.frontmatter?.aliases) || firstArrayValue(page.frontmatter?.keywords))
  const alias = aliasPage
    ? firstArrayValue(aliasPage.frontmatter?.alias) ??
      firstArrayValue(aliasPage.frontmatter?.aliases) ??
      firstArrayValue(aliasPage.frontmatter?.keywords)
    : undefined
  if (aliasPage && alias) {
    scenarios.push({
      id: "builtin-alias-keyword",
      query: alias,
      expectedInTopK: [{ path: aliasPage.path, topK: 5 }],
    })
  } else {
    skipped.push({ id: "builtin-alias-keyword", reason: "No alias/keyword metadata found." })
  }

  const cjkPage = pages.find((page) => /[\u4e00-\u9fff]/.test(`${page.title}\n${page.content}`))
  if (cjkPage) {
    const query = cjkToken(cjkPage.title) ?? cjkToken(cjkPage.content)
    if (query) {
      scenarios.push({
        id: "builtin-cjk",
        query,
        expectedInTopK: [{ path: cjkPage.path, topK: 5 }],
      })
    } else {
      skipped.push({ id: "builtin-cjk", reason: "CJK page found but no usable query token." })
    }
  } else {
    skipped.push({ id: "builtin-cjk", reason: "No CJK wiki content found." })
  }

  const graphPage = pages.find((page) => firstArrayValue(page.frontmatter?.uses) || firstArrayValue(page.frontmatter?.supports) || firstArrayValue(page.frontmatter?.depends_on))
  const graphTarget = graphPage
    ? firstArrayValue(graphPage.frontmatter?.uses) ??
      firstArrayValue(graphPage.frontmatter?.supports) ??
      firstArrayValue(graphPage.frontmatter?.depends_on)
    : undefined
  if (graphPage && graphTarget) {
    scenarios.push({
      id: "builtin-typed-graph",
      query: graphTarget,
      expectedInTopK: [{ path: graphPage.path, topK: 10 }],
    })
  } else {
    skipped.push({ id: "builtin-typed-graph", reason: "No typed relation metadata found." })
  }

  const contradicted = pages.find((page) => firstArrayValue(page.frontmatter?.contradicts) || firstArrayValue(page.frontmatter?.superseded_by))
  if (contradicted) {
    scenarios.push({
      id: "builtin-contradiction-deprioritize",
      query: contradicted.title,
      expectedOutsideTopK: [{ path: contradicted.path, topK: 1 }],
      topK: 5,
    })
  } else {
    skipped.push({ id: "builtin-contradiction-deprioritize", reason: "No contradicted or superseded page found." })
  }

  return { scenarios, skipped }
}

export function searchHealthReportPath(projectPath: string): string {
  return `${normalizePath(projectPath).replace(/\/$/, "")}/.llm-wiki/search-eval-report.json`
}

async function writeSearchHealthReport(
  projectPath: string,
  report: SearchEvalReport,
): Promise<{ path: string; error?: string }> {
  const path = searchHealthReportPath(projectPath)
  try {
    await createDirectory(`${normalizePath(projectPath).replace(/\/$/, "")}/.llm-wiki`).catch(() => {})
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`)
    return { path }
  } catch (err) {
    return { path, error: errorMessage(err) }
  }
}

async function appendSearchHealthAuditSafely(
  projectPath: string,
  result: SearchHealthRunResult,
): Promise<string | undefined> {
  try {
    await appendAuditEvent(projectPath, {
      action: "memory_ops.search_health",
      actor: "user",
      targetPath: ".llm-wiki/search-eval-report.json",
      changes: {
        status: result.status,
      },
      after: {
        status: result.status,
        scenarioCount: result.scenarioCount,
        skippedScenarios: result.skippedScenarios,
        writtenPath: result.writtenPath,
        writeError: result.writeError,
        summary: result.summary
          ? {
              scenarioCount: result.summary.scenarioCount,
              passedCount: result.summary.passedCount,
              failedCount: result.summary.failedCount,
              streamCounts: result.summary.streamCounts,
              failedScenarios: result.summary.failedScenarios,
            }
          : undefined,
      },
      reasons: [
        result.status === "skipped"
          ? "no search health scenarios available"
          : `${result.summary?.passedCount ?? 0}/${result.summary?.scenarioCount ?? result.scenarioCount} scenarios passed`,
      ],
    })
    return undefined
  } catch (err) {
    return errorMessage(err)
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function readSmokePages(projectPath: string): Promise<SmokePage[]> {
  let tree: FileNode[]
  try {
    tree = await listDirectory(`${projectPath}/wiki`)
  } catch {
    return []
  }

  const pages: SmokePage[] = []
  for (const file of flattenMdFiles(tree)) {
    try {
      const content = await readFile(file.path)
      const parsed = parseFrontmatter(content)
      pages.push({
        path: toProjectRelativePath(projectPath, file.path),
        title: scalar(parsed.frontmatter?.title) ?? file.name.replace(/\.md$/, ""),
        frontmatter: parsed.frontmatter,
        content,
      })
    } catch {
      // Unreadable pages should not block smoke scenario construction.
    }
  }
  return pages
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

function firstArrayValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.find((item) => item.trim().length > 0)
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function scalar(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value || undefined
}

function cjkToken(value: string): string | undefined {
  const match = value.match(/[\u4e00-\u9fff]{2,}/)
  return match?.[0]
}

function toProjectRelativePath(projectPath: string, path: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(path)
  return normalized.startsWith(`${pp}/`) ? normalized.slice(pp.length + 1) : normalized
}
