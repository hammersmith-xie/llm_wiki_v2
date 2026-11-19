import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { appendAuditEvent } from "@/lib/audit-timeline"
import { buildMemoryOpsResearchEvidenceMatrix } from "@/lib/memory-ops-research-matrix"
import { normalizePath } from "@/lib/path-utils"
import type {
  MemoryOpsResearchCandidateResult,
  MemoryOpsResearchEvidenceItem,
  MemoryOpsResearchEvidenceReport,
  MemoryOpsResearchProviderResult,
} from "@/lib/memory-ops-research-types"
import { summarizeResearchResults } from "@/lib/memory-ops-research-types"

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
    return isMemoryOpsResearchReport(parsed) ? normalizeResearchReport(parsed) : null
  } catch {
    return null
  }
}

function normalizeResearchReport(
  report: MemoryOpsResearchEvidenceReport,
): MemoryOpsResearchEvidenceReport {
  const results = report.results.map(normalizeResearchResult)
  return {
    ...report,
    results,
    summary: summarizeResearchResults(results),
    warnings: report.warnings ?? [],
  }
}

function normalizeResearchResult(
  result: MemoryOpsResearchCandidateResult,
): MemoryOpsResearchCandidateResult {
  const existingEvidence = result.evidence ?? []
  const providerResults = normalizeProviderResults(result.providerResults, existingEvidence)
  const evidence = existingEvidence.length > 0
    ? existingEvidence
    : providerResults.flatMap((provider) => provider.evidence)
  return {
    ...result,
    evidence,
    providerResults,
    evidenceMatrix: buildMemoryOpsResearchEvidenceMatrix(providerResults),
    warnings: result.warnings ?? [],
  }
}

function normalizeProviderResults(
  providerResults: readonly MemoryOpsResearchProviderResult[] | undefined,
  fallbackEvidence: readonly MemoryOpsResearchEvidenceItem[],
): MemoryOpsResearchProviderResult[] {
  if (providerResults && providerResults.length > 0) {
    return providerResults.map((provider) => ({
      ...provider,
      evidence: provider.evidence ?? [],
      warnings: provider.warnings ?? [],
      durationMs: Number.isFinite(provider.durationMs) ? provider.durationMs : 0,
    }))
  }

  const grouped = new Map<string, MemoryOpsResearchEvidenceItem[]>()
  for (const item of fallbackEvidence) {
    const provider = item.provider || "unknown"
    grouped.set(provider, [...(grouped.get(provider) ?? []), item])
  }
  return [...grouped.entries()].map(([provider, evidence]) => ({
    provider,
    status: "ok",
    evidence,
    warnings: [],
    durationMs: 0,
  }))
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
        `${report.summary.uniqueSourceCount} unique source${report.summary.uniqueSourceCount === 1 ? "" : "s"}`,
        `source diversity ${formatMetric(report.summary.averageSourceDiversityScore)}`,
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

function formatMetric(value: number): string {
  return value.toFixed(2)
}
