import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import type { MetadataPatchOperation, MetadataPatchValue } from "@/lib/memory-ops-executor"
import { getFileStem, normalizePath } from "@/lib/path-utils"
import {
  DEFAULT_LLM_WIKI_SCHEMA_CONTRACT,
  schemaContractFieldMap,
  schemaContractPageTypeMap,
  type LlmWikiFrontmatterFieldContract,
  type LlmWikiSchemaContract,
} from "@/lib/schema-contract"
import { normalizeWikiReferenceKey } from "@/lib/wiki-alias-index"

export type SchemaDriftFindingKind =
  | "missing-frontmatter"
  | "missing-required-field"
  | "invalid-field-kind"
  | "invalid-enum"
  | "invalid-score"
  | "invalid-integer"
  | "invalid-date"
  | "unknown-page-type"
  | "page-type-path-mismatch"
  | "dangling-relation"
  | "relation-alias-candidate"

export type SchemaDriftSeverity = "info" | "warning"

export interface SchemaDriftFinding {
  id: string
  kind: SchemaDriftFindingKind
  severity: SchemaDriftSeverity
  targetPath: string
  title: string
  detail: string
  reasons: string[]
  field?: string
  expected?: string
  actual?: string
  relationTarget?: string
  candidateTarget?: string
  proposedOperation?: MetadataPatchOperation
}

export interface SchemaDriftReport {
  contract: LlmWikiSchemaContract
  findings: SchemaDriftFinding[]
  stats: {
    pageCount: number
    findingCount: number
    warningCount: number
    infoCount: number
  }
}

export interface SchemaDriftPageInput {
  id?: string
  path: string
  fileName?: string
  content: string
}

interface ResolvedPage {
  id: string
  path: string
  relativePath: string
  fileName: string
  content: string
  frontmatter: Record<string, FrontmatterValue> | null
}

interface PageResolver {
  resolve(raw: string): ResolvedPage | null
  findCandidate(raw: string): ResolvedPage | null
}

export function scanSchemaDrift(
  pages: readonly SchemaDriftPageInput[],
  contract: LlmWikiSchemaContract = DEFAULT_LLM_WIKI_SCHEMA_CONTRACT,
): SchemaDriftReport {
  const resolvedPages = pages.map(resolvePage)
  const resolver = buildPageResolver(resolvedPages)
  const findings: SchemaDriftFinding[] = []

  for (const page of resolvedPages) {
    findings.push(...scanPage(page, contract, resolver))
  }

  return {
    contract,
    findings,
    stats: {
      pageCount: resolvedPages.length,
      findingCount: findings.length,
      warningCount: findings.filter((finding) => finding.severity === "warning").length,
      infoCount: findings.filter((finding) => finding.severity === "info").length,
    },
  }
}

function scanPage(
  page: ResolvedPage,
  contract: LlmWikiSchemaContract,
  resolver: PageResolver,
): SchemaDriftFinding[] {
  const findings: SchemaDriftFinding[] = []
  if (!page.frontmatter) {
    return [
      buildFinding({
        kind: "missing-frontmatter",
        severity: "warning",
        page,
        title: "Page is missing frontmatter",
        detail: "Schema validation requires a YAML frontmatter block.",
        reasons: ["no parseable YAML frontmatter block found"],
      }),
    ]
  }

  const fieldMap = schemaContractFieldMap(contract)
  for (const field of contract.frontmatterFields) {
    const value = page.frontmatter[field.name]
    if (field.required && isEmptyFrontmatterValue(value)) {
      findings.push(missingRequiredFieldFinding(page, field))
      continue
    }
    if (value !== undefined) {
      const fieldFinding = validateFieldValue(page, field, value)
      if (fieldFinding) findings.push(fieldFinding)
    }
  }

  findings.push(...validatePageTypeAndPath(page, contract))
  findings.push(...validateTypedRelationTargets(page, contract, fieldMap, resolver))
  return findings
}

