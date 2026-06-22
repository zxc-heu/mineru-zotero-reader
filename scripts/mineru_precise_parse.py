#!/usr/bin/env python3
"""Parse local documents with MinerU precise API and save Markdown beside them."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath


API_BASE = "https://mineru.net"
APPLY_UPLOAD_URL = f"{API_BASE}/api/v4/file-urls/batch"
BATCH_RESULT_URL = f"{API_BASE}/api/v4/extract-results/batch"
DONE_STATES = {"done", "failed"}
SUPPORTED_MODELS = {"pipeline", "vlm", "MinerU-HTML"}
MAX_DATA_ID_LENGTH = 128


class MinerUError(RuntimeError):
    pass


def tolerant_ssl_context() -> ssl.SSLContext | None:
    try:
        context = ssl.create_default_context()
        ignore_unexpected_eof = getattr(ssl, "OP_IGNORE_UNEXPECTED_EOF", 0)
        if ignore_unexpected_eof:
            context.options |= ignore_unexpected_eof
        return context
    except Exception:
        return None


def request_json(method: str, url: str, token: str, payload: dict | None = None) -> dict:
    body = None
    headers = {
        "Accept": "*/*",
        "Authorization": f"Bearer {token}",
    }
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise MinerUError(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise MinerUError(f"Network error: {exc.reason}") from exc

    try:
        result = json.loads(text)
    except json.JSONDecodeError as exc:
        raise MinerUError(f"Invalid JSON response: {text[:500]}") from exc

    if result.get("code") != 0:
        msg = result.get("msg", "unknown error")
        trace_id = result.get("trace_id", "")
        suffix = f" trace_id={trace_id}" if trace_id else ""
        raise MinerUError(f"MinerU API error: {msg}{suffix}")
    return result


def put_file(upload_url: str, path: Path) -> None:
    parsed = urllib.parse.urlparse(upload_url)
    connection_cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    path_with_query = parsed.path
    if parsed.query:
        path_with_query += f"?{parsed.query}"

    with path.open("rb") as f:
        conn = connection_cls(parsed.netloc, timeout=600)
        try:
            conn.putrequest("PUT", path_with_query)
            conn.putheader("Content-Length", str(path.stat().st_size))
            conn.endheaders()
            while True:
                chunk = f.read(1024 * 1024)
                if not chunk:
                    break
                conn.send(chunk)
            resp = conn.getresponse()
            detail = resp.read().decode("utf-8", errors="replace")
            if resp.status not in (200, 201, 204):
                raise MinerUError(f"Upload failed for {path.name}: HTTP {resp.status}: {detail}")
        except OSError as exc:
            raise MinerUError(f"Upload failed for {path.name}: {exc}") from exc
        finally:
            conn.close()


def download_file_with_curl(url: str, target: Path, retries: int, retry_delay: int) -> bool:
    curl = shutil.which("curl.exe") or shutil.which("curl")
    if not curl:
        return False

    last_error = ""
    for attempt in range(1, retries + 1):
        cmd = [
            curl,
            "--location",
            "--fail",
            "--silent",
            "--show-error",
            "--connect-timeout",
            "60",
            "--max-time",
            "900",
            "--output",
            str(target),
            url,
        ]
        result = subprocess.run(cmd, text=True, capture_output=True)
        if result.returncode == 0 and target.exists() and target.stat().st_size > 0:
            return True
        last_error = (result.stderr or result.stdout or f"curl exit code {result.returncode}").strip()
        if attempt < retries:
            print(f"curl download attempt {attempt}/{retries} failed: {last_error}; retrying in {retry_delay}s", file=sys.stderr)
            time.sleep(retry_delay)

    raise MinerUError(f"curl download failed after {retries} attempts: {last_error}")


def download_file(url: str, target: Path, retries: int = 5, retry_delay: int = 8) -> None:
    req = urllib.request.Request(url, headers={"Accept": "*/*"})
    ssl_context = tolerant_ssl_context()
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            open_kwargs = {"timeout": 600}
            if ssl_context is not None and urllib.parse.urlparse(url).scheme == "https":
                open_kwargs["context"] = ssl_context
            with urllib.request.urlopen(req, **open_kwargs) as resp, target.open("wb") as f:
                while True:
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
            if target.exists() and target.stat().st_size > 0 and zipfile.is_zipfile(target):
                return
            last_error = MinerUError("download completed but did not produce a valid zip file")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise MinerUError(f"Download failed: HTTP {exc.code}: {detail}") from exc
        except (urllib.error.URLError, OSError) as exc:
            last_error = exc

        if attempt < retries:
            print(f"Download attempt {attempt}/{retries} failed: {last_error}; retrying in {retry_delay}s", file=sys.stderr)
            time.sleep(retry_delay)

    print(f"urllib download failed after {retries} attempts: {last_error}; trying curl fallback", file=sys.stderr)
    if download_file_with_curl(url, target, retries=retries, retry_delay=retry_delay):
        if target.exists() and target.stat().st_size > 0 and zipfile.is_zipfile(target):
            return
        raise MinerUError("curl download completed but did not produce a valid zip file")

    raise MinerUError(f"Download failed after {retries} attempts: {last_error}")


def safe_extract_zip(zip_path: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    base = output_dir.resolve()
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.infolist():
            target = (output_dir / member.filename).resolve()
            try:
                target.relative_to(base)
            except ValueError as exc:
                raise MinerUError(f"Unsafe zip entry: {member.filename}")
        zf.extractall(output_dir)


def unique_output_dir(source: Path) -> Path:
    base = source.with_name(f"{source.stem}_mineru")
    if not base.exists():
        return base
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    candidate = source.with_name(f"{source.stem}_mineru_{timestamp}")
    index = 2
    while candidate.exists():
        candidate = source.with_name(f"{source.stem}_mineru_{timestamp}_{index}")
        index += 1
    return candidate


def find_full_md(extract_dir: Path) -> Path:
    matches = sorted(extract_dir.rglob("full.md"))
    if not matches:
        matches = sorted(extract_dir.rglob("*.md"))
    if not matches:
        raise MinerUError(f"No Markdown file found in {extract_dir}")
    return matches[0]


def should_rewrite_link(target: str) -> bool:
    if not target or target.startswith("#"):
        return False
    parsed = urllib.parse.urlparse(target)
    if parsed.scheme or parsed.netloc:
        return False
    return True


def rewrite_relative_links(markdown: str, md_path: Path, extract_dir: Path, sibling_name: str) -> str:
    rel_md_parent = md_path.parent.relative_to(extract_dir).as_posix()

    def prefix_target(target: str) -> str:
        if not should_rewrite_link(target):
            return target
        parsed = urllib.parse.urlparse(target)
        clean_path = parsed.path.replace("\\", "/")
        base = PurePosixPath(sibling_name)
        if rel_md_parent != ".":
            base = base / rel_md_parent
        rewritten = (base / clean_path).as_posix()
        if parsed.query:
            rewritten += f"?{parsed.query}"
        if parsed.fragment:
            rewritten += f"#{parsed.fragment}"
        return rewritten

    def replace_markdown_link(match: re.Match[str]) -> str:
        alt_or_text, target = match.group(1), match.group(2)
        return f"{match.group(0)[0] if match.group(0).startswith('!') else ''}[{alt_or_text}]({prefix_target(target)})"

    markdown = re.sub(r"(!?)\[([^\]]*)\]\(([^)\s]+)\)", lambda m: f"{m.group(1)}[{m.group(2)}]({prefix_target(m.group(3))})", markdown)
    markdown = re.sub(
        r'((?:src|href)=["\'])([^"\']+)(["\'])',
        lambda m: f"{m.group(1)}{prefix_target(m.group(2))}{m.group(3)}",
        markdown,
        flags=re.IGNORECASE,
    )
    return markdown


def make_data_id(path: Path, index: int, timestamp: int | None = None) -> str:
    """Create a MinerU data_id that stays below the API's 128-character limit."""
    timestamp = int(time.time()) if timestamp is None else timestamp
    normalized = re.sub(r"[^A-Za-z0-9_-]+", "_", path.stem).strip("_")
    if not normalized:
        normalized = "document"
    digest = hashlib.sha1(str(path).encode("utf-8")).hexdigest()[:12]
    suffix = f"_{timestamp}_{index}_{digest}"
    max_prefix = MAX_DATA_ID_LENGTH - len(suffix)
    if max_prefix < 1:
        raise MinerUError("Internal error: MinerU data_id suffix exceeds maximum length")
    return f"{normalized[:max_prefix]}{suffix}"


