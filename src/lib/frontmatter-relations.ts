import type { FrontmatterValue } from "@/lib/frontmatter"
import {
  WIKI_TYPED_RELATION_ARRAY_FIELDS,
  type WikiTypedRelationArrayField,
} from "@/lib/wiki-frontmatter-fields"

const TYPED_RELATION_LABELS: Record<WikiTypedRelationArrayField, string> = {
  uses: "Uses",
  depends_on: "Depends on",
  contradicts: "Contradicts",
  supports: "Supports",
  supersedes: "Supersedes",
  superseded_by: "Superseded by",
}

export const TYPED_RELATION_FIELDS = WIKI_TYPED_RELATION_ARRAY_FIELDS.map(
  (field) => ({ field, label: TYPED_RELATION_LABELS[field] }),
)

export type TypedRelationField = WikiTypedRelationArrayField

export interface TypedRelationGroup {
  field: TypedRelationField
  label: string
  values: string[]
}

export function collectTypedRelationGroups(
  data: Record<string, FrontmatterValue>,
): TypedRelationGroup[] {
  const groups: TypedRelationGroup[] = []
  for (const { field, label } of TYPED_RELATION_FIELDS) {
    const values = arrayValue(data[field])
    if (values.length > 0) groups.push({ field, label, values })
  }
  return groups
}

function arrayValue(v: FrontmatterValue | undefined): string[] {
  if (typeof v === "string") return v.trim() === "" ? [] : [v.trim()]
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "")
}
