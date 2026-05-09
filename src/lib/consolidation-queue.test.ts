import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  addDigestPlanToConsolidationQueue,
  consolidationQueuePath,
  queueItemFromDigestPlan,
  readConsolidationQueue,
  updateConsolidationQueueStatus,
} from "./consolidation-queue"
import type { CrystallizationDigestPlan } from "./crystallization-digest"

vi.mock("@/commands/fs", () => ({
  appendFile: vi.fn(async () => {}),
  createDirectory: vi.fn(async () => {}),
  readFile: vi.fn(),
  writeFile: vi.fn(async () => {}),
}))

import { appendFile, createDirectory, readFile, writeFile } from "@/commands/fs"

const mockAppendFile = vi.mocked(appendFile)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

beforeEach(() => {
  mockAppendFile.mockReset()
  mockCreateDirectory.mockReset()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
})

describe("consolidation queue", () => {
  it("creates stable review queue items from digest plans without source body text", () => {
    const item = queueItemFromDigestPlan(plan(), "2026-05-09T00:00:00.000Z")

    expect(item).toMatchObject({
      id: expect.stringMatching(/^cq_/),
      status: "queued",
      dedupeKey: "digest:graph",
      sourceId: "a-1",
      sourceOrigin: "chat",
      sourceTitle: "Graph Search Decision",
      targetPaths: ["wiki/synthesis/graph-search-decision.md"],
      counts: {
        lessonCount: 1,
        decisionCount: 1,
        entityCount: 2,
        relationCount: 2,
        pageCandidateCount: 1,
      },
    })
    expect(JSON.stringify(item)).not.toContain("full assistant answer")
  })

  it("adds a new digest plan, writes the queue, and audits the addition", async () => {
    mockReadFile.mockRejectedValue(new Error("missing"))

    const result = await addDigestPlanToConsolidationQueue({
      projectPath: "/project",
      plan: plan(),
      now: new Date("2026-05-09T00:00:00.000Z"),
    })

    expect(result.added).toBe(true)
    expect(mockCreateDirectory).toHaveBeenCalledWith("/project/.llm-wiki")
    expect(mockWriteFile).toHaveBeenCalledWith(
      consolidationQueuePath("/project"),
      expect.stringContaining("\"version\": 1"),
    )
    expect(mockWriteFile).toHaveBeenCalledWith(
      consolidationQueuePath("/project"),
      expect.stringContaining("\"dedupeKey\": \"digest:graph\""),
    )
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      expect.stringContaining("\"action\":\"consolidation.queue.add\""),
    )
  })

  it("dedupes existing digest keys", async () => {
    const existing = queueItemFromDigestPlan(plan(), "2026-05-09T00:00:00.000Z")
    mockReadFile.mockResolvedValue(JSON.stringify({ version: 1, items: [existing] }))

    const result = await addDigestPlanToConsolidationQueue({
      projectPath: "/project",
      plan: plan(),
    })

    expect(result.added).toBe(false)
    expect(result.item).toEqual(existing)
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockAppendFile).not.toHaveBeenCalled()
  })

  it("updates queue item status and audits the change", async () => {
    const existing = queueItemFromDigestPlan(plan(), "2026-05-09T00:00:00.000Z")
    mockReadFile.mockResolvedValue(JSON.stringify({ version: 1, items: [existing] }))

    const updated = await updateConsolidationQueueStatus({
      projectPath: "/project",
      id: existing.id,
      status: "applied",
      appliedTargetPaths: ["wiki/synthesis/graph-search-decision.md"],
      now: new Date("2026-05-09T01:00:00.000Z"),
    })

    expect(updated).toMatchObject({
      id: existing.id,
      status: "applied",
      appliedTargetPaths: ["wiki/synthesis/graph-search-decision.md"],
    })
    expect(mockWriteFile).toHaveBeenCalledWith(
      consolidationQueuePath("/project"),
      expect.stringContaining("\"status\": \"applied\""),
    )
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      expect.stringContaining("\"action\":\"consolidation.queue.status\""),
    )
  })

  it("normalizes legacy array-shaped queues", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify([{
      dedupeKey: "digest:legacy",
      sourceId: "legacy-1",
      targetPaths: ["wiki\\queries\\legacy.md"],
      counts: { decisionCount: 1 },
    }]))

    const result = await readConsolidationQueue("/project")

    expect(result.warnings).toEqual([])
    expect(result.items[0]).toMatchObject({
      dedupeKey: "digest:legacy",
      sourceId: "legacy-1",
      targetPaths: ["wiki/queries/legacy.md"],
      counts: expect.objectContaining({ decisionCount: 1 }),
    })
  })
})

function plan(): CrystallizationDigestPlan {
  return {
    id: "digest:chat:a-1",
    dedupeKey: "digest:graph",
    source: {
      origin: "chat",
      sourceId: "a-1",
      title: "Graph Search Decision",
      score: 0.82,
      reasons: ["substantial answer length", "2 explicit references"],
      dedupeKey: "content:graph",
    },
    lessons: [{ id: "lesson-1", text: "Keep streams auditable.", evidencePaths: [] }],
    decisions: [{ id: "decision-1", statement: "Use query-time graph expansion.", evidencePaths: [] }],
    entities: [],
    relations: [],
    pageCandidates: [{
      id: "page-synthesis",
      type: "synthesis",
      title: "Graph Search Decision",
      targetPath: "wiki/synthesis/graph-search-decision.md",
      tags: ["synthesis", "digest"],
      reasons: ["high-scoring output spans multiple references"],
    }],
    summary: {
      lessonCount: 1,
      decisionCount: 1,
      entityCount: 2,
      relationCount: 2,
      pageCandidateCount: 1,
    },
    warnings: [],
  }
}
