import {
  loadMemoryOpsPolicyState,
  saveMemoryOpsPolicyState,
} from "@/lib/project-store"

export interface MemoryOpsPolicyHalfLives {
  working: number
  episodic: number
  semantic: number
  procedural: number
  archived: number
}

export interface MemoryOpsPromotionPolicy {
  minSources: number
  minReinforcement: number
}

export interface MemoryOpsArchivePolicy {
  requireNoSourceSupport: boolean
  requireNoReinforcement: boolean
  requireNoRecentUse: boolean
}

export interface MemoryOpsAutomationPolicy {
  autoPatrolEnabled: boolean
  eventThreshold: number
  reminderCooldownMinutes: number
  minPatrolIntervalMinutes: number
  timeIntervalHours: number
  maintenanceDaemonEnabled: boolean
  maintenanceCheckIntervalMinutes: number
}

export interface MemoryOpsResearchPolicy {
  maxCandidates: number
  maxEvidencePerCandidate: number
  staleReportDays: number
  minConfidence: number
  contradictionEscalationThreshold: number
  defaultProviders: Array<"local" | "web-search" | "deep-research">
}

export interface MemoryOpsEvalPolicy {
  minPrecision: number
  minRecall: number
  minF1: number
}

export interface MemoryOpsPolicy {
  version: 1
  name: string
  halfLives: MemoryOpsPolicyHalfLives
  staleMultiplier: number
  lowConfidenceThreshold: number
  promotion: MemoryOpsPromotionPolicy
  archive: MemoryOpsArchivePolicy
  automation: MemoryOpsAutomationPolicy
  research: MemoryOpsResearchPolicy
  eval: MemoryOpsEvalPolicy
}

export interface MemoryOpsPolicyLoadResult {
  policy: MemoryOpsPolicy
  warnings: string[]
}

export const DEFAULT_MEMORY_OPS_POLICY: MemoryOpsPolicy = {
  version: 1,
  name: "default",
  halfLives: {
    working: 45,
    episodic: 45,
    semantic: 180,
    procedural: 365,
    archived: 45,
  },
  staleMultiplier: 2,
  lowConfidenceThreshold: 0.45,
  promotion: {
    minSources: 2,
    minReinforcement: 3,
  },
  archive: {
    requireNoSourceSupport: true,
    requireNoReinforcement: true,
    requireNoRecentUse: true,
  },
  automation: {
    autoPatrolEnabled: true,
    eventThreshold: 5,
    reminderCooldownMinutes: 30,
    minPatrolIntervalMinutes: 30,
    timeIntervalHours: 24,
    maintenanceDaemonEnabled: true,
    maintenanceCheckIntervalMinutes: 15,
  },
  research: {
    maxCandidates: 8,
    maxEvidencePerCandidate: 8,
    staleReportDays: 7,
    minConfidence: 0.55,
    contradictionEscalationThreshold: 0.35,
    defaultProviders: ["local", "web-search"],
  },
  eval: {
    minPrecision: 0.9,
    minRecall: 0.9,
    minF1: 0.9,
  },
}

