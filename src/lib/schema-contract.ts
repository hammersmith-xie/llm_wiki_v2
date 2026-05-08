import {
  WIKI_GRAPH_SEED_ARRAY_FIELDS,
  WIKI_TYPED_RELATION_ARRAY_FIELDS,
  type WikiTypedRelationArrayField,
} from "@/lib/wiki-frontmatter-fields"
import yaml from "js-yaml"

export const LLM_WIKI_SCHEMA_CONTRACT_VERSION = 1

export type LlmWikiFrontmatterFieldKind =
  | "string"
  | "string-array"
  | "date"
  | "score"
  | "integer-string"
  | "enum"

export interface LlmWikiSchemaPageType {
  type: string
  directory: string
  description: string
}

export interface LlmWikiFrontmatterFieldContract {
  name: string
  kind: LlmWikiFrontmatterFieldKind
  required?: boolean
  recommended?: boolean
  values?: string[]
  description?: string
}

export interface LlmWikiRelationContract {
  graphSeedFields: string[]
  genericRelationFields: string[]
  typedRelationFields: WikiTypedRelationArrayField[]
}

export interface LlmWikiQualityContract {
  minQualityScore: number
  minConfidence: number
  minRelationCount: number
  requiredSections: string[]
}

export interface LlmWikiMemoryOpsContract {
  sourceOfTruth: "markdown"
  auditPath: string
  requiresPreviewForMetadataPatch: boolean
  privateScopeRedaction: boolean
}

export interface LlmWikiClaimLayerContract {
  sourceOfTruth: "markdown"
  indexPath: string
  anchorFormat: string
  derivedArtifact: boolean
  appManagedAnchors: boolean
  highValueOnly: boolean
  requiresReviewForContradictions: boolean
  privateScopeRedaction: boolean
}

export interface LlmWikiSchemaContract {
  version: typeof LLM_WIKI_SCHEMA_CONTRACT_VERSION
  name: string
  pageTypes: LlmWikiSchemaPageType[]
  frontmatterFields: LlmWikiFrontmatterFieldContract[]
  relations: LlmWikiRelationContract
  quality: LlmWikiQualityContract
  memoryOps: LlmWikiMemoryOpsContract
  claimLayer: LlmWikiClaimLayerContract
}

export interface SchemaContractNormalizeResult {
  contract: LlmWikiSchemaContract
  warnings: string[]
}

export interface SchemaContractParseResult extends SchemaContractNormalizeResult {
  found: boolean
  format?: "json" | "yaml"
}

export const LLM_WIKI_PAGE_TYPES: LlmWikiSchemaPageType[] = [
  {
    type: "entity",
    directory: "wiki/entities/",
    description: "Named things such as people, tools, organizations, and datasets.",
  },
  {
    type: "concept",
    directory: "wiki/concepts/",
    description: "Ideas, techniques, phenomena, and frameworks.",
  },
  {
    type: "source",
    directory: "wiki/sources/",
    description: "Papers, articles, talks, books, and blog posts.",
  },
  {
    type: "query",
    directory: "wiki/queries/",
    description: "Open questions and crystallized explorations.",
  },
  {
    type: "comparison",
    directory: "wiki/comparisons/",
    description: "Side-by-side analysis of related entities or concepts.",
  },
  {
    type: "synthesis",
    directory: "wiki/synthesis/",
    description: "Cross-cutting summaries and conclusions.",
  },
  {
    type: "overview",
    directory: "wiki/",
    description: "High-level project summary.",
  },
]

