import { describe, expect, it } from "vitest"
import {
  DEFAULT_LLM_WIKI_SCHEMA_CONTRACT,
  normalizeSchemaContract,
  parseSchemaContractFromMarkdown,
  schemaContractFieldMap,
  schemaContractPageTypeMap,
} from "./schema-contract"
import {
  WIKI_GRAPH_SEED_ARRAY_FIELDS,
  WIKI_TYPED_RELATION_ARRAY_FIELDS,
} from "./wiki-frontmatter-fields"

describe("schema contract", () => {
  it("defines a default contract for core page types, fields, relations, quality, and governance", () => {
    const contract = DEFAULT_LLM_WIKI_SCHEMA_CONTRACT
    const fields = schemaContractFieldMap(contract)
    const pageTypes = schemaContractPageTypeMap(contract)

    expect(contract).toMatchObject({
      version: 1,
      name: "llm-wiki-v2-default",
      memoryOps: {
        sourceOfTruth: "markdown",
        auditPath: ".llm-wiki/audit.jsonl",
        requiresPreviewForMetadataPatch: true,
        privateScopeRedaction: true,
      },
      quality: {
        minQualityScore: 0.55,
        minConfidence: 0.45,
        minRelationCount: 1,
      },
    })
    expect(pageTypes.get("entity")?.directory).toBe("wiki/entities/")
    expect(pageTypes.get("synthesis")?.directory).toBe("wiki/synthesis/")
    expect(fields.get("type")).toMatchObject({
      kind: "enum",
      required: true,
      values: expect.arrayContaining(["entity", "concept", "source", "query"]),
    })
    expect(fields.get("title")).toMatchObject({ kind: "string", required: true })
    expect(fields.get("confidence")).toMatchObject({ kind: "score", recommended: true })
    expect(fields.get("review_status")).toMatchObject({
      kind: "enum",
      values: ["ok", "needs-review", "stale", "contradicted"],
    })
    expect(fields.get("scope")).toMatchObject({
      kind: "enum",
      values: ["shared", "private"],
    })
    expect(contract.relations.graphSeedFields).toEqual([...WIKI_GRAPH_SEED_ARRAY_FIELDS])
    expect(contract.relations.typedRelationFields).toEqual([...WIKI_TYPED_RELATION_ARRAY_FIELDS])
  })

  it("normalizes custom page types, fields, and thresholds while preserving defaults", () => {
    const result = normalizeSchemaContract({
      version: 1,
      name: "research",
      pageTypes: [
        {
          type: "finding",
          directory: "wiki/findings",
          description: "Individual empirical result.",
        },
      ],
      frontmatterFields: [
        {
          name: "evidence_strength",
          kind: "enum",
          values: ["low", "medium", "high"],
          recommended: true,
        },
      ],
      quality: {
        minQualityScore: 0.7,
        requiredSections: ["Summary", "Evidence"],
      },
    })

    const pageTypes = schemaContractPageTypeMap(result.contract)
    const fields = schemaContractFieldMap(result.contract)

    expect(result.warnings).toEqual([])
    expect(result.contract.name).toBe("research")
    expect(pageTypes.get("entity")?.directory).toBe("wiki/entities/")
    expect(pageTypes.get("finding")?.directory).toBe("wiki/findings/")
    expect(fields.get("title")?.required).toBe(true)
    expect(fields.get("evidence_strength")).toMatchObject({
      kind: "enum",
      values: ["low", "medium", "high"],
      recommended: true,
    })
    expect(result.contract.quality).toMatchObject({
      minQualityScore: 0.7,
      minConfidence: 0.45,
      requiredSections: ["Summary", "Evidence"],
    })
  })

  it("falls back to the default contract when input is missing", () => {
    const result = normalizeSchemaContract(null)

    expect(result.contract).toBe(DEFAULT_LLM_WIKI_SCHEMA_CONTRACT)
    expect(result.warnings).toEqual([
      "Schema contract missing or invalid; using defaults.",
    ])
  })

  it("reports invalid values and keeps a usable normalized contract", () => {
    const result = normalizeSchemaContract({
      version: 2,
      name: "",
      pageTypes: "bad",
      frontmatterFields: [
        { name: "broken", kind: "object" },
      ],
      relations: {
        graphSeedFields: "bad",
        typedRelationFields: ["uses", "unsupported"],
      },
      quality: {
        minQualityScore: 2,
        minConfidence: -1,
        minRelationCount: -1,
        requiredSections: [],
      },
      memoryOps: {
        sourceOfTruth: "database",
        auditPath: "",
      },
    })

    expect(result.contract.version).toBe(1)
    expect(result.contract.name).toBe(DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.name)
    expect(result.contract.pageTypes).toEqual(DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.pageTypes)
    expect(result.contract.relations.graphSeedFields).toEqual([...WIKI_GRAPH_SEED_ARRAY_FIELDS])
    expect(result.contract.relations.typedRelationFields).toEqual(["uses"])
    expect(result.contract.quality).toMatchObject({
      minQualityScore: 0.55,
      minConfidence: 0.45,
      minRelationCount: 1,
      requiredSections: ["Summary"],
    })
    expect(result.contract.memoryOps).toMatchObject({
      sourceOfTruth: "markdown",
      auditPath: ".llm-wiki/audit.jsonl",
    })
    expect(result.warnings).toEqual(expect.arrayContaining([
      "version must be 1; using 1.",
      "name must be a non-empty string; using llm-wiki-v2-default.",
      "pageTypes must be an array; using default page types.",
      "frontmatterFields item requires valid name and kind; item skipped.",
      "relations.graphSeedFields must be a non-empty string array; using defaults.",
      "relations.typedRelationFields contains unsupported field \"unsupported\"; skipped.",
      "quality.minQualityScore must be between 0 and 1; using 0.55.",
      "quality.minConfidence must be between 0 and 1; using 0.45.",
      "quality.minRelationCount must be a non-negative integer; using 1.",
      "quality.requiredSections must be a non-empty string array; using defaults.",
      "memoryOps.sourceOfTruth must be markdown; using markdown.",
    ]))
  })

  it("parses a YAML contract block from schema markdown", () => {
    const result = parseSchemaContractFromMarkdown(`# Wiki Schema

\`\`\`yaml llm-wiki-schema-contract
version: 1
name: custom-research
pageTypes:
  - type: finding
    directory: wiki/findings
frontmatterFields:
  - name: evidence_strength
    kind: enum
    values: [low, medium, high]
quality:
  minQualityScore: 0.7
\`\`\`
`)

    expect(result.found).toBe(true)
    expect(result.format).toBe("yaml")
    expect(result.warnings).toEqual([])
    expect(result.contract.name).toBe("custom-research")
    expect(schemaContractPageTypeMap(result.contract).get("finding")?.directory).toBe("wiki/findings/")
    expect(schemaContractFieldMap(result.contract).get("evidence_strength")).toMatchObject({
      kind: "enum",
      values: ["low", "medium", "high"],
    })
    expect(result.contract.quality.minQualityScore).toBe(0.7)
  })

  it("parses a JSON contract block from schema markdown", () => {
    const result = parseSchemaContractFromMarkdown(`Before

\`\`\`json llm-wiki-schema-contract
{
  "version": 1,
  "name": "json-contract",
  "quality": {
    "minConfidence": 0.6
  }
}
\`\`\`
`)

    expect(result.found).toBe(true)
    expect(result.format).toBe("json")
    expect(result.contract.name).toBe("json-contract")
    expect(result.contract.quality.minConfidence).toBe(0.6)
  })

  it("falls back when schema markdown has no contract block", () => {
    const result = parseSchemaContractFromMarkdown("# Wiki Schema\n\nNo machine contract yet.")

    expect(result.found).toBe(false)
    expect(result.contract).toBe(DEFAULT_LLM_WIKI_SCHEMA_CONTRACT)
    expect(result.warnings).toEqual([
      "Schema contract block not found; using defaults.",
    ])
  })

  it("falls back when schema contract block cannot be parsed", () => {
    const result = parseSchemaContractFromMarkdown(`\`\`\`json llm-wiki-schema-contract
{ bad json
\`\`\`
`)

    expect(result.found).toBe(true)
    expect(result.format).toBe("json")
    expect(result.contract).toBe(DEFAULT_LLM_WIKI_SCHEMA_CONTRACT)
    expect(result.warnings[0]).toContain("Schema contract JSON could not be parsed; using defaults:")
  })
})
