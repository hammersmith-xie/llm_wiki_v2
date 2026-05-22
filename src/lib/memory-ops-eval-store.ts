import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { appendAuditEvent } from "@/lib/audit-timeline"
import { normalizePath } from "@/lib/path-utils"
import type {
  MemoryOpsEvalGateDecision,
  MemoryOpsEvalMetrics,
  MemoryOpsEvalReport,
  MemoryOpsEvalVariantResult,
} from "@/lib/memory-ops-eval-types"

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
    return isMemoryOpsEvalReport(parsed) ? normalizeEvalReport(parsed) : null
  } catch {
    return null
  }
}

function normalizeEvalReport(report: MemoryOpsEvalReport): MemoryOpsEvalReport {
  const metrics = normalizeMetrics(report.metrics)
  return {
    ...report,
    metrics,
    gate: report.gate ?? legacyGateDecision(metrics),
    variants: report.variants?.map(normalizeVariantResult),
  }
}

function normalizeVariantResult(
  variant: MemoryOpsEvalVariantResult,
): MemoryOpsEvalVariantResult {
  const metrics = normalizeMetrics(variant.metrics)
  return {
    ...variant,
    metrics,
    scoreDelta: Number.isFinite(variant.scoreDelta) ? variant.scoreDelta : 0,
    decision: variant.decision ?? legacyGateDecision(metrics),
  }
}

function normalizeMetrics(metrics: MemoryOpsEvalMetrics): MemoryOpsEvalMetrics {
  return {
    ...metrics,
    patrolScore: legacyPatrolScore(metrics),
  }
}

function legacyGateDecision(metrics: MemoryOpsEvalMetrics): MemoryOpsEvalGateDecision {
  const patrolScore = legacyPatrolScore(metrics)
  if (metrics.failedCaseCount === 0) {
    return {
      status: "pass",
      decision: "keep",
      candidateScore: patrolScore,
      reasons: ["legacy eval report passed all cases"],
    }
  }

  return {
    status: "fail",
    decision: "discard",
    candidateScore: patrolScore,
    reasons: [`legacy eval report has ${metrics.failedCaseCount} failing case(s)`],
  }
}

function legacyPatrolScore(metrics: MemoryOpsEvalMetrics): number {
  if (Number.isFinite(metrics.patrolScore)) return metrics.patrolScore
  const exactPassRate = metrics.caseCount > 0
    ? metrics.passedCaseCount / metrics.caseCount
    : 1
  const safetyRate = metrics.actualSuggestionCount > 0
    ? metrics.safePatchCount / metrics.actualSuggestionCount
    : 1
  return Math.round((
    metrics.f1 * 0.6 +
    exactPassRate * 0.25 +
    safetyRate * 0.1 +
    metrics.precision * 0.05
  ) * 1000) / 1000
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
        status: result.writeError ? "error" : report.gate.status === "pass" ? "applied" : "error",
      },
      after: {
        reportId: report.id,
        createdAt: report.createdAt,
        metrics: report.metrics,
        gate: report.gate,
        writeError: result.writeError,
      },
      reasons: [
        `${report.metrics.passedCaseCount}/${report.metrics.caseCount} eval cases passed`,
        `precision ${formatMetric(report.metrics.precision)}`,
        `recall ${formatMetric(report.metrics.recall)}`,
        `decision ${report.gate.decision}`,
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
