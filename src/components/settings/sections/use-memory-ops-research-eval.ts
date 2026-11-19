import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import type { WikiProject } from "@/types/wiki"
import type { SearchApiConfig } from "@/stores/wiki-store"
import {
  runMemoryOpsPatrol,
  type MemoryOpsPatrolReport,
} from "@/lib/memory-ops"
import { runMemoryOpsEval } from "@/lib/memory-ops-eval"
import { BUILT_IN_MEMORY_OPS_EVAL_CASES } from "@/lib/memory-ops-eval-fixtures"
import {
  loadLatestMemoryOpsEvalReport,
  memoryOpsEvalLatestReportPath,
  saveMemoryOpsEvalReport,
  type SaveMemoryOpsEvalReportResult,
} from "@/lib/memory-ops-eval-store"
import type { MemoryOpsEvalReport } from "@/lib/memory-ops-eval-types"
import {
  enrichMemoryOpsSuggestionsWithResearch,
  selectMemoryOpsResearchCandidates,
  summarizeMemoryOpsResearchIntegration,
} from "@/lib/memory-ops-research-integration"
import { runMemoryOpsResearchEvidence } from "@/lib/memory-ops-research"
import {
  loadLatestMemoryOpsResearchReport,
  memoryOpsResearchLatestReportPath,
  saveMemoryOpsResearchReport,
  type SaveMemoryOpsResearchReportResult,
} from "@/lib/memory-ops-research-store"
import type { MemoryOpsResearchEvidenceReport } from "@/lib/memory-ops-research-types"

interface UseMemoryOpsResearchEvalOptions {
  project: WikiProject | null
  dataVersion: number
  searchApiConfig: SearchApiConfig
  patrolReport: MemoryOpsPatrolReport | null
  setPatrolReport: Dispatch<SetStateAction<MemoryOpsPatrolReport | null>>
  refreshRecentAudit: () => Promise<void>
  refreshMaintenanceStatus: () => Promise<void>
}