function validateFieldValue(
  page: ResolvedPage,
  field: LlmWikiFrontmatterFieldContract,
  value: FrontmatterValue,
): SchemaDriftFinding | null {
  if (field.kind === "string" && Array.isArray(value)) {
    return invalidKindFinding(page, field, "string", "array")
  }

  if (field.kind === "string-array" && !Array.isArray(value)) {
    return invalidKindFinding(page, field, "array", "scalar", {
      [field.name]: [value],
    })
  }

  if (field.kind === "enum") {
    if (Array.isArray(value)) return invalidKindFinding(page, field, "scalar enum", "array")
    if (field.values && !field.values.includes(value)) {
      return buildFinding({
        kind: "invalid-enum",
        severity: "warning",
        page,
        field: field.name,
        expected: field.values.join(" | "),
        actual: value,
        title: `Invalid ${field.name} value`,
        detail: `Field ${field.name} must be one of: ${field.values.join(", ")}.`,
        reasons: [`${field.name} is governed by the schema contract enum`],
      })
    }
  }

  if (field.kind === "score") {
    if (Array.isArray(value)) return invalidKindFinding(page, field, "score scalar", "array")
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      return buildFinding({
        kind: "invalid-score",
        severity: "warning",
        page,
        field: field.name,
        expected: "number between 0 and 1",
        actual: value,
        title: `Invalid ${field.name} score`,
        detail: `Field ${field.name} must be a number between 0 and 1.`,
        reasons: [`${field.name} is a schema contract score field`],
      })
    }
  }

  if (field.kind === "integer-string") {
    if (Array.isArray(value)) return invalidKindFinding(page, field, "integer scalar", "array")
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 0) {
      return buildFinding({
        kind: "invalid-integer",
        severity: "warning",
        page,
        field: field.name,
        expected: "non-negative integer",
        actual: value,
        title: `Invalid ${field.name} integer`,
        detail: `Field ${field.name} must be a non-negative integer string.`,
        reasons: [`${field.name} is a schema contract integer field`],
      })
    }
  }

  if (field.kind === "date") {
    if (Array.isArray(value)) return invalidKindFinding(page, field, "date scalar", "array")
    if (!isIsoDate(value)) {
      return buildFinding({
        kind: "invalid-date",
        severity: "warning",
        page,
        field: field.name,
        expected: "YYYY-MM-DD",
        actual: value,
        title: `Invalid ${field.name} date`,
        detail: `Field ${field.name} must use YYYY-MM-DD format.`,
        reasons: [`${field.name} is a schema contract date field`],
      })
    }
  }

  return null
}

function validatePageTypeAndPath(
  page: ResolvedPage,
  contract: LlmWikiSchemaContract,
): SchemaDriftFinding[] {
  const type = scalarValue(page.frontmatter?.type)
  if (!type) return []

  const pageType = schemaContractPageTypeMap(contract).get(type)
  if (!pageType) {
    return [
      buildFinding({
        kind: "unknown-page-type",
        severity: "warning",
        page,
        field: "type",
        actual: type,
        title: "Unknown page type",
        detail: `Type "${type}" is not declared in the schema contract.`,
        reasons: ["page type must be declared in the machine-readable schema contract"],
      }),
    ]
  }

  if (!page.relativePath.startsWith(pageType.directory)) {
    return [
      buildFinding({
        kind: "page-type-path-mismatch",
        severity: "info",
        page,
        field: "type",
        expected: pageType.directory,
        actual: page.relativePath,
        title: "Page type does not match its directory",
        detail: `Type ${type} pages should live under ${pageType.directory}.`,
        reasons: [`${type} is mapped to ${pageType.directory} by the schema contract`],
      }),
    ]
  }

  return []
}

