import { appendFile, createDirectory, readFile } from "@/commands/fs"
import type { NetworkPolicyDecision } from "@/lib/network-policy"
import { normalizePath } from "@/lib/path-utils"

export const EGRESS_SCHEMA_VERSION = 1

export type EgressTransport = "http" | "subprocess" | "loopback-bridge"

export interface EgressEvent {
  schemaVersion: typeof EGRESS_SCHEMA_VERSION
  timestamp: string
  feature: string
  provider: string
  reason: string
  transport: EgressTransport
  allowed: boolean
  decisionReason: string
  policyMode: string
  url: {
    protocol: string
    hostname: string
    port: string
    origin: string
    kind: string
  }
  requestBytes?: number
}

export interface AppendEgressEventInput {
  timestamp?: string
  feature: string
  provider: string
  reason: string
  transport?: EgressTransport
  decision: NetworkPolicyDecision
  requestBytes?: number
}

export interface EgressLogWarning {
  line: number
  message: string
  raw: string
}

export interface EgressReportGroup {
  key: string
  host: string
  feature: string
  provider: string
  reason: string
  allowedCount: number
  blockedCount: number
  lastSeenAt: string
}

export interface EgressReport {
  events: EgressEvent[]
  groups: EgressReportGroup[]
  warnings: EgressLogWarning[]
}

export function egressLogPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.llm-wiki/egress.jsonl`
}

export function buildEgressEvent(input: AppendEgressEventInput): EgressEvent {
  const url = input.decision.url
  const event: EgressEvent = {
    schemaVersion: EGRESS_SCHEMA_VERSION,
    timestamp: input.timestamp ?? new Date().toISOString(),
    feature: input.feature,
    provider: input.provider,
    reason: input.reason,
    transport: input.transport ?? "http",
    allowed: input.decision.allowed,
    decisionReason: input.decision.reason,
    policyMode: input.decision.policy.mode,
    url: {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      origin: url.origin,
      kind: url.kind,
    },
  }
  if (typeof input.requestBytes === "number" && Number.isFinite(input.requestBytes)) {
    event.requestBytes = Math.max(0, Math.round(input.requestBytes))
  }
  return event
}

export async function appendEgressEvent(
  projectPath: string | null | undefined,
  input: AppendEgressEventInput,
): Promise<void> {
  if (!projectPath) return

  const pp = normalizePath(projectPath)
  const event = buildEgressEvent(input)
  const line = `${JSON.stringify(event)}\n`

  try {
    await createDirectory(`${pp}/.llm-wiki`).catch(() => {})
    await appendFile(egressLogPath(pp), line)
  } catch (err) {
    console.warn(`[egress] failed to append egress event: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function readEgressReport(
  projectPath: string,
  options: { now?: Date; days?: number } = {},
): Promise<EgressReport> {
  let raw = ""
  try {
    raw = await readFile(egressLogPath(projectPath))
  } catch {
    return { events: [], groups: [], warnings: [] }
  }

  const now = options.now ?? new Date()
  const days = options.days ?? 7
  const earliest = now.getTime() - days * 24 * 60 * 60 * 1000
  const events: EgressEvent[] = []
  const warnings: EgressLogWarning[] = []

  const lines = raw.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as unknown
      if (!isEgressEvent(parsed)) {
        warnings.push({
          line: i + 1,
          message: "Invalid egress JSON: expected a schemaVersion=1 object.",
          raw: line,
        })
        continue
      }
      const ts = Date.parse(parsed.timestamp)
      if (!Number.isFinite(ts) || ts < earliest || ts > now.getTime()) continue
      events.push(parsed)
    } catch (err) {
      warnings.push({
        line: i + 1,
        message: `Invalid egress JSON: ${err instanceof Error ? err.message : String(err)}`,
        raw: line,
      })
    }
  }

  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return {
    events,
    groups: groupEgressEvents(events),
    warnings,
  }
}

function groupEgressEvents(events: readonly EgressEvent[]): EgressReportGroup[] {
  const groups = new Map<string, EgressReportGroup>()
  for (const event of events) {
    const host = event.url.hostname || event.url.origin || "unknown"
    const key = `${host}|${event.provider}|${event.reason}|${event.feature}`
    const existing = groups.get(key)
    if (existing) {
      if (event.allowed) existing.allowedCount++
      else existing.blockedCount++
      if (event.timestamp > existing.lastSeenAt) existing.lastSeenAt = event.timestamp
      continue
    }
    groups.set(key, {
      key,
      host,
      feature: event.feature,
      provider: event.provider,
      reason: event.reason,
      allowedCount: event.allowed ? 1 : 0,
      blockedCount: event.allowed ? 0 : 1,
      lastSeenAt: event.timestamp,
    })
  }

  return [...groups.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
}

function isEgressEvent(value: unknown): value is EgressEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Partial<EgressEvent>
  return (
    record.schemaVersion === EGRESS_SCHEMA_VERSION &&
    typeof record.timestamp === "string" &&
    typeof record.feature === "string" &&
    typeof record.provider === "string" &&
    typeof record.reason === "string" &&
    typeof record.transport === "string" &&
    typeof record.allowed === "boolean" &&
    typeof record.decisionReason === "string" &&
    typeof record.policyMode === "string" &&
    !!record.url &&
    typeof record.url === "object" &&
    typeof record.url.hostname === "string"
  )
}
