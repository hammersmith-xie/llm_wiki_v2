import { describe, expect, it } from "vitest"
import { collectTypedRelationGroups } from "./frontmatter-relations"

describe("collectTypedRelationGroups", () => {
  it("collects non-empty v2 typed relationship arrays in display order", () => {
    const groups = collectTypedRelationGroups({
      uses: ["tavily", "lancedb"],
      depends_on: ["embedding"],
      contradicts: [],
      supports: ["query-memory"],
      supersedes: ["old-search"],
      superseded_by: ["future-search"],
      related: ["generic-link"],
      title: "Deep Research",
    })

    expect(groups).toEqual([
      { field: "uses", label: "Uses", values: ["tavily", "lancedb"] },
      { field: "depends_on", label: "Depends on", values: ["embedding"] },
      { field: "supports", label: "Supports", values: ["query-memory"] },
      { field: "supersedes", label: "Supersedes", values: ["old-search"] },
      { field: "superseded_by", label: "Superseded by", values: ["future-search"] },
    ])
  })

  it("treats scalar typed relationship values as single-item groups", () => {
    const groups = collectTypedRelationGroups({
      uses: "tavily",
      supports: "query-memory",
    })

    expect(groups).toEqual([
      { field: "uses", label: "Uses", values: ["tavily"] },
      { field: "supports", label: "Supports", values: ["query-memory"] },
    ])
  })
})
