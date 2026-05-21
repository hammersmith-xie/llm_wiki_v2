import { describe, expect, it } from "vitest"
import { DEFAULT_MEMORY_OPS_POLICY } from "@/lib/memory-ops-policy"
import {
  memoryOpsPolicyEquals,
  setNumericPolicyValue,
} from "./memory-ops-policy-draft"

describe("memory ops policy draft helpers", () => {
  it("updates nested research and eval numeric fields", () => {
    const research = setNumericPolicyValue(
      DEFAULT_MEMORY_OPS_POLICY,
      "research.maxCandidates",
      12,
    )
    const evalPolicy = setNumericPolicyValue(research, "eval.minF1", 0.8)

    expect(evalPolicy.research.maxCandidates).toBe(12)
    expect(evalPolicy.eval.minF1).toBe(0.8)
    expect(memoryOpsPolicyEquals(evalPolicy, DEFAULT_MEMORY_OPS_POLICY)).toBe(false)
  })
})
