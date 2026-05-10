import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LintResult } from "./lint"
import {
  clearPostIngestLintHints,
  INGEST_LINT_HINTS_PATH_REL,
  readPostIngestLintHints,
  writePostIngestLintHints,
} from "./ingest-lint-hints"

vi.mock("./lint", () => ({
  runStructuralLint: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  deleteFile: vi.fn(async () => {}),
  readFile: vi.fn(),
  writeFile: vi.fn(async () => {}),
}))

import { deleteFile, readFile, writeFile } from "@/commands/fs"
import { runStructuralLint } from "./lint"

const mockRunStructuralLint = vi.mocked(runStructuralLint)
const mockDeleteFile = vi.mocked(deleteFile)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-05-10T08:15:00.000Z"))
  mockRunStructuralLint.mockReset()
  mockDeleteFile.mockReset()
  mockDeleteFile.mockResolvedValue(undefined)
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockWriteFile.mockResolvedValue(undefined)
})

describe("ingest lint hints", () => {
  it("writes structural lint findings with ingest metadata", async () => {
    const hints = [lintResult({ type: "orphan", page: "concepts/alpha.md" })]
    mockRunStructuralLint.mockResolvedValue(hints)

    await writePostIngestLintHints("/project", "activity_1", "raw/paper.pdf")

    expect(mockRunStructuralLint).toHaveBeenCalledWith("/project")
    expect(mockWriteFile).toHaveBeenCalledWith(
      `/project/${INGEST_LINT_HINTS_PATH_REL}`,
      JSON.stringify(
        {
          ingestId: "activity_1",
          sourcePath: "raw/paper.pdf",
          timestamp: Date.parse("2026-05-10T08:15:00.000Z"),
          hints,
          totalCount: 1,
        },
        null,
        2,
      ),
    )
  })

  it("clears stale hints when structural lint returns no findings", async () => {
    mockRunStructuralLint.mockResolvedValue([])

    await writePostIngestLintHints("/project", "activity_2", "raw/clean.md")

    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockDeleteFile).toHaveBeenCalledWith(`/project/${INGEST_LINT_HINTS_PATH_REL}`)
  })

  it("reads persisted hints", async () => {
    const payload = {
      ingestId: "activity_3",
      sourcePath: "raw/source.md",
      timestamp: 1_777_777,
      hints: [lintResult({ type: "broken-link", page: "queries/q.md" })],
      totalCount: 1,
    }
    mockReadFile.mockResolvedValue(JSON.stringify(payload))

    await expect(readPostIngestLintHints("/project")).resolves.toEqual(payload)
    expect(mockReadFile).toHaveBeenCalledWith(`/project/${INGEST_LINT_HINTS_PATH_REL}`)
  })

  it("returns null when hints file is missing or malformed", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("missing"))
    await expect(readPostIngestLintHints("/project")).resolves.toBeNull()

    mockReadFile.mockResolvedValueOnce("{not-json")
    await expect(readPostIngestLintHints("/project")).resolves.toBeNull()
  })

  it("ignores missing file errors when clearing hints", async () => {
    mockDeleteFile.mockRejectedValueOnce(new Error("not found"))

    await expect(clearPostIngestLintHints("/project")).resolves.toBeUndefined()
  })
})

function lintResult(overrides: Partial<LintResult> = {}): LintResult {
  return {
    type: "orphan",
    severity: "info",
    page: "concepts/example.md",
    detail: "No other pages link to this page.",
    ...overrides,
  }
}
