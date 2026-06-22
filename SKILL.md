---
name: mineru-zotero-reader
description: Use when Codex needs to read, quick-read, deep-read, or prepare writing notes from Zotero PDF attachments or academic PDF papers by first converting the PDF to Markdown with MinerU. Trigger on requests involving Zotero PDF reading, MinerU PDF parsing, PDF-to-Markdown research workflows, quick reading, deep reading, writing-level reading, literature notes, topic reviews, or paper analysis where the source is a Zotero PDF or local academic PDF.
---

# MinerU Zotero Reader

Use this skill to read academic PDFs through a Zotero + MinerU + Markdown workflow. Keep `SKILL.md` as the route map only. Read the minimum reference files needed for the current entry point and reading mode; do not read every file in `references/`.

## Route Rules

Always decide two things first:

1. Entry point: Zotero one-click reading, or a normal Codex session.
2. Task mode: quick read, deep read, writing-level read, or Zotero attachment linking only.

Read `references/global.md` for every task. Then read only the files selected below.

| Task | Read these files |
|---|---|
| Zotero one-click + quick read | `references/global.md`, `references/one-click.md`, `references/quickread.md` |
| Zotero one-click + deep read | `references/global.md`, `references/one-click.md`, `references/deepread.md`, `references/formula-style.md` |
| Zotero one-click + writing-level read | `references/global.md`, `references/one-click.md`, `references/writing-read.md`, `references/formula-style.md` |
| Normal quick read | `references/global.md`, `references/quickread.md` |
| Normal deep read | `references/global.md`, `references/deepread.md`, `references/formula-style.md` |
| Normal writing-level read | `references/global.md`, `references/writing-read.md`, `references/formula-style.md` |
| Normal session needs Zotero linked attachment | Add `references/zotero-attach.md` |
| Formula-heavy quick read | Add `references/formula-style.md` only if formulas must be rewritten or explained |

## Core Rules

- Use MinerU Markdown as the reading source. If `paper.md` exists beside `paper.pdf`, use it and do not reparse unless the user explicitly asks.
- Keep Zotero as the source library for PDFs and metadata. Keep Markdown notes as linked attachments, not bibliographic items.
- Use `$...$` for inline formulas and `$$...$$` for display formulas in generated notes. Do not output bare `\(...\)`, `\[` or `\]`.
- Delete only explicit generated zip files one at a time. Never delete `_mineru` directories, never use wildcard cleanup, and never use recursive deletion.
- For Zotero one-click tasks, obey `references/one-click.md`: return the full note only inside the bridge note markers and let the bridge write and attach the file.

## Bundled Scripts

- `scripts/mineru_precise_parse.py`: parse PDFs with the MinerU precise API and save Markdown beside the PDF.
- `scripts/mineru-parse.ps1` and `scripts/mineru-parse.cmd`: Windows wrappers for the parser.
- `scripts/write_reading_note.py`: write normal-session reading notes beside the source PDF.

## Legacy Reference

`references/personal-research-workflow.md` is retained as historical context. Do not use it as the main route target for new tasks unless a referenced route file is missing.
