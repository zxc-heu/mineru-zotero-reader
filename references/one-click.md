# Zotero One-Click Entry Rules

Read this file only when the task is launched by the Zotero bridge right-click menu.

Zotero one-click reading is an entry point, not a reading mode. Combine this file with the selected mode file.

## Bridge Contract

- Do not explore Zotero write APIs.
- Do not create Zotero bibliographic items.
- Do not call the Zotero helper from inside Codex.
- Do not run `write_reading_note.py`.
- Do not create temporary body files.
- Return the complete Markdown note only inside these exact marker lines:

```text
::codex-zotero-note-start::
<complete Markdown note with YAML frontmatter>
::codex-zotero-note-end::
```

- Outside the marker block, return only a short result with source Markdown path, MinerU output directory path, and note path.
- The bridge writes the note file and links it back to Zotero after Codex exits.

## Status and Logs

The bridge writes sibling status files:

```text
paper_quickread.status.json
paper_deepread.status.json
paper_writing-read.status.json
```

Logs can contain full note blocks. The bridge extracts the last complete valid block. Do not bulk-delete logs.
