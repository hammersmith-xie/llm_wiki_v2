export function hasDominantMarkdownTable(body: string): boolean {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length < 3) return false

  const tableLines = lines.filter(isPipeTableLine)
  return tableLines.length >= 3 && tableLines.length / lines.length > 0.6
}

export function extractFirstTableAsCsv(body: string): string | null {
  const tableLines = firstPipeTableLines(body)
  if (tableLines.length < 2) return null

  const rows = tableLines
    .filter((line) => !isAlignmentRow(line))
    .map(parsePipeRow)
    .filter((cells) => cells.length > 0)
  if (rows.length < 2) return null

  return rows
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n")
}

function firstPipeTableLines(body: string): string[] {
  const lines = body.split("\n")
  const table: string[] = []
  let inTable = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (isPipeTableLine(trimmed)) {
      inTable = true
      table.push(trimmed)
      continue
    }
    if (inTable) break
  }

  return table
}

function isPipeTableLine(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|") && line.split("|").length >= 4
}

function isAlignmentRow(line: string): boolean {
  const cells = parsePipeRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
}

function parsePipeRow(row: string): string[] {
  return row
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim().replace(/<br\s*\/?>/gi, "\n"))
}

function escapeCsvCell(cell: string): string {
  if (/[",\n\r]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`
  }
  return cell
}
