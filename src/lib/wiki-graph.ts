import { readFile, listDirectory } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { buildRetrievalGraph, calculateRelevance } from "./graph-relevance"
import { extractTypedGraphFromPages, type TypedEdgeType } from "./typed-graph"
import { normalizePath } from "@/lib/path-utils"
import Graph from "graphology"
import louvain from "graphology-communities-louvain"

export interface GraphNode {
  id: string
  label: string
  type: string
  path: string
  linkCount: number // inbound + outbound
  community: number // community id from Louvain detection
}

export interface GraphEdge {
  source: string
  target: string
  weight: number // relevance score between source and target
  relationshipTypes?: TypedEdgeType[]
}

export interface CommunityInfo {
  id: number
  nodeCount: number
  cohesion: number // intra-community edge density
  topNodes: string[] // top nodes by linkCount (labels)
}

/** Run Louvain community detection and compute cohesion per community */
function detectCommunities(
  nodes: { id: string; label: string; linkCount: number }[],
  edges: GraphEdge[],
): { assignments: Map<string, number>; communities: CommunityInfo[] } {
  if (nodes.length === 0) {
    return { assignments: new Map(), communities: [] }
  }

  const g = new Graph({ type: "undirected" })
  for (const node of nodes) {
    g.addNode(node.id)
  }
  for (const edge of edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      const key = `${edge.source}->${edge.target}`
      if (!g.hasEdge(key) && !g.hasEdge(`${edge.target}->${edge.source}`)) {
        g.addEdgeWithKey(key, edge.source, edge.target, { weight: edge.weight })
      }
    }
  }

  // Run Louvain — returns { nodeId: communityId }
  const communityMap: Record<string, number> = louvain(g, { resolution: 1 })
  const assignments = new Map(Object.entries(communityMap).map(([k, v]) => [k, v as number]))

  // Group nodes by community
  const groups = new Map<number, string[]>()
  for (const [nodeId, commId] of assignments) {
    const list = groups.get(commId) ?? []
    list.push(nodeId)
    groups.set(commId, list)
  }

  // Build edge lookup for cohesion calculation
  const edgeSet = new Set<string>()
  for (const edge of edges) {
    edgeSet.add(`${edge.source}:::${edge.target}`)
    edgeSet.add(`${edge.target}:::${edge.source}`)
  }

  // Build label + linkCount lookup
  const nodeInfo = new Map(nodes.map((n) => [n.id, { label: n.label, linkCount: n.linkCount }]))

  // Compute per-community info
  const communities: CommunityInfo[] = []
  for (const [commId, memberIds] of groups) {
    const n = memberIds.length
    // Cohesion = actual intra-community edges / possible edges
    let intraEdges = 0
    for (let i = 0; i < memberIds.length; i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        if (edgeSet.has(`${memberIds[i]}:::${memberIds[j]}`)) {
          intraEdges++
        }
      }
    }
    const possibleEdges = n > 1 ? (n * (n - 1)) / 2 : 1
    const cohesion = intraEdges / possibleEdges

    // Top nodes by linkCount
    const sorted = [...memberIds].sort(
      (a, b) => (nodeInfo.get(b)?.linkCount ?? 0) - (nodeInfo.get(a)?.linkCount ?? 0),
    )
    const topNodes = sorted.slice(0, 5).map((id) => nodeInfo.get(id)?.label ?? id)

    communities.push({ id: commId, nodeCount: n, cohesion, topNodes })
  }

  // Sort by nodeCount descending
  communities.sort((a, b) => b.nodeCount - a.nodeCount)

  // Re-number community IDs sequentially (0, 1, 2, ...)
  const idRemap = new Map<number, number>()
  communities.forEach((c, idx) => {
    idRemap.set(c.id, idx)
    c.id = idx
  })
  for (const [nodeId, oldId] of assignments) {
    assignments.set(nodeId, idRemap.get(oldId) ?? 0)
  }

  return { assignments, communities }
}

const WIKILINK_REGEX = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
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

