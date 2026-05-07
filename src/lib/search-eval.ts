import { searchWiki, type SearchResult } from "@/lib/search"
import { normalizePath } from "@/lib/path-utils"

export interface SearchEvalTopKExpectation {
  path: string
  topK: number
}

export interface SearchEvalStreamEvidence {
  name: "token" | "bm25" | "vector" | "graph"
  rank: number
  rawScore?: number
  contribution: number
  path?: string[]
  pathTypes?: string[]
  pathDirections?: SearchResult["graphPathDirections"]
}

export interface SearchEvalTopResultEvidence {
  rank: number
  path: string
  title: string
  score: number
  streams: SearchEvalStreamEvidence[]
}

export interface SearchEvalScenario {
  id: string
  query: string
  expectedTopPaths?: readonly string[]
  expectedInTopK?: readonly SearchEvalTopKExpectation[]
  expectedOutsideTopK?: readonly SearchEvalTopKExpectation[]
  excludedPaths?: readonly string[]
  topK?: number
}

export type SearchEvalFailureKind =
  | "top-rank-mismatch"
  | "missing-from-top-k"
  | "present-in-top-k"
  | "excluded-path-present"

export interface SearchEvalFailure {
  kind: SearchEvalFailureKind
  query: string
  expectedPath: string
  expectedRank?: number
  expectedTopK?: number
  actualPath?: string
  actualRank?: number
  topKPaths: string[]
  message: string
}

