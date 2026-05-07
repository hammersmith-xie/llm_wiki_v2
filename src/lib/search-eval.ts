import { searchWiki, type SearchResult } from "@/lib/search"
import { normalizePath } from "@/lib/path-utils"

export interface SearchEvalTopKExpectation {
  path: string
  topK: number
}

export interface SearchEvalScenario {
  id: string
  query: string
  expectedTopPaths?: readonly string[]
  expectedInTopK?: readonly SearchEvalTopKExpectation[]
  excludedPaths?: readonly string[]
}

export type SearchEvalFailureKind =
  | "top-rank-mismatch"
  | "missing-from-top-k"
  | "excluded-path-present"

export interface SearchEvalFailure {
  kind: SearchEvalFailureKind
  expectedPath: string
  expectedRank?: number
  expectedTopK?: number
  actualPath?: string
  actualRank?: number
  message: string
}

export interface SearchEvalScenarioResult {
  id: string
  query: string
  passed: boolean
  rankedPaths: string[]
  failures: SearchEvalFailure[]
}

export interface SearchEvalReport {
  summary: {
    scenarioCount: number
    passedCount: number
    failedCount: number
  }
  results: SearchEvalScenarioResult[]
}

export type SearchEvalSearcher = (
  query: string,
  scenario: SearchEvalScenario,
) => Promise<readonly Pick<SearchResult, "path" | "title" | "score">[]>

export async function runSearchWikiEval(
  projectPath: string,
  scenarios: readonly SearchEvalScenario[],
): Promise<SearchEvalReport> {
  return runSearchEval(scenarios, (query) => searchWiki(projectPath, query))
}

export async function runSearchEval(
  scenarios: readonly SearchEvalScenario[],
  searcher: SearchEvalSearcher,
): Promise<SearchEvalReport> {
  const results: SearchEvalScenarioResult[] = []

  for (const scenario of scenarios) {
    const searchResults = await searcher(scenario.query, scenario)
    const rankedPaths = searchResults.map((result) => normalizePath(result.path))
    const failures = evaluateScenario(scenario, rankedPaths)
    results.push({
      id: scenario.id,
      query: scenario.query,
      passed: failures.length === 0,
      rankedPaths,
      failures,
    })
  }

  const passedCount = results.filter((result) => result.passed).length
  return {
    summary: {
      scenarioCount: results.length,
      passedCount,
      failedCount: results.length - passedCount,
    },
    results,
  }
}

export function formatSearchEvalReport(report: SearchEvalReport): string {
  const lines = [
    `Search eval: ${report.summary.passedCount}/${report.summary.scenarioCount} scenarios passed`,
  ]
  for (const result of report.results) {
    lines.push(`${result.passed ? "PASS" : "FAIL"} ${result.id}: ${result.query}`)
    for (const failure of result.failures) {
      lines.push(`- ${failure.message}`)
    }
  }
  return lines.join("\n")
}

function evaluateScenario(
  scenario: SearchEvalScenario,
  rankedPaths: readonly string[],
): SearchEvalFailure[] {
  const failures: SearchEvalFailure[] = []

  ;(scenario.expectedTopPaths ?? []).forEach((expectedPath, index) => {
    const expectedRank = index + 1
    const actualPath = rankedPaths[index]
    if (actualPath && pathMatches(actualPath, expectedPath)) return
    const actualRank = findRank(rankedPaths, expectedPath)
    failures.push({
      kind: "top-rank-mismatch",
      expectedPath,
      expectedRank,
      actualPath,
      actualRank,
      message: actualRank
        ? `${expectedPath} expected at rank ${expectedRank}, found at rank ${actualRank}`
        : `${expectedPath} expected at rank ${expectedRank}, but it was missing`,
    })
  })

  for (const expectation of scenario.expectedInTopK ?? []) {
    const actualRank = findRank(rankedPaths, expectation.path)
    if (actualRank !== undefined && actualRank <= expectation.topK) continue
    failures.push({
      kind: "missing-from-top-k",
      expectedPath: expectation.path,
      expectedTopK: expectation.topK,
      actualRank,
      message: actualRank
        ? `${expectation.path} expected in top ${expectation.topK}, found at rank ${actualRank}`
        : `${expectation.path} expected in top ${expectation.topK}, but it was missing`,
    })
  }

  for (const excludedPath of scenario.excludedPaths ?? []) {
    const actualRank = findRank(rankedPaths, excludedPath)
    if (actualRank === undefined) continue
    failures.push({
      kind: "excluded-path-present",
      expectedPath: excludedPath,
      actualRank,
      message: `${excludedPath} should be excluded, but it appeared at rank ${actualRank}`,
    })
  }

  return failures
}

function findRank(rankedPaths: readonly string[], expectedPath: string): number | undefined {
  const index = rankedPaths.findIndex((path) => pathMatches(path, expectedPath))
  return index === -1 ? undefined : index + 1
}

function pathMatches(actualPath: string, expectedPath: string): boolean {
  const actual = normalizePath(actualPath)
  const expected = normalizePath(expectedPath)
  return actual === expected || actual.endsWith(`/${expected}`)
}
