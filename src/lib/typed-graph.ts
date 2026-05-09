import { readFile, listDirectory } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import { getFileStem, normalizePath } from "@/lib/path-utils"
import {
  WIKI_TYPED_RELATION_ARRAY_FIELDS,
  type WikiTypedRelationArrayField,
} from "@/lib/wiki-frontmatter-fields"

export type TypedEdgeType =
  | "related_to"
  | "uses"
  | "depends_on"
  | "contradicts"
  | "supersedes"
  | "supports"
  | "derived_from"
  | "mentions"

export type GraphPathDirection = "forward" | "reverse"

export interface TypedGraphNode {
  id: string
  title: string
  type: string
  path: string
  sources: string[]
  sourceCount: number
  aliases: string[]
  tags: string[]
  lifecycle: string
  lastConfirmed?: string
  confidence: number
  reviewStatus?: string
  reviewFlags: string[]
  seedText: string
}

export interface TypedGraphEdge {
  source: string
  target: string
  type: TypedEdgeType
  weight: number
  confidence: number
  explicit: boolean
  sourceField?: string
  sourcePath?: string
  rawTarget?: string
  provenance: "frontmatter" | "wikilink"
}

export interface TypedGraphTraversalEdge extends TypedGraphEdge {
  direction: GraphPathDirection
}

export interface TypedGraph {
  nodes: Map<string, TypedGraphNode>
  edges: TypedGraphEdge[]
  adjacency: Map<string, TypedGraphTraversalEdge[]>
  dataVersion: number
}

export interface GraphRank {
  id: string
  score: number
  path: string[]
  pathTypes: TypedEdgeType[]
  pathDirections: GraphPathDirection[]
}

const WIKILINK_REGEX = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g

const TYPED_EDGE_FIELD_CONFIG: Record<
  WikiTypedRelationArrayField,
  { type: TypedEdgeType; reverse?: boolean }
> = {
  uses: { type: "uses" },
  depends_on: { type: "depends_on" },
  contradicts: { type: "contradicts" },
  supports: { type: "supports" },
  supersedes: { type: "supersedes" },
  superseded_by: { type: "supersedes", reverse: true },
}

const EDGE_FIELDS: Array<{ field: string; type: TypedEdgeType; reverse?: boolean }> = [
  { field: "related", type: "related_to" },
  ...WIKI_TYPED_RELATION_ARRAY_FIELDS.map((field) => ({
    field,
    ...TYPED_EDGE_FIELD_CONFIG[field],
  })),
  { field: "sources", type: "derived_from" },
]

const EDGE_WEIGHTS: Record<TypedEdgeType, number> = {
  related_to: 1.2,
  uses: 1.4,
  depends_on: 1.5,
  contradicts: 1.1,
  supersedes: 1.3,
  supports: 1.35,
  derived_from: 0.8,
  mentions: 1.0,
}

let cachedGraph: {
  projectPath: string
  dataVersion: number
  graph: TypedGraph
} | null = null

