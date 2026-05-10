import type { LifecycleTier } from "@/lib/lifecycle"

export type ConfidenceStalenessReason =
  | "missing"
  | "malformed"
  | "fresh"
  | "stale"
  | "archived"

export interface ConfidenceStalenessAssessment {
  tier: LifecycleTier
  isStale: boolean
  daysSinceConfirmed: number | null
  halfLifeDays: number | null
  reason: ConfidenceStalenessReason
}

const DAY_MS = 86_400_000
const LIFECYCLE_TIERS = new Set<LifecycleTier>([
  "working",
  "episodic",
  "semantic",
  "procedural",
  "archived",
])

export function assessConfidenceStaleness(
  lastConfirmed: string | null | undefined,
  lifecycle: string | null | undefined,
  now: Date = new Date(),
): ConfidenceStalenessAssessment {
  const tier = normalizeLifecycle(lifecycle)
  const halfLifeDays = confidenceHalfLifeDays(tier)

  if (!lastConfirmed?.trim()) {
    return {
      tier,
      isStale: false,
      daysSinceConfirmed: null,
      halfLifeDays,
      reason: "missing",
    }
  }

  const confirmedMs = parseDateMs(lastConfirmed)
  if (confirmedMs === null) {
    return {
      tier,
      isStale: false,
      daysSinceConfirmed: null,
      halfLifeDays,
      reason: "malformed",
    }
  }

  const daysSinceConfirmed = Math.max(
    0,
    Math.floor((startOfUtcDay(now).getTime() - confirmedMs) / DAY_MS),
  )

  if (tier === "archived") {
    return {
      tier,
      isStale: false,
      daysSinceConfirmed,
      halfLifeDays: null,
      reason: "archived",
    }
  }

  const isStale = daysSinceConfirmed > halfLifeDays
  return {
    tier,
    isStale,
    daysSinceConfirmed,
    halfLifeDays,
    reason: isStale ? "stale" : "fresh",
  }
}

export function confidenceHalfLifeDays(tier: LifecycleTier): number {
  if (tier === "procedural") return 365
  if (tier === "semantic") return 180
  return 45
}

function normalizeLifecycle(value: string | null | undefined): LifecycleTier {
  const normalized = value?.trim().toLowerCase()
  return normalized && LIFECYCLE_TIERS.has(normalized as LifecycleTier)
    ? normalized as LifecycleTier
    : "semantic"
}

function parseDateMs(value: string): number | null {
  const trimmed = value.trim()
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? Date.parse(`${trimmed}T00:00:00.000Z`)
    : Date.parse(trimmed)
  return Number.isFinite(timestamp) ? startOfUtcDay(new Date(timestamp)).getTime() : null
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}
