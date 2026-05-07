import { enrichLifecycleFrontmatter } from "@/lib/lifecycle"
import { WIKI_GRAPH_SEED_ARRAY_FIELDS, WIKI_TYPED_RELATION_ARRAY_FIELDS } from "@/lib/wiki-frontmatter-fields"

export interface BuildFallbackSourceSummaryContentInput {
  fileName: string
  date: string
  body?: string
}

export function buildFallbackSourceSummaryContent(
  input: BuildFallbackSourceSummaryContentInput,
): string {
  const body = input.body?.trimEnd() ?? ""
  const frontmatter = [
    "---",
    "type: source",
    `title: ${quoteYaml(`Source: ${input.fileName}`)}`,
    `created: ${input.date}`,
    `updated: ${input.date}`,
    `sources: [${quoteYaml(input.fileName)}]`,
    "tags: []",
    "related: []",
    ...WIKI_GRAPH_SEED_ARRAY_FIELDS.map((field) => `${field}: []`),
    ...WIKI_TYPED_RELATION_ARRAY_FIELDS.map((field) => `${field}: []`),
    "---",
    "",
  ].join("\n")
  const content = `${frontmatter}# Source: ${input.fileName}\n\n${body}${body ? "\n" : ""}`
  return enrichLifecycleFrontmatter(content, { today: input.date }).content
}

function quoteYaml(value: string): string {
  if (/^[A-Za-z0-9_.\/-]+$/.test(value)) return value
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}
