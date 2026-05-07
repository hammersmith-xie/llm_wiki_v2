use std::fs;
use std::path::Path;

use chrono::Local;

use crate::panic_guard::run_guarded;
use crate::types::wiki::WikiProject;

#[tauri::command]
pub fn create_project(name: String, path: String) -> Result<WikiProject, String> {
    run_guarded("create_project", || create_project_impl(name, path))
}

fn create_project_impl(name: String, path: String) -> Result<WikiProject, String> {
    let root = Path::new(&path).join(&name);

    if root.exists() {
        return Err(format!("Directory already exists: '{}'", root.display()));
    }

    // Create all required subdirectories
    let dirs = [
        "raw/sources",
        "raw/assets",
        "wiki/entities",
        "wiki/concepts",
        "wiki/sources",
        "wiki/queries",
        "wiki/comparisons",
        "wiki/synthesis",
    ];
    for dir in &dirs {
        fs::create_dir_all(root.join(dir))
            .map_err(|e| format!("Failed to create directory '{}': {}", dir, e))?;
    }

    let today = Local::now().format("%Y-%m-%d").to_string();

    // schema.md
    let schema_content = format!(
        r#"# Wiki Schema

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
| entity | wiki/entities/ | Named things (models, companies, people, datasets) |
| concept | wiki/concepts/ | Ideas, techniques, phenomena |
| source | wiki/sources/ | Papers, articles, talks, blog posts |
| query | wiki/queries/ | Open questions under investigation |
| comparison | wiki/comparisons/ | Side-by-side analysis of related entities |
| synthesis | wiki/synthesis/ | Cross-cutting summaries and conclusions |

## Naming Conventions

- Files: `kebab-case.md`
- Entities: match official name where possible (e.g., `gpt-4.md`, `openai.md`)
- Concepts: descriptive noun phrases (e.g., `chain-of-thought.md`)
- Sources: `author-year-slug.md` (e.g., `wei-2022-chain-of-thought.md`)
- Queries: question as slug (e.g., `does-scale-improve-reasoning.md`)

## Machine-readable Schema Contract

The following block is app-readable. Keep it in sync with the human-readable
rules below when evolving this project schema.

```yaml llm-wiki-schema-contract
version: 1
name: llm-wiki-v2-default
pageTypes:
  - type: entity
    directory: wiki/entities/
    description: Named things such as people, tools, organizations, and datasets.
  - type: concept
    directory: wiki/concepts/
    description: Ideas, techniques, phenomena, and frameworks.
  - type: source
    directory: wiki/sources/
    description: Papers, articles, talks, books, and blog posts.
  - type: query
    directory: wiki/queries/
    description: Open questions and crystallized explorations.
  - type: comparison
    directory: wiki/comparisons/
    description: Side-by-side analysis of related entities or concepts.
  - type: synthesis
    directory: wiki/synthesis/
    description: Cross-cutting summaries and conclusions.
  - type: overview
    directory: wiki/
    description: High-level project summary.
frontmatterFields:
  - name: type
    kind: enum
    required: true
    values: [entity, concept, source, query, comparison, synthesis, overview]
  - name: title
    kind: string
    required: true
  - name: tags
    kind: string-array
    required: true
  - name: related
    kind: string-array
    required: true
  - name: created
    kind: date
    required: true
  - name: updated
    kind: date
    required: true
  - name: lifecycle
    kind: enum
    recommended: true
    values: [working, episodic, semantic, procedural, archived]
  - name: confidence
    kind: score
    recommended: true
  - name: confidence_reasons
    kind: string-array
    recommended: true
  - name: last_confirmed
    kind: date
    recommended: true
  - name: reinforcement_count
    kind: integer-string
    recommended: true
  - name: quality_score
    kind: score
    recommended: true
  - name: review_status
    kind: enum
    recommended: true
    values: [ok, needs-review, stale, contradicted]
  - name: scope
    kind: enum
    recommended: true
    values: [shared, private]
relations:
  graphSeedFields: [alias, aliases, keywords]
  genericRelationFields: [related]
  typedRelationFields: [uses, depends_on, contradicts, supports, supersedes, superseded_by]
quality:
  minQualityScore: 0.55
  minConfidence: 0.45
  minRelationCount: 1
  requiredSections: [Summary]
memoryOps:
  sourceOfTruth: markdown
  auditPath: .llm-wiki/audit.jsonl
  requiresPreviewForMetadataPatch: true
  privateScopeRedaction: true
```

## Frontmatter

All pages must include YAML frontmatter:

```yaml
---
type: entity | concept | source | query | comparison | synthesis | overview
title: Human-readable title
tags: []
related: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

LLM Wiki v2 lifecycle fields are page-level metadata. The app can fill missing
values deterministically, but generated pages should include them when known:

```yaml
lifecycle: working | episodic | semantic | procedural | archived
confidence: "0.00"
confidence_reasons: []
last_confirmed: YYYY-MM-DD
reinforcement_count: "0"
supersedes: []
superseded_by: []
quality_score: "0.00"
review_status: ok | needs-review | stale | contradicted
scope: shared
```

Graph seed arrays are lightweight aliases used by search and local graph
expansion. They do not create edges by themselves:

```yaml
alias: []
aliases: []
keywords: []
```

Typed relationship arrays are bare page slugs and should be used only when the
relationship is stronger than a generic wikilink:

```yaml
uses: []
depends_on: []
contradicts: []
supports: []
supersedes: []
superseded_by: []
```

Memory Ops and audit rules:
- Markdown pages remain the source of truth. Graph, vector, search evaluation,
  audit summaries, and patrol reports are derived state.
- `.llm-wiki/audit.jsonl` is an append-only app-owned event log. Do not
  hand-edit it except during explicit recovery.
- Memory Ops patrol may suggest lifecycle, relation, retention, contradiction,
  and crystallization metadata changes, but it must not silently rewrite page
  bodies.
- Apply metadata changes only after previewing the frontmatter diff. Ignore and
  apply decisions should be audit events.
- Keep `scope: private` for pages whose titles, sources, or evidence should be
  redacted from audit details.
- When evidence reconfirms a page, update `last_confirmed`,
  `reinforcement_count`, and `confidence_reasons` instead of only changing
  prose.

Source pages also include:
```yaml
authors: []
year: YYYY
url: ""
venue: ""
```

## Index Format

`wiki/index.md` lists all pages grouped by type. Each entry:
```
- [[page-slug]] — one-line description
```

## Log Format

`wiki/log.md` records research activity in reverse chronological order:
```
## YYYY-MM-DD

- Action taken / finding noted
```

## Cross-referencing Rules

- Use `[[page-slug]]` syntax to link between wiki pages
- Every entity and concept should appear in `wiki/index.md`
- Queries link to the sources and concepts they draw on
- Synthesis pages cite contributing pages via `related:` and stronger support
  links via `supports:`

## Contradiction Handling

When sources contradict each other:
1. Note the contradiction in the relevant concept or entity page
2. Create or update a query page to track the open question
3. Link both sources from the query page
4. Resolve in a synthesis page once sufficient evidence exists
"#
    );
    write_file_inner(root.join("schema.md"), &schema_content)?;

    // purpose.md
    let purpose_content = r#"# Project Purpose

## Goal

<!-- What are you trying to understand or build? -->

## Key Questions

<!-- List the primary questions driving this research -->

1.
2.
3.

## Scope

<!-- What is in scope? What is explicitly out of scope? -->

**In scope:**
-

**Out of scope:**
-

## Thesis

<!-- Your current working hypothesis or conclusion (update as research progresses) -->

> TBD
"#;
    write_file_inner(root.join("purpose.md"), purpose_content)?;

    // wiki/index.md
    let index_content = r#"# Wiki Index

## Entities

## Concepts

## Sources

## Queries

## Comparisons

## Synthesis
"#;
    write_file_inner(root.join("wiki/index.md"), index_content)?;

    // wiki/log.md
    let log_content = format!(
        r#"# Research Log

## {today}

- Project created
"#
    );
    write_file_inner(root.join("wiki/log.md"), &log_content)?;

    // wiki/overview.md
    let overview_content = format!(
        r#"---
type: overview
title: Project Overview
tags: []
related: []
lifecycle: semantic
confidence: "0.45"
confidence_reasons: []
last_confirmed: {today}
reinforcement_count: "0"
supersedes: []
superseded_by: []
quality_score: "0.45"
review_status: needs-review
scope: shared
---

# Overview

<!-- Provide a high-level summary of what this wiki covers and its current state. Update regularly as understanding deepens. -->
"#
    );
    write_file_inner(root.join("wiki/overview.md"), &overview_content)?;

    // .obsidian config for Obsidian compatibility
    fs::create_dir_all(root.join(".obsidian"))
        .map_err(|e| format!("Failed to create .obsidian: {}", e))?;

    // Obsidian app config: set attachment folder, exclude hidden dirs
    let obsidian_app_config = r#"{
  "attachmentFolderPath": "raw/assets",
  "userIgnoreFilters": [
    ".cache",
    ".llm-wiki",
    ".superpowers"
  ],
  "useMarkdownLinks": false,
  "newLinkFormat": "shortest",
  "showUnsupportedFiles": false
}"#;
    write_file_inner(root.join(".obsidian/app.json"), obsidian_app_config)?;

    // Obsidian appearance: dark mode
    let obsidian_appearance = r#"{
  "baseFontSize": 16,
  "theme": "obsidian"
}"#;
    write_file_inner(root.join(".obsidian/appearance.json"), obsidian_appearance)?;

    // Enable graph view and backlinks core plugins
    let obsidian_core_plugins = r#"{
  "file-explorer": true,
  "global-search": true,
  "graph": true,
  "backlink": true,
  "tag-pane": true,
  "page-preview": true,
  "outgoing-link": true,
  "starred": true
}"#;
    write_file_inner(
        root.join(".obsidian/core-plugins.json"),
        obsidian_core_plugins,
    )?;

    Ok(WikiProject {
        name,
        // Forward slashes for cross-platform consistency in the TS layer.
        path: root.to_string_lossy().replace('\\', "/"),
    })
}

#[tauri::command]
pub fn open_project(path: String) -> Result<WikiProject, String> {
    run_guarded("open_project", || {
        let root = Path::new(&path);

        if !root.exists() {
            return Err(format!("Path does not exist: '{}'", path));
        }
        if !root.is_dir() {
            return Err(format!("Path is not a directory: '{}'", path));
        }

        // Validate that this looks like a wiki project
        if !root.join("schema.md").exists() {
            return Err(format!(
                "Not a valid wiki project (missing schema.md): '{}'",
                path
            ));
        }
        if !root.join("wiki").is_dir() {
            return Err(format!(
                "Not a valid wiki project (missing wiki/ directory): '{}'",
                path
            ));
        }

        // Derive project name from the directory name
        let name = root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();

        Ok(WikiProject {
            name,
            // Forward slashes for cross-platform consistency in the TS layer.
            path: path.replace('\\', "/"),
        })
    })
}

fn write_file_inner(path: std::path::PathBuf, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create parent dirs for '{}': {}",
                path.display(),
                e
            )
        })?;
    }
    fs::write(&path, contents)
        .map_err(|e| format!("Failed to write file '{}': {}", path.display(), e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEMP_ID: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn create_project_schema_documents_v2_seed_and_relationship_arrays() {
        let parent = std::env::temp_dir().join(format!(
            "llm-wiki-project-schema-test-{}-{}",
            std::process::id(),
            NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&parent).unwrap();

        let project = create_project_impl(
            "schema-check".to_string(),
            parent.to_string_lossy().to_string(),
        )
        .unwrap();
        let schema = fs::read_to_string(Path::new(&project.path).join("schema.md")).unwrap();

        assert!(schema.contains("Graph seed arrays"));
        assert!(schema.contains("```yaml llm-wiki-schema-contract"));
        assert!(schema.contains("version: 1"));
        assert!(schema.contains("name: llm-wiki-v2-default"));
        assert!(schema.contains("frontmatterFields:"));
        assert!(schema.contains("typedRelationFields: [uses, depends_on, contradicts, supports, supersedes, superseded_by]"));
        assert!(schema.contains("minQualityScore: 0.55"));
        assert!(schema.contains("requiresPreviewForMetadataPatch: true"));
        assert!(schema.contains("alias: []"));
        assert!(schema.contains("aliases: []"));
        assert!(schema.contains("keywords: []"));
        assert!(schema.contains("supersedes: []"));
        assert!(schema.contains("superseded_by: []"));
        assert!(schema.contains("depends_on: []"));
        assert!(schema.contains("Memory Ops and audit rules"));
        assert!(schema.contains(".llm-wiki/audit.jsonl"));
        assert!(schema.contains("previewing the frontmatter diff"));

        let _ = fs::remove_dir_all(parent);
    }
}
