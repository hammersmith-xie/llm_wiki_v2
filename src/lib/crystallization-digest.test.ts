import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CrystallizationCandidate } from "./crystallize-candidates"
import {
  buildCrystallizationDigestPlan,
  recordCrystallizationDigestPreview,
  recordCrystallizationDigestSave,
  saveCrystallizationDigestPage,
} from "./crystallization-digest"

vi.mock("@/commands/fs", () => ({
  appendFile: vi.fn(async () => {}),
  createDirectory: vi.fn(async () => {}),
  readFile: vi.fn(async (path: string) => {
    if (path.endsWith("index.md")) return "# Wiki Index\n\n## Queries\n\n## Synthesis\n"
    if (path.endsWith("log.md")) return "# Wiki Log\n"
    return ""
  }),
  writeFile: vi.fn(async () => {}),
}))

vi.mock("@/lib/wiki-automation-events", () => ({
  recordWikiAutomationEvent: vi.fn(async (input) => ({
    action: input.type,
    auditEvent: { action: input.type },
  })),
}))

import { appendFile, readFile, writeFile } from "@/commands/fs"
import { recordWikiAutomationEvent } from "@/lib/wiki-automation-events"

const mockRecordWikiAutomationEvent = vi.mocked(recordWikiAutomationEvent)
const mockAppendFile = vi.mocked(appendFile)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

beforeEach(() => {
  mockAppendFile.mockReset()
  mockReadFile.mockReset()
  mockReadFile.mockImplementation(async (path: string) => {
    if (path.endsWith("index.md")) return "# Wiki Index\n\n## Queries\n\n## Synthesis\n"
    if (path.endsWith("log.md")) return "# Wiki Log\n"
    return ""
  })
  mockWriteFile.mockReset()
  mockRecordWikiAutomationEvent.mockReset()
  mockRecordWikiAutomationEvent.mockImplementation(async (input) => ({
    action: input.type,
    auditEvent: { action: input.type },
  }))
})

