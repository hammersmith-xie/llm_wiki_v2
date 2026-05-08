import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { SearchEvalScenario, SearchEvalTopKExpectation } from "@/lib/search-eval"
import type { SearchHealthSkippedScenario } from "@/lib/search-health"

export interface SearchHealthScenarioConfig {
  scenarios: SearchEvalScenario[]
}

export interface SearchHealthScenarioNormalizeResult {
  scenarios: SearchEvalScenario[]
  skipped: SearchHealthSkippedScenario[]
  warnings: string[]
}

export interface SearchHealthScenarioLoadResult extends SearchHealthScenarioNormalizeResult {
  path: string
}

export interface SearchHealthScenarioSaveResult {
  path: string
  error?: string
}

export function searchHealthScenarioConfigPath(projectPath: string): string {
  return `${projectRoot(projectPath)}/.llm-wiki/search-health-scenarios.json`
}

export async function loadSearchHealthScenarioConfig(
  projectPath: string,
): Promise<SearchHealthScenarioLoadResult> {
  const path = searchHealthScenarioConfigPath(projectPath)
  let raw: string
  try {
    raw = await readFile(path)
  } catch {
    return { path, scenarios: [], skipped: [], warnings: [] }
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    return {
      path,
      ...normalizeSearchHealthScenarioConfig(withProjectPath(parsed, projectPath)),
    }
  } catch (err) {
    return {
      path,
      scenarios: [],
      skipped: [],
      warnings: [
        `Could not parse custom search health scenarios: ${err instanceof Error ? err.message : String(err)}`,
      ],
    }
  }
}

function withProjectPath(input: unknown, projectPath: string): unknown {
  if (isRecord(input)) return { ...input, projectPath }
  return { projectPath, scenarios: input }
}

export async function saveSearchHealthScenarioConfig(
  projectPath: string,
  scenarios: readonly SearchEvalScenario[],
): Promise<SearchHealthScenarioSaveResult> {
  const root = projectRoot(projectPath)
  const path = searchHealthScenarioConfigPath(root)
  try {
    await createDirectory(`${root}/.llm-wiki`)
    await writeFile(path, `${JSON.stringify({ scenarios }, null, 2)}\n`)
    return { path }
  } catch (err) {
    return { path, error: err instanceof Error ? err.message : String(err) }
  }
}

export function normalizeSearchHealthScenarioConfig(
  input: unknown,
): SearchHealthScenarioNormalizeResult {
  const warnings: string[] = []
  const skipped: SearchHealthSkippedScenario[] = []
  const records = scenarioRecords(input)
  const root = configProjectRoot(input)
  if (!records) {
    return {
      scenarios: [],
      skipped: [],
      warnings: ["Custom search health scenarios must be an array."],
    }
  }

  const seen = new Set<string>()
  const scenarios: SearchEvalScenario[] = []
  for (const record of records) {
    const fallbackId = `custom-${scenarios.length + skipped.length + 1}`
    const rawId = stringValue(record.id) ?? fallbackId
    const id = normalizeScenarioId(rawId) || fallbackId
    const query = stringValue(record.query)
    if (!query) {
      skipped.push({ id, reason: "Missing query." })
      warnings.push(`Custom scenario ${id} skipped: missing query.`)
      continue
    }
    if (seen.has(id)) {
      skipped.push({ id, reason: "Duplicate scenario id." })
      warnings.push(`Custom scenario ${id} skipped: duplicate id.`)
      continue
    }

    const expectedTopPaths = normalizeScenarioPaths(record.expectedTopPaths, root)
    const expectedInTopK = topKExpectations(record.expectedInTopK, root)
    const expectedOutsideTopK = topKExpectations(record.expectedOutsideTopK, root)
    const excludedPaths = normalizeScenarioPaths(record.excludedPaths, root)
    const topK = positiveInteger(record.topK)

    if (expectedInTopK === null || expectedOutsideTopK === null || topK === null) {
      skipped.push({ id, reason: "Invalid topK value." })
      warnings.push(`Custom scenario ${id} skipped: invalid topK value.`)
      continue
    }
    if (expectedTopPaths === null || excludedPaths === null) {
      skipped.push({ id, reason: "Invalid project-relative path." })
      warnings.push(`Custom scenario ${id} skipped: invalid project-relative path.`)
      continue
    }

    if (
      expectedTopPaths.length === 0 &&
      expectedInTopK.length === 0 &&
      expectedOutsideTopK.length === 0 &&
      excludedPaths.length === 0
    ) {
      skipped.push({ id, reason: "Missing expectations." })
      warnings.push(`Custom scenario ${id} skipped: missing expectations.`)
      continue
    }

    seen.add(id)
    scenarios.push({
      id,
      query,
      ...(expectedTopPaths.length > 0 ? { expectedTopPaths } : {}),
      ...(expectedInTopK.length > 0 ? { expectedInTopK } : {}),
      ...(expectedOutsideTopK.length > 0 ? { expectedOutsideTopK } : {}),
      ...(excludedPaths.length > 0 ? { excludedPaths } : {}),
      ...(topK !== undefined ? { topK } : {}),
    })
  }

  return { scenarios, skipped, warnings }
}

function configProjectRoot(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  const raw = stringValue(input.projectPath)
  return raw ? projectRoot(raw) : undefined
}

function scenarioRecords(input: unknown): Array<Record<string, unknown>> | null {
  const root = isRecord(input) ? input.scenarios : input
  if (!Array.isArray(root)) return null
  return root.filter(isRecord)
}

function topKExpectations(
  value: unknown,
  projectPath: string | undefined,
): SearchEvalTopKExpectation[] | null {
  if (!Array.isArray(value)) return []
  const expectations: SearchEvalTopKExpectation[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const path = stringValue(item.path)
    const topK = positiveInteger(item.topK)
    if (!path || topK === null || topK === undefined) return null
    const normalizedPath = normalizeScenarioPath(path, projectPath)
    if (!normalizedPath) return null
    expectations.push({
      path: normalizedPath,
      topK,
    })
  }
  return expectations
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(stringValue).filter((item): item is string => Boolean(item))
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function positiveInteger(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === "") return undefined
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10)
  if (!Number.isInteger(parsed) || parsed < 1) return null
  return parsed
}

function normalizeScenarioId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function normalizeScenarioPaths(
  value: unknown,
  projectPath: string | undefined,
): string[] | null {
  const normalized: string[] = []
  for (const item of stringArray(value)) {
    const path = normalizeScenarioPath(item, projectPath)
    if (!path) return null
    normalized.push(path)
  }
  return normalized
}

function normalizeScenarioPath(value: string, projectPath: string | undefined): string | null {
  let normalized = normalizePath(value.trim())
  if (projectPath && normalized.startsWith(`${projectPath}/`)) {
    normalized = normalized.slice(projectPath.length + 1)
  }
  normalized = normalized.replace(/^\/+/, "")
  if (!isProjectRelativePath(normalized)) return null
  return normalized
}

function isProjectRelativePath(value: string): boolean {
  if (!value || value === "." || value.includes("\0")) return false
  if (value.split("/").some((segment) => segment === "..")) return false
  if (/^[A-Za-z]:\//.test(value)) return false
  if (value.startsWith("//")) return false
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function projectRoot(projectPath: string): string {
  return normalizePath(projectPath).replace(/\/$/, "")
}
