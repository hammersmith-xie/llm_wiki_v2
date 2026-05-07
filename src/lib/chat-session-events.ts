import {
  recordWikiAutomationEvent,
  type WikiAutomationEventResult,
} from "@/lib/wiki-automation-events"
import { normalizePath } from "@/lib/path-utils"

export interface ChatSessionEventInput {
  projectPath: string | null | undefined
  conversationId: string
  messageCount?: number
  referencedPageCount?: number
  status?: string
  reason?: string
}

export async function recordChatSessionStart(
  input: ChatSessionEventInput,
): Promise<void> {
  const projectPath = normalizeProjectPath(input.projectPath)
  if (!projectPath) return

  const result = await recordWikiAutomationEvent({
    type: "session.start",
    projectPath,
    actor: "user",
    status: input.status ?? "applied",
    reasons: ["conversation created", input.reason].filter(Boolean) as string[],
    summary: {
      conversationId: input.conversationId,
      messageCount: input.messageCount ?? 0,
    },
    maintenance: false,
  }).catch((err) => ({
    action: "session.start",
    auditEvent: { action: "session.start" },
    auditError: err instanceof Error ? err.message : String(err),
  }) satisfies WikiAutomationEventResult)

  warnAutomationError("session.start", input.conversationId, result)
}

export async function recordChatSessionEnd(
  input: ChatSessionEventInput,
): Promise<void> {
  const projectPath = normalizeProjectPath(input.projectPath)
  if (!projectPath) return

  const result = await recordWikiAutomationEvent({
    type: "session.end",
    projectPath,
    actor: "system",
    status: input.status ?? "applied",
    reasons: ["assistant response completed", input.reason].filter(Boolean) as string[],
    summary: {
      conversationId: input.conversationId,
      messageCount: input.messageCount,
      referencedPageCount: input.referencedPageCount ?? 0,
    },
    maintenance: false,
  }).catch((err) => ({
    action: "session.end",
    auditEvent: { action: "session.end" },
    auditError: err instanceof Error ? err.message : String(err),
  }) satisfies WikiAutomationEventResult)

  warnAutomationError("session.end", input.conversationId, result)
}

function normalizeProjectPath(projectPath: string | null | undefined): string | null {
  if (!projectPath) return null
  const normalized = normalizePath(projectPath).trim()
  return normalized.length > 0 ? normalized : null
}

function warnAutomationError(
  action: string,
  conversationId: string,
  result: WikiAutomationEventResult,
): void {
  if (!result.auditError && !result.maintenanceError) return
  console.warn(
    `[automation] ${action} event failed for ${conversationId}: ${[
      result.auditError,
      result.maintenanceError,
    ].filter(Boolean).join("; ")}`,
  )
}
