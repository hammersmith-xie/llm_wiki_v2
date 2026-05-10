import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DEFAULT_MEMORY_OPS_POLICY,
  normalizeMemoryOpsPolicy,
  type MemoryOpsPolicy,
} from "@/lib/memory-ops-policy"

type NumericPolicyKey =
  | "halfLives.working"
  | "halfLives.episodic"
  | "halfLives.semantic"
  | "halfLives.procedural"
  | "halfLives.archived"
  | "staleMultiplier"
  | "lowConfidenceThreshold"
  | "promotion.minSources"
  | "promotion.minReinforcement"
  | "automation.eventThreshold"
  | "automation.reminderCooldownMinutes"
  | "automation.minPatrolIntervalMinutes"
  | "automation.timeIntervalHours"
  | "automation.maintenanceCheckIntervalMinutes"

interface MemoryOpsPolicyPanelProps {
  projectReady: boolean
  policy: MemoryOpsPolicy
  warnings: readonly string[]
  saving: boolean
  error: string | null
  saved: boolean
  onSave: (policy: MemoryOpsPolicy) => void
  onRestoreDefault: () => void
}

export function MemoryOpsPolicyPanel({
  projectReady,
  policy,
  warnings,
  saving,
  error,
  saved,
  onSave,
  onRestoreDefault,
}: MemoryOpsPolicyPanelProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<MemoryOpsPolicy>(() => policy)

  useEffect(() => {
    setDraft(policy)
  }, [policy])

  const validation = useMemo(() => normalizeMemoryOpsPolicy(draft), [draft])
  const dirty = !memoryOpsPolicyEquals(draft, policy)
  const canSave = projectReady && validation.warnings.length === 0 && dirty && !saving

  const setNumber = (key: NumericPolicyKey, value: string) => {
    const parsed = value === "" ? Number.NaN : Number(value)
    setDraft((prev) => setNumericPolicyValue(prev, key, parsed))
  }

  const resetDraft = () => setDraft(policy)

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {t("settings.sections.maintenance.policy.title")}
        </h3>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={resetDraft}
            disabled={!dirty || saving}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("settings.sections.maintenance.policy.resetDraft")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onRestoreDefault}
            disabled={!projectReady || saving}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("settings.sections.maintenance.policy.restoreDefault")}
          </Button>
          <Button size="sm" onClick={() => onSave(draft)} disabled={!canSave}>
            <Save className="h-3.5 w-3.5" />
            {saving
              ? t("settings.sections.maintenance.policy.saving")
              : t("settings.sections.maintenance.policy.save")}
          </Button>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("settings.sections.maintenance.policy.description")}
      </p>

      {!projectReady && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("settings.sections.maintenance.noProject")}
        </p>
      )}

      {saved && !dirty && (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          {t("settings.sections.maintenance.policy.saved")}
        </div>
      )}

      {error && (
        <div className="rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
          {error}
        </div>
      )}

      {(warnings.length > 0 || validation.warnings.length > 0) && (
        <div className="space-y-1 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t("settings.sections.maintenance.policy.warnings")}
          </div>
          {[...warnings, ...validation.warnings].slice(0, 5).map((warning) => (
            <div key={warning} className="break-words">{warning}</div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-2 rounded border border-border/60 bg-background/80 p-3">
          <div className="text-xs font-medium">
            {t("settings.sections.maintenance.policy.halfLives")}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <NumberField
              label={t("settings.sections.maintenance.policy.working")}
              value={draft.halfLives.working}
              min={1}
              step={1}
              onChange={(value) => setNumber("halfLives.working", value)}
            />
            <NumberField
              label={t("settings.sections.maintenance.policy.episodic")}
              value={draft.halfLives.episodic}
              min={1}
              step={1}
              onChange={(value) => setNumber("halfLives.episodic", value)}
            />
            <NumberField
              label={t("settings.sections.maintenance.policy.semantic")}
              value={draft.halfLives.semantic}
              min={1}
              step={1}
              onChange={(value) => setNumber("halfLives.semantic", value)}
            />
            <NumberField
              label={t("settings.sections.maintenance.policy.procedural")}
              value={draft.halfLives.procedural}
              min={1}
              step={1}
              onChange={(value) => setNumber("halfLives.procedural", value)}
            />
            <NumberField
              label={t("settings.sections.maintenance.policy.archived")}
              value={draft.halfLives.archived}
              min={1}
              step={1}
              onChange={(value) => setNumber("halfLives.archived", value)}
            />
          </div>
        </div>

        <div className="space-y-2 rounded border border-border/60 bg-background/80 p-3">
          <div className="text-xs font-medium">
            {t("settings.sections.maintenance.policy.thresholds")}
          </div>
          <NumberField
            label={t("settings.sections.maintenance.policy.staleMultiplier")}
            value={draft.staleMultiplier}
            min={0.1}
            step={0.1}
            onChange={(value) => setNumber("staleMultiplier", value)}
          />
          <NumberField
            label={t("settings.sections.maintenance.policy.lowConfidence")}
            value={draft.lowConfidenceThreshold}
            min={0}
            max={1}
            step={0.05}
            onChange={(value) => setNumber("lowConfidenceThreshold", value)}
          />
          <NumberField
            label={t("settings.sections.maintenance.policy.minSources")}
            value={draft.promotion.minSources}
            min={0}
            step={1}
            onChange={(value) => setNumber("promotion.minSources", value)}
          />
          <NumberField
            label={t("settings.sections.maintenance.policy.minReinforcement")}
            value={draft.promotion.minReinforcement}
            min={0}
            step={1}
            onChange={(value) => setNumber("promotion.minReinforcement", value)}
          />
        </div>
      </div>

      <div className="space-y-2 rounded border border-border/60 bg-background/80 p-3">
        <div className="text-xs font-medium">
          {t("settings.sections.maintenance.policy.automation")}
        </div>
        <CheckboxRow
          label={t("settings.sections.maintenance.policy.autoPatrolEnabled")}
          checked={draft.automation.autoPatrolEnabled}
          onChange={(checked) =>
            setDraft((prev) => ({
              ...prev,
              automation: { ...prev.automation, autoPatrolEnabled: checked },
            }))
          }
        />
        <CheckboxRow
          label={t("settings.sections.maintenance.policy.maintenanceDaemonEnabled")}
          checked={draft.automation.maintenanceDaemonEnabled}
          onChange={(checked) =>
            setDraft((prev) => ({
              ...prev,
              automation: { ...prev.automation, maintenanceDaemonEnabled: checked },
            }))
          }
        />
        <NumberField
          label={t("settings.sections.maintenance.policy.maintenanceCheckIntervalMinutes")}
          value={draft.automation.maintenanceCheckIntervalMinutes}
          min={1}
          step={1}
          onChange={(value) => setNumber("automation.maintenanceCheckIntervalMinutes", value)}
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("settings.sections.maintenance.policy.maintenanceCheckHelp")}
        </p>
        <NumberField
          label={t("settings.sections.maintenance.policy.eventThreshold")}
          value={draft.automation.eventThreshold}
          min={1}
          step={1}
          onChange={(value) => setNumber("automation.eventThreshold", value)}
        />
        <NumberField
          label={t("settings.sections.maintenance.policy.reminderCooldownMinutes")}
          value={draft.automation.reminderCooldownMinutes}
          min={1}
          step={1}
          onChange={(value) => setNumber("automation.reminderCooldownMinutes", value)}
        />
        <NumberField
          label={t("settings.sections.maintenance.policy.minPatrolIntervalMinutes")}
          value={draft.automation.minPatrolIntervalMinutes}
          min={0}
          step={1}
          onChange={(value) => setNumber("automation.minPatrolIntervalMinutes", value)}
        />
        <NumberField
          label={t("settings.sections.maintenance.policy.timeIntervalHours")}
          value={draft.automation.timeIntervalHours}
          min={0}
          step={1}
          onChange={(value) => setNumber("automation.timeIntervalHours", value)}
        />
      </div>

      <div className="space-y-2 rounded border border-border/60 bg-background/80 p-3">
        <div className="text-xs font-medium">
          {t("settings.sections.maintenance.policy.archiveRules")}
        </div>
        <CheckboxRow
          label={t("settings.sections.maintenance.policy.requireNoSourceSupport")}
          checked={draft.archive.requireNoSourceSupport}
          onChange={(checked) =>
            setDraft((prev) => ({
              ...prev,
              archive: { ...prev.archive, requireNoSourceSupport: checked },
            }))
          }
        />
        <CheckboxRow
          label={t("settings.sections.maintenance.policy.requireNoReinforcement")}
          checked={draft.archive.requireNoReinforcement}
          onChange={(checked) =>
            setDraft((prev) => ({
              ...prev,
              archive: { ...prev.archive, requireNoReinforcement: checked },
            }))
          }
        />
        <CheckboxRow
          label={t("settings.sections.maintenance.policy.requireNoRecentUse")}
          checked={draft.archive.requireNoRecentUse}
          onChange={(checked) =>
            setDraft((prev) => ({
              ...prev,
              archive: { ...prev.archive, requireNoRecentUse: checked },
            }))
          }
        />
      </div>

      <div className="text-xs text-muted-foreground">
        {t("settings.sections.maintenance.policy.defaultSummary", {
          working: DEFAULT_MEMORY_OPS_POLICY.halfLives.working,
          semantic: DEFAULT_MEMORY_OPS_POLICY.halfLives.semantic,
          procedural: DEFAULT_MEMORY_OPS_POLICY.halfLives.procedural,
          confidence: DEFAULT_MEMORY_OPS_POLICY.lowConfidenceThreshold,
        })}
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max?: number
  step: number
  onChange: (value: string) => void
}) {
  return (
    <Label className="flex min-w-0 flex-col items-stretch gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 text-xs"
      />
    </Label>
  )
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Label className="flex items-center gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        className="h-3.5 w-3.5"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </Label>
  )
}

function setNumericPolicyValue(
  policy: MemoryOpsPolicy,
  key: NumericPolicyKey,
  value: number,
): MemoryOpsPolicy {
  if (key.startsWith("halfLives.")) {
    const halfLife = key.split(".")[1] as keyof MemoryOpsPolicy["halfLives"]
    return {
      ...policy,
      halfLives: { ...policy.halfLives, [halfLife]: value },
    }
  }
  if (key.startsWith("promotion.")) {
    const promotionKey = key.split(".")[1] as keyof MemoryOpsPolicy["promotion"]
    return {
      ...policy,
      promotion: { ...policy.promotion, [promotionKey]: value },
    }
  }
  if (key.startsWith("automation.")) {
    const automationKey = key.split(".")[1] as keyof MemoryOpsPolicy["automation"]
    return {
      ...policy,
      automation: { ...policy.automation, [automationKey]: value },
    }
  }
  return { ...policy, [key]: value }
}

function memoryOpsPolicyEquals(a: MemoryOpsPolicy, b: MemoryOpsPolicy): boolean {
  return (
    a.version === b.version &&
    a.name === b.name &&
    a.halfLives.working === b.halfLives.working &&
    a.halfLives.episodic === b.halfLives.episodic &&
    a.halfLives.semantic === b.halfLives.semantic &&
    a.halfLives.procedural === b.halfLives.procedural &&
    a.halfLives.archived === b.halfLives.archived &&
    a.staleMultiplier === b.staleMultiplier &&
    a.lowConfidenceThreshold === b.lowConfidenceThreshold &&
    a.promotion.minSources === b.promotion.minSources &&
    a.promotion.minReinforcement === b.promotion.minReinforcement &&
    a.archive.requireNoSourceSupport === b.archive.requireNoSourceSupport &&
    a.archive.requireNoReinforcement === b.archive.requireNoReinforcement &&
    a.archive.requireNoRecentUse === b.archive.requireNoRecentUse &&
    a.automation.autoPatrolEnabled === b.automation.autoPatrolEnabled &&
    a.automation.eventThreshold === b.automation.eventThreshold &&
    a.automation.reminderCooldownMinutes === b.automation.reminderCooldownMinutes &&
    a.automation.minPatrolIntervalMinutes === b.automation.minPatrolIntervalMinutes &&
    a.automation.timeIntervalHours === b.automation.timeIntervalHours &&
    a.automation.maintenanceDaemonEnabled === b.automation.maintenanceDaemonEnabled &&
    a.automation.maintenanceCheckIntervalMinutes === b.automation.maintenanceCheckIntervalMinutes
  )
}
