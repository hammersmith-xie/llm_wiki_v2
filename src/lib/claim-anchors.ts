const CLAIM_ANCHOR_RE = /^\s*<!--\s*claim:(claim_[a-z0-9][a-z0-9_]*)\s*-->\s*$/

export interface ClaimAnchorLocation {
  claimId: string
  line: number
  column: number
  raw: string
}

export interface InsertClaimAnchorInput {
  claimId: string
  claimText?: string
  pageAnchor?: string
}

export interface ResolveClaimAnchorInput {
  claimId: string
  pageAnchor?: string
}

export type ClaimAnchorResolution =
  | (ClaimAnchorLocation & { status: "anchor" })
  | {
      status: "heading-fallback"
      claimId: string
      line: number
      heading: string
    }
  | {
      status: "orphan"
      claimId: string
    }

export function formatClaimAnchor(claimId: string): string {
  assertClaimId(claimId)
  return `<!-- claim:${claimId} -->`
}

export function parseClaimAnchors(content: string): ClaimAnchorLocation[] {
  return splitContentLines(content).lines.flatMap((line, index) => {
    const match = line.match(CLAIM_ANCHOR_RE)
    if (!match) return []
    return [{
      claimId: match[1],
      line: index + 1,
      column: line.indexOf("<!--") + 1,
      raw: line,
    }]
  })
}

export function insertClaimAnchor(
  content: string,
  input: InsertClaimAnchorInput,
): string {
  const anchor = formatClaimAnchor(input.claimId)
  if (parseClaimAnchors(content).some((location) => location.claimId === input.claimId)) {
    return content
  }

  const { lines, eol } = splitContentLines(content)
  const targetLine = findClaimTextLine(lines, input.claimText)
    ?? findHeadingLine(lines, input.pageAnchor)

  if (targetLine === null) {
    if (content.length === 0) return `${anchor}${eol}`
    const needsLeadingBreak = !content.endsWith("\n")
    return `${content}${needsLeadingBreak ? eol : ""}${anchor}${eol}`
  }

  lines.splice(targetLine, 0, anchor)
  return lines.join(eol)
}

export function resolveClaimAnchor(
  content: string,
  input: ResolveClaimAnchorInput,
): ClaimAnchorResolution {
  assertClaimId(input.claimId)
  const explicit = parseClaimAnchors(content)
    .find((location) => location.claimId === input.claimId)
  if (explicit) return { ...explicit, status: "anchor" }

  const { lines } = splitContentLines(content)
  const headingLine = findHeadingLine(lines, input.pageAnchor)
  if (headingLine !== null) {
    return {
      status: "heading-fallback",
      claimId: input.claimId,
      line: headingLine + 1,
      heading: lines[headingLine],
    }
  }

  return { status: "orphan", claimId: input.claimId }
}

function assertClaimId(claimId: string): void {
  if (!/^claim_[a-z0-9][a-z0-9_]*$/.test(claimId)) {
    throw new Error("Invalid claim id")
  }
}

function splitContentLines(content: string): { lines: string[]; eol: "\n" | "\r\n" } {
  return {
    lines: content.split(/\r?\n/),
    eol: content.includes("\r\n") ? "\r\n" : "\n",
  }
}

function findClaimTextLine(
  lines: readonly string[],
  claimText: string | undefined,
): number | null {
  const needle = normalizeInlineText(claimText ?? "")
  if (!needle) return null
  const index = lines.findIndex((line) => normalizeInlineText(line).includes(needle))
  return index === -1 ? null : index
}

function findHeadingLine(
  lines: readonly string[],
  pageAnchor: string | undefined,
): number | null {
  const target = normalizeHeadingIdentity(pageAnchor ?? "")
  if (!target) return null
  const index = lines.findIndex((line) => {
    const heading = parseHeading(line)
    return heading ? normalizeHeadingIdentity(heading) === target : false
  })
  return index === -1 ? null : index
}

function parseHeading(line: string): string | null {
  const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
  return match ? `${match[1]} ${match[2].trim()}` : null
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function normalizeHeadingIdentity(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/\s+#*\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}
