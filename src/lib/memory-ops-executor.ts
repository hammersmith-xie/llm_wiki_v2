import { readFile, writeFile } from "@/commands/fs"
import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import { isAbsolutePath, normalizePath } from "@/lib/path-utils"

export type MetadataPatchValue = string | string[] | number | boolean

export interface MetadataPatchOperation {
  kind: "metadata-patch"
  targetPath: string
  fields: Record<string, MetadataPatchValue>
  reason: string
}

export interface MetadataFieldDiff {
  field: string
  before: FrontmatterValue | undefined
  after: MetadataPatchValue
}

export interface RollbackRestoreContent {
  kind: "restore-content"
  targetPath: string
  content: string
  reason: string
}

export interface MetadataPatchPlan {
  kind: "metadata-patch"
  dryRun: true
  targetPath: string
  changed: boolean
  diff: MetadataFieldDiff[]
  beforeContent: string
  afterContent: string
  rollback: RollbackRestoreContent
}

export interface ApplyOperationResult {
  targetPath: string
  status: "applied" | "unchanged" | "error"
  plan?: MetadataPatchPlan
  error?: string
}

export interface ApplyOperationsResult {
  ok: boolean
  results: ApplyOperationResult[]
}

export function createMetadataPatchPlan(input: {
  targetPath: string
  content: string
  fields: Record<string, MetadataPatchValue>
  reason: string
}): MetadataPatchPlan {
  const parsed = parseFrontmatter(input.content)
  const diff: MetadataFieldDiff[] = []

  for (const [field, after] of Object.entries(input.fields)) {
    const before = parsed.frontmatter?.[field]
    if (!frontmatterValuesEqual(before, after)) {
      diff.push({ field, before, after })
    }
  }

  const afterContent =
    diff.length > 0 ? setFrontmatterFields(input.content, input.fields) : input.content

  return {
    kind: "metadata-patch",
    dryRun: true,
    targetPath: input.targetPath,
    changed: diff.length > 0 && afterContent !== input.content,
    diff,
    beforeContent: input.content,
    afterContent,
    rollback: {
      kind: "restore-content",
      targetPath: input.targetPath,
      content: input.content,
      reason: `Rollback metadata patch: ${input.reason}`,
    },
  }
}

export async function applyMemoryOpsOperations(
  projectPath: string,
  operations: readonly MetadataPatchOperation[],
): Promise<ApplyOperationsResult> {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const results: ApplyOperationResult[] = []

  for (const operation of operations) {
    try {
      const fullPath = resolveMemoryOpsTargetPath(pp, operation.targetPath)
      const content = await readFile(fullPath)
      const plan = createMetadataPatchPlan({
        targetPath: operation.targetPath,
        content,
        fields: operation.fields,
        reason: operation.reason,
      })

      if (!plan.changed) {
        results.push({ targetPath: operation.targetPath, status: "unchanged", plan })
        continue
      }

      await writeFile(fullPath, plan.afterContent)
      results.push({ targetPath: operation.targetPath, status: "applied", plan })
    } catch (err) {
      results.push({
        targetPath: operation.targetPath,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    ok: results.every((result) => result.status !== "error"),
    results,
  }
}

export function resolveMemoryOpsTargetPath(projectPath: string, targetPath: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(targetPath)
  if (normalized.split("/").includes("..")) {
    throw new Error(`Memory Ops target path contains parent traversal: ${targetPath}`)
  }
  const resolved = isAbsolutePath(normalized) ? normalized : `${pp}/${normalized}`
  if (resolved !== pp && !resolved.startsWith(`${pp}/`)) {
    throw new Error(`Memory Ops target path escapes the project root: ${targetPath}`)
  }
  return resolved
}

function setFrontmatterFields(
  content: string,
  fields: Record<string, MetadataPatchValue>,
): string {
  const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)(\r?\n|$)/)
  if (!match) {
    const body = Object.entries(fields)
      .map(([key, value]) => formatFrontmatterLine(key, value))
      .join("\n")
    return `---\n${body}\n---\n\n${content}`
  }

  const [, open, body, close, afterCloseNewline] = match
  const lines = body.split(/\r?\n/)
  const consumed = new Set<string>()
  const out: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const keyMatch = line.match(/^([A-Za-z_][\w-]*):/)
    if (!keyMatch) {
      out.push(line)
      continue
    }

    const key = keyMatch[1]
    if (!(key in fields)) {
      out.push(line)
      continue
    }

    out.push(formatFrontmatterLine(key, fields[key]))
    consumed.add(key)

    if (Array.isArray(fields[key])) {
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) i++
    }
  }

  for (const [key, value] of Object.entries(fields)) {
    if (!consumed.has(key)) out.push(formatFrontmatterLine(key, value))
  }

  return `${open}${out.join("\n")}${close}${afterCloseNewline}${content.slice(match[0].length)}`
}

function formatFrontmatterLine(key: string, value: MetadataPatchValue): string {
  if (Array.isArray(value)) {
    return `${key}: [${value.map(quoteYamlString).join(", ")}]`
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${key}: ${String(value)}`
  }
  return `${key}: ${quoteYamlScalar(value)}`
}

function frontmatterValuesEqual(
  before: FrontmatterValue | undefined,
  after: MetadataPatchValue,
): boolean {
  if (Array.isArray(before) || Array.isArray(after)) {
    return JSON.stringify(before ?? []) === JSON.stringify(after)
  }
  return String(before ?? "") === String(after)
}

function quoteYamlScalar(value: string): string {
  if (/^[A-Za-z0-9_.\/-]+$/.test(value)) return value
  return quoteYamlString(value)
}

function quoteYamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}
