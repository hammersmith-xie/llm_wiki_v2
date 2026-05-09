import {
  collectCrystallizationCandidates,
  type CrystallizationCandidate,
} from "@/lib/crystallize-candidates"
import {
  buildCrystallizationDigestPlan,
  type CrystallizationDigestPlan,
} from "@/lib/crystallization-digest"
import type { DisplayMessage } from "@/stores/chat-store"

export interface SessionCrystallizationPlanInput {
  conversationId: string
  messages: readonly DisplayMessage[]
  existingDigestKeys?: Iterable<string>
  maxPlans?: number
}

export interface SessionCrystallizationPlan {
  conversationId: string
  candidate: CrystallizationCandidate
  digest: CrystallizationDigestPlan
}

export function buildSessionCrystallizationPlans(
  input: SessionCrystallizationPlanInput,
): SessionCrystallizationPlan[] {
  const messages = input.messages.filter(
    (message) => message.conversationId === input.conversationId,
  )
  if (messages.length === 0) return []

  const candidates = collectCrystallizationCandidates({
    chatMessages: messages,
  })
  const seenDigestKeys = new Set(input.existingDigestKeys ?? [])
  const plans: SessionCrystallizationPlan[] = []
  const limit = Math.max(0, input.maxPlans ?? 1)
  if (limit === 0) return []

  for (const candidate of candidates) {
    const digest = buildCrystallizationDigestPlan({
      candidate,
      existingDigestKeys: seenDigestKeys,
    })
    if (!digest) continue
    seenDigestKeys.add(digest.dedupeKey)
    plans.push({
      conversationId: input.conversationId,
      candidate,
      digest,
    })
    if (plans.length >= limit) break
  }

  return plans
}