export function normalizeMemoryOpsPolicy(input: unknown): MemoryOpsPolicyLoadResult {
  const warnings: string[] = []
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { policy: DEFAULT_MEMORY_OPS_POLICY, warnings: ["Memory Ops policy missing or invalid; using defaults."] }
  }

  const record = input as Record<string, unknown>
  const policy: MemoryOpsPolicy = {
    version: 1,
    name: stringValue(record.name) ?? DEFAULT_MEMORY_OPS_POLICY.name,
    halfLives: {
      working: positiveNumber(recordAt(record.halfLives, "working"), DEFAULT_MEMORY_OPS_POLICY.halfLives.working, "halfLives.working", warnings),
      episodic: positiveNumber(recordAt(record.halfLives, "episodic"), DEFAULT_MEMORY_OPS_POLICY.halfLives.episodic, "halfLives.episodic", warnings),
      semantic: positiveNumber(recordAt(record.halfLives, "semantic"), DEFAULT_MEMORY_OPS_POLICY.halfLives.semantic, "halfLives.semantic", warnings),
      procedural: positiveNumber(recordAt(record.halfLives, "procedural"), DEFAULT_MEMORY_OPS_POLICY.halfLives.procedural, "halfLives.procedural", warnings),
      archived: positiveNumber(recordAt(record.halfLives, "archived"), DEFAULT_MEMORY_OPS_POLICY.halfLives.archived, "halfLives.archived", warnings),
    },
    staleMultiplier: positiveNumber(record.staleMultiplier, DEFAULT_MEMORY_OPS_POLICY.staleMultiplier, "staleMultiplier", warnings),
    lowConfidenceThreshold: scoreNumber(record.lowConfidenceThreshold, DEFAULT_MEMORY_OPS_POLICY.lowConfidenceThreshold, "lowConfidenceThreshold", warnings),
    promotion: {
      minSources: nonNegativeInteger(recordAt(record.promotion, "minSources"), DEFAULT_MEMORY_OPS_POLICY.promotion.minSources, "promotion.minSources", warnings),
      minReinforcement: nonNegativeInteger(recordAt(record.promotion, "minReinforcement"), DEFAULT_MEMORY_OPS_POLICY.promotion.minReinforcement, "promotion.minReinforcement", warnings),
    },
    archive: {
      requireNoSourceSupport: booleanValue(recordAt(record.archive, "requireNoSourceSupport"), DEFAULT_MEMORY_OPS_POLICY.archive.requireNoSourceSupport),
      requireNoReinforcement: booleanValue(recordAt(record.archive, "requireNoReinforcement"), DEFAULT_MEMORY_OPS_POLICY.archive.requireNoReinforcement),
      requireNoRecentUse: booleanValue(recordAt(record.archive, "requireNoRecentUse"), DEFAULT_MEMORY_OPS_POLICY.archive.requireNoRecentUse),
    },
    automation: {
      autoPatrolEnabled: booleanValue(recordAt(record.automation, "autoPatrolEnabled"), DEFAULT_MEMORY_OPS_POLICY.automation.autoPatrolEnabled),
      eventThreshold: positiveInteger(recordAt(record.automation, "eventThreshold"), DEFAULT_MEMORY_OPS_POLICY.automation.eventThreshold, "automation.eventThreshold", warnings),
      reminderCooldownMinutes: positiveNumber(recordAt(record.automation, "reminderCooldownMinutes"), DEFAULT_MEMORY_OPS_POLICY.automation.reminderCooldownMinutes, "automation.reminderCooldownMinutes", warnings),
      minPatrolIntervalMinutes: nonNegativeNumber(recordAt(record.automation, "minPatrolIntervalMinutes"), DEFAULT_MEMORY_OPS_POLICY.automation.minPatrolIntervalMinutes, "automation.minPatrolIntervalMinutes", warnings),
      timeIntervalHours: nonNegativeNumber(recordAt(record.automation, "timeIntervalHours"), DEFAULT_MEMORY_OPS_POLICY.automation.timeIntervalHours, "automation.timeIntervalHours", warnings),
      maintenanceDaemonEnabled: booleanValue(recordAt(record.automation, "maintenanceDaemonEnabled"), DEFAULT_MEMORY_OPS_POLICY.automation.maintenanceDaemonEnabled),
      maintenanceCheckIntervalMinutes: positiveNumber(recordAt(record.automation, "maintenanceCheckIntervalMinutes"), DEFAULT_MEMORY_OPS_POLICY.automation.maintenanceCheckIntervalMinutes, "automation.maintenanceCheckIntervalMinutes", warnings),
    },
    research: {
      maxCandidates: positiveInteger(recordAt(record.research, "maxCandidates"), DEFAULT_MEMORY_OPS_POLICY.research.maxCandidates, "research.maxCandidates", warnings),
      maxEvidencePerCandidate: positiveInteger(recordAt(record.research, "maxEvidencePerCandidate"), DEFAULT_MEMORY_OPS_POLICY.research.maxEvidencePerCandidate, "research.maxEvidencePerCandidate", warnings),
      staleReportDays: nonNegativeNumber(recordAt(record.research, "staleReportDays"), DEFAULT_MEMORY_OPS_POLICY.research.staleReportDays, "research.staleReportDays", warnings),
      minConfidence: scoreNumber(recordAt(record.research, "minConfidence"), DEFAULT_MEMORY_OPS_POLICY.research.minConfidence, "research.minConfidence", warnings),
      contradictionEscalationThreshold: scoreNumber(recordAt(record.research, "contradictionEscalationThreshold"), DEFAULT_MEMORY_OPS_POLICY.research.contradictionEscalationThreshold, "research.contradictionEscalationThreshold", warnings),
      defaultProviders: providerArray(recordAt(record.research, "defaultProviders"), DEFAULT_MEMORY_OPS_POLICY.research.defaultProviders, "research.defaultProviders", warnings),
    },
    eval: {
      minPrecision: scoreNumber(recordAt(record.eval, "minPrecision"), DEFAULT_MEMORY_OPS_POLICY.eval.minPrecision, "eval.minPrecision", warnings),
      minRecall: scoreNumber(recordAt(record.eval, "minRecall"), DEFAULT_MEMORY_OPS_POLICY.eval.minRecall, "eval.minRecall", warnings),
      minF1: scoreNumber(recordAt(record.eval, "minF1"), DEFAULT_MEMORY_OPS_POLICY.eval.minF1, "eval.minF1", warnings),
    },
  }

  return { policy, warnings }
}

