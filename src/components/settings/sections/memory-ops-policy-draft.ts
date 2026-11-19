import type { MemoryOpsPolicy } from "@/lib/memory-ops-policy"

export type NumericPolicyKey =
  | "halfLives.working"
  | "halfLives.episodic"
  | "halfLives.semantic"
  | "halfLives.procedural"
  | "halfLives.archived"
  | "staleMultiplier"
  | "lowConfidenceThreshold"
  | "promotion.minSources"
  | "promotion.minReinforcement"
  | "automation.eventThreshold"
  | "automation.reminderCooldownMinutes"
  | "automation.minPatrolIntervalMinutes"
  | "automation.timeIntervalHours"
  | "automation.maintenanceCheckIntervalMinutes"
  | "research.maxCandidates"
  | "research.maxEvidencePerCandidate"
  | "research.staleReportDays"
  | "research.minConfidence"
  | "research.contradictionEscalationThreshold"
  | "eval.minPrecision"
  | "eval.minRecall"
  | "eval.minF1"

export function setNumericPolicyValue(
  policy: MemoryOpsPolicy,
  key: NumericPolicyKey,
  value: number,
): MemoryOpsPolicy {
  if (key.startsWith("halfLives.")) {
    const halfLife = key.split(".")[1] as keyof MemoryOpsPolicy["halfLives"]
    return {
      ...policy,
      halfLives: { ...policy.halfLives, [halfLife]: value },
    }
  }
  if (key.startsWith("promotion.")) {
    const promotionKey = key.split(".")[1] as keyof MemoryOpsPolicy["promotion"]
    return {
      ...policy,
      promotion: { ...policy.promotion, [promotionKey]: value },
    }
  }
  if (key.startsWith("automation.")) {
    const automationKey = key.split(".")[1] as keyof MemoryOpsPolicy["automation"]
    return {
      ...policy,
      automation: { ...policy.automation, [automationKey]: value },
    }
  }
  if (key.startsWith("research.")) {
    const researchKey = key.split(".")[1] as keyof Omit<MemoryOpsPolicy["research"], "defaultProviders">
    return {
      ...policy,
      research: { ...policy.research, [researchKey]: value },
    }
  }
  if (key.startsWith("eval.")) {
    const evalKey = key.split(".")[1] as keyof MemoryOpsPolicy["eval"]
    return {
      ...policy,
      eval: { ...policy.eval, [evalKey]: value },
    }
  }
  return { ...policy, [key]: value }
}

export function memoryOpsPolicyEquals(a: MemoryOpsPolicy, b: MemoryOpsPolicy): boolean {
  return (
    a.version === b.version &&
    a.name === b.name &&
    a.halfLives.working === b.halfLives.working &&
    a.halfLives.episodic === b.halfLives.episodic &&
    a.halfLives.semantic === b.halfLives.semantic &&
    a.halfLives.procedural === b.halfLives.procedural &&
    a.halfLives.archived === b.halfLives.archived &&
    a.staleMultiplier === b.staleMultiplier &&
    a.lowConfidenceThreshold === b.lowConfidenceThreshold &&
    a.promotion.minSources === b.promotion.minSources &&
    a.promotion.minReinforcement === b.promotion.minReinforcement &&
    a.archive.requireNoSourceSupport === b.archive.requireNoSourceSupport &&
    a.archive.requireNoReinforcement === b.archive.requireNoReinforcement &&
    a.archive.requireNoRecentUse === b.archive.requireNoRecentUse &&
    a.automation.autoPatrolEnabled === b.automation.autoPatrolEnabled &&
    a.automation.eventThreshold === b.automation.eventThreshold &&
    a.automation.reminderCooldownMinutes === b.automation.reminderCooldownMinutes &&
    a.automation.minPatrolIntervalMinutes === b.automation.minPatrolIntervalMinutes &&
    a.automation.timeIntervalHours === b.automation.timeIntervalHours &&
    a.automation.maintenanceDaemonEnabled === b.automation.maintenanceDaemonEnabled &&
    a.automation.maintenanceCheckIntervalMinutes === b.automation.maintenanceCheckIntervalMinutes &&
    a.research.maxCandidates === b.research.maxCandidates &&
    a.research.maxEvidencePerCandidate === b.research.maxEvidencePerCandidate &&
    a.research.staleReportDays === b.research.staleReportDays &&
    a.research.minConfidence === b.research.minConfidence &&
    a.research.contradictionEscalationThreshold === b.research.contradictionEscalationThreshold &&
    a.research.defaultProviders.join("\0") === b.research.defaultProviders.join("\0") &&
    a.eval.minPrecision === b.eval.minPrecision &&
    a.eval.minRecall === b.eval.minRecall &&
    a.eval.minF1 === b.eval.minF1
  )
}