def apply_upload_urls(args: argparse.Namespace, paths: list[Path], token: str) -> str:
    files = []
    timestamp = int(time.time())
    for index, path in enumerate(paths):
        data_id = make_data_id(path, index, timestamp)
        item = {"name": path.name, "data_id": data_id}
        if args.is_ocr:
            item["is_ocr"] = True
        if args.page_ranges:
            item["page_ranges"] = args.page_ranges
        files.append(item)

    payload = {
        "files": files,
        "model_version": args.model,
        "language": args.language,
        "enable_formula": not args.disable_formula,
        "enable_table": not args.disable_table,
    }
    if args.extra_format:
        payload["extra_formats"] = args.extra_format

    result = request_json("POST", APPLY_UPLOAD_URL, token, payload)
    batch_id = result["data"]["batch_id"]
    upload_urls = result["data"]["file_urls"]
    if len(upload_urls) != len(paths):
        raise MinerUError("MinerU returned a different number of upload URLs than input files")

    for path, upload_url in zip(paths, upload_urls, strict=True):
        print(f"Uploading: {path}")
        put_file(upload_url, path)
    return batch_id


def poll_batch(batch_id: str, token: str, interval: int, timeout: int) -> list[dict]:
    start = time.monotonic()
    while True:
        result = request_json("GET", f"{BATCH_RESULT_URL}/{batch_id}", token)
        items = result["data"].get("extract_result", [])
        states = [item.get("state", "unknown") for item in items]
        print(f"Batch {batch_id}: {', '.join(states) if states else 'waiting'}")

        if items and all(state in DONE_STATES for state in states):
            return items
        if time.monotonic() - start > timeout:
            raise MinerUError(f"Timed out waiting for batch {batch_id}")
        time.sleep(interval)


