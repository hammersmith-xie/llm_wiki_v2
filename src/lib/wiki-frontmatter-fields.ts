export const WIKI_GRAPH_SEED_ARRAY_FIELDS = [
  "alias",
  "aliases",
  "keywords",
] as const

export const WIKI_TYPED_RELATION_ARRAY_FIELDS = [
  "uses",
  "depends_on",
  "contradicts",
  "supports",
  "supersedes",
  "superseded_by",
] as const

export const WIKI_REFERENCE_ARRAY_FIELDS = [
  "related",
  ...WIKI_TYPED_RELATION_ARRAY_FIELDS,
] as const

export const WIKI_MERGE_ARRAY_FIELDS = [
  "sources",
  "tags",
  ...WIKI_GRAPH_SEED_ARRAY_FIELDS,
  ...WIKI_REFERENCE_ARRAY_FIELDS,
] as const

export type WikiTypedRelationArrayField =
  (typeof WIKI_TYPED_RELATION_ARRAY_FIELDS)[number]
