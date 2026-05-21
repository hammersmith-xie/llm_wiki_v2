import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  GitBranch,
  RefreshCcw,
  SearchCheck,
} from "lucide-react"
import type { MemoryOpsSuggestionCategory } from "@/lib/memory-ops-ui"

export function MemoryOpsCategoryIcon({
  category,
}: {
  category: MemoryOpsSuggestionCategory
}) {
  const className = "h-3.5 w-3.5 shrink-0 text-muted-foreground"
  if (category === "lifecycle") return <RefreshCcw className={className} />
  if (category === "relation") return <GitBranch className={className} />
  if (category === "contradiction") return <AlertTriangle className={className} />
  if (category === "retention") return <Archive className={className} />
  if (category === "schema") return <ClipboardCheck className={className} />
  if (category === "quality") return <CheckCircle2 className={className} />
  if (category === "search-health") return <SearchCheck className={className} />
  return <CircleDot className={className} />
}
