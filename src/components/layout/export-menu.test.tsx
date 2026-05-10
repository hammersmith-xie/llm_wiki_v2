import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import {
  ExportMenuView,
  exportMarkdownPageAsCsv,
  exportMarkdownPageAsMarp,
} from "./export-menu"

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  writeFile: vi.fn(async () => {}),
}))

import { save } from "@tauri-apps/plugin-dialog"
import { writeFile } from "@/commands/fs"

const mockSave = vi.mocked(save)
const mockWriteFile = vi.mocked(writeFile)

describe("ExportMenu", () => {
  it("renders Marp and CSV export actions with CSV disabled for non-table pages", () => {
    const html = renderToStaticMarkup(
      <ExportMenuView
        canExportCsv={false}
        open
        onToggle={vi.fn()}
        onExportMarp={vi.fn()}
        onExportCsv={vi.fn()}
      />,
    )

    expect(html).toContain("Export")
    expect(html).toContain("Export as Marp")
    expect(html).toContain("Export table as CSV")
    expect(html).toContain("disabled")
  })

  it("does not write a file when the save dialog is cancelled", async () => {
    mockSave.mockResolvedValueOnce(null)

    await exportMarkdownPageAsMarp({
      path: "/project/wiki/queries/example.md",
      content: "# Example",
      frontmatter: {},
    })

    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it("writes Marp markdown to the selected local path", async () => {
    mockSave.mockResolvedValueOnce("/tmp/example.marp.md")

    await exportMarkdownPageAsMarp({
      path: "/project/wiki/queries/example.md",
      content: "---\ntitle: Demo\n---\n\n# Demo",
      frontmatter: {},
    })

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "example.marp.md",
      }),
    )
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/example.marp.md",
      expect.stringContaining("marp: true"),
    )
  })

  it("writes CSV only when the page contains a valid table", async () => {
    mockSave.mockResolvedValueOnce("/tmp/table.csv")

    await exportMarkdownPageAsCsv({
      path: "/project/wiki/queries/table.md",
      content: "| A | B |\n| --- | --- |\n| x | y |",
      frontmatter: {},
    })

    expect(mockWriteFile).toHaveBeenCalledWith("/tmp/table.csv", "A,B\nx,y")

    mockWriteFile.mockClear()
    await exportMarkdownPageAsCsv({
      path: "/project/wiki/queries/plain.md",
      content: "# Plain",
      frontmatter: {},
    })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})