function validateTypedRelationTargets(
  page: ResolvedPage,
  contract: LlmWikiSchemaContract,
  fieldMap: ReadonlyMap<string, LlmWikiFrontmatterFieldContract>,
  resolver: PageResolver,
): SchemaDriftFinding[] {
  const findings: SchemaDriftFinding[] = []

  for (const field of contract.relations.typedRelationFields) {
    const value = page.frontmatter?.[field]
    if (value === undefined) continue

    if (!Array.isArray(value)) {
      const fieldContract = fieldMap.get(field)
      if (fieldContract) {
        findings.push(invalidKindFinding(page, fieldContract, "array", "scalar", {
          [field]: [value],
        }))
      }
    }

    for (const target of arrayValue(value)) {
      if (resolver.resolve(target)) continue
      const candidate = resolver.findCandidate(target)
      findings.push(candidate
        ? buildFinding({
            kind: "relation-alias-candidate",
            severity: "info",
            page,
            field,
            relationTarget: target,
            candidateTarget: candidate.relativePath,
            title: "Typed relation has a likely alias candidate",
            detail: `Field ${field} points to "${target}", which does not resolve exactly. Candidate: ${candidate.relativePath}.`,
            reasons: [
              `${field} is an explicit typed relationship field`,
              "candidate found by title, filename, or alias similarity",
            ],
            proposedOperation: relationReplacementOperation(page, field, target, candidate.id),
          })
        : buildFinding({
            kind: "dangling-relation",
            severity: "warning",
            page,
            field,
            relationTarget: target,
            title: "Typed relation target does not resolve",
            detail: `Field ${field} points to "${target}", which does not resolve to a wiki page.`,
            reasons: [
              `${field} is an explicit typed relationship field`,
              "no matching page, title, or alias found",
            ],
          }))
    }
  }

  return findings
}

function missingRequiredFieldFinding(
  page: ResolvedPage,
  field: LlmWikiFrontmatterFieldContract,
): SchemaDriftFinding {
  const inferred = inferMissingRequiredFieldValue(page, field)
  return buildFinding({
    kind: "missing-required-field",
    severity: "warning",
    page,
    field: field.name,
    expected: field.kind,
    title: `Missing required ${field.name}`,
    detail: `Field ${field.name} is required by the schema contract.`,
    reasons: [`${field.name} is marked required in the machine-readable schema contract`],
    proposedOperation: inferred === undefined
      ? undefined
      : {
          kind: "metadata-patch",
          targetPath: page.path,
          fields: { [field.name]: inferred },
          reason: `Schema drift repair: add missing required ${field.name}`,
          scope: scalarValue(page.frontmatter?.scope),
        },
  })
}

function invalidKindFinding(
  page: ResolvedPage,
  field: LlmWikiFrontmatterFieldContract,
  expected: string,
  actual: string,
  patchFields?: Record<string, MetadataPatchValue>,
): SchemaDriftFinding {
  return buildFinding({
    kind: "invalid-field-kind",
    severity: "warning",
    page,
    field: field.name,
    expected,
    actual,
    title: `Invalid ${field.name} field shape`,
    detail: `Field ${field.name} must be ${expected}, but found ${actual}.`,
    reasons: [`${field.name} is defined as ${field.kind} in the schema contract`],
    proposedOperation: patchFields
      ? {
          kind: "metadata-patch",
          targetPath: page.path,
          fields: patchFields,
          reason: `Schema drift repair: normalize ${field.name}`,
          scope: scalarValue(page.frontmatter?.scope),
        }
      : undefined,
  })
}

function relationReplacementOperation(
  page: ResolvedPage,
  field: string,
  target: string,
  replacement: string,
): MetadataPatchOperation {
  const current = arrayValue(page.frontmatter?.[field])
  const next = current.map((value) => (value === target ? replacement : value))
  return {
    kind: "metadata-patch",
    targetPath: page.path,
    fields: { [field]: uniqueStrings(next) },
    reason: `Schema drift repair: replace unresolved ${field} target ${target}`,
    scope: scalarValue(page.frontmatter?.scope),
  }
}

function inferMissingRequiredFieldValue(
  page: ResolvedPage,
  field: LlmWikiFrontmatterFieldContract,
): MetadataPatchValue | undefined {
  if (field.kind === "string-array") return []
  if (field.name === "title") return headingTitle(page.content) ?? titleFromId(page.id)
  if (field.name === "type") return inferTypeFromPath(page.relativePath)
  return undefined
}

