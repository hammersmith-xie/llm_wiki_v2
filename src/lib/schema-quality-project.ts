import { listDirectory, readFile } from "@/commands/fs"
import {
  runSchemaQualityScan,
  schemaQualityScanSuggestions,
  type RunSchemaQualityScanResult,
} from "@/lib/schema-quality"
import type { MemoryOpsSuggestion } from "@/lib/memory-ops-rules"
import {
  saveSchemaQualitySummaryState,
  type PersistedSchemaQualitySummaryState,
} from "@/lib/project-store"
import { getFileStem, normalizePath } from "@/lib/path-utils"
import type { SchemaDriftPageInput } from "@/lib/schema-drift"
import type { FileNode } from "@/types/wiki"

export interface ProjectSchemaQualityScanResult extends RunSchemaQualityScanResult {
  suggestions: MemoryOpsSuggestion[]
  schemaQualitySummary: PersistedSchemaQualitySummaryState
}

export interface RunProjectSchemaQualityScanOptions {
  dataVersion?: number
  now?: number
  persistSummary?: boolean
}

export async function runProjectSchemaQualityScan(
  projectPath: string,
  options: RunProjectSchemaQualityScanOptions = {},
): Promise<ProjectSchemaQualityScanResult> {
  const pp = normalizePath(projectPath)
  const [schemaMarkdown, pages] = await Promise.all([
    readFile(`${pp}/schema.md`).catch(() => undefined),
    readProjectWikiPages(pp),
  ])
  const result = await runSchemaQualityScan({
    projectPath: pp,
    schemaMarkdown,
    pages,
  })
  const suggestions = schemaQualityScanSuggestions(result.report)
  const schemaQualitySummary = buildPersistedSummary(
    result,
    suggestions.length,
    {
      dataVersion: options.dataVersion,
      scannedAt: options.now ?? Date.now(),
    },
  )
  if (options.persistSummary !== false) {
    await saveSchemaQualitySummaryState(pp, schemaQualitySummary).catch(() => {})
  }

  return {
    ...result,
    suggestions,
    schemaQualitySummary,
  }
}

function buildPersistedSummary(
  result: RunSchemaQualityScanResult,
  suggestionCount: number,
  options: { scannedAt: number; dataVersion?: number },
): PersistedSchemaQualitySummaryState {
  return {
    scannedAt: options.scannedAt,
    dataVersion: options.dataVersion,
    ...result.report.summary,
    suggestionCount,
    auditError: result.auditError,
  }
}

async function readProjectWikiPages(projectPath: string): Promise<SchemaDriftPageInput[]> {
  let tree: FileNode[]
  try {
    tree = await listDirectory(`${projectPath}/wiki`)
  } catch {
    return []
  }

  const pages = await mapWithConcurrency(
    flattenMarkdownFiles(tree),
    16,
    async (file): Promise<SchemaDriftPageInput | null> => {
      try {
        const content = await readFile(file.path)
        return {
          id: getFileStem(file.name),
          path: projectRelativePath(projectPath, file.path),
          fileName: file.name,
          content,
        }
      } catch {
        // Unreadable pages should not block a project-level health scan.
        return null
      }
    },
  )
  return pages.filter((page): page is SchemaDriftPageInput => page !== null)
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, concurrency), items.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index])
    }
  }))
  return results
}

function flattenMarkdownFiles(nodes: readonly FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMarkdownFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function projectRelativePath(projectPath: string, path: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(path)
  return normalized.startsWith(`${pp}/`) ? normalized.slice(pp.length + 1) : normalized
}
