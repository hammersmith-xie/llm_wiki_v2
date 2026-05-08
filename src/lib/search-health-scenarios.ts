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

export function normalizeSearchHealthScenarioConfig(
  input: unknown,
): SearchHealthScenarioNormalizeResult {
  const warnings: string[] = []
  const skipped: SearchHealthSkippedScenario[] = []
  const records = scenarioRecords(input)
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

    const expectedTopPaths = stringArray(record.expectedTopPaths).map(normalizeScenarioPath)
    const expectedInTopK = topKExpectations(record.expectedInTopK)
    const expectedOutsideTopK = topKExpectations(record.expectedOutsideTopK)
    const excludedPaths = stringArray(record.excludedPaths).map(normalizeScenarioPath)
    const topK = positiveInteger(record.topK)

    if (expectedInTopK === null || expectedOutsideTopK === null || topK === null) {
      skipped.push({ id, reason: "Invalid topK value." })
      warnings.push(`Custom scenario ${id} skipped: invalid topK value.`)
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

function scenarioRecords(input: unknown): Array<Record<string, unknown>> | null {
  const root = isRecord(input) ? input.scenarios : input
  if (!Array.isArray(root)) return null
  return root.filter(isRecord)
}

function topKExpectations(value: unknown): SearchEvalTopKExpectation[] | null {
  if (!Array.isArray(value)) return []
  const expectations: SearchEvalTopKExpectation[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const path = stringValue(item.path)
    const topK = positiveInteger(item.topK)
    if (!path || topK === null || topK === undefined) return null
    expectations.push({
      path: normalizeScenarioPath(path),
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

function normalizeScenarioPath(value: string): string {
  return normalizePath(value.trim()).replace(/^\/+/, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