export function useMemoryOpsResearchEval({
  project,
  dataVersion,
  searchApiConfig,
  patrolReport,
  setPatrolReport,
  refreshRecentAudit,
  refreshMaintenanceStatus,
}: UseMemoryOpsResearchEvalOptions) {
  const [researchRunning, setResearchRunning] = useState(false)
  const [researchReport, setResearchReport] =
    useState<MemoryOpsResearchEvidenceReport | null>(null)
  const [researchSaveResult, setResearchSaveResult] =
    useState<SaveMemoryOpsResearchReportResult | null>(null)
  const [researchError, setResearchError] = useState<string | null>(null)
  const [evalRunning, setEvalRunning] = useState(false)
  const [evalReport, setEvalReport] = useState<MemoryOpsEvalReport | null>(null)
  const [evalSaveResult, setEvalSaveResult] =
    useState<SaveMemoryOpsEvalReportResult | null>(null)
  const [evalError, setEvalError] = useState<string | null>(null)

  const refreshLatestResearchReport = useCallback(async () => {
    if (!project) {
      setResearchReport(null)
      setResearchSaveResult(null)
      setResearchError(null)
      return
    }
    const latest = await loadLatestMemoryOpsResearchReport(project.path)
    const latestPath = memoryOpsResearchLatestReportPath(project.path)
    setResearchReport(latest)
    setResearchSaveResult(latest ? { path: latestPath, latestPath } : null)
  }, [project])

  useEffect(() => {
    void refreshLatestResearchReport()
  }, [refreshLatestResearchReport])

  const refreshLatestEvalReport = useCallback(async () => {
    if (!project) {
      setEvalReport(null)
      setEvalSaveResult(null)
      setEvalError(null)
      return
    }
    const latest = await loadLatestMemoryOpsEvalReport(project.path)
    setEvalReport(latest)
    setEvalSaveResult(latest ? { path: memoryOpsEvalLatestReportPath(project.path) } : null)
  }, [project])

  useEffect(() => {
    void refreshLatestEvalReport()
  }, [refreshLatestEvalReport])

  const ensureMemoryOpsPatrolReport = useCallback(async (): Promise<MemoryOpsPatrolReport | null> => {
    if (!project) return null
    if (patrolReport) return patrolReport
    const report = await runMemoryOpsPatrol(project.path, { dataVersion })
    setPatrolReport(report)
    await Promise.all([
      refreshMaintenanceStatus(),
      refreshRecentAudit(),
    ])
    return report
  }, [
    project,
    patrolReport,
    dataVersion,
    setPatrolReport,
    refreshMaintenanceStatus,
    refreshRecentAudit,
  ])

  const handleRunResearchEvidence = useCallback(async () => {
    if (!project) return
    setResearchRunning(true)
    setResearchError(null)
    setResearchSaveResult(null)
    try {
      const baseline = await ensureMemoryOpsPatrolReport()
      if (!baseline) return
      const candidates = selectMemoryOpsResearchCandidates(
        baseline.snapshot,
        baseline.suggestions,
      )
      const report = await runMemoryOpsResearchEvidence(project.path, candidates, {
        providers: ["local", "deep-research"],
        searchConfig: searchApiConfig,
        trigger: "manual",
        snapshot: baseline.snapshot,
        maxCandidates: baseline.snapshot.policy.research.maxCandidates,
        maxResultsPerProvider: baseline.snapshot.policy.research.maxEvidencePerCandidate,
      })
      const saveResult = await saveMemoryOpsResearchReport(project.path, report)
      const enrichedSuggestions = enrichMemoryOpsSuggestionsWithResearch(
        baseline.suggestions,
        report,
        baseline.snapshot,
      )
      const summary = summarizeMemoryOpsResearchIntegration(report, enrichedSuggestions)
      setResearchReport(report)
      setResearchSaveResult(saveResult)
      setPatrolReport({
        ...baseline,
        suggestions: enrichedSuggestions,
        stats: {
          ...baseline.stats,
          researchEvidenceCandidateCount: summary.candidateCount,
          researchEvidenceMatchedSuggestionCount: summary.matchedSuggestionCount,
          researchEvidenceItemCount: summary.evidenceCount,
          researchEvidenceWarningCount: summary.warningCount,
        },
      })
      await refreshRecentAudit()
    } catch (err) {
      setResearchError(err instanceof Error ? err.message : String(err))
    } finally {
      setResearchRunning(false)
    }
  }, [
    project,
    ensureMemoryOpsPatrolReport,
    searchApiConfig,
    setPatrolReport,
    refreshRecentAudit,
  ])

  const handleRunMemoryOpsEval = useCallback(async () => {
    if (!project) return
    setEvalRunning(true)
    setEvalError(null)
    setEvalSaveResult(null)
    try {
      const baseline = await ensureMemoryOpsPatrolReport()
      if (!baseline) return
      const evalCase = {
        id: "current-project-patrol",
        title: "Current project patrol regression",
        description: "Re-runs Memory Ops patrol and compares the suggestion set against the latest baseline.",
        expectedSuggestions: baseline.suggestions.map((suggestion) => ({
          id: suggestion.id,
          kind: suggestion.kind,
          targetPath: suggestion.targetPath,
        })),
      }
      let latestPatrol: MemoryOpsPatrolReport | null = null
      const report = await runMemoryOpsEval(project.path, {
        cases: [
          ...BUILT_IN_MEMORY_OPS_EVAL_CASES,
          evalCase,
        ],
        runner: async () => {
          latestPatrol = await runMemoryOpsPatrol(project.path, { dataVersion })
          return latestPatrol
        },
        variants: [{
          id: "current-policy",
          title: "Current project policy",
          policy: baseline.snapshot.policy,
        }],
      })
      const saveResult = await saveMemoryOpsEvalReport(project.path, report)
      if (latestPatrol) setPatrolReport(latestPatrol)
      setEvalReport(report)
      setEvalSaveResult(saveResult)
      await Promise.all([
        refreshMaintenanceStatus(),
        refreshRecentAudit(),
      ])
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : String(err))
    } finally {
      setEvalRunning(false)
    }
  }, [
    project,
    dataVersion,
    ensureMemoryOpsPatrolReport,
    setPatrolReport,
    refreshMaintenanceStatus,
    refreshRecentAudit,
  ])

  return {
    researchRunning,
    researchReport,
    researchSaveResult,
    researchError,
    evalRunning,
    evalReport,
    evalSaveResult,
    evalError,
    handleRunResearchEvidence,
    handleRunMemoryOpsEval,
  }
}
