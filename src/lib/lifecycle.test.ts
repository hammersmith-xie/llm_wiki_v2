import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  appendLifecycleAuditEvent,
  calculateLifecycleMetadata,
  enrichLifecycleFrontmatter,
  lifecycleLintIssues,
} from "./lifecycle"

vi.mock("@/commands/fs", () => ({
  appendFile: vi.fn(async () => {}),
  createDirectory: vi.fn(async () => {}),
  readFile: vi.fn(async () => ""),
  writeFile: vi.fn(async () => {}),
}))

import { appendFile, createDirectory, readFile, writeFile } from "@/commands/fs"

const mockAppendFile = vi.mocked(appendFile)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

beforeEach(() => {
  mockAppendFile.mockClear()
  mockCreateDirectory.mockClear()
  mockReadFile.mockClear()
  mockWriteFile.mockClear()
})

describe("lifecycle metadata", () => {
  it("increases confidence for sources and reinforcement", () => {
    const weak = calculateLifecycleMetadata({
      type: "concept",
      sources: [],
      today: "2026-05-06",
      lastConfirmed: "2026-05-06",
    })
    const strong = calculateLifecycleMetadata({
      type: "concept",
      sources: ["a.md", "b.md"],
      reinforcementCount: 5,
      today: "2026-05-06",
      lastConfirmed: "2026-05-06",
    })

    expect(strong.confidence).toBeGreaterThan(weak.confidence)
    expect(strong.confidenceReasons.join(" ")).toContain("2 supporting sources")
    expect(strong.reviewStatus).toBe("ok")
  })

  it("decreases confidence and flags superseded pages", () => {
    const meta = calculateLifecycleMetadata({
      type: "concept",
      sources: ["old.md"],
      supersededBy: ["new-page"],
      today: "2026-05-06",
      lastConfirmed: "2025-01-01",
    })

    expect(meta.reviewStatus).toBe("stale")
    expect(meta.confidence).toBeLessThan(0.5)
    expect(meta.confidenceReasons.join(" ")).toContain("superseded")
  })

  it("normalizes review status before applying contradiction penalties", () => {
    const ok = calculateLifecycleMetadata({
      type: "concept",
      sources: ["a.md"],
      today: "2026-05-06",
      lastConfirmed: "2026-05-06",
      reviewStatus: "ok",
    })
    const contradicted = calculateLifecycleMetadata({
      type: "concept",
      sources: ["a.md"],
      today: "2026-05-06",
      lastConfirmed: "2026-05-06",
      reviewStatus: "Contradicted",
    })

    expect(contradicted.reviewStatus).toBe("contradicted")
    expect(contradicted.confidence).toBeLessThan(ok.confidence)
    expect(contradicted.confidenceReasons).toContain("contradiction signal present")
  })

  it("enriches legacy frontmatter without dropping existing fields", () => {
    const input = [
      "---",
      "type: concept",
      "title: Attention",
      "created: 2026-01-01",
      "updated: 2026-01-02",
      "tags: [ml]",
      "sources: [paper.md]",
      "---",
      "",
      "# Attention",
      "",
      "Body.",
    ].join("\n")

    const out = enrichLifecycleFrontmatter(input, { today: "2026-05-06" })

    expect(out.changed).toBe(true)
    expect(out.content).toContain("title: Attention")
    expect(out.content).toContain("tags: [ml]")
    expect(out.content).toContain("lifecycle: semantic")
    expect(out.content).toContain('confidence: "')
    expect(out.content).toContain('reinforcement_count: "0"')
    expect(out.content).toContain('quality_score: "')
    expect(out.content).toContain("review_status:")
  })

  it("surfaces deterministic lifecycle lint issues", () => {
    const content = [
      "---",
      "type: concept",
      "title: Old Claim",
      "sources: []",
      "last_confirmed: 2025-01-01",
      "superseded_by: [new-claim]",
      "---",
      "",
      "# Old Claim",
    ].join("\n")

    const issues = lifecycleLintIssues(content, { today: "2026-05-06" })

    expect(issues.map((i) => i.kind)).toContain("superseded")
    expect(issues.some((i) => i.severity === "warning")).toBe(true)
  })

  it("appends audit events as jsonl", async () => {
    mockReadFile.mockResolvedValueOnce("{\"old\":true}\n")

    await appendLifecycleAuditEvent("/project", {
      timestamp: "2026-05-06T00:00:00.000Z",
      action: "lifecycle.enrich",
      pagePath: "wiki/concepts/a.md",
      reasons: ["test"],
    })

    expect(mockCreateDirectory).toHaveBeenCalledWith("/project/.llm-wiki")
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      expect.stringContaining("\"action\":\"lifecycle.enrich\""),
    )
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})
