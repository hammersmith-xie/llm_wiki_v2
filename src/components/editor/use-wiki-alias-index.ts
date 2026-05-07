import { useEffect, useState } from "react"
import { readFile } from "@/commands/fs"
import {
  buildWikiAliasIndex,
  type WikiAliasIndex,
} from "@/lib/wiki-alias-index"
import type { FileNode } from "@/types/wiki"

const EMPTY_ALIAS_INDEX: WikiAliasIndex = new Map()

let cachedAliasIndex:
  | {
      key: string
      index?: WikiAliasIndex
      promise?: Promise<WikiAliasIndex>
    }
  | null = null

export function useWikiAliasIndex(
  fileTree: FileNode[],
  wikiRoot: string | null,
  dataVersion: number,
): WikiAliasIndex {
  const [index, setIndex] = useState<WikiAliasIndex>(() => EMPTY_ALIAS_INDEX)

  useEffect(() => {
    if (!wikiRoot) {
      setIndex(EMPTY_ALIAS_INDEX)
      return
    }

    const key = `${wikiRoot}::${dataVersion}::${wikiMarkdownTreeKey(fileTree, wikiRoot)}`
    if (cachedAliasIndex?.key === key && cachedAliasIndex.index) {
      setIndex(cachedAliasIndex.index)
      return
    }

    let cancelled = false
    const promise =
      cachedAliasIndex?.key === key && cachedAliasIndex.promise
        ? cachedAliasIndex.promise
        : buildWikiAliasIndex(fileTree, wikiRoot, readFile).catch(() => new Map())

    cachedAliasIndex = { key, promise }
    promise.then((nextIndex) => {
      if (cachedAliasIndex?.key === key) {
        cachedAliasIndex = { key, index: nextIndex }
      }
      if (!cancelled) setIndex(nextIndex)
    })

    return () => {
      cancelled = true
    }
  }, [fileTree, wikiRoot, dataVersion])

  return index
}

function wikiMarkdownTreeKey(fileTree: FileNode[], wikiRoot: string): string {
  const rootPrefix = `${wikiRoot.replace(/\/$/, "")}/`
  const paths: string[] = []

  function walk(nodes: FileNode[]) {
    for (const node of nodes) {
      if (node.is_dir) {
        if (node.children) walk(node.children)
        continue
      }
      if (node.path.startsWith(rootPrefix) && node.name.endsWith(".md")) {
        paths.push(node.path)
      }
    }
  }

  walk(fileTree)
  return paths.sort().join("\n")
}
