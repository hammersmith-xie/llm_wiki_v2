import { useState } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle, Plus, ShieldCheck, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { validateProxyUrl } from "@/lib/proxy-config"
import {
  normalizeNetworkAllowlistEntry,
  normalizeNetworkPolicy,
  type NetworkPolicyConfig,
  type NetworkPolicyMode,
} from "@/lib/network-policy"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import type { EgressReport } from "@/lib/egress-log"
import { EgressReportPanel } from "./egress-report-panel"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
  projectReady?: boolean
  egressReport?: EgressReport | null
  egressLoading?: boolean
  onRefreshEgress?: () => void
}

const POLICY_MODES: NetworkPolicyMode[] = ["local-only", "allowlist", "any"]

export function NetworkSection({
  draft,
  setDraft,
  projectReady = false,
  egressReport = null,
  egressLoading = false,
  onRefreshEgress = () => {},
}: Props) {
  const { t } = useTranslation()
  const [allowlistInput, setAllowlistInput] = useState("")

  // Live URL validation — only flag the user when they've actually
  // typed something. Empty + enabled is "form not yet finished",
  // not a hard error.
  const trimmed = draft.proxyUrl.trim()
  const validation = trimmed === "" ? null : validateProxyUrl(trimmed)
  const showError = draft.proxyEnabled && validation && !validation.ok
  const policy = normalizeNetworkPolicy(draft.networkPolicyConfig)

  function setPolicy(next: NetworkPolicyConfig) {
    setDraft("networkPolicyConfig", next)
  }

  function addAllowlistEntry() {
    const next = addNetworkPolicyAllowlistEntry(policy, allowlistInput)
    setPolicy(next)
    if (next !== policy) setAllowlistInput("")
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.network.title", { defaultValue: "Network" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.network.description", {
            defaultValue:
              "Control app-layer outbound policy and proxy routing. Policy changes apply on Save; proxy changes apply on app restart.",
          })}
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-border p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">
              {t("settings.sections.network.policyTitle", {
                defaultValue: "Outbound policy",
              })}
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("settings.sections.network.policyDescription", {
              defaultValue:
                "Policy-aware outbound integrations check this before egress. Tauri capability remains broad for custom hosts; enforcement is at the app transport layer.",
            })}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
          {POLICY_MODES.map((mode) => {
            const active = policy.mode === mode
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPolicy(setNetworkPolicyMode(policy, mode))}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border hover:bg-muted/60"
                }`}
              >
                <span className="block text-sm font-medium">
                  {t(`settings.sections.network.modes.${mode}.label`, {
                    defaultValue: defaultModeLabel(mode),
                  })}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t(`settings.sections.network.modes.${mode}.hint`, {
                    defaultValue: defaultModeHint(mode),
                  })}
                </span>
              </button>
            )
          })}
        </div>

        {policy.mode === "any" && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("settings.sections.network.anyWarningTitle", {
                defaultValue: "Cloud egress allowed",
              })}
            </div>
            <p className="mt-1">
              {t("settings.sections.network.anyWarning", {
                defaultValue:
                  "Any permits policy-aware requests to public cloud endpoints. Use it only when you intentionally want remote providers or external search.",
              })}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="network-allowlist-input">
            {t("settings.sections.network.allowlistTitle", {
              defaultValue: "Allowed hosts",
            })}
          </Label>
          <div className="flex gap-2">
            <Input
              id="network-allowlist-input"
              value={allowlistInput}
              onChange={(e) => setAllowlistInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  addAllowlistEntry()
                }
              }}
              placeholder={t("settings.sections.network.allowlistPlaceholder", {
                defaultValue: "https://api.example.com or localhost:11434",
              })}
            />
            <Button type="button" variant="outline" onClick={addAllowlistEntry}>
              <Plus className="h-4 w-4" />
              {t("settings.sections.network.addAllowedHost", {
                defaultValue: "Add",
              })}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("settings.sections.network.allowlistHelp", {
              defaultValue:
                "Use an origin like https://api.example.com or a host:port like localhost:11434. Paths are normalized to the origin.",
            })}
          </p>
          {policy.allowedHosts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              {t("settings.sections.network.emptyAllowlist", {
                defaultValue: "No public hosts are allowlisted.",
              })}
            </p>
          ) : (
            <div className="space-y-1">
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                {t("settings.sections.network.seedDisclosure", {
                  defaultValue:
                    "Configured cloud providers may seed this allowlist during upgrade so existing OpenAI/Anthropic/search/embedding workflows keep working. Review or remove hosts you do not want.",
                })}
              </p>
              {policy.allowedHosts.map((host) => (
                <div
                  key={host}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <code className="min-w-0 truncate text-xs">{host}</code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title={t("settings.sections.network.removeAllowedHost", {
                      defaultValue: "Remove {{host}}",
                      host,
                    })}
                    onClick={() => setPolicy(removeNetworkPolicyAllowlistEntry(policy, host))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={policy.allowLan}
            onChange={(e) => setPolicy(setNetworkPolicyAllowLan(policy, e.target.checked))}
            className="mt-0.5 h-4 w-4"
          />
          <div className="space-y-1">
            <span className="text-sm">
              {t("settings.sections.network.allowLan", {
                defaultValue: "Allow LAN addresses",
              })}
            </span>
            <p className="text-xs text-muted-foreground">
              {t("settings.sections.network.allowLanHelp", {
                defaultValue:
                  "Allows RFC1918 addresses such as 10.x.x.x, 172.16-31.x.x, and 192.168.x.x. Keep off unless your local models or services run on another device.",
              })}
            </p>
          </div>
        </label>
      </section>

      <EgressReportPanel
        projectReady={projectReady}
        report={egressReport}
        loading={egressLoading}
        onRefresh={onRefreshEgress}
      />

      <section className="space-y-4 rounded-lg border border-border p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {t("settings.sections.network.proxyTitle", {
              defaultValue: "Proxy",
            })}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("settings.sections.network.proxyDescription", {
              defaultValue:
                "Route outbound HTTP through a proxy after the app restarts. This does not override the outbound policy above.",
            })}
          </p>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.proxyEnabled}
            onChange={(e) => setDraft("proxyEnabled", e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm">
            {t("settings.sections.network.enable", {
              defaultValue: "Enable proxy",
            })}
          </span>
        </label>

        <div className="space-y-2">
          <Label htmlFor="proxy-url">
            {t("settings.sections.network.url", { defaultValue: "Proxy URL" })}
          </Label>
          <Input
            id="proxy-url"
            value={draft.proxyUrl}
            onChange={(e) => setDraft("proxyUrl", e.target.value)}
            placeholder="http://127.0.0.1:7890"
            disabled={!draft.proxyEnabled}
            className={showError ? "border-destructive" : ""}
          />
          <p className="text-xs text-muted-foreground">
            {t("settings.sections.network.urlHelp", {
              defaultValue:
                "Full URL with scheme. Supported: http://, https://. (SOCKS5 not supported in this version.)",
            })}
          </p>
          {showError && validation && !validation.ok && (
            <p className="flex items-center gap-1 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3" />
              {validation.error}
            </p>
          )}
        </div>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.proxyBypassLocal}
            onChange={(e) => setDraft("proxyBypassLocal", e.target.checked)}
            disabled={!draft.proxyEnabled}
            className="mt-0.5 h-4 w-4"
          />
          <div className="space-y-1">
            <span className="text-sm">
              {t("settings.sections.network.bypassLocal", {
                defaultValue: "Bypass proxy for local addresses (recommended)",
              })}
            </span>
            <p className="text-xs text-muted-foreground">
              {t("settings.sections.network.bypassLocalHelp", {
                defaultValue:
                  "Requests to localhost, 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, and *.local don't go through the proxy. Keep this on if you use Ollama / LM Studio / other local or LAN-deployed LLMs.",
              })}
            </p>
          </div>
        </label>
      </section>
    </div>
  )
}

export function setNetworkPolicyMode(
  policy: NetworkPolicyConfig,
  mode: NetworkPolicyMode,
): NetworkPolicyConfig {
  return { ...normalizeNetworkPolicy(policy), mode }
}

export function addNetworkPolicyAllowlistEntry(
  policy: NetworkPolicyConfig,
  entry: string,
): NetworkPolicyConfig {
  const normalizedPolicy = normalizeNetworkPolicy(policy)
  const normalizedEntry = normalizeAllowlistEntryForUi(entry)
  if (!normalizedEntry) return normalizedPolicy

  const existing = new Set(
    normalizedPolicy.allowedHosts.map((host) => normalizeAllowlistEntryForUi(host)),
  )
  if (existing.has(normalizedEntry)) return normalizedPolicy

  return {
    ...normalizedPolicy,
    allowedHosts: [...normalizedPolicy.allowedHosts, normalizedEntry],
  }
}

export function removeNetworkPolicyAllowlistEntry(
  policy: NetworkPolicyConfig,
  entry: string,
): NetworkPolicyConfig {
  const normalizedPolicy = normalizeNetworkPolicy(policy)
  const target = normalizeAllowlistEntryForUi(entry)
  return {
    ...normalizedPolicy,
    allowedHosts: normalizedPolicy.allowedHosts.filter(
      (host) => normalizeAllowlistEntryForUi(host) !== target,
    ),
  }
}

export function setNetworkPolicyAllowLan(
  policy: NetworkPolicyConfig,
  allowLan: boolean,
): NetworkPolicyConfig {
  return { ...normalizeNetworkPolicy(policy), allowLan }
}

function normalizeAllowlistEntryForUi(entry: string): string {
  return normalizeNetworkAllowlistEntry(entry)
}

function defaultModeLabel(mode: NetworkPolicyMode): string {
  if (mode === "local-only") return "Local only"
  if (mode === "allowlist") return "Allowlist"
  return "Any"
}

function defaultModeHint(mode: NetworkPolicyMode): string {
  if (mode === "local-only") return "Loopback endpoints only; public cloud blocked."
  if (mode === "allowlist") return "Loopback plus listed hosts/origins."
  return "Permit all outbound hosts."
}
