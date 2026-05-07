import {
  appendAuditEvent,
  type AuditEvent,
  type AuditEventActor,
} from "@/lib/audit-timeline"
import {
  recordMemoryOpsMaintenanceEvent,
  type MemoryOpsMaintenanceEventOptions,
} from "@/lib/memory-ops"

export type WikiAutomationEventType =
  | "session.start"
  | "session.end"
  | "memory.write"
  | "schema.scan"
  | "quality.scan"
  | "digest.preview"
  | "digest.save"

export interface WikiAutomationEventInput {
  type: WikiAutomationEventType
  projectPath: string
  actor?: AuditEventActor
  targetPath?: string
  pagePath?: string
  sourcePath?: string
  status?: string
  reasons?: readonly string[]
  summary?: Record<string, unknown>
  maintenance?: false | MemoryOpsMaintenanceEventOptions
}

export interface WikiAutomationEventResult {
  action: WikiAutomationEventType
  auditEvent: AuditEvent
  auditError?: string
  maintenanceError?: string
}

export async function recordWikiAutomationEvent(
  input: WikiAutomationEventInput,
): Promise<WikiAutomationEventResult> {
  const auditEvent = buildWikiAutomationAuditEvent(input)
  let auditError: string | undefined
  let maintenanceError: string | undefined

  try {
    await appendAuditEvent(input.projectPath, auditEvent)
  } catch (err) {
    auditError = errorMessage(err)
  }

  if (input.maintenance !== false) {
    try {
      await recordMemoryOpsMaintenanceEvent(
        input.projectPath,
        input.type,
        input.maintenance ?? {},
      )
    } catch (err) {
      maintenanceError = errorMessage(err)
    }
  }

  return {
    action: input.type,
    auditEvent,
    auditError,
    maintenanceError,
  }
}

export function buildWikiAutomationAuditEvent(
  input: WikiAutomationEventInput,
): AuditEvent {
  return {
    action: input.type,
    actor: input.actor ?? defaultActor(input.type),
    targetPath: input.targetPath ?? defaultTargetPath(input.type),
    pagePath: input.pagePath,
    sourcePath: input.sourcePath,
    changes: input.status ? { status: input.status } : undefined,
    after: {
      eventType: input.type,
      ...(input.summary ?? {}),
    },
    reasons: [
      `automation event ${input.type}`,
      ...(input.reasons ?? []),
    ],
  }
}

function defaultActor(type: WikiAutomationEventType): AuditEventActor {
  if (type === "session.start" || type === "session.end") return "user"
  return "system"
}

function defaultTargetPath(type: WikiAutomationEventType): string {
  if (type === "session.start" || type === "session.end") return ".llm-wiki/sessions"
  if (type === "schema.scan" || type === "quality.scan") return ".llm-wiki/audit.jsonl"
  if (type === "digest.preview" || type === "digest.save") return ".llm-wiki/crystallization"
  return ".llm-wiki/audit.jsonl"
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