describe("crystallization digest planner", () => {
  it("does not create a digest for low-score or unreferenced content", () => {
    expect(buildCrystallizationDigestPlan({
      candidate: candidate({ score: 0.3 }),
    })).toBeNull()

    expect(buildCrystallizationDigestPlan({
      candidate: candidate({
        references: [],
        content: [
          "# Cache Notes",
          "",
          "Recommendation: preserve this answer because it explains several tradeoffs in enough detail.",
          "Takeaway: the idea is useful, but it has no explicit source or wiki reference.",
        ].join("\n"),
      }),
    })).toBeNull()
  })

  it("builds conservative lessons, decisions, entities, relations, and page candidates", () => {
    const plan = buildCrystallizationDigestPlan({
      candidate: candidate(),
    })

    expect(plan).not.toBeNull()
    expect(plan?.dedupeKey).toBe("digest:content:graph")
    expect(plan?.decisions.map((item) => item.statement)).toEqual([
      "keep graph expansion query-time because [[concepts/typed-graph|Typed Graph]] changes with every page write.",
      "Next step: use [[concepts/bm25-ranking|BM25 Ranking]] as a lexical baseline before graph expansion.",
    ])
    expect(plan?.lessons.map((item) => item.text)).toEqual([
      "hybrid search needs BM25, vector, and graph streams to remain separately auditable.",
    ])
    expect(plan?.entities.map((entity) => entity.targetSlug)).toEqual([
      "typed-graph",
      "bm25-ranking",
    ])
    expect(plan?.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "supports",
          source: "query-planner-tradeoffs",
          target: "typed-graph",
          targetPath: "wiki/concepts/typed-graph.md",
        }),
      ]),
    )
    expect(plan?.pageCandidates[0]).toMatchObject({
      type: "synthesis",
      targetPath: "wiki/synthesis/query-planner-tradeoffs.md",
    })
  })

  it("skips duplicate digest keys", () => {
    expect(buildCrystallizationDigestPlan({
      candidate: candidate(),
      existingDigestKeys: ["digest:content:graph"],
    })).toBeNull()
  })

  it("records preview events without maintenance dirty tracking", async () => {
    const plan = buildCrystallizationDigestPlan({ candidate: candidate() })
    expect(plan).not.toBeNull()

    await recordCrystallizationDigestPreview("/project", plan!)

    expect(mockRecordWikiAutomationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "digest.preview",
        projectPath: "/project",
        actor: "user",
        status: "dry-run",
        maintenance: false,
        summary: expect.objectContaining({
          dedupeKey: "digest:content:graph",
          sourceDedupeKey: "content:graph",
          sourceScore: 0.78,
          sourceReasons: ["2 explicit references", "contains decision signal"],
        }),
      }),
    )
  })

  it("records save events with dedupe key and target paths", async () => {
    const plan = buildCrystallizationDigestPlan({ candidate: candidate() })
    expect(plan).not.toBeNull()

    await recordCrystallizationDigestSave({
      projectPath: "/project",
      plan: plan!,
      targetPaths: ["wiki/queries/query-planner-tradeoffs.md"],
      appliedOperationCount: 2,
      skippedOperationCount: 1,
    })

    expect(mockRecordWikiAutomationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "digest.save",
        projectPath: "/project",
        actor: "user",
        targetPath: "wiki/queries/query-planner-tradeoffs.md",
        pagePath: "wiki/queries/query-planner-tradeoffs.md",
        status: "applied",
        summary: expect.objectContaining({
          dedupeKey: "digest:content:graph",
          targetPaths: [
            "wiki/queries/query-planner-tradeoffs.md",
            "wiki/synthesis/query-planner-tradeoffs.md",
          ],
          appliedOperationCount: 2,
          skippedOperationCount: 1,
        }),
      }),
    )
  })

  it("saves a digest page through the crystallized page writer", async () => {
    const plan = buildCrystallizationDigestPlan({ candidate: candidate() })
    expect(plan).not.toBeNull()

    const result = await saveCrystallizationDigestPage({
      projectPath: "/project",
      candidate: candidate(),
      plan: plan!,
      now: new Date("2026-05-07T12:34:56.000Z"),
    })

    expect(result.relativePath).toBe(
      "wiki/synthesis/query-planner-tradeoffs-2026-05-07-123456.md",
    )
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/wiki/synthesis/query-planner-tradeoffs-2026-05-07-123456.md",
      expect.stringContaining("type: synthesis"),
    )
    const pageWrite = mockWriteFile.mock.calls.find(([path]) =>
      String(path).includes("/wiki/synthesis/query-planner-tradeoffs"),
    )
    expect(pageWrite?.[1]).toContain("## Decisions")
    expect(pageWrite?.[1]).toContain("<!-- claim:")
    expect(pageWrite?.[1]).toContain("## Relation Candidates")
    const claimCall = mockAppendFile.mock.calls.find(([path]) => path === "/project/.llm-wiki/claims.jsonl")
    expect(claimCall?.[1]).toContain("keep graph expansion query-time")
    expect(result.claimWrite).toMatchObject({ claimCount: 3 })
    expect(mockRecordWikiAutomationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "digest.save",
        targetPath: "wiki/synthesis/query-planner-tradeoffs-2026-05-07-123456.md",
        summary: expect.objectContaining({
          appliedOperationCount: 1,
          skippedOperationCount: 2,
        }),
      }),
    )
  })
})

function candidate(
  overrides: Partial<CrystallizationCandidate> = {},
): CrystallizationCandidate {
  return {
    id: "crystallize:chat:m-1",
    origin: "chat",
    sourceId: "m-1",
    title: "Query Planner Tradeoffs",
    content: [
      "# Query Planner Tradeoffs",
      "",
      "Decision: keep graph expansion query-time because [[concepts/typed-graph|Typed Graph]] changes with every page write.",
      "Takeaway: hybrid search needs BM25, vector, and graph streams to remain separately auditable.",
      "",
      "- Next step: use [[concepts/bm25-ranking|BM25 Ranking]] as a lexical baseline before graph expansion.",
    ].join("\n"),
    score: 0.78,
    reasons: ["2 explicit references", "contains decision signal"],
    references: [
      { title: "Typed Graph", path: "wiki/concepts/typed-graph.md" },
      { title: "BM25 Ranking", path: "wiki/concepts/bm25-ranking.md" },
    ],
    tags: ["chat"],
    dedupeKey: "content:graph",
    timestamp: 1,
    ...overrides,
  }
}