function extractTitle(content: string, fileName: string): string {
  const frontmatterTitleMatch = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
  if (frontmatterTitleMatch) return frontmatterTitleMatch[1].trim()

  const headingMatch = content.match(/^#\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()

  return fileName.replace(/\.md$/, "").replace(/-/g, " ")
}

function extractType(content: string): string {
  const frontmatterTypeMatch = content.match(/^---\n[\s\S]*?^type:\s*["']?(.+?)["']?\s*$/m)
  if (frontmatterTypeMatch) return frontmatterTypeMatch[1].trim().toLowerCase()
  return "other"
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

function fileNameToId(fileName: string): string {
  return fileName.replace(/\.md$/, "")
}

export async function buildWikiGraph(
  projectPath: string,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; communities: CommunityInfo[] }> {
  const wikiRoot = `${normalizePath(projectPath)}/wiki`

  let tree: FileNode[]
  try {
    tree = await listDirectory(wikiRoot)
  } catch {
    return { nodes: [], edges: [], communities: [] }
  }

  const mdFiles = flattenMdFiles(tree)
  if (mdFiles.length === 0) {
    return { nodes: [], edges: [], communities: [] }
  }

  // Build a map of id -> node data
  const pages: Array<{ id: string; path: string; fileName: string; content: string }> = []
  const nodeMap = new Map<
    string,
    { id: string; label: string; type: string; path: string; links: string[] }
  >()

  for (const file of mdFiles) {
    const id = fileNameToId(file.name)
    let content = ""
    try {
      content = await readFile(file.path)
    } catch {
      // Skip unreadable files
      continue
    }
    pages.push({ id, path: file.path, fileName: file.name, content })

    nodeMap.set(id, {
      id,
      label: extractTitle(content, file.name),
      type: extractType(content),
      path: file.path,
      links: extractWikilinks(content),
    })
  }

  // Filter out query nodes (research results, saved chat answers) — they are
  // intermediate artifacts, not knowledge structure. The entities/concepts
  // extracted from them via auto-ingest are what belong in the graph.
  const HIDDEN_TYPES = new Set(["query"])
  for (const [id, node] of nodeMap) {
    if (HIDDEN_TYPES.has(node.type)) {
      nodeMap.delete(id)
    }
  }

  // Count link references
  const linkCounts = new Map<string, number>()
  for (const [id] of nodeMap) {
    linkCounts.set(id, 0)
  }

  const rawEdges: GraphEdge[] = []

  for (const [sourceId, nodeData] of nodeMap) {
    for (const targetRaw of nodeData.links) {
      // Normalize target: try matching by id (case-insensitive, hyphen/space)
      const targetId = resolveTarget(targetRaw, nodeMap)
      if (targetId === null) continue
      if (targetId === sourceId) continue

      rawEdges.push({ source: sourceId, target: targetId, weight: 1, relationshipTypes: ["mentions"] })

      linkCounts.set(sourceId, (linkCounts.get(sourceId) ?? 0) + 1)
      linkCounts.set(targetId, (linkCounts.get(targetId) ?? 0) + 1)
    }
  }

  // Add explicit LLM Wiki v2 relationship arrays to the visual graph.
  // `mentions` edges are already covered by the wikilink pass above, and
  // `derived_from` can make the graph read as source-spider noise.
  const typedGraph = extractTypedGraphFromPages(pages)
  for (const edge of typedGraph.edges) {
    if (!edge.explicit) continue
    if (edge.type === "derived_from") continue
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue
    if (edge.source === edge.target) continue

    rawEdges.push({
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
      relationshipTypes: [edge.type],
    })

    linkCounts.set(edge.source, (linkCounts.get(edge.source) ?? 0) + 1)
    linkCounts.set(edge.target, (linkCounts.get(edge.target) ?? 0) + 1)
  }

  // Deduplicate edges while preserving which relationship types contributed.
  const dedupedEdges = new Map<string, { source: string; target: string; relationshipTypes: Set<TypedEdgeType> }>()
  for (const edge of rawEdges) {
    const forwardKey = `${edge.source}:::${edge.target}`
    const reverseKey = `${edge.target}:::${edge.source}`
    const key = dedupedEdges.has(reverseKey) ? reverseKey : forwardKey
    const existing = dedupedEdges.get(key)
    if (existing) {
      for (const type of edge.relationshipTypes ?? []) existing.relationshipTypes.add(type)
    } else {
      dedupedEdges.set(key, {
        source: edge.source,
        target: edge.target,
        relationshipTypes: new Set(edge.relationshipTypes ?? []),
      })
    }
  }

  // Calculate relevance weights using the retrieval graph
  let retrievalGraph: Awaited<ReturnType<typeof buildRetrievalGraph>> | null = null
  try {
    const { useWikiStore } = await import("@/stores/wiki-store")
    const dv = useWikiStore.getState().dataVersion
    retrievalGraph = await buildRetrievalGraph(normalizePath(projectPath), dv)
  } catch {
    // ignore — weights will default to 1
  }

  const edges: GraphEdge[] = [...dedupedEdges.values()].map((e) => {
    let weight = 1
    if (retrievalGraph) {
      const nodeA = retrievalGraph.nodes.get(e.source)
      const nodeB = retrievalGraph.nodes.get(e.target)
      if (nodeA && nodeB) {
        weight = calculateRelevance(nodeA, nodeB, retrievalGraph)
      }
    }
    return {
      source: e.source,
      target: e.target,
      weight,
      relationshipTypes: [...e.relationshipTypes].sort(),
    }
  })

  // Build preliminary nodes for community detection
  const prelimNodes = Array.from(nodeMap.values()).map((n) => ({
    id: n.id,
    label: n.label,
    linkCount: linkCounts.get(n.id) ?? 0,
  }))

  const { assignments, communities } = detectCommunities(prelimNodes, edges)

  const nodes: GraphNode[] = Array.from(nodeMap.values()).map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    path: n.path,
    linkCount: linkCounts.get(n.id) ?? 0,
    community: assignments.get(n.id) ?? 0,
  }))

  return { nodes, edges, communities }
}

function resolveTarget(
  raw: string,
  nodeMap: Map<string, { id: string }>,
): string | null {
  // Direct match
  if (nodeMap.has(raw)) return raw

  // Normalize: lowercase, replace spaces with hyphens and vice versa
  const normalized = raw.toLowerCase().replace(/\s+/g, "-")
  for (const id of nodeMap.keys()) {
    if (id.toLowerCase() === normalized) return id
    if (id.toLowerCase() === raw.toLowerCase()) return id
    if (id.toLowerCase().replace(/\s+/g, "-") === normalized) return id
  }

  return null
}
