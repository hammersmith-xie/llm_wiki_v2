import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { appendAuditEvent } from "@/lib/audit-timeline"
import { normalizePath } from "@/lib/path-utils"
import type { MemoryOpsResearchEvidenceReport } from "@/lib/memory-ops-research-types"

export interface SaveMemoryOpsResearchReportResult {
  path: string
  latestPath: string
  auditError?: string
  writeError?: string
}

const RESEARCH_DIR = ".llm-wiki/memory-ops-research"
const LATEST_FILE = "latest.json"

export function memoryOpsResearchReportPath(
  projectPath: string,
  reportId: string,
): string {
  return `${projectRoot(projectPath)}/${RESEARCH_DIR}/${safeFilePart(reportId)}.json`
}

export function memoryOpsResearchLatestReportPath(projectPath: string): string {
  return `${projectRoot(projectPath)}/${RESEARCH_DIR}/${LATEST_FILE}`
}

export async function saveMemoryOpsResearchReport(
  projectPath: string,
  report: MemoryOpsResearchEvidenceReport,
): Promise<SaveMemoryOpsResearchReportResult> {
  const root = projectRoot(projectPath)
  const dir = `${root}/${RESEARCH_DIR}`
  const path = memoryOpsResearchReportPath(root, report.id)
  const latestPath = memoryOpsResearchLatestReportPath(root)
  const contents = `${JSON.stringify(report, null, 2)}\n`
  const result: SaveMemoryOpsResearchReportResult = { path, latestPath }

  try {
    await createDirectory(dir).catch(() => {})
    await writeFile(path, contents)
    await writeFile(latestPath, contents)
  } catch (err) {
    result.writeError = errorMessage(err)
  }

  result.auditError = await appendResearchAuditSafely(root, report, result)
  return result
}

export async function loadLatestMemoryOpsResearchReport(
  projectPath: string,
): Promise<MemoryOpsResearchEvidenceReport | null> {
  try {
    const raw = await readFile(memoryOpsResearchLatestReportPath(projectPath))
    const parsed = JSON.parse(raw) as unknown
    return isMemoryOpsResearchReport(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function appendResearchAuditSafely(
  projectPath: string,
  report: MemoryOpsResearchEvidenceReport,
  result: SaveMemoryOpsResearchReportResult,
): Promise<string | undefined> {
  try {
    await appendAuditEvent(projectPath, {
      action: "memory_ops.research_evidence",
      actor: "user",
      targetPath: ".llm-wiki/memory-ops-research/latest.json",
      changes: {
        status: result.writeError ? "error" : "applied",
      },
      after: {
        reportId: report.id,
        createdAt: report.createdAt,
        providers: report.providers,
        summary: report.summary,
        writeError: result.writeError,
      },
      reasons: [
        `${report.summary.candidateCount} research candidate${report.summary.candidateCount === 1 ? "" : "s"}`,
        `${report.summary.evidenceCount} evidence item${report.summary.evidenceCount === 1 ? "" : "s"}`,
      ],
    })
    return undefined
  } catch (err) {
    return errorMessage(err)
  }
}

function isMemoryOpsResearchReport(value: unknown): value is MemoryOpsResearchEvidenceReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Partial<MemoryOpsResearchEvidenceReport>
  return record.schemaVersion === 1 && typeof record.id === "string" && Array.isArray(record.results)
}

function projectRoot(projectPath: string): string {
  return normalizePath(projectPath).replace(/\/$/, "")
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "report"
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
