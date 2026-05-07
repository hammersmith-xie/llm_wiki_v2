import { describe, expect, it, vi } from "vitest"
import type { FileNode } from "@/types/wiki"
import {
  buildWikiAliasIndex,
  buildWikiAliasIndexFromPages,
  normalizeWikiReferenceKey,
} from "./wiki-alias-index"

const PP = "/p"
const WIKI = `${PP}/wiki`

const page = (frontmatter: string) => `---\n${frontmatter}\n---\n\nbody`

function file(path: string): FileNode {
  const name = path.split("/").pop()!
  return { name, path, is_dir: false }
}

function dir(path: string, children: FileNode[]): FileNode {
  const name = path.split("/").pop()!
  return { name, path, is_dir: true, children }
}

describe("buildWikiAliasIndexFromPages", () => {
  it("indexes title, alias, and aliases frontmatter values by normalized key", () => {
    const index = buildWikiAliasIndexFromPages(
      [
        {
          path: `${WIKI}/concepts/tavily-api.md`,
          content: page(
            [
              "title: Tavily API",
              "alias: [tavily]",
              "aliases: [web search api, search_api]",
            ].join("\n"),
          ),
        },
      ],
      WIKI,
    )

    expect(index.get(normalizeWikiReferenceKey("Tavily API"))).toBe(
      `${WIKI}/concepts/tavily-api.md`,
    )
    expect(index.get(normalizeWikiReferenceKey("tavily"))).toBe(
      `${WIKI}/concepts/tavily-api.md`,
    )
    expect(index.get(normalizeWikiReferenceKey("web_search_api"))).toBe(
      `${WIKI}/concepts/tavily-api.md`,
    )
  })

  it("keeps the first page when two pages claim the same alias", () => {
    const index = buildWikiAliasIndexFromPages(
      [
        { path: `${WIKI}/concepts/a.md`, content: page("alias: [shared]") },
        { path: `${WIKI}/concepts/b.md`, content: page("alias: [shared]") },
      ],
      WIKI,
    )

    expect(index.get(normalizeWikiReferenceKey("shared"))).toBe(`${WIKI}/concepts/a.md`)
  })

  it("ignores non-wiki paths and pages without frontmatter", () => {
    const index = buildWikiAliasIndexFromPages(
      [
        { path: `${PP}/raw/sources/tavily.md`, content: page("alias: [tavily]") },
        { path: `${WIKI}/concepts/no-fm.md`, content: "# No frontmatter" },
      ],
      WIKI,
    )

    expect(index.size).toBe(0)
  })
})

describe("buildWikiAliasIndex", () => {
  it("reads markdown wiki files from the file tree and skips unreadable pages", async () => {
    const tree = [
      dir(`${WIKI}`, [
        dir(`${WIKI}/concepts`, [
          file(`${WIKI}/concepts/tavily-api.md`),
          file(`${WIKI}/concepts/broken.md`),
        ]),
      ]),
    ]
    const readPage = vi.fn(async (path: string) => {
      if (path.endsWith("broken.md")) throw new Error("missing")
      return page("title: Tavily API\naliases: [tavily]")
    })

    const index = await buildWikiAliasIndex(tree, WIKI, readPage)

    expect(readPage).toHaveBeenCalledTimes(2)
    expect(index.get(normalizeWikiReferenceKey("tavily"))).toBe(
      `${WIKI}/concepts/tavily-api.md`,
    )
  })
})
