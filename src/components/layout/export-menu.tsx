import { useState } from "react"
import { save } from "@tauri-apps/plugin-dialog"
import { Download } from "lucide-react"
import { writeFile } from "@/commands/fs"
import { pageToMarp } from "@/lib/marp-export"
import { extractFirstTableAsCsv, hasDominantMarkdownTable } from "@/lib/table-export"
import { getFileName } from "@/lib/path-utils"
import type { WikiPage } from "@/types/wiki"

export function ExportMenu({ page }: { page: WikiPage }) {
  const [open, setOpen] = useState(false)
  const canExportCsv = hasDominantMarkdownTable(page.content)

  return (
    <ExportMenuView
      canExportCsv={canExportCsv}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      onExportMarp={() => {
        void exportMarkdownPageAsMarp(page).finally(() => setOpen(false))
      }}
      onExportCsv={() => {
        void exportMarkdownPageAsCsv(page).finally(() => setOpen(false))
      }}
    />
  )
}

export function ExportMenuView({
  canExportCsv,
  open,
  onToggle,
  onExportMarp,
  onExportCsv,
}: {
  canExportCsv: boolean
  open: boolean
  onToggle: () => void
  onExportMarp: () => void
  onExportCsv: () => void
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="rounded p-1 text-muted-foreground hover:bg-accent"
        title="Export"
        aria-label="Export"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border bg-popover py-1 text-sm shadow-md">
          <button
            type="button"
            className="w-full px-3 py-2 text-left hover:bg-muted"
            onClick={onExportMarp}
          >
            Export as Marp
          </button>
          <button
            type="button"
            className="w-full px-3 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canExportCsv}
            onClick={onExportCsv}
          >
            Export table as CSV
          </button>
        </div>
      )}
    </div>
  )
}

export async function exportMarkdownPageAsMarp(page: WikiPage): Promise<void> {
  const targetPath = await save({
    defaultPath: `${fileStem(page.path)}.marp.md`,
    filters: [{ name: "Marp Markdown", extensions: ["md"] }],
  })
  if (!targetPath) return

  await writeFile(targetPath, pageToMarp(page))
}

export async function exportMarkdownPageAsCsv(page: WikiPage): Promise<void> {
  const csv = extractFirstTableAsCsv(page.content)
  if (!csv) return

  const targetPath = await save({
    defaultPath: `${fileStem(page.path)}.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  })
  if (!targetPath) return

  await writeFile(targetPath, csv)
}

function fileStem(path: string): string {
  return getFileName(path).replace(/\.md$/i, "") || "export"
}
