import { appendFile, createDirectory, readFile } from "@/commands/fs"
import { redactSensitiveText } from "@/lib/audit-redaction"
import { normalizePath } from "@/lib/path-utils"

export const CLAIM_LIFECYCLES = [
  "working",
  "episodic",
  "semantic",
  "procedural",
  "archived",
] as const

export const CLAIM_STATUSES = [
  "ok",
  "needs-review",
  "stale",
  "contradicted",
  "superseded",
] as const

export const CLAIM_SCOPES = ["private", "shared"] as const

export type ClaimLifecycle = (typeof CLAIM_LIFECYCLES)[number]
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]
export type ClaimScope = (typeof CLAIM_SCOPES)[number]

export interface ClaimSourceRef {
  path: string
  title?: string
  anchor?: string
  snippet_hash?: string
  page?: number
  line_start?: number
  line_end?: number
  char_start?: number
  char_end?: number
}

export interface ClaimRecord {
  claim_id: string
  text: string
  page_path: string
  page_anchor?: string
  page_title?: string
  source_refs: ClaimSourceRef[]
  lifecycle: ClaimLifecycle
  status: ClaimStatus
  confidence: string
  confidence_reasons: string[]
  last_confirmed: string
  reinforcement_count: string
  supports: string[]
  contradicts: string[]
  supersedes: string[]
  superseded_by: string[]
  scope: ClaimScope
  created_at: string
  updated_at: string
}

export interface ClaimIdInput {
  pagePath: string
  pageAnchor?: string
  text: string
}

export type ClaimRecordDraft = Partial<Record<keyof ClaimRecord, unknown>>

export interface ClaimNormalizeOptions {
  today?: string
}

export interface ClaimNormalizeResult {
  claim: ClaimRecord
  warnings: string[]
}

export interface ClaimIndexWarning {
  line: number
  message: string
  raw: string
}

export interface ClaimIndexReadResult {
  claims: ClaimRecord[]
  warnings: ClaimIndexWarning[]
}

export interface ClaimAppendOptions extends ClaimNormalizeOptions {}

export interface ClaimAppendResult {
  writtenCount: number
  warnings: string[]
}

export type ClaimAuditSummary =
  | {
      claim_id: string
      page_path: string
      page_anchor?: string
      status: ClaimStatus
      lifecycle: ClaimLifecycle
      scope: "private"
      redacted: true
    }
  | {
      claim_id: string
      text: string
      page_path: string
      page_anchor?: string
      status: ClaimStatus
      lifecycle: ClaimLifecycle
      scope: "shared"
      confidence: string
      source_ref_count: number
      redacted: false
    }

export function createClaimId(input: ClaimIdInput): string {
  const identity = [
    normalizePath(input.pagePath).trim().toLowerCase(),
    normalizeIdentityPart(input.pageAnchor ?? ""),
    normalizeText(input.text),
  ].join("\n")
  return `claim_${hashString(identity)}`
}

export function normalizeClaimRecord(
  input: ClaimRecordDraft,
  options: ClaimNormalizeOptions = {},
): ClaimNormalizeResult {
  const warnings: string[] = []
  const today = normalizeDate(options.today) ?? new Date().toISOString().slice(0, 10)
  const text = normalizeText(stringValue(input.text))
  const pagePath = normalizePath(stringValue(input.page_path)).trim()
  const pageAnchor = optionalString(input.page_anchor)
  const pageTitle = optionalString(input.page_title)
  const sourceRefs = normalizeSourceRefs(input.source_refs, warnings)
  const lifecycle = normalizeLifecycle(input.lifecycle, warnings)
  const status = normalizeStatus(input.status, warnings)
  const scope = normalizeScope(input.scope, warnings)
  const createdAt = normalizeDate(stringValue(input.created_at)) ?? today
  const updatedAt = normalizeDate(stringValue(input.updated_at)) ?? today
  const lastConfirmed =
    normalizeDate(stringValue(input.last_confirmed)) ?? updatedAt ?? createdAt
  const confidence = formatScore(parseScore(input.confidence))
  const reinforcementCount = String(Math.max(0, Math.floor(numberValue(input.reinforcement_count))))

  let claimId = stringValue(input.claim_id).trim()
  if (!/^claim_[a-z0-9]+$/.test(claimId)) {
    claimId = createClaimId({ pagePath, pageAnchor, text })
    warnings.push("claim_id missing or invalid; generated a stable claim id.")
  }

  return {
    claim: {
      claim_id: claimId,
      text,
      page_path: pagePath,
      ...(pageAnchor ? { page_anchor: pageAnchor } : {}),
      ...(pageTitle ? { page_title: pageTitle } : {}),
      source_refs: sourceRefs,
      lifecycle,
      status,
      confidence,
      confidence_reasons: uniqueStrings(arrayValue(input.confidence_reasons)),
      last_confirmed: lastConfirmed,
      reinforcement_count: reinforcementCount,
      supports: uniqueStrings(arrayValue(input.supports)),
      contradicts: uniqueStrings(arrayValue(input.contradicts)),
      supersedes: uniqueStrings(arrayValue(input.supersedes)),
      superseded_by: uniqueStrings(arrayValue(input.superseded_by)),
      scope,
      created_at: createdAt,
      updated_at: updatedAt,
    },
    warnings,
  }
}

