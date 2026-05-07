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
    })
  })

  it("reports invalid fields and falls back to default values", () => {
    const result = normalizeMemoryOpsPolicy({
      halfLives: { semantic: -1 },
      lowConfidenceThreshold: 2,
      promotion: { minSources: 1.5 },
    })

    expect(result.policy.halfLives.semantic).toBe(180)
    expect(result.policy.lowConfidenceThreshold).toBe(0.45)
    expect(result.policy.promotion.minSources).toBe(2)
    expect(result.warnings).toEqual([
      "halfLives.semantic must be a positive number; using 180.",
      "lowConfidenceThreshold must be between 0 and 1; using 0.45.",
      "promotion.minSources must be a non-negative integer; using 2.",
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
