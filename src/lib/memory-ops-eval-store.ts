import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { appendAuditEvent } from "@/lib/audit-timeline"
import { normalizePath } from "@/lib/path-utils"
import type { MemoryOpsEvalReport } from "@/lib/memory-ops-eval-types"

export interface SaveMemoryOpsEvalReportResult {
  path: string
  auditError?: string
  writeError?: string
}

const EVAL_DIR = ".llm-wiki/memory-ops-evals"
const LATEST_FILE = "latest.json"

export function memoryOpsEvalLatestReportPath(projectPath: string): string {
  return `${projectRoot(projectPath)}/${EVAL_DIR}/${LATEST_FILE}`
}

export async function saveMemoryOpsEvalReport(
  projectPath: string,
  report: MemoryOpsEvalReport,
): Promise<SaveMemoryOpsEvalReportResult> {
  const root = projectRoot(projectPath)
  const path = memoryOpsEvalLatestReportPath(root)
  const result: SaveMemoryOpsEvalReportResult = { path }

  try {
    await createDirectory(`${root}/${EVAL_DIR}`).catch(() => {})
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`)
  } catch (err) {
    result.writeError = errorMessage(err)
  }

  result.auditError = await appendEvalAuditSafely(root, report, result)
  return result
}

export async function loadLatestMemoryOpsEvalReport(
  projectPath: string,
): Promise<MemoryOpsEvalReport | null> {
  try {
    const raw = await readFile(memoryOpsEvalLatestReportPath(projectPath))
    const parsed = JSON.parse(raw) as unknown
    return isMemoryOpsEvalReport(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function appendEvalAuditSafely(
  projectPath: string,
  report: MemoryOpsEvalReport,
  result: SaveMemoryOpsEvalReportResult,
): Promise<string | undefined> {
  try {
    await appendAuditEvent(projectPath, {
      action: "memory_ops.eval",
      actor: "user",
      targetPath: ".llm-wiki/memory-ops-evals/latest.json",
      changes: {
        status: result.writeError ? "error" : report.metrics.failedCaseCount === 0 ? "applied" : "error",
      },
      after: {
        reportId: report.id,
        createdAt: report.createdAt,
        metrics: report.metrics,
        writeError: result.writeError,
      },
      reasons: [
        `${report.metrics.passedCaseCount}/${report.metrics.caseCount} eval cases passed`,
        `precision ${formatMetric(report.metrics.precision)}`,
        `recall ${formatMetric(report.metrics.recall)}`,
      ],
    })
    return undefined
  } catch (err) {
    return errorMessage(err)
  }
}

function isMemoryOpsEvalReport(value: unknown): value is MemoryOpsEvalReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Partial<MemoryOpsEvalReport>
  return record.schemaVersion === 1 && typeof record.id === "string" && !!record.metrics
}

function formatMetric(value: number): string {
  return value.toFixed(2)
}

function projectRoot(projectPath: string): string {
  return normalizePath(projectPath).replace(/\/$/, "")
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
