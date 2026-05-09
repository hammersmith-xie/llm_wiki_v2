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