export async function loadMemoryOpsPolicy(
  projectPath: string,
): Promise<MemoryOpsPolicyLoadResult> {
  const raw = await loadMemoryOpsPolicyState(projectPath).catch(() => null)
  if (raw === null) return { policy: DEFAULT_MEMORY_OPS_POLICY, warnings: [] }
  return normalizeMemoryOpsPolicy(raw)
}

export async function saveMemoryOpsPolicy(
  projectPath: string,
  policy: MemoryOpsPolicy,
): Promise<void> {
  const normalized = normalizeMemoryOpsPolicy(policy)
  if (normalized.warnings.length > 0) {
    throw new Error(`Invalid Memory Ops policy: ${normalized.warnings.join("; ")}`)
  }
  await saveMemoryOpsPolicyState(projectPath, normalized.policy)
}

export function memoryOpsHalfLifeForLifecycle(
  lifecycle: string | undefined,
  policy: MemoryOpsPolicy = DEFAULT_MEMORY_OPS_POLICY,
): number {
  if (lifecycle === "procedural") return policy.halfLives.procedural
  if (lifecycle === "semantic") return policy.halfLives.semantic
  if (lifecycle === "working") return policy.halfLives.working
  if (lifecycle === "archived") return policy.halfLives.archived
  return policy.halfLives.episodic
}

function recordAt(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return (value as Record<string, unknown>)[key]
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function positiveNumber(
  value: unknown,
  fallback: number,
  field: string,
  warnings: string[],
): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  if (value !== undefined) warnings.push(`${field} must be a positive number; using ${fallback}.`)
  return fallback
}

function scoreNumber(
  value: unknown,
  fallback: number,
  field: string,
  warnings: string[],
): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed
  if (value !== undefined) warnings.push(`${field} must be between 0 and 1; using ${fallback}.`)
  return fallback
}

function nonNegativeInteger(
  value: unknown,
  fallback: number,
  field: string,
  warnings: string[],
): number {
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed >= 0) return parsed
  if (value !== undefined) warnings.push(`${field} must be a non-negative integer; using ${fallback}.`)
  return fallback
}

function positiveInteger(
  value: unknown,
  fallback: number,
  field: string,
  warnings: string[],
): number {
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed > 0) return parsed
  if (value !== undefined) warnings.push(`${field} must be a positive integer; using ${fallback}.`)
  return fallback
}

function nonNegativeNumber(
  value: unknown,
  fallback: number,
  field: string,
  warnings: string[],
): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed >= 0) return parsed
  if (value !== undefined) warnings.push(`${field} must be a non-negative number; using ${fallback}.`)
  return fallback
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function providerArray(
  value: unknown,
  fallback: MemoryOpsResearchPolicy["defaultProviders"],
  field: string,
  warnings: string[],
): MemoryOpsResearchPolicy["defaultProviders"] {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value)) {
    warnings.push(`${field} must be an array of providers; using ${fallback.join(", ")}.`)
    return [...fallback]
  }
  const valid = new Set<MemoryOpsResearchPolicy["defaultProviders"][number]>([
    "local",
    "web-search",
    "deep-research",
  ])
  const providers = value.filter((item): item is MemoryOpsResearchPolicy["defaultProviders"][number] =>
    typeof item === "string" && valid.has(item as MemoryOpsResearchPolicy["defaultProviders"][number])
  )
  if (providers.length === 0) {
    warnings.push(`${field} must contain at least one supported provider; using ${fallback.join(", ")}.`)
    return [...fallback]
  }
  return [...new Set(providers)]
}
