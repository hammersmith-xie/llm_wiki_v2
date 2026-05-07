import { createDirectory, writeFile } from "@/commands/fs"
import { appendAuditEvent } from "@/lib/audit-timeline"
import {
  runSearchWikiEval,
  summarizeSearchEvalForMemoryOps,
  type SearchEvalMemoryOpsSummary,
  type SearchEvalReport,
  type SearchEvalScenario,
} from "@/lib/search-eval"
import { normalizePath } from "@/lib/path-utils"

export type SearchHealthStatus = "skipped" | "pass" | "fail"

export interface SearchHealthRunResult {
  status: SearchHealthStatus
  scenarioCount: number
  report?: SearchEvalReport
  summary?: SearchEvalMemoryOpsSummary
  writtenPath?: string
  writeError?: string
  auditError?: string
}

export interface RunSearchHealthOptions {
  writeReport?: boolean
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
    }
    result.auditError = await appendSearchHealthAuditSafely(pp, result)
    return result
  }

  const report = await runSearchWikiEval(pp, scenarios)
  const summary = summarizeSearchEvalForMemoryOps(report)
  const result: SearchHealthRunResult = {
    status: summary.status,
    scenarioCount: scenarios.length,
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
