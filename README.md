# MinerU Zotero Reader

MinerU Zotero Reader is a Codex skill for reading Zotero PDF attachments through a Zotero + MinerU + Markdown workflow. It converts academic PDFs to MinerU Markdown, then creates quick-read, deep-read, or writing-level reading notes while keeping Zotero as the source library.

![MinerU Zotero Reader workflow](docs/images/mineru-zotero-reader-workflow.png)

Important distinction: the Zotero Bridge XPI must be installed in Zotero. On the Codex side, users need Codex CLI plus the `mineru-zotero-reader` skill.

## Installation Guide

For a step-by-step Chinese installation and usage guide, including Codex CLI login, MinerU API Token setup, custom `skillRoot` paths, Zotero XPI installation, first-run checks, and troubleshooting, see:

```text
docs/INSTALL.zh-CN.md
```

## Install Zotero Bridge

Install the current bridge XPI in Zotero from:

```text
assets/zotero-bridge/codexzoterobridge-installable@polygon.org.xpi
```

The versioned copy for this release is:

```text
assets/zotero-bridge/codexzoterobridge-0.3.16@polygon.org.xpi
```

If the skill is installed outside the default `~/.codex/skills/mineru-zotero-reader` path, configure this Zotero preference:

```text
extensions.codexZoteroBridge.skillRoot
```

## What Changed in 0.3.12

- Fixed Windows VBS/codepage corruption with Chinese PDF paths.
- Improved MinerU result download reliability with retry and fallback handling.
- Standardized generated formula syntax to `$...$` for inline math and `$$...$$` for display math.
- Broadened MinerU download failure detection for curl, SSL/TLS, schannel, connection reset, and timeout errors.
- Added `noteMarkerWarning` to detect repeated Codex note marker blocks.
- Writes bridge status JSON as UTF-8 with BOM for readable Chinese paths and titles in Windows tools.
- Updated manual parsing wrappers to prefer `uv`, then `py`, then `python`.
- Hardened ZIP extraction with strict target path boundary checks.
- Rebuilt the Zotero bridge XPI as version `0.3.12`.

## What Changed in 0.3.16

- Restored the Zotero `update_url` manifest field required for plugin compatibility checks.
- Kept the bridge author as `zxc` and homepage as the GitHub repository.

## What Changed in 0.3.15

- Rebuilt the Zotero bridge XPI with a BOM-free manifest so Zotero can install it correctly.

## What Changed in 0.3.14

- Updated the Zotero bridge author metadata to `zxc`.
- Updated the Zotero bridge homepage to `https://github.com/zxc-heu/mineru-zotero-reader`.
- Rebuilt the Zotero bridge XPI as version `0.3.14`.
## What Changed in 0.3.13

- Added configurable skill discovery through `extensions.codexZoteroBridge.skillRoot`.
- Added fallback skill discovery through `CODEX_ZOTERO_READER_SKILL_ROOT`, `~/.codex/skills/mineru-zotero-reader`, and `~/.agents/skills/mineru-zotero-reader`.
- Added `skillRoot` and `mineruScriptPath` to status JSON when MinerU parsing runs.
- Rewrote the Chinese installation guide for first-time users.
- Rebuilt the Zotero bridge XPI as version `0.3.13`.

## Release Acceptance

Before publishing a release, verify the following:

1. Install `codexzoterobridge-installable@polygon.org.xpi` in Zotero.
2. Run quickread on a PDF that already has sibling MinerU Markdown; MinerU should not reparse it.
3. Run deepread on a PDF that needs MinerU parsing; upload, parse, result download, Markdown save, and Zotero linked attachment should complete.
4. Check the generated `.status.json` file:
   - `stage` is `completed`.
   - `mineruDownloadFailure` is `false`.
   - `fallback` is `false` unless an intentional fallback occurred.
   - `zoteroLinked` is `true` for Zotero bridge runs.
   - Chinese paths and titles are readable.
5. Open the generated Markdown note and verify image paths and formula rendering.

## Cleanup Rules

Do not batch-delete generated files or directories. Temporary MinerU zip files may be deleted only one explicit file path at a time after Markdown has been saved. Do not delete `_mineru` directories.


