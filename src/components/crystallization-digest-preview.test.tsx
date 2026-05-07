import "@/i18n"
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CrystallizationDigestPreview } from "./crystallization-digest-preview"
import type { CrystallizationCandidate } from "@/lib/crystallize-candidates"

describe("CrystallizationDigestPreview", () => {
  it("renders a collapsed digest summary for high-value candidates", () => {
    const html = renderToStaticMarkup(
      <CrystallizationDigestPreview candidate={candidate()} compact />,
    )

    expect(html).toContain("Digest preview")
    expect(html).toContain("1 lessons, 2 decisions, 2 entities, 2 relations")
  })

  it("does not render for low-value candidates", () => {
    const html = renderToStaticMarkup(
      <CrystallizationDigestPreview
        candidate={{
          ...candidate(),
          score: 0.4,
        }}
        compact
      />,
    )

    expect(html).toBe("")
  })
})

function candidate(): CrystallizationCandidate {
  return {
    id: "crystallize:chat:m-1",
    origin: "chat",
    sourceId: "m-1",
    title: "Query Planner Tradeoffs",
    content: [
      "# Query Planner Tradeoffs",
      "",
      "Decision: keep graph expansion query-time because [[concepts/typed-graph|Typed Graph]] changes with every page write.",
      "Takeaway: hybrid search needs BM25, vector, and graph streams to remain separately auditable.",
      "",
      "- Next step: use [[concepts/bm25-ranking|BM25 Ranking]] as a lexical baseline before graph expansion.",
    ].join("\n"),
    score: 0.78,
    reasons: ["2 explicit references", "contains decision signal"],
    references: [
      { title: "Typed Graph", path: "wiki/concepts/typed-graph.md" },
      { title: "BM25 Ranking", path: "wiki/concepts/bm25-ranking.md" },
    ],
    tags: ["chat"],
    dedupeKey: "content:graph",
    timestamp: 1,
  }
}
