import {
  recordWikiAutomationEvent,
  type WikiAutomationEventResult,
} from "@/lib/wiki-automation-events"
import { recordCrystallizationDigestPreview } from "@/lib/crystallization-digest"
import { normalizePath } from "@/lib/path-utils"
import {
  buildSessionCrystallizationPlans,
  type SessionCrystallizationPlan,
} from "@/lib/session-crystallization"
import { addDigestPlanToConsolidationQueue } from "@/lib/consolidation-queue"
import type { DisplayMessage } from "@/stores/chat-store"

export interface ChatSessionEventInput {
  projectPath: string | null | undefined
  conversationId: string
  messageCount?: number
  referencedPageCount?: number
  status?: string
  reason?: string
  messages?: readonly DisplayMessage[]
  existingDigestKeys?: Iterable<string>
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

  const crystallizationPlans = input.status === "error"
    ? []
    : buildSessionCrystallizationPlans({
        conversationId: input.conversationId,
        messages: input.messages ?? [],
        existingDigestKeys: input.existingDigestKeys,
        maxPlans: 1,
      })

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
      crystallizationCandidateCount: crystallizationPlans.length,
      crystallizationCandidates: crystallizationPlans.map(sessionCrystallizationSummary),
    },
    maintenance: false,
  }).catch((err) => ({
    action: "session.end",
    auditEvent: { action: "session.end" },
    auditError: err instanceof Error ? err.message : String(err),
  }) satisfies WikiAutomationEventResult)

  warnAutomationError("session.end", input.conversationId, result)

  await recordSessionCrystallizationPreviews(projectPath, input.conversationId, crystallizationPlans)
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

async function recordSessionCrystallizationPreviews(
  projectPath: string,
  conversationId: string,
  plans: readonly SessionCrystallizationPlan[],
): Promise<void> {
  for (const plan of plans) {
    const result = await recordCrystallizationDigestPreview(projectPath, plan.digest)
    warnAutomationError("digest.preview", conversationId, result)
    await addDigestPlanToConsolidationQueue({
      projectPath,
      plan: plan.digest,
    }).catch((err) => {
      console.warn(
        `[automation] consolidation.queue.add failed for ${conversationId}: ${err instanceof Error ? err.message : String(err)}`,
      )
    })
  }
}

function sessionCrystallizationSummary(plan: SessionCrystallizationPlan): Record<string, unknown> {
  return {
    sourceId: plan.candidate.sourceId,
    title: plan.candidate.title,
    score: plan.candidate.score,
    reasons: plan.candidate.reasons,
    targetPaths: plan.digest.pageCandidates.map((candidate) => candidate.targetPath),
    counts: plan.digest.summary,
  }
}
