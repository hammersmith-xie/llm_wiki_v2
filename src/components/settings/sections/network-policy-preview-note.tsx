import type { NetworkPolicyPreview } from "@/lib/network-policy-preview"

export function NetworkPolicyPreviewNote({ preview }: { preview: NetworkPolicyPreview }) {
  const className =
    preview.kind === "blocked"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : preview.kind === "cloud-allowed"
        ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300"
        : "border-border bg-muted/20 text-muted-foreground"
  return (
    <p className={`rounded-md border px-3 py-2 text-xs ${className}`}>
      {preview.message}
    </p>
  )
}
