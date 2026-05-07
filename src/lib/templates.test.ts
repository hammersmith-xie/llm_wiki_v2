import { describe, expect, it } from "vitest"
import { templates } from "./templates"

describe("wiki templates", () => {
  it("include the llm wiki v2 lifecycle and typed relationship contract", () => {
    for (const template of templates) {
      expect(template.schema, template.id).toContain("LLM Wiki v2 lifecycle fields")
      expect(template.schema, template.id).toContain("confidence_reasons")
      expect(template.schema, template.id).toContain("Graph seed arrays")
      expect(template.schema, template.id).toContain("alias: []")
      expect(template.schema, template.id).toContain("aliases: []")
      expect(template.schema, template.id).toContain("keywords: []")
      expect(template.schema, template.id).toContain("superseded_by")
      expect(template.schema, template.id).toContain("Typed relationship arrays")
      expect(template.schema, template.id).toContain("depends_on")
      expect(template.schema, template.id).toContain("supports")
      expect(template.schema, template.id).toContain("supersedes")
    }
  })

  it("does not redefine v2 relationship arrays as scalar fields", () => {
    for (const template of templates) {
      expect(template.schema, template.id).not.toContain('supersedes: ""')
    }
  })
})
