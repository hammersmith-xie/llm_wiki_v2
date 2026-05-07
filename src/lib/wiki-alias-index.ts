import type { FileNode } from "@/types/wiki"
import { parseFrontmatter, type FrontmatterValue } from "./frontmatter"

export type WikiAliasIndex = ReadonlyMap<string, string>
export type WikiAliasIndexReader = (path: string) => Promise<string>

export function normalizeWikiReferenceKey(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]+/g, "")
}

export function buildWikiAliasIndexFromPages(
  pages: Array<{ path: string; content: string }>,
  wikiRoot: string,
): Map<string, string> {
  const index = new Map<string, string>()
  const rootPrefix = `${wikiRoot.replace(/\/$/, "")}/`

  for (const page of pages) {
    if (!page.path.startsWith(rootPrefix) || !page.path.endsWith(".md")) continue
    const parsed = parseFrontmatter(page.content)
    if (!parsed.frontmatter) continue

    for (const alias of aliasesFromFrontmatter(parsed.frontmatter)) {
      const key = normalizeWikiReferenceKey(alias)
      if (!key || index.has(key)) continue
      index.set(key, page.path)
    }
  }

  return index
}

export async function buildWikiAliasIndex(
  tree: FileNode[],
  wikiRoot: string,
  readPage: WikiAliasIndexReader,
): Promise<Map<string, string>> {
  const pages = await Promise.all(
    collectWikiMarkdownFiles(tree, wikiRoot).map(async (path) => {
      try {
        return { path, content: await readPage(path) }
      } catch {
        return null
      }
    }),
  )

  return buildWikiAliasIndexFromPages(
    pages.filter((page): page is { path: string; content: string } => page !== null),
    wikiRoot,
  )
}

function collectWikiMarkdownFiles(tree: FileNode[], wikiRoot: string): string[] {
  const out: string[] = []
  const rootPrefix = `${wikiRoot.replace(/\/$/, "")}/`

  function walk(nodes: FileNode[]) {
    for (const node of nodes) {
      if (node.is_dir) {
        if (node.children) walk(node.children)
        continue
      }
      if (node.path.startsWith(rootPrefix) && node.name.endsWith(".md")) {
        out.push(node.path)
      }
    }
  }

  walk(tree)
  return out
}

function aliasesFromFrontmatter(frontmatter: Record<string, FrontmatterValue>): string[] {
  return [
    ...arrayValue(frontmatter.title),
    ...arrayValue(frontmatter.alias),
    ...arrayValue(frontmatter.aliases),
  ].filter((value) => value.trim() !== "")
}

function arrayValue(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return value
  if (typeof value === "string") return [value]
  return []
}