export function claimIndexPath(projectPath: string): string {
  return `${normalizeProjectPath(projectPath)}/.llm-wiki/claims.jsonl`
}

export async function readClaimIndex(
  projectPath: string,
): Promise<ClaimIndexReadResult> {
  let raw = ""
  try {
    raw = await readFile(claimIndexPath(projectPath))
  } catch {
    return { claims: [], warnings: [] }
  }

  const claims: ClaimRecord[] = []
  const warnings: ClaimIndexWarning[] = []
  const lines = raw.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as unknown
      if (!isClaimRecordDraft(parsed)) {
        warnings.push({
          line: i + 1,
          message: "Invalid claim JSON: expected non-empty text and page_path.",
          raw: redactSensitiveText(line),
        })
        continue
      }
      const normalized = normalizeClaimRecord(parsed)
      claims.push(normalized.claim)
      for (const message of normalized.warnings) {
        warnings.push({ line: i + 1, message, raw: redactSensitiveText(line) })
      }
    } catch (err) {
      warnings.push({
        line: i + 1,
        message: `Invalid claim JSON: ${err instanceof Error ? err.message : String(err)}`,
        raw: redactSensitiveText(line),
      })
    }
  }

  return { claims, warnings }
}

export async function appendClaimRecords(
  projectPath: string,
  drafts: readonly ClaimRecordDraft[],
  options: ClaimAppendOptions = {},
): Promise<ClaimAppendResult> {
  const pp = normalizeProjectPath(projectPath)
  const warnings: string[] = []
  const claims: ClaimRecord[] = []

  for (const draft of drafts) {
    if (!isClaimRecordDraft(draft)) {
      warnings.push("Invalid claim JSON: expected non-empty text and page_path.")
      continue
    }
    const normalized = normalizeClaimRecord(draft, options)
    claims.push(normalized.claim)
    warnings.push(...normalized.warnings)
  }

  if (claims.length === 0) return { writtenCount: 0, warnings }

  await createDirectory(`${pp}/.llm-wiki`).catch(() => {})
  await appendFile(
    claimIndexPath(pp),
    claims.map((claim) => JSON.stringify(claim)).join("\n") + "\n",
  )

  return { writtenCount: claims.length, warnings }
}

export function mergeClaimRecords(
  existing: readonly ClaimRecord[],
  incoming: readonly ClaimRecord[],
): ClaimRecord[] {
  const order: string[] = []
  const byId = new Map<string, ClaimRecord>()

  for (const claim of existing) {
    order.push(claim.claim_id)
    byId.set(claim.claim_id, claim)
  }

  for (const claim of incoming) {
    const current = byId.get(claim.claim_id)
    if (!current) {
      order.push(claim.claim_id)
      byId.set(claim.claim_id, claim)
      continue
    }
    byId.set(claim.claim_id, {
      ...current,
      ...claim,
      source_refs: mergeSourceRefs(current.source_refs, claim.source_refs),
      confidence_reasons: uniqueStrings([
        ...current.confidence_reasons,
        ...claim.confidence_reasons,
      ]),
      supports: uniqueStrings([...current.supports, ...claim.supports]),
      contradicts: uniqueStrings([...current.contradicts, ...claim.contradicts]),
      supersedes: uniqueStrings([...current.supersedes, ...claim.supersedes]),
      superseded_by: uniqueStrings([...current.superseded_by, ...claim.superseded_by]),
    })
  }

  return order.map((id) => byId.get(id)).filter((claim): claim is ClaimRecord => Boolean(claim))
}

export function claimRecordAuditSummary(claim: ClaimRecord): ClaimAuditSummary {
  if (claim.scope === "private") {
    return {
      claim_id: claim.claim_id,
      page_path: claim.page_path,
      ...(claim.page_anchor ? { page_anchor: claim.page_anchor } : {}),
      status: claim.status,
      lifecycle: claim.lifecycle,
      scope: "private",
      redacted: true,
    }
  }

  return {
    claim_id: claim.claim_id,
    text: claim.text,
    page_path: claim.page_path,
    ...(claim.page_anchor ? { page_anchor: claim.page_anchor } : {}),
    status: claim.status,
    lifecycle: claim.lifecycle,
    scope: "shared",
    confidence: claim.confidence,
    source_ref_count: claim.source_refs.length,
    redacted: false,
  }
}

function normalizeProjectPath(projectPath: string): string {
  return normalizePath(projectPath).replace(/\/$/, "")
}

