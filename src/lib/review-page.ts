import { insertClaimAnchor } from "@/lib/claim-anchors"
import { extractClaimCandidates } from "@/lib/claim-extract"
import { enrichLifecycleFrontmatter } from "@/lib/lifecycle"
import { normalizePath } from "@/lib/path-utils"
import { makeQuerySlug } from "@/lib/wiki-filename"
import { WIKI_GRAPH_SEED_ARRAY_FIELDS, WIKI_TYPED_RELATION_ARRAY_FIELDS } from "@/lib/wiki-frontmatter-fields"

export interface BuildReviewCreatedPageContentInput {
  pageType: string
  title: string
  description: string
  date: string
}

export interface BuildReviewCreatedPageTargetInput {
  projectPath: string
  pageType: string
  title: string
  date: string
}

export interface ReviewCreatedPageTarget {
  dir: string
  slug: string
  fileName: string
  filePath: string
  linkTarget: string
}

export function buildReviewCreatedPageTarget(
  input: BuildReviewCreatedPageTargetInput,
): ReviewCreatedPageTarget {
  const dir = directoryForPageType(input.pageType)
  const slug = makeQuerySlug(input.title)
  const fileName = `${slug}-${input.date}.md`
  const linkTarget = `${dir}/${slug}-${input.date}`
  return {
    dir,
    slug,
    fileName,
    filePath: `${normalizePath(input.projectPath)}/wiki/${dir}/${fileName}`,
    linkTarget,
  }
}

export function buildReviewCreatedPageContent(
  input: BuildReviewCreatedPageContentInput,
): string {
  const title = input.title.trim() || "Untitled"
  const description = input.description.trimEnd()
  const frontmatter = [
    "---",
    `type: ${quoteYaml(input.pageType)}`,
    `title: ${quoteYaml(title)}`,
    `created: ${input.date}`,
    `updated: ${input.date}`,
    "origin: review-create",
    "tags: []",
    "related: []",
    "sources: []",
    ...WIKI_GRAPH_SEED_ARRAY_FIELDS.map((field) => `${field}: []`),
    ...WIKI_TYPED_RELATION_ARRAY_FIELDS.map((field) => `${field}: []`),
    "---",
    "",
  ].join("\n")

  let body = `# ${title}\n\n${description}\n`
  const extraction = extractClaimCandidates({
    pagePath: `wiki/${directoryForPageType(input.pageType)}/${makeQuerySlug(title)}-${input.date}.md`,
    pageTitle: title,
    content: body,
    today: input.date,
    lifecycle: lifecycleForPageType(input.pageType),
  })
  for (const candidate of extraction.claims) {
    body = insertClaimAnchor(body, {
      claimId: candidate.claim.claim_id,
      claimText: candidate.anchorText,
      pageAnchor: candidate.claim.page_anchor,
    })
  }
  return enrichLifecycleFrontmatter(frontmatter + body, { today: input.date }).content
}

function lifecycleForPageType(pageType: string): "working" | "episodic" | "semantic" | "procedural" | "archived" {
  return pageType === "query" ? "episodic" : "semantic"
}

function directoryForPageType(pageType: string): string {
  switch (pageType) {
    case "entity":
      return "entities"
    case "concept":
      return "concepts"
    case "comparison":
      return "comparisons"
    case "synthesis":
      return "synthesis"
    case "query":
    default:
      return "queries"
  }
}

function quoteYaml(value: string): string {
  if (/^[A-Za-z0-9_.\/-]+$/.test(value)) return value
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}
