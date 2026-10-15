#!/usr/bin/env python3
"""Bounded GETs for a fixed URL list. Difficult cases go to Grok, never retry loops."""
import argparse
from datetime import datetime, timezone
from email.message import Message
from html.parser import HTMLParser
import ipaddress
import json
import math
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from collector_tools import atomic_write, digest, encode, load_json, nonempty, strict_json


VERSION = "simple-fetch-v1"


def utc_now():
    return datetime.now(timezone.utc).isoformat()


class Handoff(Exception):
    def __init__(self, reason, detail=""):
        self.reason, self.detail = reason, detail
        super().__init__(reason)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class VisibleText(HTMLParser):
    """Mechanical visible-text conversion, not article/body selection."""
    hidden = {"head", "script", "style", "template"}
    blocks = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6",
              "section", "article", "main", "table", "ul", "ol", "pre", "blockquote"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = []
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in self.hidden:
            self.skip.append(tag)
        if not self.skip:
            if tag in self.blocks:
                self.parts.append("\n")
            elif tag in {"td", "th"}:
                self.parts.append("\t")

    def handle_endtag(self, tag):
        if self.skip:
            if tag == self.skip[-1]:
                self.skip.pop()
        elif tag in self.blocks:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def public_url(url, resolve=False):
    """Guard accidental local fetches; not a network sandbox against DNS rebinding."""
    if not nonempty(url) or any(ord(c) < 32 for c in url):
        raise Handoff("invalid_url")
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username is not None or parsed.password is not None:
            raise ValueError("public HTTP(S) URL without credentials required")
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if port not in {80, 443}:
            raise ValueError("only ports 80 and 443 are supported")
        host = parsed.hostname
        if host.lower().rstrip(".") == "localhost" or host.lower().endswith((".localhost", ".local")):
            raise Handoff("non_public_url")
        try:
            addresses = [ipaddress.ip_address(host)]
        except ValueError:
            addresses = [ipaddress.ip_address(info[4][0]) for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)] if resolve else []
        if resolve and not addresses:
            raise Handoff("dns_failed")
        if any(not address.is_global for address in addresses):
            raise Handoff("non_public_url")
    except (ValueError, UnicodeError) as exc:
        raise Handoff("invalid_url", str(exc)) from exc


def convert(raw, content_type):
    message = Message()
    message["Content-Type"] = content_type
    mime = message.get_content_type().lower()
    charset = message.get_content_charset() or "utf-8-sig"
    if raw.startswith(b"%PDF-") or mime == "application/pdf":
        raise Handoff("pdf_needs_extraction")
    is_json = mime == "application/json" or mime.endswith("+json")
    is_xml = mime in {"application/xml", "text/xml"} or mime.endswith("+xml")
    if not (mime in {"text/plain", "text/csv", "text/tab-separated-values", "text/html"} or is_json or is_xml):
        raise Handoff("unsupported_content_type", mime)
    try:
        text = raw.decode(charset)
    except (UnicodeError, LookupError) as exc:
        raise Handoff("encoding_needs_review", str(exc)) from exc
    if "\x00" in text:
        raise Handoff("binary_or_unsupported_encoding")
    method = "decoded-text-v1"
    if mime in {"text/html", "application/xhtml+xml"}:
        parser = VisibleText()
        parser.feed(text)
        parser.close()
        text = "".join(parser.parts).strip()
        method = "html-visible-text-v1"
    elif is_json:
        try:
            strict_json(text)
        except (ValueError, RecursionError) as exc:
            raise Handoff("invalid_json", str(exc)) from exc
    if not text.strip():
        raise Handoff("no_text_extracted")
    return text.encode("utf-8"), method, charset


