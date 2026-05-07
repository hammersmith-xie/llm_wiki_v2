import { listDirectory, readFile } from "@/commands/fs"
import {
  runSchemaQualityScan,
  schemaQualityScanSuggestions,
  type RunSchemaQualityScanResult,
} from "@/lib/schema-quality"
import type { MemoryOpsSuggestion } from "@/lib/memory-ops-rules"
import { getFileStem, normalizePath } from "@/lib/path-utils"
import type { SchemaDriftPageInput } from "@/lib/schema-drift"
import type { FileNode } from "@/types/wiki"

export interface ProjectSchemaQualityScanResult extends RunSchemaQualityScanResult {
  suggestions: MemoryOpsSuggestion[]
}

export async function runProjectSchemaQualityScan(
  projectPath: string,
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

  return {
    ...result,
    suggestions: schemaQualityScanSuggestions(result.report),
  }
}

async function readProjectWikiPages(projectPath: string): Promise<SchemaDriftPageInput[]> {
  let tree: FileNode[]
  try {
    tree = await listDirectory(`${projectPath}/wiki`)
  } catch {
    return []
  }

  const pages: SchemaDriftPageInput[] = []
  for (const file of flattenMarkdownFiles(tree)) {
    try {
      const content = await readFile(file.path)
      pages.push({
        id: getFileStem(file.name),
        path: projectRelativePath(projectPath, file.path),
        fileName: file.name,
        content,
      })
    } catch {
      // Unreadable pages should not block a project-level health scan.
    }
  }
  return pages
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
