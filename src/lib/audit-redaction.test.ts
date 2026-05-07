import { describe, expect, it } from "vitest"
import {
  redactAuditEvent,
  redactSensitiveText,
} from "./audit-redaction"

describe("audit redaction", () => {
  it("redacts common secrets while preserving ordinary prose", () => {
    const input = [
      "Keep this architectural note.",
      "OPENAI_API_KEY=sk-proj-abc1234567890secret",
      "Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456",
      "password: hunter2",
      "<private>customer email alice@example.com</private>",
    ].join("\n")

    const output = redactSensitiveText(input)

    expect(output).toContain("Keep this architectural note.")
    expect(output).not.toContain("sk-proj-abc")
    expect(output).not.toContain("ghp_")
    expect(output).not.toContain("hunter2")
    expect(output).not.toContain("alice@example.com")
    expect(output).toContain("OPENAI_API_KEY=[REDACTED:secret]")
    expect(output).toContain("Authorization: Bearer [REDACTED:secret]")
    expect(output).toContain("password: [REDACTED:secret]")
    expect(output).toContain("<private>[REDACTED:private]</private>")
  })

  it("redacts string values recursively inside audit events", () => {
    const output = redactAuditEvent({
      timestamp: "2026-05-07T00:00:00.000Z",
      action: "memory_ops.apply",
      targetPath: "wiki/concepts/a.md",
      reasons: ["token sk-abcdef1234567890 should not leak"],
      after: {
        body: "Use Authorization: Bearer test-token-abcdefghijklmnopqrstuvwxyz",
        nested: {
          password: "hunter2",
          safe: "ordinary note",
        },
      },
    })

    expect(JSON.stringify(output)).not.toContain("sk-abcdef")
    expect(JSON.stringify(output)).not.toContain("test-token")
    expect(JSON.stringify(output)).not.toContain("hunter2")
    expect(output.after).toMatchObject({
      body: "Use Authorization: Bearer [REDACTED:secret]",
      nested: {
        password: "[REDACTED:secret]",
        safe: "ordinary note",
      },
    })
  })

  it("collapses private-scope audit details to a minimal summary", () => {
    const output = redactAuditEvent({
      timestamp: "2026-05-07T00:00:00.000Z",
      action: "memory_ops.apply",
      scope: "private",
      targetPath: "wiki/private/personal.md",
      detail: "personal details",
      before: { body: "old private body" },
      after: { body: "new private body" },
      reasons: ["manual confirmation"],
    })

    expect(output).toEqual({
      timestamp: "2026-05-07T00:00:00.000Z",
      action: "memory_ops.apply",
      scope: "private",
      targetPath: "wiki/private/personal.md",
      reasons: ["manual confirmation"],
      redacted: true,
      redactionReason: "private scope",
    })
  })
})
