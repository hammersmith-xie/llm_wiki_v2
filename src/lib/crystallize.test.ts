import { describe, expect, it, vi, beforeEach } from "vitest"
import { writeCrystallizedQueryPage } from "./crystallize"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async () => ""),
  writeFile: vi.fn(async () => {}),
  createDirectory: vi.fn(async () => {}),
}))

import { readFile, writeFile, createDirectory } from "@/commands/fs"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockCreateDirectory = vi.mocked(createDirectory)

beforeEach(() => {
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockCreateDirectory.mockReset()
})

describe("writeCrystallizedQueryPage", () => {
  it("writes lifecycle metadata, typed supports links, source refs, and an audit event", async () => {
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/wiki/sources/paper.md") {
        return "---\ntype: source\nsources: [paper.pdf]\n---\n\n# Paper"
      }
      if (path === "/project/.llm-wiki/audit.jsonl") return ""
      return ""
    })

    const result = await writeCrystallizedQueryPage({
      projectPath: "/project",
      filePath: "/project/wiki/queries/answer.md",
      title: "Answer",
      body: "# Answer\n\nContent",
      date: "2026-05-06",
      origin: "chat-save",
      tags: ["research"],
      references: [
        { title: "Attention", path: "/project/wiki/concepts/attention.md" },
        { title: "Paper", path: "/project/wiki/sources/paper.md" },
        { title: "Raw", path: "/project/raw/sources/raw-note.pdf" },
      ],
    })

    expect(result.relativePath).toBe("wiki/queries/answer.md")
    expect(result.supports).toEqual(["attention", "paper"])
    expect(result.sources).toEqual(["paper.pdf", "raw-note.pdf"])

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/wiki/queries/answer.md",
      expect.stringContaining("supports: [\"attention\", \"paper\"]"),
    )
    const pageContent = mockWriteFile.mock.calls[0][1]
    expect(pageContent).toContain("lifecycle: episodic")
    expect(pageContent).toContain('confidence: "')
    expect(pageContent).toContain('origin: "chat-save"')
    expect(pageContent).toContain('reinforcement_count: "2"')

    expect(mockCreateDirectory).toHaveBeenCalledWith("/project/.llm-wiki")
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      expect.stringContaining("\"action\":\"crystallize.query\""),
    )
  })
})
