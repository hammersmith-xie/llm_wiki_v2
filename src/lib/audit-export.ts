import { createDirectory, writeFile } from "@/commands/fs"
import {
  appendAuditEvent,
  type AuditEvent,
} from "@/lib/audit-timeline"
import { auditTimelineTargetLabel, summarizeAuditTimelineEvent } from "@/lib/audit-timeline-ui"
import { normalizePath } from "@/lib/path-utils"

export type AuditExportFormat = "json" | "csv"

export interface AuditExportInput {
  projectPath: string
  events: readonly AuditEvent[]
  format: AuditExportFormat
  now?: Date
}

export interface AuditExportResult {
  format: AuditExportFormat
  path: string
  eventCount: number
}

export async function exportAuditEvents(
  input: AuditExportInput,
): Promise<AuditExportResult> {
  const projectPath = normalizePath(input.projectPath).replace(/\/$/, "")
  const now = input.now ?? new Date()
  const stamp = exportTimestamp(now)
  const path = `${projectPath}/.llm-wiki/exports/audit-${stamp}.${input.format}`
  const contents =
    input.format === "json"
      ? formatAuditEventsJson(input.events)
      : formatAuditEventsCsv(input.events)

  await createDirectory(`${projectPath}/.llm-wiki/exports`).catch(() => {})
  await writeFile(path, contents)
  await appendAuditEvent(projectPath, {
    action: "audit.export",
    actor: "user",
    targetPath: ".llm-wiki/exports",
    changes: { status: "applied" },
    after: {
      format: input.format,
      path,
      eventCount: input.events.length,
    },
    reasons: [
      `exported ${input.events.length} audit event${input.events.length === 1 ? "" : "s"}`,
      `format ${input.format}`,
    ],
  })

  return {
    format: input.format,
    path,
    eventCount: input.events.length,
  }
}

export function formatAuditEventsJson(events: readonly AuditEvent[]): string {
  return `${JSON.stringify(events, null, 2)}\n`
}

export function formatAuditEventsCsv(events: readonly AuditEvent[]): string {
  const header = [
    "timestamp",
    "action",
    "category",
    "actor",
    "status",
    "scope",
    "target",
    "reasons",
  ]
  const rows = events.map((event) => {
    const summary = summarizeAuditTimelineEvent(event)
    return [
      event.timestamp ?? "",
      event.action,
      summary.category,
      event.actor ?? "",
      summary.status ?? "",
      event.scope ?? "",
      auditTimelineTargetLabel(event),
      summary.reasonText,
    ]
  })
  return `${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`
}

function csvCell(value: unknown): string {
  const text = String(value ?? "")
  if (!/[",\r\n]/.test(text)) return text
  return `"${text.replace(/"/g, "\"\"")}"`
}

function exportTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-")
}