function buildFinding(input: {
  kind: SchemaDriftFindingKind
  severity: SchemaDriftSeverity
  page: ResolvedPage
  title: string
  detail: string
  reasons: string[]
  field?: string
  expected?: string
  actual?: string
  relationTarget?: string
  candidateTarget?: string
  proposedOperation?: MetadataPatchOperation
}): SchemaDriftFinding {
  return {
    id: [
      "schema",
      input.kind,
      input.page.relativePath,
      input.field,
      input.relationTarget,
    ].filter(Boolean).join(":"),
    kind: input.kind,
    severity: input.severity,
    targetPath: input.page.path,
    title: input.title,
    detail: input.detail,
    reasons: input.reasons,
    field: input.field,
    expected: input.expected,
    actual: input.actual,
    relationTarget: input.relationTarget,
    candidateTarget: input.candidateTarget,
    proposedOperation: input.proposedOperation,
  }
}

function resolvePage(page: SchemaDriftPageInput): ResolvedPage {
  const path = normalizePath(page.path)
  const fileName = page.fileName ?? path.split("/").pop() ?? path
  const id = page.id ?? getFileStem(fileName)
  const parsed = parseFrontmatter(page.content)
  return {
    id,
    path,
    relativePath: wikiRelativePath(path),
    fileName,
    content: page.content,
    frontmatter: parsed.frontmatter,
  }
}

function buildPageResolver(pages: readonly ResolvedPage[]): PageResolver {
  const exact = new Map<string, ResolvedPage>()
  const candidates: Array<{ key: string; page: ResolvedPage }> = []

  for (const page of pages) {
    for (const key of pageReferenceKeys(page)) {
      const normalized = normalizeWikiReferenceKey(key)
      if (!normalized) continue
      if (!exact.has(normalized)) exact.set(normalized, page)
      candidates.push({ key: normalized, page })
    }
  }

  return {
    resolve(raw: string) {
      return exact.get(normalizeWikiReferenceKey(cleanReference(raw))) ?? null
    },
    findCandidate(raw: string) {
      const normalized = normalizeWikiReferenceKey(cleanReference(raw))
      if (!normalized) return null
      const match = candidates.find(({ key }) =>
        key.includes(normalized) || normalized.includes(key),
      )
      return match?.page ?? null
    },
  }
}

function pageReferenceKeys(page: ResolvedPage): string[] {
  return [
    page.id,
    page.fileName,
    getFileStem(page.fileName),
    page.path,
    page.relativePath,
    page.relativePath.replace(/^wiki\//, ""),
    scalarValue(page.frontmatter?.title),
    ...arrayValue(page.frontmatter?.alias),
    ...arrayValue(page.frontmatter?.aliases),
  ].filter((value): value is string => typeof value === "string" && value.length > 0)
}

function wikiRelativePath(path: string): string {
  const normalized = normalizePath(path)
  const idx = normalized.lastIndexOf("/wiki/")
  if (idx >= 0) return normalized.slice(idx + 1)
  if (normalized.startsWith("wiki/")) return normalized
  return normalized
}

function inferTypeFromPath(path: string): string | undefined {
  if (path.startsWith("wiki/entities/")) return "entity"
  if (path.startsWith("wiki/concepts/")) return "concept"
  if (path.startsWith("wiki/sources/")) return "source"
  if (path.startsWith("wiki/queries/")) return "query"
  if (path.startsWith("wiki/comparisons/")) return "comparison"
  if (path.startsWith("wiki/synthesis/")) return "synthesis"
  if (path === "wiki/overview.md") return "overview"
  return undefined
}

function isEmptyFrontmatterValue(value: FrontmatterValue | undefined): boolean {
  if (value === undefined) return true
  if (Array.isArray(value)) return value.length === 0
  return value.trim() === ""
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function cleanReference(value: string): string {
  return value
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .replace(/\.md$/i, "")
    .split("|")[0]
    .trim()
}

function scalarValue(value: FrontmatterValue | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value || undefined
}

function arrayValue(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return uniqueStrings(value)
  if (!value) return []
  return uniqueStrings([value])
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = String(value).trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

function headingTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m)
  return match?.[1].trim()
}

function titleFromId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ")
}
