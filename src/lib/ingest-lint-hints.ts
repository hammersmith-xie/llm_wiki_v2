import { deleteFile, readFile, writeFile } from "@/commands/fs"
import { runStructuralLint, type LintResult } from "./lint"

export const INGEST_LINT_HINTS_PATH_REL = ".llm-wiki/ingest-lint-hints.json"

export interface IngestLintHints {
  ingestId: string
  sourcePath: string
  timestamp: number
  hints: LintResult[]
  totalCount: number
}

export async function writePostIngestLintHints(
  projectPath: string,
  ingestId: string,
  sourcePath: string,
): Promise<void> {
  const hints = await runStructuralLint(projectPath)
  if (hints.length === 0) {
    await clearPostIngestLintHints(projectPath)
    return
  }

  const payload: IngestLintHints = {
    ingestId,
    sourcePath,
    timestamp: Date.now(),
    hints,
    totalCount: hints.length,
  }

  await writeFile(
    hintsPath(projectPath),
    JSON.stringify(payload, null, 2),
  )
}

export async function readPostIngestLintHints(
  projectPath: string,
): Promise<IngestLintHints | null> {
  try {
    return parseIngestLintHints(await readFile(hintsPath(projectPath)))
  } catch {
    return null
  }
}

export async function clearPostIngestLintHints(projectPath: string): Promise<void> {
  try {
    await deleteFile(hintsPath(projectPath))
  } catch {
    // Missing stale hint files are harmless.
  }
}

function hintsPath(projectPath: string): string {
  return `${projectPath.replace(/\/$/, "")}/${INGEST_LINT_HINTS_PATH_REL}`
}

function parseIngestLintHints(raw: string): IngestLintHints | null {
  const parsed = JSON.parse(raw) as Partial<IngestLintHints>
  if (typeof parsed.ingestId !== "string") return null
  if (typeof parsed.sourcePath !== "string") return null
  if (typeof parsed.timestamp !== "number") return null
  if (!Array.isArray(parsed.hints)) return null
  if (typeof parsed.totalCount !== "number") return null
  return parsed as IngestLintHints
}
