import type {
  MemoryOpsSuggestion,
  MemoryOpsSuggestionDecision,
} from "@/lib/memory-ops-types"

export interface DecideMemoryOpsSuggestionOptions {
  minResearchConfidence: number
  requireResearchForWarnings?: boolean
}

export function decideMemoryOpsSuggestion(
  suggestion: MemoryOpsSuggestion,
  options: DecideMemoryOpsSuggestionOptions,
): MemoryOpsSuggestionDecision {
  if (!suggestion.proposedOperation) {
    return {
      kind: "review-only",
      applyAllowed: false,
      batchAllowed: false,
      confidence: suggestion.research?.confidence ?? 0,
      reasons: ["suggestion has no safe metadata patch operation"],
    }
  }

  const research = suggestion.research
  if (
    research &&
    (research.verdict === "contradicted" || research.verdict === "mixed")
  ) {
    return {
      kind: "blocked-by-contradiction",
      applyAllowed: false,
      batchAllowed: false,
      confidence: research.confidence,
      reasons: [
        `research verdict ${research.verdict}`,
        "metadata patch blocked until contradiction is reviewed",
      ],
    }
  }

  if (options.requireResearchForWarnings && suggestion.severity === "warning") {
    if (!research) {
      return {
        kind: "needs-research",
        applyAllowed: false,
        batchAllowed: false,
        confidence: 0,
        reasons: ["warning-level metadata patch requires research evidence"],
      }
    }
    if (research.confidence < options.minResearchConfidence) {
      return {
        kind: "needs-research",
        applyAllowed: false,
        batchAllowed: false,
        confidence: research.confidence,
        reasons: [
          `research confidence ${formatScore(research.confidence)} below ${formatScore(options.minResearchConfidence)}`,
        ],
      }
    }
  }

  return {
    kind: "ready",
    applyAllowed: true,
    batchAllowed: true,
    confidence: research?.confidence ?? 1,
    reasons: research
      ? [`research verdict ${research.verdict}`, `research confidence ${formatScore(research.confidence)}`]
      : ["deterministic local rule has a safe metadata patch"],
  }
}

export function withMemoryOpsSuggestionDecisions(
  suggestions: readonly MemoryOpsSuggestion[],
  options: DecideMemoryOpsSuggestionOptions,
): MemoryOpsSuggestion[] {
  return suggestions.map((suggestion) => ({
    ...suggestion,
    decision: decideMemoryOpsSuggestion(suggestion, options),
  }))
}

export function canApplyMemoryOpsSuggestion(suggestion: MemoryOpsSuggestion): boolean {
  if (!suggestion.proposedOperation) return false
  return suggestion.decision?.applyAllowed ?? true
}

function formatScore(value: number): string {
  return value.toFixed(2)
}