export const LLM_WIKI_FRONTMATTER_FIELDS: LlmWikiFrontmatterFieldContract[] = [
  {
    name: "type",
    kind: "enum",
    required: true,
    values: LLM_WIKI_PAGE_TYPES.map((pageType) => pageType.type),
    description: "Page type declared by the project schema.",
  },
  {
    name: "title",
    kind: "string",
    required: true,
    description: "Human-readable page title.",
  },
  {
    name: "tags",
    kind: "string-array",
    required: true,
    description: "Topic tags used for filtering and browsing.",
  },
  {
    name: "related",
    kind: "string-array",
    required: true,
    description: "Generic related page slugs or wikilinks.",
  },
  {
    name: "created",
    kind: "date",
    required: true,
    description: "Creation date in YYYY-MM-DD format.",
  },
  {
    name: "updated",
    kind: "date",
    required: true,
    description: "Last update date in YYYY-MM-DD format.",
  },
  {
    name: "lifecycle",
    kind: "enum",
    recommended: true,
    values: ["working", "episodic", "semantic", "procedural", "archived"],
    description: "Memory lifecycle tier.",
  },
  {
    name: "confidence",
    kind: "score",
    recommended: true,
    description: "Page-level confidence score between 0 and 1.",
  },
  {
    name: "confidence_reasons",
    kind: "string-array",
    recommended: true,
    description: "Short reasons behind the confidence score.",
  },
  {
    name: "last_confirmed",
    kind: "date",
    recommended: true,
    description: "Most recent evidence confirmation date.",
  },
  {
    name: "reinforcement_count",
    kind: "integer-string",
    recommended: true,
    description: "Count of local reinforcement events or confirmations.",
  },
  {
    name: "quality_score",
    kind: "score",
    recommended: true,
    description: "Deterministic page health score between 0 and 1.",
  },
  {
    name: "review_status",
    kind: "enum",
    recommended: true,
    values: ["ok", "needs-review", "stale", "contradicted"],
    description: "Review state used by Memory Ops and maintenance views.",
  },
  {
    name: "scope",
    kind: "enum",
    recommended: true,
    values: ["shared", "private"],
    description: "Local governance scope for audit redaction and promotion.",
  },
  {
    name: "sources",
    kind: "string-array",
    description: "Raw source paths or source page references.",
  },
  {
    name: "authors",
    kind: "string-array",
    description: "Source authors.",
  },
  {
    name: "year",
    kind: "string",
    description: "Source publication year.",
  },
  {
    name: "url",
    kind: "string",
    description: "Source URL.",
  },
  {
    name: "venue",
    kind: "string",
    description: "Source venue.",
  },
  ...WIKI_GRAPH_SEED_ARRAY_FIELDS.map((name) => ({
    name,
    kind: "string-array" as const,
    description: "Graph/search seed aliases and keywords.",
  })),
  ...WIKI_TYPED_RELATION_ARRAY_FIELDS.map((name) => ({
    name,
    kind: "string-array" as const,
    description: "Typed relationship target page slugs.",
  })),
]

export const DEFAULT_LLM_WIKI_SCHEMA_CONTRACT: LlmWikiSchemaContract = {
  version: LLM_WIKI_SCHEMA_CONTRACT_VERSION,
  name: "llm-wiki-v2-default",
  pageTypes: LLM_WIKI_PAGE_TYPES,
  frontmatterFields: LLM_WIKI_FRONTMATTER_FIELDS,
  relations: {
    graphSeedFields: [...WIKI_GRAPH_SEED_ARRAY_FIELDS],
    genericRelationFields: ["related"],
    typedRelationFields: [...WIKI_TYPED_RELATION_ARRAY_FIELDS],
  },
  quality: {
    minQualityScore: 0.55,
    minConfidence: 0.45,
    minRelationCount: 1,
    requiredSections: ["Summary"],
  },
  memoryOps: {
    sourceOfTruth: "markdown",
    auditPath: ".llm-wiki/audit.jsonl",
    requiresPreviewForMetadataPatch: true,
    privateScopeRedaction: true,
  },
  claimLayer: {
    sourceOfTruth: "markdown",
    indexPath: ".llm-wiki/claims.jsonl",
    anchorFormat: "<!-- claim:claim_xxx -->",
    derivedArtifact: true,
    appManagedAnchors: true,
    highValueOnly: true,
    requiresReviewForContradictions: true,
    privateScopeRedaction: true,
  },
}

