import { describe, expect, it } from "vitest"
import {
  WIKI_GRAPH_SEED_ARRAY_FIELDS,
  WIKI_MERGE_ARRAY_FIELDS,
  WIKI_REFERENCE_ARRAY_FIELDS,
  WIKI_TYPED_RELATION_ARRAY_FIELDS,
} from "./wiki-frontmatter-fields"

describe("wiki frontmatter field groups", () => {
  it("keeps v2 typed relation fields in one reusable order", () => {
    expect(WIKI_TYPED_RELATION_ARRAY_FIELDS).toEqual([
      "uses",
      "depends_on",
      "contradicts",
      "supports",
      "supersedes",
      "superseded_by",
    ])
  })

  it("treats related plus typed relations as frontmatter reference arrays", () => {
    expect(WIKI_REFERENCE_ARRAY_FIELDS).toEqual([
      "related",
      ...WIKI_TYPED_RELATION_ARRAY_FIELDS,
    ])
  })

  it("uses the same graph seed and reference fields for deterministic merges", () => {
    expect(WIKI_GRAPH_SEED_ARRAY_FIELDS).toEqual(["alias", "aliases", "keywords"])
    expect(WIKI_MERGE_ARRAY_FIELDS).toEqual([
      "sources",
      "tags",
      ...WIKI_GRAPH_SEED_ARRAY_FIELDS,
      ...WIKI_REFERENCE_ARRAY_FIELDS,
    ])
  })
})