function isClaimRecordDraft(value: unknown): value is ClaimRecordDraft {
  if (!value || typeof value !== "object") return false
  const raw = value as Record<string, unknown>
  return Boolean(stringValue(raw.text).trim() && stringValue(raw.page_path).trim())
}

function mergeSourceRefs(
  existing: readonly ClaimSourceRef[],
  incoming: readonly ClaimSourceRef[],
): ClaimSourceRef[] {
  const refs: ClaimSourceRef[] = []
  const seen = new Set<string>()
  for (const ref of [...existing, ...incoming]) {
    const key = [
      ref.path.toLowerCase(),
      ref.anchor?.toLowerCase() ?? "",
      ref.snippet_hash ?? "",
    ].join("\n")
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(ref)
  }
  return refs
}

function normalizeLifecycle(value: unknown, warnings: string[]): ClaimLifecycle {
  const normalized = stringValue(value).toLowerCase()
  if (isClaimLifecycle(normalized)) return normalized
  if (normalized) {
    warnings.push(
      "lifecycle must be one of working, episodic, semantic, procedural, archived; using working.",
    )
  }
  return "working"
}

function normalizeStatus(value: unknown, warnings: string[]): ClaimStatus {
  const normalized = stringValue(value).toLowerCase()
  if (isClaimStatus(normalized)) return normalized
  if (normalized) {
    warnings.push(
      "status must be one of ok, needs-review, stale, contradicted, superseded; using needs-review.",
    )
  }
  return "needs-review"
}

function normalizeScope(value: unknown, warnings: string[]): ClaimScope {
  const normalized = stringValue(value).toLowerCase()
  if (isClaimScope(normalized)) return normalized
  if (normalized) warnings.push("scope must be private or shared; using shared.")
  return "shared"
}

function isClaimLifecycle(value: string): value is ClaimLifecycle {
  return (CLAIM_LIFECYCLES as readonly string[]).includes(value)
}

function isClaimStatus(value: string): value is ClaimStatus {
  return (CLAIM_STATUSES as readonly string[]).includes(value)
}

function isClaimScope(value: string): value is ClaimScope {
  return (CLAIM_SCOPES as readonly string[]).includes(value)
}

function normalizeSourceRefs(value: unknown, warnings: string[]): ClaimSourceRef[] {
  if (!Array.isArray(value)) return []
  const refs: ClaimSourceRef[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== "object") {
      warnings.push("source_refs item requires a non-empty path; item skipped.")
      continue
    }
    const raw = item as Record<string, unknown>
    const path = normalizePath(stringValue(raw.path)).trim()
    if (!path) {
      warnings.push("source_refs item requires a non-empty path; item skipped.")
      continue
    }
    const ref: ClaimSourceRef = {
      path,
      ...definedString("title", raw.title),
      ...definedString("anchor", raw.anchor),
      ...definedString("snippet_hash", raw.snippet_hash ?? raw.snippetHash),
      ...definedPositiveInteger("page", raw.page),
      ...definedPositiveInteger("line_start", raw.line_start ?? raw.lineStart),
      ...definedPositiveInteger("line_end", raw.line_end ?? raw.lineEnd),
      ...definedNonNegativeInteger("char_start", raw.char_start ?? raw.charStart),
      ...definedNonNegativeInteger("char_end", raw.char_end ?? raw.charEnd),
    }
    const key = [
      ref.path.toLowerCase(),
      ref.anchor?.toLowerCase() ?? "",
      ref.snippet_hash ?? "",
    ].join("\n")
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(ref)
  }
  return refs
}

function definedString<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  const normalized = optionalString(value)
  return normalized ? { [key]: normalized } as Record<K, string> : {}
}

function definedPositiveInteger<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, number>> {
  const normalized = integerValue(value)
  return normalized !== undefined && normalized > 0
    ? { [key]: normalized } as Record<K, number>
    : {}
}

function definedNonNegativeInteger<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, number>> {
  const normalized = integerValue(value)
  return normalized !== undefined && normalized >= 0
    ? { [key]: normalized } as Record<K, number>
    : {}
}

function arrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(stringValue)
  if (typeof value === "string") return [value]
  return []
}

function uniqueStrings(values: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return ""
}

function optionalString(value: unknown): string | undefined {
  const normalized = stringValue(value).trim()
  return normalized || undefined
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeIdentityPart(value: string): string {
  return normalizeText(value).toLowerCase().replace(/[\s_]+/g, "-")
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function integerValue(value: unknown): number | undefined {
  const parsed = numberValue(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

function parseScore(value: unknown): number {
  return Math.min(1, Math.max(0, numberValue(value)))
}

function formatScore(value: number): string {
  return value.toFixed(2)
}

function normalizeDate(value: unknown): string | undefined {
  const normalized = stringValue(value).trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined
}

function hashString(value: string): string {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
