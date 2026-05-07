import type { AuditEvent } from "@/lib/audit-timeline"

const SECRET_PLACEHOLDER = "[REDACTED:secret]"
const PRIVATE_PLACEHOLDER = "[REDACTED:private]"
const PRIVATE_SCOPE_PLACEHOLDER = "private scope"

const PRIVATE_BLOCK_RE = /<private\b[^>]*>[\s\S]*?<\/private>/gi
const AUTH_BEARER_RE = /(\bAuthorization\s*:\s*Bearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi
const KEY_VALUE_SECRET_RE =
  /\b([A-Za-z0-9_.-]*(?:api[_-]?key|token|secret|password|passwd)[A-Za-z0-9_.-]*\s*[:=]\s*)([^\s"',`<>]+)/gi
const STANDALONE_SECRET_RE =
  /\b(?:sk-[A-Za-z0-9_-]{10,}|sk-proj-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g

export function redactSensitiveText(input: string): string {
  return input
    .replace(PRIVATE_BLOCK_RE, `<private>${PRIVATE_PLACEHOLDER}</private>`)
    .replace(AUTH_BEARER_RE, `$1${SECRET_PLACEHOLDER}`)
    .replace(KEY_VALUE_SECRET_RE, `$1${SECRET_PLACEHOLDER}`)
    .replace(STANDALONE_SECRET_RE, SECRET_PLACEHOLDER)
}

export function redactAuditEvent(event: AuditEvent): AuditEvent {
  if (event.scope === "private") {
    const summary: AuditEvent = {
      schemaVersion: event.schemaVersion,
      timestamp: event.timestamp,
      action: event.action,
      category: event.category,
      actor: event.actor,
      scope: event.scope,
      ...definedPathFields(event),
      reasons: redactUnknown(event.reasons) as string[] | undefined,
      redacted: true,
      redactionReason: PRIVATE_SCOPE_PLACEHOLDER,
    }
    return dropUndefined(summary)
  }

  return redactUnknown(event) as AuditEvent
}

function redactUnknown(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    return isSensitiveKey(key) ? SECRET_PLACEHOLDER : redactSensitiveText(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, key))
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = redactUnknown(childValue, childKey)
    }
    return out
  }

  return value
}

function isSensitiveKey(key: string | undefined): boolean {
  return !!key && /(?:api[_-]?key|token|secret|password|passwd)/i.test(key)
}

function definedPathFields(event: AuditEvent): Partial<AuditEvent> {
  return dropUndefined({
    pagePath: event.pagePath,
    targetPath: event.targetPath,
    sourcePath: event.sourcePath,
    dryRun: event.dryRun,
  })
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry
  }
  return out as T
}