def fetch_once(url, directory, max_bytes, timeout, opener=None):
    """Worker operation; parent enforces a total deadline including DNS/read/parse."""
    result = {"status": "handoff", "requested_url": url, "attempted_at": utc_now(),
              "tool_version": VERSION, "semantic_review": "not_performed"}
    try:
        public_url(url, resolve=True)
        opener = opener or build_opener(ProxyHandler({}), NoRedirect())
        request = Request(url, headers={"User-Agent": "EumenesSimpleFetcher/1.0",
                                       "Accept-Encoding": "identity"})
        with opener.open(request, timeout=timeout) as response:
            result["http_status"] = response.status
            result["response_url"] = response.geturl()
            if response.status != 200:
                raise Handoff("unexpected_http_status", str(response.status))
            content_type = response.headers.get("Content-Type", "application/octet-stream")
            result["content_type"] = content_type
            result["etag"] = response.headers.get("ETag")
            result["last_modified"] = response.headers.get("Last-Modified")
            if response.headers.get("Content-Encoding", "identity").lower() not in {"", "identity"}:
                raise Handoff("unsupported_content_encoding")
            length = response.headers.get("Content-Length")
            if length is not None and int(length) > max_bytes:
                raise Handoff("body_too_large")
            raw = response.read(max_bytes + 1)
            if len(raw) > max_bytes:
                raise Handoff("body_too_large")
            if length is not None and len(raw) != int(length):
                raise Handoff("incomplete_body")
        atomic_write(Path(directory) / "response.bin", raw)
        result.update(raw_sha256=digest(raw), raw_bytes=len(raw))
        text, method, charset = convert(raw, content_type)
        atomic_write(Path(directory) / "text.txt", text)
        result.update(status="fetched", text_sha256=digest(text), text_bytes=len(text),
                      extraction_method=method, charset=charset, needs_content_review=True)
    except HTTPError as exc:
        result.update(http_status=exc.code, reason="redirect_needs_review" if 300 <= exc.code < 400 else "http_error")
        result["location"] = exc.headers.get("Location")
        result["retry_after"] = exc.headers.get("Retry-After")
        exc.close()
    except Handoff as exc:
        result.update(reason=exc.reason, detail=exc.detail)
    except (URLError, OSError, ValueError, RecursionError) as exc:
        result.update(reason="fetch_or_decode_failed", detail=str(exc)[:500])
    return result


def isolated_fetch(url, directory, max_bytes, timeout):
    try:
        proc = subprocess.run([sys.executable, str(Path(__file__).resolve()), "_worker",
                               "--url", url, "--output", str(directory),
                               "--max-bytes", str(max_bytes), "--timeout", str(timeout)],
                              capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"status": "handoff", "reason": "attempt_deadline", "tool_version": VERSION}
    except OSError as exc:
        return {"status": "handoff", "reason": "worker_unavailable", "detail": str(exc)[:500], "tool_version": VERSION}
    if proc.returncode:
        return {"status": "handoff", "reason": "worker_failed", "tool_version": VERSION}
    result = strict_json(proc.stdout)
    if not isinstance(result, dict) or result.get("status") not in {"fetched", "handoff"}:
        raise ValueError("invalid worker result")
    return result


def input_rows(path):
    with Path(path).open("rb") as file:
        raw = file.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError("input list exceeds 2 MiB")
    rows, seen, urls = [], set(), set()
    lines = raw.decode("utf-8").split("\n")
    if lines[-1] == "":
        lines.pop()
    for n, line in enumerate(lines, 1):
        row = strict_json(line)
        if not isinstance(row, dict) or not all(nonempty(row.get(k)) for k in ("candidate_id", "url", "domain")):
            raise ValueError(f"line {n}: candidate_id, url, domain required")
        if row["candidate_id"] in seen:
            raise ValueError("duplicate candidate_id")
        if row["url"] in urls:
            raise ValueError("duplicate URL; retrieve once and reuse its snapshot")
        seen.add(row["candidate_id"])
        urls.add(row["url"])
        rows.append({k: row[k] for k in ("candidate_id", "url", "domain")})
    if not 1 <= len(rows) <= 500:
        raise ValueError("supply 1 to 500 candidates per plan")
    return raw, rows


def verify_saved(root, result):
    for field, hash_field in (("raw_path", "raw_sha256"), ("text_path", "text_sha256")):
        if field in result:
            path = Path(result[field])
            if path.is_absolute() or ".." in path.parts or not (root / path).resolve().is_relative_to(root.resolve()):
                raise ValueError("saved path escapes output")
            if digest((root / path).read_bytes()) != result[hash_field]:
                raise ValueError("saved snapshot is missing or corrupt; do not silently refetch")
    if result["status"] == "fetched" and not all(k in result for k in ("raw_path", "text_path")):
        raise ValueError("fetched result has no snapshots")