export function extractTypedGraphFromPages(
  pages: Array<{ id: string; path: string; fileName: string; content: string }>,
  dataVersion: number = 0,
): TypedGraph {
  const rawNodes = pages.map((page) => {
    const parsed = parseFrontmatter(page.content)
    return {
      ...page,
      parsed,
      title: scalar(parsed.frontmatter?.title) || headingTitle(page.content) || page.id,
      type: (scalar(parsed.frontmatter?.type) || "other").toLowerCase(),
      sources: arrayValue(parsed.frontmatter?.sources),
      aliases: uniqueStrings([
        ...arrayValue(parsed.frontmatter?.aliases),
        ...arrayValue(parsed.frontmatter?.alias),
      ]),
      tags: arrayValue(parsed.frontmatter?.tags),
      lifecycle: scalar(parsed.frontmatter?.lifecycle) || "working",
      lastConfirmed:
        scalar(parsed.frontmatter?.last_confirmed) ??
        scalar(parsed.frontmatter?.updated) ??
        scalar(parsed.frontmatter?.created),
      confidence: parseScore(scalar(parsed.frontmatter?.confidence)),
      reviewStatus: scalar(parsed.frontmatter?.review_status),
      reviewFlags: reviewFlagsFromFrontmatter(parsed.frontmatter),
      seedText: buildSeedText(parsed.frontmatter),
    }
  })

  const idAliases = new Map<string, string>()
  for (const page of rawNodes) {
    idAliases.set(normalizeSlug(page.id), page.id)
    idAliases.set(normalizeSlug(page.title), page.id)
    idAliases.set(normalizeSlug(page.fileName.replace(/\.md$/, "")), page.id)
  }
  for (const page of rawNodes) {
    for (const alias of [
      ...arrayValue(page.parsed.frontmatter?.aliases),
      ...arrayValue(page.parsed.frontmatter?.alias),
    ]) {
      const key = normalizeSlug(alias)
      if (!idAliases.has(key)) idAliases.set(key, page.id)
    }
  }

  const nodes = new Map<string, TypedGraphNode>()
  for (const page of rawNodes) {
    nodes.set(page.id, {
      id: page.id,
      title: page.title,
      type: page.type,
      path: page.path,
      sources: page.sources,
      sourceCount: page.sources.length,
      aliases: page.aliases,
      tags: page.tags,
      lifecycle: page.lifecycle,
      lastConfirmed: page.lastConfirmed,
      confidence: page.confidence,
      reviewStatus: page.reviewStatus,
      reviewFlags: page.reviewFlags,
      seedText: page.seedText,
    })
  }

  const edges: TypedGraphEdge[] = []
  const seen = new Set<string>()
  const pushEdge = (
    source: string,
    targetRaw: string,
    type: TypedEdgeType,
    explicit: boolean,
    provenance: {
      sourceField?: string
      sourcePath?: string
      rawTarget?: string
      provenance: TypedGraphEdge["provenance"]
    },
  ) => {
    const target = resolveTarget(source, targetRaw, type, idAliases)
    if (!target || target === source) return
    const key = `${source}::${target}::${type}::${explicit ? "1" : "0"}::${provenance.sourceField ?? ""}`
    if (seen.has(key)) return
    seen.add(key)
    const sourceNode = nodes.get(source)
    const targetNode = nodes.get(target)
    const confidence = Math.min(sourceNode?.confidence ?? 0.5, targetNode?.confidence ?? 0.5)
    edges.push({
      source,
      target,
      type,
      explicit,
      confidence,
      sourceField: provenance.sourceField,
      sourcePath: provenance.sourcePath,
      rawTarget: provenance.rawTarget ?? targetRaw,
      provenance: provenance.provenance,
      weight: EDGE_WEIGHTS[type] * (explicit ? 1.15 : 1) * (0.75 + confidence * 0.5),
    })
  }

  for (const page of rawNodes) {
    for (const { field, type, reverse } of EDGE_FIELDS) {
      for (const target of arrayValue(page.parsed.frontmatter?.[field])) {
        if (reverse) {
          const reversedSource = resolveTarget(page.id, target, type, idAliases)
          if (reversedSource) {
            pushEdge(reversedSource, page.id, type, true, {
              sourceField: field,
              sourcePath: page.path,
              rawTarget: target,
              provenance: "frontmatter",
            })
          }
        } else {
          pushEdge(page.id, target, type, true, {
            sourceField: field,
            sourcePath: page.path,
            rawTarget: target,
            provenance: "frontmatter",
          })
        }
      }
    }
    for (const target of extractWikilinks(page.content)) {
      pushEdge(page.id, target, "mentions", false, {
        sourceField: "body:wikilink",
        sourcePath: page.path,
        rawTarget: target,
        provenance: "wikilink",
      })
    }
  }

  const adjacency = new Map<string, TypedGraphTraversalEdge[]>()
  for (const nodeId of nodes.keys()) adjacency.set(nodeId, [])
  for (const edge of edges) {
    adjacency.get(edge.source)?.push({ ...edge, direction: "forward" })
    adjacency.get(edge.target)?.push({
      ...edge,
      source: edge.target,
      target: edge.source,
      direction: "reverse",
    })
  }

  return { nodes, edges, adjacency, dataVersion }
}

