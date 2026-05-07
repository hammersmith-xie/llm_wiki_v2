import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Wrench,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Trash2,
  RotateCcw,
  Clock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { readFile, listDirectory } from "@/commands/fs"
import { useWikiStore } from "@/stores/wiki-store"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import {
  appendAuditEvent,
  readAuditTimeline,
  type AuditEvent,
  type AuditTimelineWarning,
} from "@/lib/audit-timeline"
import { runDuplicateDetection } from "@/lib/dedup-runner"
import { addNotDuplicate } from "@/lib/dedup-storage"
import {
  applyMemoryOpsOperations,
  buildMemoryOpsPatchAuditEvent,
  createMetadataPatchPlan,
  resolveMemoryOpsTargetPath,
  type ApplyOperationResult,
  type MetadataPatchOperation,
  type MetadataPatchPlan,
} from "@/lib/memory-ops-executor"
import {
  applyMemoryOpsBatch,
  ignoreMemoryOpsBatch,
  previewMemoryOpsBatch,
  type MemoryOpsBatchItem,
  type MemoryOpsBatchResult,
} from "@/lib/memory-ops-batch"
import {
  applyMemoryOpsRollback,
  previewMemoryOpsRollback,
  type MemoryOpsRollbackPreview,
  type MemoryOpsRollbackResult,
} from "@/lib/memory-ops-rollback"
import {
  DEFAULT_MEMORY_OPS_POLICY,
  loadMemoryOpsPolicy,
  saveMemoryOpsPolicy,
  type MemoryOpsPolicy,
} from "@/lib/memory-ops-policy"
import {
  buildBuiltInSearchHealthScenarios,
  runSearchHealth,
  type SearchHealthRunResult,
} from "@/lib/search-health"
import {
  getMemoryOpsMaintenanceStatus,
  runMemoryOpsPatrol,
  type MemoryOpsMaintenanceStatus,
  type MemoryOpsPatrolReport,
} from "@/lib/memory-ops"
import type { MemoryOpsSuggestion } from "@/lib/memory-ops-rules"
import { selectRecentAuditEvents } from "@/lib/memory-ops-ui"
import { AuditTimelinePanel } from "./audit-timeline-panel"
import { MemoryOpsPolicyPanel } from "./memory-ops-policy-panel"
import { MemoryOpsPatrolBlock } from "./memory-ops-patrol-block"
import { SearchHealthPanel } from "./search-health-panel"
import {
  enqueueMerge,
  cancelTask,
  retryTask,
  getQueue,
  groupKey,
  type DedupTask,
} from "@/lib/dedup-queue"
import type { DuplicateGroup } from "@/lib/dedup"

interface GroupUiEntry {
  group: DuplicateGroup
  canonicalSlug: string
  /** Becomes true when the user marks the group as "not duplicates"
   *  in this session — the card transitions to skipped state. */
  skipped: boolean
}

type MaintenanceWorkbenchTab = "patrol" | "timeline" | "policy" | "search"

/** Match a card to its task in the queue (if any) by slug-set. */
function findTaskForGroup(
  tasks: readonly DedupTask[],
  slugs: readonly string[],
): DedupTask | undefined {
  const key = groupKey(slugs)
  return tasks.find((t) => groupKey(t.group.slugs) === key)
}

