import { describe, expect, it } from "vitest"
import {
  DEFAULT_LLM_WIKI_SCHEMA_CONTRACT,
  parseSchemaContractFromMarkdown,
} from "./schema-contract"
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

  it("include memory ops audit and patrol boundaries", () => {
    for (const template of templates) {
      expect(template.schema, template.id).toContain("Memory Ops and audit rules")
      expect(template.schema, template.id).toContain(".llm-wiki/audit.jsonl")
      expect(template.schema, template.id).toContain("previewing the frontmatter diff")
      expect(template.schema, template.id).toContain("scope: private")
    }
  })

  it("include fact-level claim governance without making the claim index authoritative", () => {
    for (const template of templates) {
      expect(template.schema, template.id).toContain("Fact-level claim rules")
      expect(template.schema, template.id).toContain("<!-- claim:claim_xxx -->")
      expect(template.schema, template.id).toContain(".llm-wiki/claims.jsonl")
      expect(template.schema, template.id).toContain("derived claim index")
      expect(template.schema, template.id).toContain("Do not hand-edit or treat it as the source of truth")
    }
  })

  it("include parseable machine-readable schema contracts", () => {
    for (const template of templates) {
      expect(template.schema, template.id).toContain("```yaml llm-wiki-schema-contract")
      const parsed = parseSchemaContractFromMarkdown(template.schema)
      expect(parsed.found, template.id).toBe(true)
      expect(parsed.warnings, template.id).toEqual([])
      expect(parsed.contract).toMatchObject({
        version: DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.version,
        name: DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.name,
        relations: DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.relations,
        quality: DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.quality,
        memoryOps: DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.memoryOps,
        claimLayer: DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.claimLayer,
      })
    }
  })

  it("does not redefine v2 relationship arrays as scalar fields", () => {
    for (const template of templates) {
      expect(template.schema, template.id).not.toContain('supersedes: ""')
    }
  })
})