def delete_single_zip(zip_path: Path) -> None:
    """Delete only the explicit MinerU zip file for one source PDF."""
    if zip_path.exists() and zip_path.is_file():
        zip_path.unlink()


def save_outputs(source: Path, result: dict, keep_zip: bool, download_retries: int, retry_delay: int) -> tuple[Path, Path]:
    if result.get("state") == "failed":
        raise MinerUError(f"{source.name} failed: {result.get('err_msg', 'unknown error')}")
    zip_url = result.get("full_zip_url")
    if not zip_url:
        raise MinerUError(f"{source.name} completed without full_zip_url")

    output_dir = unique_output_dir(source)
    zip_path = output_dir.with_suffix(".zip")
    retry_metadata_path = source.with_name(f"{source.stem}_mineru_task_result.json")
    retry_metadata_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Downloading result: {source.name}")
    download_file(zip_url, zip_path, retries=download_retries, retry_delay=retry_delay)
    safe_extract_zip(zip_path, output_dir)

    full_md = find_full_md(output_dir)
    markdown = full_md.read_text(encoding="utf-8")
    markdown = rewrite_relative_links(markdown, full_md, output_dir, output_dir.name)

    target_md = source.with_suffix(".md")
    target_md.write_text(markdown, encoding="utf-8", newline="\n")

    metadata_path = output_dir / "mineru_task_result.json"
    metadata_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    if not keep_zip:
        delete_single_zip(zip_path)
    return target_md, output_dir