export const DEFAULT_LLM_WIKI_SCHEMA_CONTRACT_BLOCK = `\`\`\`yaml llm-wiki-schema-contract
version: 1
name: llm-wiki-v2-default
pageTypes:
  - type: entity
    directory: wiki/entities/
    description: Named things such as people, tools, organizations, and datasets.
  - type: concept
    directory: wiki/concepts/
    description: Ideas, techniques, phenomena, and frameworks.
  - type: source
    directory: wiki/sources/
    description: Papers, articles, talks, books, and blog posts.
  - type: query
    directory: wiki/queries/
    description: Open questions and crystallized explorations.
  - type: comparison
    directory: wiki/comparisons/
    description: Side-by-side analysis of related entities or concepts.
  - type: synthesis
    directory: wiki/synthesis/
    description: Cross-cutting summaries and conclusions.
  - type: overview
    directory: wiki/
    description: High-level project summary.
frontmatterFields:
  - name: type
    kind: enum
    required: true
    values: [entity, concept, source, query, comparison, synthesis, overview]
  - name: title
    kind: string
    required: true
  - name: tags
    kind: string-array
    required: true
  - name: related
    kind: string-array
    required: true
  - name: created
    kind: date
    required: true
  - name: updated
    kind: date
    required: true
  - name: lifecycle
    kind: enum
    recommended: true
    values: [working, episodic, semantic, procedural, archived]
  - name: confidence
    kind: score
    recommended: true
  - name: confidence_reasons
    kind: string-array
    recommended: true
  - name: last_confirmed
    kind: date
    recommended: true
  - name: reinforcement_count
    kind: integer-string
    recommended: true
  - name: quality_score
    kind: score
    recommended: true
  - name: review_status
    kind: enum
    recommended: true
    values: [ok, needs-review, stale, contradicted]
  - name: scope
    kind: enum
    recommended: true
    values: [shared, private]
relations:
  graphSeedFields: [alias, aliases, keywords]
  genericRelationFields: [related]
  typedRelationFields: [uses, depends_on, contradicts, supports, supersedes, superseded_by]
quality:
  minQualityScore: 0.55
  minConfidence: 0.45
  minRelationCount: 1
  requiredSections: [Summary]
memoryOps:
  sourceOfTruth: markdown
  auditPath: .llm-wiki/audit.jsonl
  requiresPreviewForMetadataPatch: true
  privateScopeRedaction: true
claimLayer:
  sourceOfTruth: markdown
  indexPath: .llm-wiki/claims.jsonl
  anchorFormat: "<!-- claim:claim_xxx -->"
  derivedArtifact: true
  appManagedAnchors: true
  highValueOnly: true
  requiresReviewForContradictions: true
  privateScopeRedaction: true
\`\`\``

export function normalizeSchemaContract(input: unknown): SchemaContractNormalizeResult {
  const warnings: string[] = []
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      contract: DEFAULT_LLM_WIKI_SCHEMA_CONTRACT,
      warnings: ["Schema contract missing or invalid; using defaults."],
    }
  }

  const record = input as Record<string, unknown>
  const version = normalizeVersion(record.version, warnings)
  const name = stringValue(record.name) ?? DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.name
  if (record.name !== undefined && !stringValue(record.name)) {
    warnings.push(`name must be a non-empty string; using ${DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.name}.`)
  }

  const pageTypes = normalizePageTypes(record.pageTypes, warnings)
  const frontmatterFields = normalizeFrontmatterFields(record.frontmatterFields, warnings)

  return {
    contract: {
      version,
      name,
      pageTypes,
      frontmatterFields,
      relations: normalizeRelations(record.relations, warnings),
      quality: normalizeQuality(record.quality, warnings),
      memoryOps: normalizeMemoryOps(record.memoryOps, warnings),
      claimLayer: normalizeClaimLayer(record.claimLayer, warnings),
    },
    warnings,
  }
}