def run_plan(input_path, output, limit=20, timeout=20.0, max_bytes=2 * 1024 * 1024,
             max_seconds=180.0, interval=1.0, fetcher=isolated_fetch):
    raw, rows = input_rows(input_path)
    root = Path(output)
    root.mkdir(parents=True, exist_ok=True)
    plan = {"version": VERSION, "input_sha256": digest(raw), "max_bytes": max_bytes, "timeout": timeout}
    plan_path = root / "plan.json"
    if plan_path.exists():
        if load_json(plan_path) != plan:
            raise ValueError("plan/settings changed; use a new output directory")
    else:
        if any(root.iterdir()):
            raise ValueError("new output directory must be empty")
        atomic_write(plan_path, encode(plan))
    started = time.monotonic()
    attempts = 0
    results = []
    for row in rows:
        task = root / "tasks" / (digest(row["candidate_id"].encode()) + ".json")
        if task.exists():
            result = load_json(task)
            if result.get("request") != row:
                raise ValueError("saved candidate differs from plan")
            if result.get("status") == "in_progress":
                result.update(status="handoff", reason="interrupted_attempt")
                atomic_write(task, encode(result))
            if result.get("status") not in {"fetched", "handoff"}:
                raise ValueError("invalid saved task state")
            verify_saved(root, result)
        else:
            remaining = max_seconds - (time.monotonic() - started)
            if remaining <= 0:
                results.append({"request": row, "status": "deferred", "reason": "invocation_budget"})
                continue
            if attempts >= limit or remaining <= interval:
                results.append({"request": row, "status": "deferred", "reason": "invocation_budget"})
                continue
            if attempts:
                time.sleep(min(interval, remaining))
            remaining = max_seconds - (time.monotonic() - started)
            if remaining <= 0:
                results.append({"request": row, "status": "deferred", "reason": "invocation_budget"})
                continue
            result = {"request": row, "status": "in_progress", "attempted_at": utc_now(),
                      "semantic_review": "not_performed"}
            atomic_write(task, encode(result))
            attempts += 1
            with tempfile.TemporaryDirectory(prefix=".fetch-", dir=root) as temporary:
                outcome = fetcher(row["url"], temporary, max_bytes, min(timeout, remaining))
                result.update(outcome)
                for name, field, hfield in (("response.bin", "raw_path", "raw_sha256"), ("text.txt", "text_path", "text_sha256")):
                    if hfield in result:
                        body = (Path(temporary) / name).read_bytes()
                        if digest(body) != result[hfield]:
                            raise ValueError("worker snapshot hash mismatch")
                        relative = "sources/" + result[hfield] + (".txt" if field == "text_path" else ".bin")
                        atomic_write(root / relative, body)
                        result[field] = relative
                verify_saved(root, result)
                atomic_write(task, encode(result))
        results.append(result)
    for name, selected in (("results", results), ("handoff", [r for r in results if r["status"] == "handoff"]),
                           ("pending", [r for r in results if r["status"] == "deferred"])):
        payload = b"".join(json.dumps(r, ensure_ascii=False, allow_nan=False).encode() + b"\n" for r in selected)
        atomic_write(root / (name + ".jsonl"), payload)
    summary = {"version": VERSION, "attempts_this_invocation": attempts,
               "counts": {s: sum(r["status"] == s for r in results) for s in ("fetched", "handoff", "deferred")},
               "semantic_review": "not_performed", "output": str(root.resolve())}
    atomic_write(root / "summary.json", encode(summary))
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("run", "_worker"))
    parser.add_argument("--input")
    parser.add_argument("--url")
    parser.add_argument("--output", required=True)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=20)
    parser.add_argument("--max-bytes", type=int, default=2 * 1024 * 1024)
    parser.add_argument("--max-seconds", type=float, default=180)
    parser.add_argument("--interval", type=float, default=1)
    args = parser.parse_args()
    try:
        if not (1 <= args.limit <= 500 and 1 <= args.max_bytes <= 16 * 1024 * 1024
                and all(math.isfinite(v) for v in (args.timeout, args.max_seconds, args.interval))
                and 0 < args.timeout <= 120 and 0 < args.max_seconds <= 1800 and 0 <= args.interval <= 60):
            raise ValueError("invalid limits: up to 500 attempts, 16 MiB/body, 120s/attempt, 1800s/invocation")
        if args.mode == "_worker":
            result = fetch_once(args.url, args.output, args.max_bytes, args.timeout)
            code = 0
        else:
            result = run_plan(args.input, args.output, args.limit, args.timeout, args.max_bytes, args.max_seconds, args.interval)
            code = 0 if result["counts"]["handoff"] + result["counts"]["deferred"] == 0 else 1
    except (OSError, ValueError, TypeError, KeyError, AttributeError, RecursionError) as exc:
        result, code = {"ok": False, "error": str(exc)}, 2
    print(encode(result).decode(), end="")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