export function MaintenanceSection() {
  const { t } = useTranslation()
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)

  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [groups, setGroups] = useState<GroupUiEntry[]>([])
  const [scanCompleted, setScanCompleted] = useState(false)
  const [patrolRunning, setPatrolRunning] = useState(false)
  const [patrolError, setPatrolError] = useState<string | null>(null)
  const [patrolReport, setPatrolReport] = useState<MemoryOpsPatrolReport | null>(null)
  const [maintenanceStatus, setMaintenanceStatus] = useState<MemoryOpsMaintenanceStatus | null>(null)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [auditWarnings, setAuditWarnings] = useState<AuditTimelineWarning[]>([])
  const [auditOpenError, setAuditOpenError] = useState<string | null>(null)
  const [recentAuditEvents, setRecentAuditEvents] = useState<AuditEvent[]>([])
  const [policy, setPolicy] = useState<MemoryOpsPolicy>(DEFAULT_MEMORY_OPS_POLICY)
  const [policyWarnings, setPolicyWarnings] = useState<string[]>([])
  const [policySaving, setPolicySaving] = useState(false)
  const [policyError, setPolicyError] = useState<string | null>(null)
  const [policySaved, setPolicySaved] = useState(false)
  const [searchHealthRunning, setSearchHealthRunning] = useState(false)
  const [searchHealthResult, setSearchHealthResult] =
    useState<SearchHealthRunResult | null>(null)
  const [searchHealthError, setSearchHealthError] = useState<string | null>(null)
  const [workbenchTab, setWorkbenchTab] = useState<MaintenanceWorkbenchTab>("patrol")
  const [ignoredSuggestionIds, setIgnoredSuggestionIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [appliedSuggestionIds, setAppliedSuggestionIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [dryRunPlans, setDryRunPlans] = useState<Record<string, MetadataPatchPlan>>({})
  const [suggestionErrors, setSuggestionErrors] = useState<Record<string, string>>({})
  const [workingSuggestionId, setWorkingSuggestionId] = useState<string | null>(null)
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [batchWorking, setBatchWorking] = useState(false)
  const [lastBatchResult, setLastBatchResult] = useState<MemoryOpsBatchResult | null>(null)
  const [rollbackPreviews, setRollbackPreviews] = useState<
    Record<string, MemoryOpsRollbackPreview>
  >({})
  const [rollbackResults, setRollbackResults] = useState<
    Record<string, MemoryOpsRollbackResult>
  >({})
  const [rollbackErrors, setRollbackErrors] = useState<Record<string, string>>({})
  const [workingRollbackId, setWorkingRollbackId] = useState<string | null>(null)

  // Poll the queue at 1Hz so the UI reflects pending → processing →
  // failed transitions and cross-window queue activity (e.g. a merge
  // that completed while the user was on a different settings tab).
  // Same pattern activity-panel uses for ingest-queue.
  const [tasks, setTasks] = useState<readonly DedupTask[]>([])
  useEffect(() => {
    setTasks([...getQueue()])
    const id = setInterval(() => setTasks([...getQueue()]), 1000)
    return () => clearInterval(id)
  }, [])

  const llmReady = hasUsableLlm(llmConfig)
  const projectReady = !!project

  const refreshRecentAudit = useCallback(async () => {
    if (!project) {
      setAuditEvents([])
      setAuditWarnings([])
      setAuditOpenError(null)
      setRecentAuditEvents([])
      return
    }
    const audit = await readAuditTimeline(project.path)
    setAuditEvents(audit.events)
    setAuditWarnings(audit.warnings)
    setAuditOpenError(null)
    setRecentAuditEvents(selectRecentAuditEvents(audit.events, 3))
  }, [project])

  useEffect(() => {
    void refreshRecentAudit()
  }, [refreshRecentAudit, dataVersion])

  const refreshMaintenanceStatus = useCallback(async () => {
    if (!project) {
      setMaintenanceStatus(null)
      return
    }
    setMaintenanceStatus(await getMemoryOpsMaintenanceStatus(project.path))
  }, [project])

  useEffect(() => {
    void refreshMaintenanceStatus()
  }, [refreshMaintenanceStatus, dataVersion])

  const refreshMemoryOpsPolicy = useCallback(async () => {
    if (!project) {
      setPolicy(DEFAULT_MEMORY_OPS_POLICY)
      setPolicyWarnings([])
      setPolicyError(null)
      setPolicySaved(false)
      return
    }
    const result = await loadMemoryOpsPolicy(project.path)
    setPolicy(result.policy)
    setPolicyWarnings(result.warnings)
  }, [project])

  useEffect(() => {
    void refreshMemoryOpsPolicy()
  }, [refreshMemoryOpsPolicy])

  const handlePatrol = useCallback(async () => {
    if (!project) return
    setPatrolRunning(true)
    setPatrolError(null)
    setPatrolReport(null)
    setIgnoredSuggestionIds(new Set())
    setAppliedSuggestionIds(new Set())
    setDryRunPlans({})
    setSuggestionErrors({})
    setSelectedSuggestionIds(new Set())
    setLastBatchResult(null)
    setRollbackPreviews({})
    setRollbackResults({})
    setRollbackErrors({})
    setWorkingRollbackId(null)
    try {
      const report = await runMemoryOpsPatrol(project.path, { dataVersion })
      setPatrolReport(report)
      await refreshMaintenanceStatus()
      await refreshRecentAudit()
    } catch (err) {
      setPatrolError(err instanceof Error ? err.message : String(err))
    } finally {
      setPatrolRunning(false)
    }
  }, [project, dataVersion, refreshMaintenanceStatus, refreshRecentAudit])

  const runPatrolAfterPolicyChange = useCallback(async () => {
    if (!project) return
    setPatrolRunning(true)
    setPatrolError(null)
    setIgnoredSuggestionIds(new Set())
    setAppliedSuggestionIds(new Set())
    setDryRunPlans({})
    setSuggestionErrors({})
    setSelectedSuggestionIds(new Set())
    setLastBatchResult(null)
    setRollbackPreviews({})
    setRollbackResults({})
    setRollbackErrors({})
    setWorkingRollbackId(null)
    try {
      const report = await runMemoryOpsPatrol(project.path, { dataVersion })
      setPatrolReport(report)
      await refreshMaintenanceStatus()
      await refreshRecentAudit()
    } catch (err) {
      setPatrolError(err instanceof Error ? err.message : String(err))
    } finally {
      setPatrolRunning(false)
    }
  }, [project, dataVersion, refreshMaintenanceStatus, refreshRecentAudit])

  const handleSavePolicy = useCallback(
    async (nextPolicy: MemoryOpsPolicy) => {
      if (!project) return
      setPolicySaving(true)
      setPolicyError(null)
      setPolicySaved(false)
      try {
        await saveMemoryOpsPolicy(project.path, nextPolicy)
        await appendAuditEvent(project.path, {
          action: "memory_ops.policy_update",
          actor: "user",
          targetPath: ".llm-wiki/memory-ops-policy",
          changes: { status: "applied" },
          after: {
            version: nextPolicy.version,
            name: nextPolicy.name,
            halfLives: nextPolicy.halfLives,
            staleMultiplier: nextPolicy.staleMultiplier,
            lowConfidenceThreshold: nextPolicy.lowConfidenceThreshold,
            promotion: nextPolicy.promotion,
            archive: nextPolicy.archive,
          },
          reasons: ["Memory Ops lifecycle policy updated"],
        })
        .catch((err) => {
          setPolicyError(
            t("settings.sections.maintenance.policy.auditError", {
              error: err instanceof Error ? err.message : String(err),
            }),
          )
        })
        await refreshMemoryOpsPolicy()
        setPolicySaved(true)
        await runPatrolAfterPolicyChange()
      } catch (err) {
        setPolicyError(err instanceof Error ? err.message : String(err))
      } finally {
        setPolicySaving(false)
      }
    },
    [project, refreshMemoryOpsPolicy, runPatrolAfterPolicyChange],
  )

  const handleRestoreDefaultPolicy = useCallback(async () => {
    await handleSavePolicy(DEFAULT_MEMORY_OPS_POLICY)
  }, [handleSavePolicy])

  const handlePreviewSuggestion = useCallback(
    async (suggestion: MemoryOpsSuggestion) => {
      if (!project || !suggestion.proposedOperation) return
      setWorkingSuggestionId(suggestion.id)
      setSuggestionErrors((prev) => withoutKey(prev, suggestion.id))
      try {
        const operation = suggestion.proposedOperation
        const content = await readFile(
          resolveMemoryOpsTargetPath(project.path, operation.targetPath),
        )
        const plan = createMetadataPatchPlan({
          targetPath: operation.targetPath,
          content,
          fields: operation.fields,
          reason: operation.reason,
        })
        setDryRunPlans((prev) => ({ ...prev, [suggestion.id]: plan }))
        await appendAuditEvent(project.path, buildMemoryOpsPatchAuditEvent({
          action: "memory_ops.preview",
          operation,
          suggestionId: suggestion.id,
          suggestionTitle: suggestion.title,
          reasons: suggestion.reasons,
          plan,
        })).catch((err) => {
          console.warn(
            `[Memory Ops] preview audit failed: ${err instanceof Error ? err.message : err}`,
          )
        })
      } catch (err) {
        setSuggestionErrors((prev) => ({
          ...prev,
          [suggestion.id]: err instanceof Error ? err.message : String(err),
        }))
      } finally {
        setWorkingSuggestionId(null)
      }
    },
    [project],
  )

  const handleApplySuggestion = useCallback(
    async (suggestion: MemoryOpsSuggestion) => {
      if (!project || !suggestion.proposedOperation) return
      setWorkingSuggestionId(suggestion.id)
      setSuggestionErrors((prev) => withoutKey(prev, suggestion.id))
      try {
        const result = await applyMemoryOpsOperations(project.path, [suggestion.proposedOperation])
        const first = result.results[0]
        await appendAuditEvent(project.path, buildMemoryOpsPatchAuditEvent({
          action: "memory_ops.apply",
          operation: suggestion.proposedOperation,
          suggestionId: suggestion.id,
          suggestionTitle: suggestion.title,
          reasons: suggestion.reasons,
          result: first,
        })).catch((err) => {
          console.warn(
            `[Memory Ops] apply audit failed: ${err instanceof Error ? err.message : err}`,
          )
        })
        if (!first || first.status === "error") {
          throw new Error(first?.error ?? "Memory Ops operation failed")
        }

        setLastBatchResult(buildSingleApplyBatchResult(
          suggestion,
          suggestion.proposedOperation,
          first,
        ))
        setRollbackPreviews({})
        setRollbackResults({})
        setRollbackErrors({})
        const tree = await listDirectory(project.path)
        setFileTree(tree)
        bumpDataVersion()
        setAppliedSuggestionIds((prev) => new Set(prev).add(suggestion.id))
        setSelectedSuggestionIds((prev) => withoutSetValue(prev, suggestion.id))
        await refreshRecentAudit()
      } catch (err) {
        setSuggestionErrors((prev) => ({
          ...prev,
          [suggestion.id]: err instanceof Error ? err.message : String(err),
        }))
      } finally {
        setWorkingSuggestionId(null)
      }
    },
    [project, setFileTree, bumpDataVersion, refreshRecentAudit],
  )

  const handleIgnoreSuggestion = useCallback(
    async (suggestion: MemoryOpsSuggestion) => {
      if (!project) return
      setIgnoredSuggestionIds((prev) => new Set(prev).add(suggestion.id))
      setSelectedSuggestionIds((prev) => withoutSetValue(prev, suggestion.id))
      await appendAuditEvent(project.path, {
        action: "memory_ops.ignore",
        targetPath: suggestion.targetPath,
        after: {
          suggestionId: suggestion.id,
          kind: suggestion.kind,
          title: suggestion.title,
        },
        reasons: suggestion.reasons,
      }).catch((err) => {
        console.warn(
          `[Memory Ops] ignore audit failed: ${err instanceof Error ? err.message : err}`,
        )
      })
      await refreshRecentAudit()
    },
    [project, refreshRecentAudit],
  )

  const selectedMemoryOpsSuggestions = useCallback((): MemoryOpsSuggestion[] => {
    if (!patrolReport) return []
    return patrolReport.suggestions.filter((suggestion) =>
      selectedSuggestionIds.has(suggestion.id),
    )
  }, [patrolReport, selectedSuggestionIds])

  const handleToggleSuggestionSelection = useCallback((suggestion: MemoryOpsSuggestion) => {
    setSelectedSuggestionIds((prev) => {
      const next = new Set(prev)
      if (next.has(suggestion.id)) next.delete(suggestion.id)
      else next.add(suggestion.id)
      return next
    })
  }, [])

  const handleSelectSuggestionCategory = useCallback((suggestions: MemoryOpsSuggestion[]) => {
    setSelectedSuggestionIds((prev) => {
      const next = new Set(prev)
      for (const suggestion of suggestions) next.add(suggestion.id)
      return next
    })
  }, [])

  const handleClearSuggestionSelection = useCallback(() => {
    setSelectedSuggestionIds(new Set())
  }, [])

  const handleBatchPreview = useCallback(async () => {
    if (!project) return
    const suggestions = selectedMemoryOpsSuggestions()
    if (suggestions.length === 0) return
    setBatchWorking(true)
    setSuggestionErrors({})
    setRollbackPreviews({})
    setRollbackResults({})
    setRollbackErrors({})
    try {
      const result = await previewMemoryOpsBatch(project.path, suggestions)
      setLastBatchResult(result)
      const nextPlans: Record<string, MetadataPatchPlan> = {}
      const nextErrors: Record<string, string> = {}
      for (const item of result.items) {
        if (item.plan) nextPlans[item.suggestionId] = item.plan
        if (item.error) nextErrors[item.suggestionId] = item.error
      }
      setDryRunPlans((prev) => ({ ...prev, ...nextPlans }))
      setSuggestionErrors(nextErrors)
      await refreshRecentAudit()
    } finally {
      setBatchWorking(false)
    }
  }, [project, selectedMemoryOpsSuggestions, refreshRecentAudit])

  const handleBatchApply = useCallback(async () => {
    if (!project) return
    const suggestions = selectedMemoryOpsSuggestions()
    if (suggestions.length === 0) return
    setBatchWorking(true)
    setSuggestionErrors({})
    setRollbackPreviews({})
    setRollbackResults({})
    setRollbackErrors({})
    try {
      const result = await applyMemoryOpsBatch(project.path, suggestions)
      setLastBatchResult(result)
      const nextErrors: Record<string, string> = {}
      const handledIds: string[] = []
      let wroteFiles = false
      for (const item of result.items) {
        if (item.status === "applied") wroteFiles = true
        if (item.status === "applied" || item.status === "unchanged") handledIds.push(item.suggestionId)
        if (item.error) nextErrors[item.suggestionId] = item.error
      }
      if (wroteFiles) {
        const tree = await listDirectory(project.path)
        setFileTree(tree)
        bumpDataVersion()
      }
      setAppliedSuggestionIds((prev) => {
        const next = new Set(prev)
        for (const id of handledIds) next.add(id)
        return next
      })
      setSelectedSuggestionIds((prev) => {
        const next = new Set(prev)
        for (const id of handledIds) next.delete(id)
        return next
      })
      setSuggestionErrors(nextErrors)
      await refreshRecentAudit()
    } finally {
      setBatchWorking(false)
    }
  }, [project, selectedMemoryOpsSuggestions, setFileTree, bumpDataVersion, refreshRecentAudit])

  const handleBatchIgnore = useCallback(async () => {
    if (!project) return
    const suggestions = selectedMemoryOpsSuggestions()
    if (suggestions.length === 0) return
    setBatchWorking(true)
    setSuggestionErrors({})
    setRollbackPreviews({})
    setRollbackResults({})
    setRollbackErrors({})
    try {
      const result = await ignoreMemoryOpsBatch(project.path, suggestions)
      setLastBatchResult(result)
      const ignoredIds: string[] = []
      const nextErrors: Record<string, string> = {}
      for (const item of result.items) {
        if (item.status === "ignored") ignoredIds.push(item.suggestionId)
        if (item.error) nextErrors[item.suggestionId] = item.error
      }
      setIgnoredSuggestionIds((prev) => {
        const next = new Set(prev)
        for (const id of ignoredIds) next.add(id)
        return next
      })
      setSelectedSuggestionIds((prev) => {
        const next = new Set(prev)
        for (const id of ignoredIds) next.delete(id)
        return next
      })
      setSuggestionErrors(nextErrors)
      await refreshRecentAudit()
    } finally {
      setBatchWorking(false)
    }
  }, [project, selectedMemoryOpsSuggestions, refreshRecentAudit])

  const handlePreviewRollback = useCallback(
    async (item: MemoryOpsBatchItem) => {
      if (!project || !item.plan) return
      setWorkingRollbackId(item.suggestionId)
      setRollbackErrors((prev) => withoutKey(prev, item.suggestionId))
      setRollbackResults((prev) => withoutKey(prev, item.suggestionId))
      try {
        const preview = await previewMemoryOpsRollback(project.path, {
          rollback: item.plan.rollback,
          expectedContent: item.plan.afterContent,
          suggestionId: item.suggestionId,
          suggestionTitle: item.suggestionTitle,
          scope: item.plan.scope,
        })
        setRollbackPreviews((prev) => ({ ...prev, [item.suggestionId]: preview }))
      } catch (err) {
        setRollbackErrors((prev) => ({
          ...prev,
          [item.suggestionId]: err instanceof Error ? err.message : String(err),
        }))
      } finally {
        setWorkingRollbackId(null)
      }
    },
    [project],
  )

  const handleApplyRollback = useCallback(
    async (item: MemoryOpsBatchItem) => {
      if (!project || !item.plan) return
      setWorkingRollbackId(item.suggestionId)
      setRollbackErrors((prev) => withoutKey(prev, item.suggestionId))
      try {
        const result = await applyMemoryOpsRollback(project.path, {
          rollback: item.plan.rollback,
          expectedContent: item.plan.afterContent,
          suggestionId: item.suggestionId,
          suggestionTitle: item.suggestionTitle,
          scope: item.plan.scope,
        })
        setRollbackResults((prev) => ({ ...prev, [item.suggestionId]: result }))
        if (result.preview) {
          setRollbackPreviews((prev) => ({ ...prev, [item.suggestionId]: result.preview! }))
        }
        if (result.status !== "restored") {
          setRollbackErrors((prev) => ({
            ...prev,
            [item.suggestionId]: result.error ?? result.reason,
          }))
          await refreshRecentAudit()
          return
        }

        const tree = await listDirectory(project.path)
        setFileTree(tree)
        bumpDataVersion()
        setAppliedSuggestionIds((prev) => withoutSetValue(prev, item.suggestionId))
        await refreshRecentAudit()
      } catch (err) {
        setRollbackErrors((prev) => ({
          ...prev,
          [item.suggestionId]: err instanceof Error ? err.message : String(err),
        }))
      } finally {
        setWorkingRollbackId(null)
      }
    },
    [project, setFileTree, bumpDataVersion, refreshRecentAudit],
  )

  const handleOpenSuggestion = useCallback(
    async (suggestion: MemoryOpsSuggestion) => {
      if (!project) return
      setSuggestionErrors((prev) => withoutKey(prev, suggestion.id))
      try {
        const path = resolveMemoryOpsTargetPath(project.path, suggestion.targetPath)
        const content = await readFile(path)
        setSelectedFile(path)
        setFileContent(content)
        setActiveView("wiki")
      } catch (err) {
        setSuggestionErrors((prev) => ({
          ...prev,
          [suggestion.id]: err instanceof Error ? err.message : String(err),
        }))
      }
    },
    [project, setSelectedFile, setFileContent, setActiveView],
  )

  const handleOpenAuditPath = useCallback(
    async (path: string) => {
      if (!project) return
      setAuditOpenError(null)
      try {
        const fullPath = resolveMemoryOpsTargetPath(project.path, path)
        const content = await readFile(fullPath)
        setSelectedFile(fullPath)
        setFileContent(content)
        setActiveView("wiki")
      } catch (err) {
        setAuditOpenError(err instanceof Error ? err.message : String(err))
      }
    },
    [project, setSelectedFile, setFileContent, setActiveView],
  )

  const handleRunSearchHealth = useCallback(async () => {
    if (!project) return
    setSearchHealthRunning(true)
    setSearchHealthError(null)
    setSearchHealthResult(null)
    try {
      const builtIn = await buildBuiltInSearchHealthScenarios(project.path)
      const result = await runSearchHealth(project.path, builtIn.scenarios, {
        skippedScenarios: builtIn.skipped,
      })
      setSearchHealthResult(result)
      await refreshRecentAudit()
    } catch (err) {
      setSearchHealthError(err instanceof Error ? err.message : String(err))
    } finally {
      setSearchHealthRunning(false)
    }
  }, [project, refreshRecentAudit])

  const handleScan = useCallback(async () => {
    if (!project) return
    setScanning(true)
    setScanError(null)
    setGroups([])
    setScanCompleted(false)
    try {
      const detected = await runDuplicateDetection(project.path, llmConfig)
      setGroups(
        detected.map((g) => ({
          group: g,
          canonicalSlug: g.slugs[0],
          skipped: false,
        })),
      )
      setScanCompleted(true)
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }, [project, llmConfig])

  const handleCanonicalChange = useCallback(
    (idx: number, slug: string) => {
      setGroups((prev) =>
        prev.map((g, i) => (i === idx ? { ...g, canonicalSlug: slug } : g)),
      )
    },
    [],
  )

  const handleEnqueue = useCallback(
    async (entry: GroupUiEntry) => {
      if (!project) return
      try {
        await enqueueMerge(project.id, entry.group, entry.canonicalSlug)
        // Refresh immediately so the card flips to "queued" without
        // waiting for the next 1s poll tick.
        setTasks([...getQueue()])
      } catch (err) {
        console.error("[Maintenance] enqueue failed:", err)
      }
    },
    [project],
  )

  const handleCancel = useCallback(async (taskId: string) => {
    await cancelTask(taskId)
    setTasks([...getQueue()])
  }, [])

  const handleRetry = useCallback(async (taskId: string) => {
    await retryTask(taskId)
    setTasks([...getQueue()])
  }, [])

  const handleNotDuplicate = useCallback(
    async (idx: number) => {
      if (!project) return
      const entry = groups[idx]
      if (!entry) return
      try {
        await addNotDuplicate(project.path, entry.group.slugs)
        setGroups((prev) =>
          prev.map((g, i) => (i === idx ? { ...g, skipped: true } : g)),
        )
      } catch (err) {
        console.error("[Maintenance] addNotDuplicate failed:", err)
      }
    },
    [project, groups],
  )

  // Drive each card's status from the queue.
  // - Card not in queue + not skipped → idle, can merge / dismiss
  // - Task pending → "Queued (N ahead)"
  // - Task processing → "Merging…"
  // - Task gone (after success) → "Merged" (queue removes done tasks
  //     immediately, so we only know it succeeded if we observed it
  //     in-flight before. Track that with a session-local set.)
  // - Task failed → show error + retry / delete.
  const [recentlyMergedKeys, setRecentlyMergedKeys] = useState<Set<string>>(
    () => new Set(),
  )

  useEffect(() => {
    // Detect transitions out of the queue: a slug-set we saw last
    // tick is now gone → it completed (cancelled paths also remove,
    // but only with explicit user action that re-renders separately).
    setRecentlyMergedKeys((prev) => {
      const currentKeys = new Set(tasks.map((t) => groupKey(t.group.slugs)))
      let changed = false
      const next = new Set(prev)
      for (const g of groups) {
        const k = groupKey(g.group.slugs)
        const wasInFlight = lastSeenTaskKeysRef.current.has(k)
        if (wasInFlight && !currentKeys.has(k) && !next.has(k)) {
          next.add(k)
          changed = true
        }
      }
      lastSeenTaskKeysRef.current = currentKeys
      return changed ? next : prev
    })
    // We intentionally only re-run when tasks change — the closure
    // over `groups` is fine because newly-scanned groups can't be
    // "recently merged" until they've been observed in-flight first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks])
  const lastSeenTaskKeysRef = useRefInit<Set<string>>(() => new Set())

  // Pending position helper: "queued (N ahead)" — count pending tasks
  // before this one in arrival order.
  const pendingPositionByTaskId = useMemo(() => {
    const positions = new Map<string, number>()
    let position = 0
    for (const t of tasks) {
      if (t.status === "pending") {
        positions.set(t.id, position)
        position++
      }
    }
    return positions
  }, [tasks])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.maintenance.title", { defaultValue: "Maintenance" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.maintenance.description", {
            defaultValue:
              "Tools for keeping the wiki healthy — run local patrols, review recent audit activity, and merge duplicate entities/concepts.",
          })}
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 rounded-lg border border-border/60 bg-muted/20 p-2">
          {(["patrol", "timeline", "policy", "search"] as const).map((tab) => (
            <Button
              key={tab}
              size="sm"
              variant={workbenchTab === tab ? "secondary" : "ghost"}
              onClick={() => setWorkbenchTab(tab)}
            >
              {t(`settings.sections.maintenance.workbenchTabs.${tab}`)}
            </Button>
          ))}
        </div>

        {workbenchTab === "patrol" && (
          <MemoryOpsPatrolBlock
            projectReady={projectReady}
            running={patrolRunning}
            error={patrolError}
            report={patrolReport}
            maintenanceStatus={maintenanceStatus}
            recentAuditEvents={recentAuditEvents}
            ignoredSuggestionIds={ignoredSuggestionIds}
            appliedSuggestionIds={appliedSuggestionIds}
            dryRunPlans={dryRunPlans}
            suggestionErrors={suggestionErrors}
            workingSuggestionId={workingSuggestionId}
            selectedSuggestionIds={selectedSuggestionIds}
            batchWorking={batchWorking}
            lastBatchResult={lastBatchResult}
            rollbackPreviews={rollbackPreviews}
            rollbackResults={rollbackResults}
            rollbackErrors={rollbackErrors}
            workingRollbackId={workingRollbackId}
            onToggleSelection={handleToggleSuggestionSelection}
            onSelectCategory={handleSelectSuggestionCategory}
            onClearSelection={handleClearSuggestionSelection}
            onBatchPreview={() => void handleBatchPreview()}
            onBatchApply={() => void handleBatchApply()}
            onBatchIgnore={() => void handleBatchIgnore()}
            onPreviewRollback={(item) => void handlePreviewRollback(item)}
            onApplyRollback={(item) => void handleApplyRollback(item)}
            onRun={() => void handlePatrol()}
            onPreview={(suggestion) => void handlePreviewSuggestion(suggestion)}
            onApply={(suggestion) => void handleApplySuggestion(suggestion)}
            onIgnore={(suggestion) => void handleIgnoreSuggestion(suggestion)}
            onOpen={(suggestion) => void handleOpenSuggestion(suggestion)}
          />
        )}

        {workbenchTab === "timeline" && (
          <AuditTimelinePanel
            projectReady={projectReady}
            events={auditEvents}
            warnings={auditWarnings}
            openError={auditOpenError}
            onRefresh={() => void refreshRecentAudit()}
            onOpenPath={(path) => void handleOpenAuditPath(path)}
          />
        )}

        {workbenchTab === "policy" && (
          <MemoryOpsPolicyPanel
            projectReady={projectReady}
            policy={policy}
            warnings={policyWarnings}
            saving={policySaving}
            error={policyError}
            saved={policySaved}
            onSave={(nextPolicy) => void handleSavePolicy(nextPolicy)}
            onRestoreDefault={() => void handleRestoreDefaultPolicy()}
          />
        )}

        {workbenchTab === "search" && (
          <SearchHealthPanel
            projectReady={projectReady}
            running={searchHealthRunning}
            result={searchHealthResult}
            error={searchHealthError}
            onRun={() => void handleRunSearchHealth()}
            onOpenReport={(path) => void handleOpenAuditPath(path)}
          />
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">
            {t("settings.sections.maintenance.dedup.title", {
              defaultValue: "Detect duplicate entities / concepts",
            })}
          </h3>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("settings.sections.maintenance.dedup.description", {
            defaultValue:
              "Asks the LLM to scan all entity / concept pages and group ones that likely refer to the same topic under different names (English vs Chinese, plural vs singular, abbreviation vs full form). You confirm each group before merging. Merges are queued and run one at a time so cross-references stay consistent.",
          })}
        </p>

        {!projectReady && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t("settings.sections.maintenance.noProject", {
              defaultValue: "Open a project first.",
            })}
          </p>
        )}
        {projectReady && !llmReady && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t("settings.sections.maintenance.noLlm", {
              defaultValue: "Configure an LLM provider first.",
            })}
          </p>
        )}

        <Button
          onClick={() => void handleScan()}
          disabled={scanning || !projectReady || !llmReady}
        >
          {scanning ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("settings.sections.maintenance.dedup.scanning", {
                defaultValue: "Scanning…",
              })}
            </>
          ) : (
            t("settings.sections.maintenance.dedup.scanButton", {
              defaultValue: "Scan for duplicates",
            })
          )}
        </Button>

        {scanError && (
          <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>{scanError}</div>
          </div>
        )}

        {scanCompleted && groups.length === 0 && !scanError && (
          <div className="flex items-start gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              {t("settings.sections.maintenance.dedup.noneFound", {
                defaultValue: "No duplicate groups found. The wiki is clean.",
              })}
            </div>
          </div>
        )}
      </div>

      <QueueOrphanList
        tasks={tasks}
        groups={groups}
        onCancel={(id) => void handleCancel(id)}
        onRetry={(id) => void handleRetry(id)}
        pendingPositionByTaskId={pendingPositionByTaskId}
      />

      {groups.map((entry, idx) => {
        const task = findTaskForGroup(tasks, entry.group.slugs)
        const merged = recentlyMergedKeys.has(groupKey(entry.group.slugs))
        return (
          <DuplicateGroupCard
            key={entry.group.slugs.join(",")}
            entry={entry}
            task={task}
            merged={merged}
            pendingPosition={
              task && task.status === "pending"
                ? pendingPositionByTaskId.get(task.id) ?? 0
                : 0
            }
            onCanonicalChange={(slug) => handleCanonicalChange(idx, slug)}
            onEnqueue={() => void handleEnqueue(entry)}
            onCancel={() => task && void handleCancel(task.id)}
            onRetry={() => task && void handleRetry(task.id)}
            onNotDuplicate={() => void handleNotDuplicate(idx)}
          />
        )
      })}
    </div>
  )
}