def load_existing_task_result(source: Path) -> dict | None:
    metadata_path = source.with_name(f"{source.stem}_mineru_task_result.json")
    if not metadata_path.is_file():
        return None
    try:
        result = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if result.get("state") == "done" and result.get("full_zip_url"):
        return result
    return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Use MinerU precise API to parse local files and save Markdown beside each source file."
    )
    parser.add_argument("files", nargs="+", help="Local file path(s) to parse. Up to 50 files per batch.")
    parser.add_argument("--token", help="MinerU API token. Prefer MINERU_API_TOKEN environment variable.")
    parser.add_argument("--model", default="vlm", choices=sorted(SUPPORTED_MODELS), help="MinerU model version.")
    parser.add_argument("--language", default="ch", help="Document language, default: ch.")
    parser.add_argument("--is-ocr", action="store_true", help="Enable OCR.")
    parser.add_argument("--disable-formula", action="store_true", help="Disable formula recognition.")
    parser.add_argument("--disable-table", action="store_true", help="Disable table recognition.")
    parser.add_argument("--page-ranges", help='Page ranges, for example "1-10" or "2,4-6".')
    parser.add_argument("--extra-format", action="append", choices=["docx", "html", "latex"], help="Extra output format.")
    parser.add_argument("--keep-zip", action="store_true", help="Keep MinerU result zip after Markdown is saved.")
    parser.add_argument("--json-summary", action="store_true", help="Print a JSON summary of generated paths after parsing.")
    parser.add_argument("--poll-interval", type=int, default=10, help="Polling interval in seconds.")
    parser.add_argument("--timeout", type=int, default=3600, help="Polling timeout in seconds.")
    parser.add_argument("--download-retries", type=int, default=5, help="Retry result zip download this many times.")
    parser.add_argument("--download-retry-delay", type=int, default=8, help="Seconds to wait between result zip download retries.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    token = args.token or os.environ.get("MINERU_API_TOKEN")
    if not token:
        print("Missing token. Set MINERU_API_TOKEN or pass --token.", file=sys.stderr)
        return 2

    paths = [Path(p).expanduser().resolve() for p in args.files]
    if len(paths) > 50:
        print("MinerU precise API supports up to 50 local files per upload batch.", file=sys.stderr)
        return 2
    for path in paths:
        if not path.is_file():
            print(f"File not found: {path}", file=sys.stderr)
            return 2

    try:
        existing_by_path = {path: load_existing_task_result(path) for path in paths}
        if all(existing_by_path.values()):
            print("Reusing existing MinerU task result metadata")
            results = list(existing_by_path.values())
            by_path = existing_by_path
        else:
            batch_id = apply_upload_urls(args, paths, token)
            print(f"Batch created: {batch_id}")
            results = poll_batch(batch_id, token, args.poll_interval, args.timeout)
            by_path = {}

        by_name = {item.get("file_name"): item for item in results}
        summaries = []
        for path in paths:
            result = by_path.get(path) or by_name.get(path.name)
            if result is None and len(results) == 1:
                result = results[0]
            if result is None:
                raise MinerUError(f"No result found for {path.name}")
            target_md, output_dir = save_outputs(path, result, args.keep_zip, args.download_retries, args.download_retry_delay)
            summaries.append(
                {
                    "source_pdf": str(path),
                    "mineru_md": str(target_md),
                    "mineru_dir": str(output_dir),
                    "zip_kept": args.keep_zip,
                }
            )
            print(f"Markdown saved: {target_md}")
        if args.json_summary:
            print(json.dumps(summaries, ensure_ascii=False, indent=2))
    except MinerUError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