export function parseSchemaContractFromMarkdown(
  schemaMarkdown: string,
): SchemaContractParseResult {
  const block = findSchemaContractBlock(schemaMarkdown)
  if (!block) {
    return {
      contract: DEFAULT_LLM_WIKI_SCHEMA_CONTRACT,
      found: false,
      warnings: ["Schema contract block not found; using defaults."],
    }
  }

  let parsed: unknown
  try {
    parsed = block.format === "json"
      ? JSON.parse(block.body)
      : yaml.load(block.body, { schema: yaml.JSON_SCHEMA })
  } catch (err) {
    return {
      contract: DEFAULT_LLM_WIKI_SCHEMA_CONTRACT,
      found: true,
      format: block.format,
      warnings: [
        `Schema contract ${block.format.toUpperCase()} could not be parsed; using defaults: ${err instanceof Error ? err.message : String(err)}`,
      ],
    }
  }

  const normalized = normalizeSchemaContract(parsed)
  return {
    ...normalized,
    found: true,
    format: block.format,
  }
}

export function schemaContractFieldMap(
  contract: LlmWikiSchemaContract = DEFAULT_LLM_WIKI_SCHEMA_CONTRACT,
): Map<string, LlmWikiFrontmatterFieldContract> {
  return new Map(contract.frontmatterFields.map((field) => [field.name, field]))
}

export function schemaContractPageTypeMap(
  contract: LlmWikiSchemaContract = DEFAULT_LLM_WIKI_SCHEMA_CONTRACT,
): Map<string, LlmWikiSchemaPageType> {
  return new Map(contract.pageTypes.map((pageType) => [pageType.type, pageType]))
}