// --- helpers ---------------------------------------------------------------

/** A useRef variant that initializes lazily — avoids constructing a new
 *  Set on every render. Kept inline since it's only used here. */
function useRefInit<T>(init: () => T): { current: T } {
  // `useState` returning a ref-shaped object lets us mutate `.current`
  // without triggering re-renders, which is exactly the ref semantics
  // we want for the "last seen task keys" tracking above.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [ref] = useState<{ current: T }>(() => ({ current: init() }))
  return ref
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function withoutSetValue<T>(set: ReadonlySet<T>, value: T): Set<T> {
  if (!set.has(value)) return new Set(set)
  const next = new Set(set)
  next.delete(value)
  return next
}

function buildSingleApplyBatchResult(
  suggestion: MemoryOpsSuggestion,
  operation: MetadataPatchOperation,
  result: ApplyOperationResult,
): MemoryOpsBatchResult {
  return {
    ok: result.status !== "error",
    summary: {
      selectedCount: 1,
      eligibleCount: 1,
      plannedCount: 0,
      appliedCount: result.status === "applied" ? 1 : 0,
      unchangedCount: result.status === "unchanged" ? 1 : 0,
      ignoredCount: 0,
      ineligibleCount: 0,
      errorCount: result.status === "error" ? 1 : 0,
    },
    items: [{
      suggestionId: suggestion.id,
      suggestionTitle: suggestion.title,
      targetPath: operation.targetPath,
      status: result.status,
      operation,
      applyResult: result,
      plan: result.plan,
      error: result.error,
    }],
  }
}

interface QueueOrphanListProps {
  tasks: readonly DedupTask[]
  groups: GroupUiEntry[]
  onCancel: (taskId: string) => void
  onRetry: (taskId: string) => void
  pendingPositionByTaskId: Map<string, number>
}

/**
 * Render queued tasks that don't have a matching card on screen. This
 * happens after the user closes the Maintenance pane and re-opens it,
 * or after an app restart with pending tasks: those tasks are real
 * but the user hasn't re-scanned, so without this list they'd be
 * invisible.
 */
function QueueOrphanList({
  tasks,
  groups,
  onCancel,
  onRetry,
  pendingPositionByTaskId,
}: QueueOrphanListProps) {
  const { t } = useTranslation()
  const groupKeys = new Set(groups.map((g) => groupKey(g.group.slugs)))
  const orphans = tasks.filter((t) => !groupKeys.has(groupKey(t.group.slugs)))

  if (orphans.length === 0) return null

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-4">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {t("settings.sections.maintenance.dedup.queueTitle", {
            defaultValue: "In-progress merges",
          })}
        </h3>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settings.sections.maintenance.dedup.queueDescription", {
          defaultValue:
            "Tasks queued from a previous scan that haven't finished yet. Merges run one at a time.",
        })}
      </p>
      {orphans.map((task) => (
        <div
          key={task.id}
          className="flex flex-wrap items-center gap-2 rounded border border-border/40 bg-background px-3 py-2 text-xs"
        >
          <code className="font-mono">{task.group.slugs.join(" + ")}</code>
          <span className="text-muted-foreground">
            →{" "}
            <code className="font-mono">{task.canonicalSlug}</code>
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <TaskStatusChip
              task={task}
              pendingPosition={pendingPositionByTaskId.get(task.id) ?? 0}
            />
            {task.status === "failed" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onRetry(task.id)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("settings.sections.maintenance.dedup.retry", {
                  defaultValue: "Retry",
                })}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onCancel(task.id)}>
              <Trash2 className="h-3.5 w-3.5" />
              {t("settings.sections.maintenance.dedup.delete", {
                defaultValue: "Delete",
              })}
            </Button>
          </span>
          {task.error && task.status === "failed" && (
            <div className="basis-full rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1 text-rose-700 dark:text-rose-400">
              {task.error}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

interface ChipProps {
  task: DedupTask
  pendingPosition: number
}

function TaskStatusChip({ task, pendingPosition }: ChipProps) {
  const { t } = useTranslation()
  if (task.status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("settings.sections.maintenance.dedup.merging", {
          defaultValue: "Merging…",
        })}
      </span>
    )
  }
  if (task.status === "pending") {
    if (pendingPosition === 0) {
      return (
        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
          {t("settings.sections.maintenance.dedup.queued", {
            defaultValue: "Queued",
          })}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
        {t("settings.sections.maintenance.dedup.queuedAhead", {
          defaultValue: "Queued ({{n}} ahead)",
          n: pendingPosition,
        })}
      </span>
    )
  }
  if (task.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700 dark:text-rose-400">
        <AlertTriangle className="h-3 w-3" />
        {t("settings.sections.maintenance.dedup.failed", {
          defaultValue: "Failed ({{retries}}/3)",
          retries: task.retryCount,
        })}
      </span>
    )
  }
  return null
}

interface CardProps {
  entry: GroupUiEntry
  task: DedupTask | undefined
  merged: boolean
  pendingPosition: number
  onCanonicalChange: (slug: string) => void
  onEnqueue: () => void
  onCancel: () => void
  onRetry: () => void
  onNotDuplicate: () => void
}

function DuplicateGroupCard({
  entry,
  task,
  merged,
  pendingPosition,
  onCanonicalChange,
  onEnqueue,
  onCancel,
  onRetry,
  onNotDuplicate,
}: CardProps) {
  const { t } = useTranslation()
  const { group, canonicalSlug, skipped } = entry

  const inFlight = !!task && (task.status === "pending" || task.status === "processing")
  const failed = !!task && task.status === "failed"
  const finished = merged || skipped

  const confidenceClass =
    group.confidence === "high"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : group.confidence === "medium"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground"

  return (
    <div
      className={`space-y-3 rounded-lg border px-4 py-3 ${
        finished ? "border-border/40 bg-muted/10 opacity-60" : "border-border bg-background"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${confidenceClass}`}>
          {group.confidence}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("settings.sections.maintenance.dedup.candidates", {
            defaultValue: "{{n}} candidates",
            n: group.slugs.length,
          })}
        </span>
        {merged && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("settings.sections.maintenance.dedup.merged", { defaultValue: "Merged" })}
          </span>
        )}
        {skipped && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
            {t("settings.sections.maintenance.dedup.skipped", { defaultValue: "Marked not duplicates" })}
          </span>
        )}
        {task && !finished && (
          <span className="ml-auto">
            <TaskStatusChip task={task} pendingPosition={pendingPosition} />
          </span>
        )}
      </div>

      {group.reason && (
        <div className="text-xs italic leading-relaxed text-muted-foreground">{group.reason}</div>
      )}

      {!finished && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">
              {t("settings.sections.maintenance.dedup.canonicalLabel", {
                defaultValue: "Keep this slug as canonical:",
              })}
            </Label>
            {group.slugs.map((slug) => (
              <label
                key={slug}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
              >
                <input
                  type="radio"
                  name={`canonical-${group.slugs.join(",")}`}
                  checked={canonicalSlug === slug}
                  onChange={() => onCanonicalChange(slug)}
                  disabled={inFlight}
                />
                <code className="font-mono text-xs">{slug}</code>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {!task && (
              <>
                <Button size="sm" onClick={onEnqueue}>
                  {t("settings.sections.maintenance.dedup.mergeButton", {
                    defaultValue: "Merge into {{slug}}",
                    slug: canonicalSlug,
                  })}
                </Button>
                <Button size="sm" variant="ghost" onClick={onNotDuplicate}>
                  {t("settings.sections.maintenance.dedup.notDuplicates", {
                    defaultValue: "Not duplicates",
                  })}
                </Button>
              </>
            )}
            {inFlight && (
              <Button size="sm" variant="ghost" onClick={onCancel}>
                <Trash2 className="h-3.5 w-3.5" />
                {t("settings.sections.maintenance.dedup.cancel", {
                  defaultValue: "Cancel",
                })}
              </Button>
            )}
            {failed && (
              <>
                <Button size="sm" onClick={onRetry}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t("settings.sections.maintenance.dedup.retry", {
                    defaultValue: "Retry",
                  })}
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancel}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("settings.sections.maintenance.dedup.delete", {
                    defaultValue: "Delete",
                  })}
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {failed && task?.error && (
        <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>{task.error}</div>
        </div>
      )}
    </div>
  )
}
