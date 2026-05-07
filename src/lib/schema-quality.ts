import { appendAuditEvent, type AuditEvent } from "@/lib/audit-timeline"
import type { MemoryOpsSuggestion } from "@/lib/memory-ops-rules"
import {
  evaluatePagesQuality,
  type PageQualityScore,
} from "@/lib/page-quality"
import {
  scanSchemaDrift,
  type SchemaDriftFinding,
  type SchemaDriftPageInput,
} from "@/lib/schema-drift"
import {
  DEFAULT_LLM_WIKI_SCHEMA_CONTRACT,
  parseSchemaContractFromMarkdown,
  type LlmWikiSchemaContract,
} from "@/lib/schema-contract"

export interface SchemaQualityScanInput {
  projectPath?: string
  schemaMarkdown?: string
  pages: readonly SchemaDriftPageInput[]
  contract?: LlmWikiSchemaContract
}

export interface SchemaQualityScanSummary {
  pageCount: number
  contractName: string
  contractVersion: number
  schemaContractFound: boolean
  findingCount: number
  warningCount: number
  infoCount: number
  averageQualityScore: number
  lowQualityPageCount: number
}

export interface SchemaQualityScanReport {
  contract: LlmWikiSchemaContract
  contractWarnings: string[]
  findings: SchemaDriftFinding[]
  qualityScores: PageQualityScore[]
  summary: SchemaQualityScanSummary
}

export interface RunSchemaQualityScanResult {
  report: SchemaQualityScanReport
  auditError?: string
}

export async function runSchemaQualityScan(
  input: SchemaQualityScanInput,
): Promise<RunSchemaQualityScanResult> {
  const report = buildSchemaQualityScanReport(input)
  let auditError: string | undefined

  if (input.projectPath) {
    try {
      await appendAuditEvent(input.projectPath, buildSchemaQualityScanAuditEvent(report))
    } catch (err) {
      auditError = err instanceof Error ? err.message : String(err)
    }
  }

  return { report, auditError }
}

export function buildSchemaQualityScanReport(
  input: SchemaQualityScanInput,
): SchemaQualityScanReport {
  const contractLoad = input.contract
    ? {
        contract: input.contract,
        found: true,
        warnings: [] as string[],
      }
    : input.schemaMarkdown !== undefined
      ? parseSchemaContractFromMarkdown(input.schemaMarkdown)
      : {
          contract: DEFAULT_LLM_WIKI_SCHEMA_CONTRACT,
          found: false,
          warnings: ["Schema markdown not provided; using defaults."],
        }

  const drift = scanSchemaDrift(input.pages, contractLoad.contract)
  const qualityScores = evaluatePagesQuality(input.pages, contractLoad.contract)
  const averageQualityScore = average(
    qualityScores.map((qualityScore) => qualityScore.score),
  )
  const lowQualityPageCount = qualityScores.filter(
    (qualityScore) => qualityScore.score < contractLoad.contract.quality.minQualityScore,
  ).length

  return {
    contract: contractLoad.contract,
    contractWarnings: contractLoad.warnings,
    findings: drift.findings,
    qualityScores,
    summary: {
      pageCount: input.pages.length,
      contractName: contractLoad.contract.name,
      contractVersion: contractLoad.contract.version,
      schemaContractFound: contractLoad.found,
      findingCount: drift.stats.findingCount,
      warningCount: drift.stats.warningCount,
      infoCount: drift.stats.infoCount,
      averageQualityScore,
      lowQualityPageCount,
    },
  }
}

export function buildSchemaQualityScanAuditEvent(
  report: SchemaQualityScanReport,
): AuditEvent {
  return {
    action: "memory_ops.schema_quality",
    actor: "system",
    targetPath: ".llm-wiki/audit.jsonl",
    after: {
      summary: report.summary,
      contractWarnings: report.contractWarnings,
      topFindings: report.findings.slice(0, 10).map((finding) => ({
        kind: finding.kind,
        severity: finding.severity,
        targetPath: finding.targetPath,
        field: finding.field,
      })),
      lowQualityPages: report.qualityScores
        .filter((qualityScore) => qualityScore.score < report.contract.quality.minQualityScore)
        .slice(0, 10)
        .map((qualityScore) => ({
          targetPath: qualityScore.targetPath,
          score: qualityScore.score,
        })),
    },
    reasons: [
      `${report.summary.pageCount} page${report.summary.pageCount === 1 ? "" : "s"} scanned`,
      `${report.summary.findingCount} schema finding${report.summary.findingCount === 1 ? "" : "s"}`,
      `${report.summary.lowQualityPageCount} low-quality page${report.summary.lowQualityPageCount === 1 ? "" : "s"}`,
    ],
  }
}

export function schemaQualityScanSuggestions(
  report: SchemaQualityScanReport,
): MemoryOpsSuggestion[] {
  return [
    ...report.findings.map(schemaFindingSuggestion),
    ...report.qualityScores
      .filter((qualityScore) =>
        qualityScore.score < report.contract.quality.minQualityScore &&
        qualityScore.proposedOperation,
      )
      .map((qualityScore) => qualityScoreSuggestion(qualityScore, report.contract.quality.minQualityScore)),
  ]
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
}

function schemaFindingSuggestion(finding: SchemaDriftFinding): MemoryOpsSuggestion {
  return {
    id: `schema-drift:${finding.id}`,
    kind: finding.proposedOperation ? "metadata-update" : "review-action",
    severity: finding.severity,
    targetPath: finding.targetPath,
    title: finding.title,
    detail: finding.detail,
    reasons: [
      "schema drift finding",
      ...finding.reasons,
    ],
    proposedOperation: finding.proposedOperation,
    relation: finding.relationTarget
      ? {
          field: finding.field ?? "relation",
          target: finding.relationTarget,
          candidateTarget: finding.candidateTarget,
        }
      : undefined,
  }
}

function qualityScoreSuggestion(
  qualityScore: PageQualityScore,
  threshold: number,
): MemoryOpsSuggestion {
  return {
    id: `schema-quality:quality:${qualityScore.targetPath}:${qualityScore.score}`,
    kind: "metadata-update",
    severity: "warning",
    targetPath: qualityScore.targetPath,
    title: "Mark low-quality page for review",
    detail: `Quality score ${formatScore(qualityScore.score)} is below ${formatScore(threshold)}.`,
    reasons: [
      "quality score finding",
      ...qualityScore.reasons,
    ],
    proposedOperation: qualityScore.proposedOperation,
  }
}

function formatScore(value: number): string {
  return value.toFixed(2)
}