function findSchemaContractBlock(
  markdown: string,
): { body: string; format: "json" | "yaml" } | null {
  const fenceRe = /^```([^\n`]*)\n([\s\S]*?)^```\s*$/gm
  let match: RegExpExecArray | null
  while ((match = fenceRe.exec(markdown)) !== null) {
    const info = match[1].trim().toLowerCase()
    if (!info.includes("llm-wiki-schema-contract")) continue
    const format = info.includes("json") ? "json" : "yaml"
    return { body: match[2].trim(), format }
  }
  return null
}

function normalizeVersion(
  value: unknown,
  warnings: string[],
): typeof LLM_WIKI_SCHEMA_CONTRACT_VERSION {
  if (value === undefined || value === LLM_WIKI_SCHEMA_CONTRACT_VERSION) {
    return LLM_WIKI_SCHEMA_CONTRACT_VERSION
  }
  warnings.push(`version must be ${LLM_WIKI_SCHEMA_CONTRACT_VERSION}; using ${LLM_WIKI_SCHEMA_CONTRACT_VERSION}.`)
  return LLM_WIKI_SCHEMA_CONTRACT_VERSION
}

function normalizePageTypes(
  value: unknown,
  warnings: string[],
): LlmWikiSchemaPageType[] {
  const merged = new Map(
    DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.pageTypes.map((pageType) => [
      pageType.type,
      pageType,
    ]),
  )

  if (value === undefined) return [...merged.values()]
  if (!Array.isArray(value)) {
    warnings.push("pageTypes must be an array; using default page types.")
    return [...merged.values()]
  }

  for (const item of value) {
    const pageType = normalizePageType(item, warnings)
    if (pageType) merged.set(pageType.type, pageType)
  }
  return [...merged.values()]
}

function normalizePageType(
  value: unknown,
  warnings: string[],
): LlmWikiSchemaPageType | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    warnings.push("pageTypes item must be an object with type and directory; item skipped.")
    return null
  }
  const record = value as Record<string, unknown>
  const type = identifierValue(record.type)
  const directory = directoryValue(record.directory)
  if (!type || !directory) {
    warnings.push("pageTypes item requires non-empty type and wiki/ directory; item skipped.")
    return null
  }
  return {
    type,
    directory,
    description: stringValue(record.description) ?? "",
  }
}

function normalizeFrontmatterFields(
  value: unknown,
  warnings: string[],
): LlmWikiFrontmatterFieldContract[] {
  const merged = new Map(
    DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.frontmatterFields.map((field) => [
      field.name,
      field,
    ]),
  )

  if (value === undefined) return [...merged.values()]
  if (!Array.isArray(value)) {
    warnings.push("frontmatterFields must be an array; using default fields.")
    return [...merged.values()]
  }

  for (const item of value) {
    const field = normalizeFrontmatterField(item, warnings)
    if (field) merged.set(field.name, field)
  }
  return [...merged.values()]
}

function normalizeFrontmatterField(
  value: unknown,
  warnings: string[],
): LlmWikiFrontmatterFieldContract | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    warnings.push("frontmatterFields item must be an object with name and kind; item skipped.")
    return null
  }
  const record = value as Record<string, unknown>
  const name = identifierValue(record.name)
  const kind = frontmatterFieldKind(record.kind)
  if (!name || !kind) {
    warnings.push("frontmatterFields item requires valid name and kind; item skipped.")
    return null
  }

  const values = stringArray(record.values)
  return {
    name,
    kind,
    required: booleanValue(record.required),
    recommended: booleanValue(record.recommended),
    values: kind === "enum" ? values : undefined,
    description: stringValue(record.description),
  }
}

function normalizeRelations(value: unknown, warnings: string[]): LlmWikiRelationContract {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    warnings.push("relations must be an object; using default relations.")
    return DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.relations
  }
  const record = (value ?? {}) as Record<string, unknown>
  return {
    graphSeedFields: stringArrayOrDefault(
      record.graphSeedFields,
      DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.relations.graphSeedFields,
      "relations.graphSeedFields",
      warnings,
    ),
    genericRelationFields: stringArrayOrDefault(
      record.genericRelationFields,
      DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.relations.genericRelationFields,
      "relations.genericRelationFields",
      warnings,
    ),
    typedRelationFields: typedRelationFields(record.typedRelationFields, warnings),
  }
}

function normalizeQuality(value: unknown, warnings: string[]): LlmWikiQualityContract {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    warnings.push("quality must be an object; using default quality thresholds.")
    return DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.quality
  }
  const record = (value ?? {}) as Record<string, unknown>
  return {
    minQualityScore: scoreNumber(
      record.minQualityScore,
      DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.quality.minQualityScore,
      "quality.minQualityScore",
      warnings,
    ),
    minConfidence: scoreNumber(
      record.minConfidence,
      DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.quality.minConfidence,
      "quality.minConfidence",
      warnings,
    ),
    minRelationCount: nonNegativeInteger(
      record.minRelationCount,
      DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.quality.minRelationCount,
      "quality.minRelationCount",
      warnings,
    ),
    requiredSections: stringArrayOrDefault(
      record.requiredSections,
      DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.quality.requiredSections,
      "quality.requiredSections",
      warnings,
    ),
  }
}

function normalizeMemoryOps(value: unknown, warnings: string[]): LlmWikiMemoryOpsContract {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    warnings.push("memoryOps must be an object; using default Memory Ops contract.")
    return DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.memoryOps
  }
  const record = (value ?? {}) as Record<string, unknown>
  const sourceOfTruth = record.sourceOfTruth
  if (sourceOfTruth !== undefined && sourceOfTruth !== "markdown") {
    warnings.push("memoryOps.sourceOfTruth must be markdown; using markdown.")
  }
  return {
    sourceOfTruth: "markdown",
    auditPath:
      stringValue(record.auditPath) ??
      DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.memoryOps.auditPath,
    requiresPreviewForMetadataPatch:
      booleanValue(record.requiresPreviewForMetadataPatch) ??
      DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.memoryOps.requiresPreviewForMetadataPatch,
    privateScopeRedaction:
      booleanValue(record.privateScopeRedaction) ??
      DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.memoryOps.privateScopeRedaction,
  }
}

function normalizeClaimLayer(value: unknown, warnings: string[]): LlmWikiClaimLayerContract {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    warnings.push("claimLayer must be an object; using default claim layer contract.")
    return DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.claimLayer
  }

  const record = (value ?? {}) as Record<string, unknown>
  if (record.sourceOfTruth !== undefined && record.sourceOfTruth !== "markdown") {
    warnings.push("claimLayer.sourceOfTruth must be markdown; using markdown.")
  }
  if (
    record.indexPath !== undefined &&
    stringValue(record.indexPath) !== DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.claimLayer.indexPath
  ) {
    warnings.push("claimLayer.indexPath is app-owned and must be .llm-wiki/claims.jsonl; using default.")
  }
  if (
    record.anchorFormat !== undefined &&
    stringValue(record.anchorFormat) !== DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.claimLayer.anchorFormat
  ) {
    warnings.push("claimLayer.anchorFormat is app-owned and must be <!-- claim:claim_xxx -->; using default.")
  }
  if (record.derivedArtifact !== undefined && record.derivedArtifact !== true) {
    warnings.push("claimLayer.derivedArtifact must be true; using true.")
  }

  return {
    sourceOfTruth: "markdown",
    indexPath: DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.claimLayer.indexPath,
    anchorFormat: DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.claimLayer.anchorFormat,
    derivedArtifact: true,
    appManagedAnchors:
      booleanValue(record.appManagedAnchors) ??
      DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.claimLayer.appManagedAnchors,
    highValueOnly:
      booleanValue(record.highValueOnly) ??
      DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.claimLayer.highValueOnly,
    requiresReviewForContradictions:
      booleanValue(record.requiresReviewForContradictions) ??
      DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.claimLayer.requiresReviewForContradictions,
    privateScopeRedaction:
      booleanValue(record.privateScopeRedaction) ??
      DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.claimLayer.privateScopeRedaction,
  }
}

function typedRelationFields(
  value: unknown,
  warnings: string[],
): WikiTypedRelationArrayField[] {
  if (value === undefined) {
    return DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.relations.typedRelationFields
  }
  if (!Array.isArray(value)) {
    warnings.push("relations.typedRelationFields must be an array; using defaults.")
    return DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.relations.typedRelationFields
  }

  const allowed = new Set<string>(WIKI_TYPED_RELATION_ARRAY_FIELDS)
  const out: WikiTypedRelationArrayField[] = []
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item)) {
      warnings.push(`relations.typedRelationFields contains unsupported field ${JSON.stringify(item)}; skipped.`)
      continue
    }
    if (!out.includes(item as WikiTypedRelationArrayField)) {
      out.push(item as WikiTypedRelationArrayField)
    }
  }
  return out.length > 0
    ? out
    : DEFAULT_LLM_WIKI_SCHEMA_CONTRACT.relations.typedRelationFields
}

function stringArrayOrDefault(
  value: unknown,
  fallback: string[],
  field: string,
  warnings: string[],
): string[] {
  if (value === undefined) return fallback
  const parsed = stringArray(value)
  if (parsed.length > 0) return parsed
  warnings.push(`${field} must be a non-empty string array; using defaults.`)
  return fallback
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const parsed = stringValue(item)
    if (parsed && !out.includes(parsed)) out.push(parsed)
  }
  return out
}

function frontmatterFieldKind(value: unknown): LlmWikiFrontmatterFieldKind | null {
  if (typeof value !== "string") return null
  if (
    value === "string" ||
    value === "string-array" ||
    value === "date" ||
    value === "score" ||
    value === "integer-string" ||
    value === "enum"
  ) {
    return value
  }
  return null
}

function scoreNumber(
  value: unknown,
  fallback: number,
  field: string,
  warnings: string[],
): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed
  if (value !== undefined) warnings.push(`${field} must be between 0 and 1; using ${fallback}.`)
  return fallback
}

function nonNegativeInteger(
  value: unknown,
  fallback: number,
  field: string,
  warnings: string[],
): number {
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed >= 0) return parsed
  if (value !== undefined) warnings.push(`${field} must be a non-negative integer; using ${fallback}.`)
  return fallback
}

function identifierValue(value: unknown): string | undefined {
  const parsed = stringValue(value)
  if (!parsed || !/^[a-z][a-z0-9_-]*$/i.test(parsed)) return undefined
  return parsed
}

function directoryValue(value: unknown): string | undefined {
  const parsed = stringValue(value)
  if (!parsed || !parsed.startsWith("wiki/")) return undefined
  return parsed.endsWith("/") ? parsed : `${parsed}/`
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}