export async function buildTypedGraph(
  projectPath: string,
  dataVersion: number = 0,
): Promise<TypedGraph> {
  const pp = normalizePath(projectPath)
  if (
    cachedGraph !== null &&
    cachedGraph.projectPath === pp &&
    cachedGraph.dataVersion === dataVersion
  ) {
    return cachedGraph.graph
  }

  const wikiRoot = `${pp}/wiki`
  let tree: FileNode[]
  try {
    tree = await listDirectory(wikiRoot)
  } catch {
    const empty = emptyTypedGraph(dataVersion)
    cachedGraph = { projectPath: pp, dataVersion, graph: empty }
    return empty
  }

  const files = flattenMdFiles(tree)
  const pages: Array<{ id: string; path: string; fileName: string; content: string }> = []
  for (const file of files) {
    try {
      pages.push({
        id: getFileStem(file.name),
        path: file.path,
        fileName: file.name,
        content: await readFile(file.path),
      })
    } catch {
      // Skip unreadable pages; graph/search should remain best-effort.
    }
  }

  const graph = extractTypedGraphFromPages(pages, dataVersion)
  cachedGraph = { projectPath: pp, dataVersion, graph }
  return graph
}

export function graphRankPages(
  graph: TypedGraph,
  query: string,
  options: { maxDepth?: number; limit?: number } = {},
): GraphRank[] {
  const maxDepth = options.maxDepth ?? 2
  const limit = options.limit ?? 12
  const seeds = findSeedNodes(graph, query)
  if (seeds.length === 0) return []

  const scores = new Map<
    string,
    {
      score: number
      path: string[]
      pathTypes: TypedEdgeType[]
      pathDirections: GraphPathDirection[]
    }
  >()
  const queue: Array<{
    id: string
    depth: number
    score: number
    path: string[]
    pathTypes: TypedEdgeType[]
    pathDirections: GraphPathDirection[]
  }> = []
  for (const seed of seeds) {
    queue.push({
      id: seed.id,
      depth: 0,
      score: seed.score,
      path: [seed.id],
      pathTypes: [],
      pathDirections: [],
    })
    scores.set(seed.id, {
      score: seed.score,
      path: [seed.id],
      pathTypes: [],
      pathDirections: [],
    })
  }

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.depth >= maxDepth) continue
    const edges = graph.adjacency.get(current.id) ?? []
    for (const edge of edges) {
      const nextDepth = current.depth + 1
      const nextScore = current.score * edge.weight * Math.pow(0.55, nextDepth)
      if (nextScore < 0.05) continue
      const nextPath = [...current.path, edge.target]
      const nextPathTypes = [...current.pathTypes, edge.type]
      const nextPathDirections = [...current.pathDirections, edge.direction]
      const existing = scores.get(edge.target)
      if (!existing || nextScore > existing.score) {
        scores.set(edge.target, {
          score: nextScore,
          path: nextPath,
          pathTypes: nextPathTypes,
          pathDirections: nextPathDirections,
        })
        queue.push({
          id: edge.target,
          depth: nextDepth,
          score: nextScore,
          path: nextPath,
          pathTypes: nextPathTypes,
          pathDirections: nextPathDirections,
        })
      }
    }
  }

  return [...scores.entries()]
    .map(([id, value]) => ({
      id,
      score: value.score,
      path: value.path,
      pathTypes: value.pathTypes,
      pathDirections: value.pathDirections,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.id.localeCompare(b.id)
    })
    .slice(0, limit)
}

export function clearTypedGraphCache(): void {
  cachedGraph = null
}