export interface SearchEvalScenarioResult {
  id: string
  query: string
  topK: number
  passed: boolean
  rankedPaths: string[]
  topResults: SearchEvalTopResultEvidence[]
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

export interface SearchEvalMemoryOpsSummary {
  status: "pass" | "fail"
  scenarioCount: number
  passedCount: number
  failedCount: number
  streamCounts: Record<string, number>
  failedScenarios: Array<{
    id: string
    query: string
    topKPaths: string[]
    failures: Array<{
      kind: SearchEvalFailureKind
      expectedPath: string
      message: string
      actualRank?: number
      expectedRank?: number
      expectedTopK?: number
    }>
  }>
}

export type SearchEvalSearchResult = Pick<SearchResult, "path" | "title" | "score"> &
  Partial<Pick<SearchResult, "retrieval" | "graphPath" | "graphPathTypes" | "graphPathDirections">>

export type SearchEvalSearcher = (
  query: string,
  scenario: SearchEvalScenario,
) => Promise<readonly SearchEvalSearchResult[]>

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
    const topK = inferScenarioTopK(scenario)
    const topResults = searchResults
      .slice(0, topK)
      .map((result, index) => buildTopResultEvidence(result, index + 1))
    const topKPaths = topResults.map((result) => result.path)
    const failures = evaluateScenario(scenario, rankedPaths, topKPaths)
    results.push({
      id: scenario.id,
      query: scenario.query,
      topK,
      passed: failures.length === 0,
      rankedPaths,
      topResults,
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
    const topPaths = result.topResults.map((topResult) => topResult.path).join(", ") || "(none)"
    lines.push(
      `${result.passed ? "PASS" : "FAIL"} ${result.id}: ${result.query} | top ${result.topK}: ${topPaths}`,
    )
    for (const failure of result.failures) {
      lines.push(`- ${failure.message}`)
    }
  }
  return lines.join("\n")
}

export function summarizeSearchEvalForMemoryOps(
  report: SearchEvalReport,
): SearchEvalMemoryOpsSummary {
  const streamCounts: Record<string, number> = {}
  for (const result of report.results) {
    for (const topResult of result.topResults) {
      for (const stream of topResult.streams) {
        streamCounts[stream.name] = (streamCounts[stream.name] ?? 0) + 1
      }
    }
  }

  return {
    status: report.summary.failedCount === 0 ? "pass" : "fail",
    scenarioCount: report.summary.scenarioCount,
    passedCount: report.summary.passedCount,
    failedCount: report.summary.failedCount,
    streamCounts,
    failedScenarios: report.results
      .filter((result) => !result.passed)
      .map((result) => ({
        id: result.id,
        query: result.query,
        topKPaths: result.topResults.map((topResult) => topResult.path),
        failures: result.failures.map((failure) => ({
          kind: failure.kind,
          expectedPath: failure.expectedPath,
          message: failure.message,
          actualRank: failure.actualRank,
          expectedRank: failure.expectedRank,
          expectedTopK: failure.expectedTopK,
        })),
      })),
  }
}

function evaluateScenario(
  scenario: SearchEvalScenario,
  rankedPaths: readonly string[],
  topKPaths: readonly string[],
): SearchEvalFailure[] {
  const failures: SearchEvalFailure[] = []

  ;(scenario.expectedTopPaths ?? []).forEach((expectedPath, index) => {
    const expectedRank = index + 1
    const actualPath = rankedPaths[index]
    if (actualPath && pathMatches(actualPath, expectedPath)) return
    const actualRank = findRank(rankedPaths, expectedPath)
    failures.push({
      kind: "top-rank-mismatch",
      query: scenario.query,
      expectedPath,
      expectedRank,
      actualPath,
      actualRank,
      topKPaths: [...topKPaths],
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
      query: scenario.query,
      expectedPath: expectation.path,
      expectedTopK: expectation.topK,
      actualRank,
      topKPaths: [...topKPaths],
      message: actualRank
        ? `${expectation.path} expected in top ${expectation.topK}, found at rank ${actualRank}`
        : `${expectation.path} expected in top ${expectation.topK}, but it was missing`,
    })
  }

  for (const expectation of scenario.expectedOutsideTopK ?? []) {
    const actualRank = findRank(rankedPaths, expectation.path)
    if (actualRank === undefined || actualRank > expectation.topK) continue
    failures.push({
      kind: "present-in-top-k",
      query: scenario.query,
      expectedPath: expectation.path,
      expectedTopK: expectation.topK,
      actualRank,
      topKPaths: [...topKPaths],
      message: `${expectation.path} expected outside top ${expectation.topK}, found at rank ${actualRank}`,
    })
  }

  for (const excludedPath of scenario.excludedPaths ?? []) {
    const actualRank = findRank(rankedPaths, excludedPath)
    if (actualRank === undefined) continue
    failures.push({
      kind: "excluded-path-present",
      query: scenario.query,
      expectedPath: excludedPath,
      actualRank,
      topKPaths: [...topKPaths],
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

function inferScenarioTopK(scenario: SearchEvalScenario): number {
  const expectedTopPathCount = scenario.expectedTopPaths?.length ?? 0
  const expectedInTopK = Math.max(0, ...((scenario.expectedInTopK ?? []).map((e) => e.topK)))
  const expectedOutsideTopK = Math.max(
    0,
    ...((scenario.expectedOutsideTopK ?? []).map((e) => e.topK)),
  )
  return Math.max(5, scenario.topK ?? 0, expectedTopPathCount, expectedInTopK, expectedOutsideTopK)
}

function buildTopResultEvidence(
  result: SearchEvalSearchResult,
  rank: number,
): SearchEvalTopResultEvidence {
  return {
    rank,
    path: displayPath(result.path),
    title: result.title,
    score: result.score,
    streams: buildStreamEvidence(result, rank),
  }
}

function buildStreamEvidence(
  result: SearchEvalSearchResult,
  resultRank: number,
): SearchEvalStreamEvidence[] {
  const streams: SearchEvalStreamEvidence[] = []
  const retrieval = result.retrieval
  if (retrieval?.token) {
    streams.push({
      name: "token",
      rank: retrieval.token.rank,
      rawScore: retrieval.token.rawScore,
      contribution: retrieval.token.rrf,
    })
  }
  if (retrieval?.bm25) {
    streams.push({
      name: "bm25",
      rank: retrieval.bm25.rank,
      rawScore: retrieval.bm25.rawScore,
      contribution: retrieval.bm25.rrf,
    })
  }
  if (retrieval?.vector) {
    streams.push({
      name: "vector",
      rank: retrieval.vector.rank,
      rawScore: retrieval.vector.rawScore,
      contribution: retrieval.vector.rrf,
    })
  }
  if (retrieval?.graph) {
    streams.push({
      name: "graph",
      rank: retrieval.graph.rank,
      rawScore: retrieval.graph.rawScore,
      contribution: retrieval.graph.rrf,
      path: retrieval.graph.path,
      pathTypes: retrieval.graph.pathTypes,
      pathDirections: retrieval.graph.pathDirections,
    })
  } else if (result.graphPath && result.graphPath.length > 0) {
    streams.push({
      name: "graph",
      rank: resultRank,
      contribution: result.score,
      path: result.graphPath,
      pathTypes: result.graphPathTypes,
      pathDirections: result.graphPathDirections,
    })
  }
  return streams
}

function displayPath(path: string): string {
  const normalized = normalizePath(path)
  const wikiIndex = normalized.lastIndexOf("/wiki/")
  return wikiIndex === -1 ? normalized : normalized.slice(wikiIndex + 1)
}
