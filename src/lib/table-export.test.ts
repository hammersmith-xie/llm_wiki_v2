import { describe, expect, it } from "vitest"
import {
  extractFirstTableAsCsv,
  hasDominantMarkdownTable,
} from "./table-export"

describe("table export", () => {
  it("detects table-heavy markdown pages", () => {
    expect(hasDominantMarkdownTable([
      "| Model | Score |",
      "| --- | --- |",
      "| A | 0.9 |",
      "| B | 0.8 |",
    ].join("\n"))).toBe(true)

    expect(hasDominantMarkdownTable([
      "# Notes",
      "",
      "This page has a tiny table.",
      "",
      "| A | B |",
      "| --- | --- |",
    ].join("\n"))).toBe(false)
  })

  it("extracts the first pipe table and skips the alignment row", () => {
    const csv = extractFirstTableAsCsv([
      "# Comparison",
      "",
      "| Model | Score |",
      "| :--- | ---: |",
      "| A | 0.9 |",
      "| B | 0.8 |",
    ].join("\n"))

    expect(csv).toBe("Model,Score\nA,0.9\nB,0.8")
  })

  it("escapes commas, quotes, and newlines for CSV", () => {
    const csv = extractFirstTableAsCsv([
      "| Name | Note |",
      "| --- | --- |",
      '| A | says "hello, world" |',
      "| B | line 1<br>line 2 |",
    ].join("\n"))

    expect(csv).toBe([
      "Name,Note",
      'A,"says ""hello, world"""',
      'B,"line 1\nline 2"',
    ].join("\n"))
  })

  it("returns null when no valid table exists", () => {
    expect(extractFirstTableAsCsv("# No table\n\nJust prose.")).toBeNull()
    expect(extractFirstTableAsCsv("| Only | Header |")).toBeNull()
  })
})
