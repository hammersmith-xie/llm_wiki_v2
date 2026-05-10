import type { WikiPage } from "@/types/wiki"
import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import { getFileName } from "@/lib/path-utils"

export interface MarpExportOptions {
  theme?: "default" | "gaia" | "uncover"
  paginate?: boolean
  includeFrontmatter?: boolean
}

const DEFAULT_OPTIONS: Required<MarpExportOptions> = {
  theme: "default",
  paginate: true,
  includeFrontmatter: true,
}

export function pageToMarp(
  page: WikiPage,
  options: MarpExportOptions = {},
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const parsed = parseFrontmatter(page.content)
  const frontmatter = parsed.frontmatter ?? normalizePageFrontmatter(page.frontmatter)
  const body = parsed.body.trim()
  const title = stringFrontmatterValue(frontmatter?.title) ?? pageTitleFromPath(page.path)

  const marpHeader = [
    "---",
    "marp: true",
    `theme: ${opts.theme}`,
    `paginate: ${String(opts.paginate)}`,
    "---",
  ].join("\n")

  const titleSlide = [
    `# ${title}`,
    "",
    ...(opts.includeFrontmatter ? [formatMetadata(frontmatter)] : []),
  ].filter((part) => part.trim().length > 0).join("\n")

  const slides = splitBodyIntoSlides(body)
  return [marpHeader, titleSlide, ...slides]
    .filter((slide) => slide.trim().length > 0)
    .join("\n\n---\n\n")
}

export function splitBodyIntoSlides(body: string): string[] {
  const trimmed = body.trim()
  if (!trimmed) return []

  const lines = trimmed.split("\n")
  const slides: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (line.startsWith("## ") && current.length > 0) {
      slides.push(current.join("\n").trim())
      current = []
    }
    current.push(line)
  }

  if (current.length > 0) slides.push(current.join("\n").trim())
  return slides.filter((slide) => slide.length > 0)
}

function formatMetadata(frontmatter: Record<string, FrontmatterValue> | null): string {
  if (!frontmatter) return ""
  const rows: string[] = []
  const type = stringFrontmatterValue(frontmatter.type)
  const created = stringFrontmatterValue(frontmatter.created)
  const updated = stringFrontmatterValue(frontmatter.updated)
  const confidence = stringFrontmatterValue(frontmatter.confidence)
  const sources = arrayFrontmatterValue(frontmatter.sources)

  if (type) rows.push(`**Type**: ${type}`)
  if (created) rows.push(`**Created**: ${created}`)
  if (updated) rows.push(`**Updated**: ${updated}`)
  if (confidence) rows.push(`**Confidence**: ${confidence}`)
  if (sources.length > 0) rows.push(`**Sources**: ${sources.length}`)

  return rows.join("  \n")
}

function normalizePageFrontmatter(
  frontmatter: Record<string, unknown> | null | undefined,
): Record<string, FrontmatterValue> | null {
  if (!frontmatter) return null
  const out: Record<string, FrontmatterValue> = {}
  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value === "string") out[key] = value
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value)
    else if (Array.isArray(value)) out[key] = value.map(String)
  }
  return out
}

function stringFrontmatterValue(value: FrontmatterValue | undefined): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (Array.isArray(value) && value.length > 0) return value[0]?.trim() || undefined
  return undefined
}

function arrayFrontmatterValue(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return value.filter((item) => item.trim().length > 0)
  if (typeof value === "string" && value.trim()) return [value.trim()]
  return []
}

function pageTitleFromPath(path: string): string {
  return getFileName(path).replace(/\.md$/i, "") || "Untitled"
}
