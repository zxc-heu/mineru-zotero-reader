#!/usr/bin/env python3
"""Write quick/deep/writing reading notes beside a source PDF."""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from pathlib import Path


LEVEL_SUFFIX = {
    "quickread": "_quickread.md",
    "deepread": "_deepread.md",
    "writing-read": "_writing-read.md",
}


def yaml_scalar(value: str) -> str:
    value = value.encode("utf-8", errors="replace").decode("utf-8")
    value = value.strip()
    if not value:
        return ""
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def read_body(args: argparse.Namespace) -> str:
    if args.body_file:
        return Path(args.body_file).expanduser().read_text(encoding="utf-8").strip()
    raw = sys.stdin.read()
    if args.body_stdin_base64:
        try:
            return base64.b64decode(raw.strip(), validate=True).decode("utf-8").strip()
        except (ValueError, UnicodeDecodeError) as exc:
            raise RuntimeError("Invalid UTF-8 base64 note body from stdin.") from exc
    return raw.strip()


def note_path_for(source_pdf: Path, level: str) -> Path:
    return source_pdf.with_name(f"{source_pdf.stem}{LEVEL_SUFFIX[level]}")


def resolve_source_pdf(args: argparse.Namespace) -> Path:
    if args.source_pdf:
        return Path(args.source_pdf).expanduser().resolve()
    source_dir = Path(args.source_dir).expanduser().resolve()
    pdfs = sorted(source_dir.glob("*.pdf"))
    if not pdfs:
        raise FileNotFoundError(f"No PDF found in {source_dir}")
    if len(pdfs) > 1:
        raise RuntimeError(f"Multiple PDFs found in {source_dir}; pass --source-pdf explicitly.")
    return pdfs[0]


def resolve_mineru_md(source_pdf: Path, mineru_md: str | None) -> str:
    if mineru_md:
        return str(Path(mineru_md).expanduser().resolve())
    candidate = source_pdf.with_suffix(".md")
    return str(candidate) if candidate.exists() else ""


def backup_existing(path: Path) -> Path | None:
    if not path.exists():
        return None
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    backup = path.with_name(f"{path.stem}_{timestamp}.bak.md")
    index = 2
    while backup.exists():
        backup = path.with_name(f"{path.stem}_{timestamp}_{index}.bak.md")
        index += 1
    backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    return backup


def build_frontmatter(args: argparse.Namespace) -> str:
    fields = {
        "title": args.title,
        "authors": args.authors,
        "year": args.year,
        "journal": args.journal,
        "doi": args.doi,
        "zotero_key": args.zotero_key,
        "citekey": args.citekey,
        "status": args.status,
        "relevance": args.relevance,
        "source_pdf": str(args.resolved_source_pdf),
        "mineru_md": args.resolved_mineru_md,
    }
    lines = ["---"]
    for key, value in fields.items():
        lines.append(f"{key}: {yaml_scalar(value or '')}")
    lines.append("---")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Save a MinerU-Zotero reading note beside the source PDF.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--source-pdf", "--pdf", dest="source_pdf", help="Source PDF path. --pdf is kept as a legacy alias.")
    source.add_argument("--source-dir", help="Directory containing exactly one source PDF.")
    parser.add_argument("--mineru-md", help="MinerU-generated Markdown source path.")
    parser.add_argument("--level", "--mode", dest="level", required=True, choices=sorted(LEVEL_SUFFIX), help="Reading note type. --mode is kept as a legacy alias.")
    parser.add_argument("--body-file", help="Read note body from this Markdown file. Defaults to stdin.")
    parser.add_argument("--body-stdin-base64", action="store_true", help="Read UTF-8 base64 encoded note body from stdin.")
    parser.add_argument("--title", default="")
    parser.add_argument("--authors", default="")
    parser.add_argument("--year", default="")
    parser.add_argument("--journal", default="")
    parser.add_argument("--doi", default="")
    parser.add_argument("--zotero-key", default="")
    parser.add_argument("--citekey", default="")
    parser.add_argument("--status", default="")
    parser.add_argument("--relevance", default="")
    parser.add_argument("--json", action="store_true", help="Print JSON result.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        source_pdf = resolve_source_pdf(args)
    except (FileNotFoundError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if not source_pdf.exists():
        print(f"Source PDF not found: {source_pdf}", file=sys.stderr)
        return 2
    args.resolved_source_pdf = source_pdf
    args.resolved_mineru_md = resolve_mineru_md(source_pdf, args.mineru_md)

    body = read_body(args)
    body = body.encode("utf-8", errors="replace").decode("utf-8")
    if not body:
        print("Reading note body is empty.", file=sys.stderr)
        return 2

    note_path = note_path_for(source_pdf, args.level)
    backup_path = backup_existing(note_path)
    text = f"{build_frontmatter(args)}\n\n{body.strip()}\n"
    note_path.write_text(text, encoding="utf-8", newline="\n")

    result = {
        "source_pdf": str(source_pdf),
        "mineru_md": args.resolved_mineru_md,
        "note_md": str(note_path),
        "backup_md": str(backup_path) if backup_path else None,
        "level": args.level,
    }
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"Note saved: {note_path}")
        if backup_path:
            print(f"Previous note backed up: {backup_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
