# Global Workflow Rules

Read this file for every MinerU-Zotero reading task.

## Source Selection

- Locate the source PDF first.
- For `paper.pdf`, check for sibling `paper.md`.
- If `paper.md` exists, read it directly and do not call MinerU again unless the user explicitly asks to reparse.
- If `paper.md` does not exist, parse the PDF with the bundled MinerU entrypoint.

## MinerU Parsing

Use one of these entrypoints:

```powershell
scripts/mineru-parse.ps1 "<pdf-path>"
scripts/mineru-parse.cmd "<pdf-path>"
python scripts/mineru_precise_parse.py "<pdf-path>"
```

MinerU API access requires `MINERU_API_TOKEN` unless `--token` is explicitly supplied.

## Output Layout

For `paper.pdf`, the parser creates:

```text
paper.md
paper_mineru\
```

Reading notes are separate files:

```text
paper_quickread.md
paper_deepread.md
paper_writing-read.md
```

## Cleanup Rules

- Temporary MinerU zip files may be deleted only after Markdown has been saved.
- Delete only one explicit generated zip path at a time, such as `paper_mineru.zip`.
- Do not use wildcards, directory deletion, recursive deletion, or batch cleanup.
- Do not delete `_mineru` directories.

## Note Writing

For normal Codex sessions, write notes with `scripts/write_reading_note.py`.

For Zotero one-click reading, do not run the note-writing script. Follow `one-click.md`.