function findSeedNodes(graph: TypedGraph, query: string): Array<{ id: string; score: number }> {
  const normalizedQuery = normalizeText(query)
  const tokens = normalizeText(query).split(/\s+/).filter((t) => t.length > 1)
  if (!normalizedQuery && tokens.length === 0) return []

  const seeds: Array<{ id: string; score: number }> = []
  for (const node of graph.nodes.values()) {
    const idText = normalizeText(node.id)
    const titleText = normalizeText(node.title)
    const seedText = normalizeText(node.seedText ?? "")
    let score = 0
    if (normalizedQuery && idText === normalizedQuery) score += 4
    if (normalizedQuery && titleText === normalizedQuery) score += 4
    if (normalizedQuery && titleText.includes(normalizedQuery)) score += 2
    if (normalizedQuery && seedText.includes(normalizedQuery)) score += 2.5
    for (const token of tokens) {
      if (idText.includes(token)) score += 1.5
      if (titleText.includes(token)) score += 1.5
      if (seedText.includes(token)) score += 1.2
    }
    if (score > 0) seeds.push({ id: node.id, score: score * (0.75 + node.confidence * 0.5) })
  }
  return seeds.sort((a, b) => b.score - a.score).slice(0, 5)
}

function emptyTypedGraph(dataVersion: number): TypedGraph {
  return { nodes: new Map(), edges: [], adjacency: new Map(), dataVersion }
}

function flattenMdFiles(nodes: readonly FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function extractWikilinks(content: string): string[] {
  const links: string[] = []
  const regex = new RegExp(WIKILINK_REGEX.source, "g")
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].trim())
  }
  return links
}

function resolveTarget(
  source: string,
  raw: string,
  type: TypedEdgeType,
  aliases: ReadonlyMap<string, string>,
): string | null {
  const normalized = normalizeSlug(raw)
  if (aliases.has(normalized)) return aliases.get(normalized)!
  if (type === "derived_from") {
    const sourceStem = normalizeSlug(source)
    if (normalized === sourceStem) return source
    const rawStem = normalizeSourceRef(raw)
    if (aliases.has(rawStem)) return aliases.get(rawStem)!
    if (rawStem === sourceStem) return source
  }
  return null
}

function normalizeSlug(value: string): string {
  return normalizeText(value)
    .replace(/\.md$/, "")
    .replace(/^wiki\//, "")
    .split("/")
    .pop()!
}

function normalizeText(value: string): string {
  return value.toLowerCase().trim().replace(/\[\[|\]\]/g, "").replace(/\s+/g, "-")
}

function normalizeSourceRef(value: string): string {
  return normalizeSlug(value).replace(/\.[a-z0-9]+$/i, "")
}

function headingTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m)
  return match?.[1].trim()
}

function scalar(value: FrontmatterValue | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value || undefined
}

function arrayValue(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return uniqueStrings(value)
  if (!value) return []
  return uniqueStrings([value])
}

function buildSeedText(frontmatter: Record<string, FrontmatterValue> | null | undefined): string {
  if (!frontmatter) return ""
  return [
    ...arrayValue(frontmatter.aliases),
    ...arrayValue(frontmatter.alias),
    ...arrayValue(frontmatter.tags),
    ...arrayValue(frontmatter.keywords),
    ...arrayValue(frontmatter.summary),
    ...arrayValue(frontmatter.description),
  ].join(" ")
}

function reviewFlagsFromFrontmatter(
  frontmatter: Record<string, FrontmatterValue> | null | undefined,
): string[] {
  if (!frontmatter) return []
  const flags: string[] = []
  const status = scalar(frontmatter.review_status)
  if (status && status !== "ok") flags.push(status)
  if (scalar(frontmatter.status) === "stale") flags.push("stale")
  if (arrayValue(frontmatter.contradicts).length > 0) flags.push("contradicts")
  if (arrayValue(frontmatter.superseded_by).length > 0) flags.push("superseded")
  return uniqueStrings(flags)
}

function parseScore(value: string | undefined): number {
  if (!value) return 0.55
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return 0.55
  return Math.max(0, Math.min(1, parsed))
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
