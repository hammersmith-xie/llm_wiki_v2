import { describe, expect, it } from "vitest"
import {
  decideMemoryOpsEvidenceLedger,
  researchEvidenceToLedgerEntry,
} from "./memory-ops-evidence-ledger"

describe("memory ops evidence ledger", () => {
  it("scores support-only evidence as supported and applicable", () => {
    const decision = decideMemoryOpsEvidenceLedger([
      researchEvidenceToLedgerEntry({
        id: "local:1",
        provider: "local",
        stance: "support",
        title: "Local source",
        path: "wiki/a.md",
        snippet: "The claim is supported.",
        score: 0.8,
      }),
    ])

    expect(decision.verdict).toBe("supported")
    expect(decision.recommendation).toBe("apply")
    expect(decision.supportScore).toBeGreaterThan(0)
  })

  it("keeps conflicting evidence mixed for review", () => {
    const decision = decideMemoryOpsEvidenceLedger([
      researchEvidenceToLedgerEntry({
        id: "web:1",
        provider: "web-search",
        stance: "support",
        title: "Support",
        snippet: "Supported.",
        score: 0.8,
      }),
      researchEvidenceToLedgerEntry({
        id: "deep:1",
        provider: "deep-research",
        stance: "contradict",
        title: "Contradiction",
        snippet: "Deprecated and superseded.",
        score: 0.9,
      }),
    ])

    expect(decision.verdict).toBe("mixed")
    expect(decision.recommendation).toBe("review")
    expect(decision.contradictionScore).toBeGreaterThan(0)
  })

  it("returns unavailable when no evidence exists", () => {
    const decision = decideMemoryOpsEvidenceLedger([])

    expect(decision.verdict).toBe("unavailable")
    expect(decision.confidence).toBe(0)
    expect(decision.recommendation).toBe("defer")
  })
})
