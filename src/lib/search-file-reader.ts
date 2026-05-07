import { readFile } from "@/commands/fs"
import {
  prepareLexicalQuery,
  scoreFileLexically,
  type LexicalDocument,
  type PreparedLexicalQuery,
} from "@/lib/search-lexical"
import type { SearchResult } from "@/lib/search-types"
import type { FileNode } from "@/types/wiki"

/**
 * Bound on concurrent `readFile` calls during search. Going wider
 * than this saturates the Tauri IPC channel and starts QUEUING
 * work behind the search request.
 */
const SEARCH_READ_CONCURRENCY = 16

export function flattenMdFiles(nodes: FileNode[]): FileNode[] {
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

export async function searchFiles(
  files: FileNode[],
  tokens: readonly string[],
  query: string,
  results: SearchResult[],
  lexicalDocuments: LexicalDocument[],
): Promise<void> {
  const preparedQuery = prepareLexicalQuery(query, tokens)

  for (let i = 0; i < files.length; i += SEARCH_READ_CONCURRENCY) {
    const batch = files.slice(i, i + SEARCH_READ_CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        let content: string
        try {
          content = await readFile(file.path)
        } catch {
          return null
        }
        lexicalDocuments.push({ path: file.path, fileName: file.name, content })
        return scoreFile(file, content, preparedQuery)
      }),
    )
    for (const r of batchResults) {
      if (r) results.push(r)
    }
  }
}

function scoreFile(
  file: FileNode,
  content: string,
  preparedQuery: PreparedLexicalQuery,
): SearchResult | null {
  const hit = scoreFileLexically(file, content, preparedQuery)
  if (!hit) return null

  return {
    path: hit.path,
    title: hit.title,
    snippet: hit.snippet,
    titleMatch: hit.titleMatch,
    score: hit.score,
    images: hit.images,
  }
}
