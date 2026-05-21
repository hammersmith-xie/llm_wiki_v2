import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_MEMORY_OPS_POLICY,
  memoryOpsHalfLifeForLifecycle,
  normalizeMemoryOpsPolicy,
  saveMemoryOpsPolicy,
} from "./memory-ops-policy"

vi.mock("@/lib/project-store", () => ({
  loadMemoryOpsPolicyState: vi.fn(),
  saveMemoryOpsPolicyState: vi.fn(async () => {}),
}))

import { saveMemoryOpsPolicyState } from "@/lib/project-store"

const mockSavePolicyState = vi.mocked(saveMemoryOpsPolicyState)

beforeEach(() => {
  mockSavePolicyState.mockClear()
})

describe("memory ops policy", () => {
  it("keeps defaults compatible with the existing hard-coded thresholds", () => {
    expect(DEFAULT_MEMORY_OPS_POLICY).toMatchObject({
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
    })
  })

  it("normalizes partial custom policies with defaults", () => {
    const result = normalizeMemoryOpsPolicy({
      name: "research",
      halfLives: { semantic: 365 },
      staleMultiplier: 3,
      lowConfidenceThreshold: 0.5,
      promotion: { minSources: 3 },
      archive: { requireNoRecentUse: false },
      automation: {
        autoPatrolEnabled: false,
        eventThreshold: 7,
        reminderCooldownMinutes: 45,
        minPatrolIntervalMinutes: 10,
        timeIntervalHours: 12,
        maintenanceDaemonEnabled: false,
        maintenanceCheckIntervalMinutes: 20,
      },
      research: {
        maxCandidates: 12,
        maxEvidencePerCandidate: 10,
        staleReportDays: 3,
        minConfidence: 0.6,
        contradictionEscalationThreshold: 0.4,
        defaultProviders: ["local", "deep-research", "invalid"],
      },
      eval: {
        minPrecision: 0.8,
        minRecall: 0.75,
        minF1: 0.77,
      },
    })

    expect(result.warnings).toEqual([])
    expect(result.policy).toMatchObject({
      name: "research",
      halfLives: {
        working: 45,
        episodic: 45,
        semantic: 365,
        procedural: 365,
      },
      staleMultiplier: 3,
      lowConfidenceThreshold: 0.5,
      promotion: {
        minSources: 3,
        minReinforcement: 3,
      },
      archive: {
        requireNoSourceSupport: true,
        requireNoReinforcement: true,
        requireNoRecentUse: false,
      },
      automation: {
        autoPatrolEnabled: false,
        eventThreshold: 7,
        reminderCooldownMinutes: 45,
        minPatrolIntervalMinutes: 10,
        timeIntervalHours: 12,
        maintenanceDaemonEnabled: false,
        maintenanceCheckIntervalMinutes: 20,
      },
      research: {
        maxCandidates: 12,
        maxEvidencePerCandidate: 10,
        staleReportDays: 3,
        minConfidence: 0.6,
        contradictionEscalationThreshold: 0.4,
        defaultProviders: ["local", "deep-research"],
      },
      eval: {
        minPrecision: 0.8,
        minRecall: 0.75,
        minF1: 0.77,
      },
    })
  })

  it("reports invalid fields and falls back to default values", () => {
    const result = normalizeMemoryOpsPolicy({
      halfLives: { semantic: -1 },
      lowConfidenceThreshold: 2,
      promotion: { minSources: 1.5 },
      automation: {
        eventThreshold: 0,
        minPatrolIntervalMinutes: -1,
        maintenanceCheckIntervalMinutes: 0,
      },
      research: {
        maxCandidates: 0,
        maxEvidencePerCandidate: -1,
        staleReportDays: -1,
        minConfidence: 2,
        contradictionEscalationThreshold: -0.1,
        defaultProviders: ["bad"],
      },
      eval: {
        minPrecision: 2,
        minRecall: -1,
        minF1: Number.NaN,
      },
    })

    expect(result.policy.halfLives.semantic).toBe(180)
    expect(result.policy.lowConfidenceThreshold).toBe(0.45)
    expect(result.policy.promotion.minSources).toBe(2)
    expect(result.policy.automation.eventThreshold).toBe(5)
    expect(result.policy.automation.minPatrolIntervalMinutes).toBe(30)
    expect(result.policy.automation.maintenanceDaemonEnabled).toBe(true)
    expect(result.policy.automation.maintenanceCheckIntervalMinutes).toBe(15)
    expect(result.policy.research.maxCandidates).toBe(8)
    expect(result.policy.research.defaultProviders).toEqual(["local", "web-search"])
    expect(result.policy.eval.minPrecision).toBe(0.9)
    expect(result.warnings).toEqual([
      "halfLives.semantic must be a positive number; using 180.",
      "lowConfidenceThreshold must be between 0 and 1; using 0.45.",
      "promotion.minSources must be a non-negative integer; using 2.",
      "automation.eventThreshold must be a positive integer; using 5.",
      "automation.minPatrolIntervalMinutes must be a non-negative number; using 30.",
      "automation.maintenanceCheckIntervalMinutes must be a positive number; using 15.",
      "research.maxCandidates must be a positive integer; using 8.",
      "research.maxEvidencePerCandidate must be a positive integer; using 8.",
      "research.staleReportDays must be a non-negative number; using 7.",
      "research.minConfidence must be between 0 and 1; using 0.55.",
      "research.contradictionEscalationThreshold must be between 0 and 1; using 0.35.",
      "research.defaultProviders must contain at least one supported provider; using local, web-search.",
      "eval.minPrecision must be between 0 and 1; using 0.9.",
      "eval.minRecall must be between 0 and 1; using 0.9.",
      "eval.minF1 must be between 0 and 1; using 0.9.",
    ])
  })

  it("resolves half-life by lifecycle tier", () => {
    expect(memoryOpsHalfLifeForLifecycle("procedural")).toBe(365)
    expect(memoryOpsHalfLifeForLifecycle("semantic")).toBe(180)
    expect(memoryOpsHalfLifeForLifecycle("working")).toBe(45)
    expect(memoryOpsHalfLifeForLifecycle("unknown")).toBe(45)
  })

  it("persists normalized policy state", async () => {
    await saveMemoryOpsPolicy("/project", {
      ...DEFAULT_MEMORY_OPS_POLICY,
      name: "custom",
      halfLives: {
        ...DEFAULT_MEMORY_OPS_POLICY.halfLives,
        semantic: 365,
      },
    })

    expect(mockSavePolicyState).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({
        name: "custom",
        halfLives: expect.objectContaining({ semantic: 365 }),
      }),
    )
  })
})
