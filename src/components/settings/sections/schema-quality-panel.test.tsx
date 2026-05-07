import "@/i18n"
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { SchemaQualityPanel } from "./schema-quality-panel"
import type { ProjectSchemaQualityScanResult } from "@/lib/schema-quality-project"

describe("SchemaQualityPanel", () => {
  it("renders scan summary and schema suggestions", () => {
    const html = renderToStaticMarkup(
      <SchemaQualityPanel
        projectReady
        running={false}
        error={null}
        result={scanResult()}
        ignoredSuggestionIds={new Set()}
        appliedSuggestionIds={new Set()}
        dryRunPlans={{}}
        suggestionErrors={{}}
        workingSuggestionId={null}
        selectedSuggestionIds={new Set()}
        batchWorking={false}
        lastBatchResult={null}
        onRun={vi.fn()}
        onToggleSelection={vi.fn()}
        onSelectCategory={vi.fn()}
        onClearSelection={vi.fn()}
        onBatchPreview={vi.fn()}
        onBatchApply={vi.fn()}
        onBatchIgnore={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onIgnore={vi.fn()}
        onOpen={vi.fn()}
      />,
    )

    expect(html).toContain("Schema &amp; Quality scan")
    expect(html).toContain("llm-wiki-v2-default v1")
    expect(html).toContain("Schema findings")
    expect(html).toContain("Fix missing title")
    expect(html).toContain("Schema &amp; quality suggestions")
  })
})

function scanResult(): ProjectSchemaQualityScanResult {
  return {
    auditError: undefined,
    suggestions: [
      {
        id: "schema-drift:missing-title",
        kind: "metadata-update",
        severity: "warning",
        targetPath: "wiki/concepts/a.md",
        title: "Fix missing title",
        detail: "Page is missing required title metadata.",
        reasons: ["schema drift finding"],
        proposedOperation: {
          kind: "metadata-patch",
          targetPath: "wiki/concepts/a.md",
          fields: { title: "A" },
          reason: "Schema drift repair: title",
        },
      },
    ],
    report: {
      contract: {
        version: 1,
        name: "llm-wiki-v2-default",
        pageTypes: [],
        frontmatterFields: [],
        relations: {
          graphSeedFields: [],
          genericRelationFields: [],
          typedRelationFields: [],
        },
        quality: {
          minQualityScore: 0.6,
          minConfidence: 0.5,
          minRelationCount: 1,
          requiredSections: [],
        },
        memoryOps: {
          sourceOfTruth: "markdown",
          auditPath: ".llm-wiki/audit.jsonl",
          requiresPreviewForMetadataPatch: true,
          privateScopeRedaction: true,
        },
      },
      contractWarnings: [],
      findings: [
        {
          id: "schema:missing-required-field:wiki/concepts/a.md:title",
          kind: "missing-required-field",
          severity: "warning",
          targetPath: "wiki/concepts/a.md",
          title: "Fix missing title",
          detail: "Page is missing required title metadata.",
          reasons: ["required by schema"],
          field: "title",
        },
      ],
      qualityScores: [
        {
          targetPath: "wiki/concepts/a.md",
          score: 0.42,
          dimensions: {
            structure: { dimension: "structure", score: 0.5, reasons: [] },
            citation: { dimension: "citation", score: 0.2, reasons: [] },
            relation: { dimension: "relation", score: 0.1, reasons: [] },
            retrieval: { dimension: "retrieval", score: 0.5, reasons: [] },
            governance: { dimension: "governance", score: 0.4, reasons: [] },
          },
          reasons: ["structure: short"],
        },
      ],
      summary: {
        pageCount: 1,
        contractName: "llm-wiki-v2-default",
        contractVersion: 1,
        schemaContractFound: true,
        findingCount: 1,
        warningCount: 1,
        infoCount: 0,
        averageQualityScore: 0.42,
        lowQualityPageCount: 1,
      },
    },
  }
}
