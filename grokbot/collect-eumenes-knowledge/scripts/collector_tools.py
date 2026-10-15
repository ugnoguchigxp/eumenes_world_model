#!/usr/bin/env python3
"""Deterministic collection helpers. No network, model calls or semantic grading."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
import time
from fractions import Fraction
from urllib.parse import urlsplit


SUPPORTED_SCHEMA = "1.1"


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def finite_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def http_url(value):
    if not nonempty(value):
        return False
    try:
        parsed = urlsplit(value)
        return parsed.scheme in ("http", "https") and bool(parsed.hostname)
    except ValueError:
        return False


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()


def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".write-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def load_json(path):
    return strict_json(Path(path).read_text(encoding="utf-8"))


def strict_json(text):
    def invalid(value):
        raise ValueError(f"non-JSON number: {value}")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON key: {key}")
            result[key] = value
        return result
    def finite_float(value):
        result = float(value)
        if not math.isfinite(result):
            raise ValueError("JSON number is outside the finite float range")
        return result
    return json.loads(text, parse_constant=invalid, parse_float=finite_float, object_pairs_hook=unique)


def safe_source(root, relative):
    if not isinstance(relative, str) or not relative:
        raise ValueError("source path is missing")
    p = Path(relative)
    if p.is_absolute() or ".." in p.parts:
        raise ValueError("source path must be relative and stay inside source root")
    try:
        root = Path(root).resolve(strict=True)
        result = (root / p).resolve(strict=True)
    except (RuntimeError, OSError) as exc:
        raise ValueError("source path cannot be resolved") from exc
    if not result.is_relative_to(root):
        raise ValueError("source path escapes source root")
    return result


def read_batch(batch, legacy=False):
    result = {}
    for name in ("raw", "first_output", "excluded_held"):
        path = Path(batch) / (name + ".jsonl")
        if not path.exists():
            if name == "raw" and legacy:
                continue
            raise ValueError(f"missing {path}; use an empty file when there are no entries")
        rows = []
        lines = path.read_text(encoding="utf-8").split("\n")
        if lines[-1] == "":
            lines.pop()
        for line, text in enumerate(lines, 1):
            if not text.strip():
                raise ValueError(f"{path}:{line}: blank JSONL line")
            row = strict_json(text)
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{line}: expected object")
            rows.append(row)
        result[name] = rows
    return result


def candidate_key(row, legacy):
    if "candidate_id" in row:
        if not nonempty(row["candidate_id"]):
            raise ValueError("candidate_id must be a nonempty string")
        return ("candidate", row["candidate_id"])
    if not legacy:
        raise ValueError("candidate_id is required; --legacy is only for historical data")
    return ("legacy_record", row["record_id"])


def disposition(row, name, legacy):
    """Shared identity/disposition contract; no evidence or semantic assessment."""
    if row.get("record_type") == "slot":
        if name != "excluded_held":
            raise ValueError("slot is only allowed in excluded_held")
        if type(row.get("slots")) is not int or row["slots"] <= 0:
            raise ValueError("slot count must be a positive integer")
        if not nonempty(row.get("domain")) or not nonempty(row.get("reason_code")):
            raise ValueError("slot domain and reason_code are required")
        if "candidate_id" in row or not legacy:
            candidate_key(row, legacy)
            if row["slots"] != 1:
                raise ValueError("identified slot must have slots=1")
        return "unfilled"
    if row.get("record_type", "record") != "record":
        raise ValueError("unknown record_type")
    if row.get("schema_version") != SUPPORTED_SCHEMA:
        raise ValueError("unsupported or missing schema_version; expected 1.1")
    if not nonempty(row.get("record_id")):
        raise ValueError("record_id must be a nonempty string")
    candidate_key(row, legacy)
    if not isinstance(row.get("scope"), dict) or not nonempty(row["scope"].get("domain")):
        raise ValueError("scope.domain must be a nonempty string")
    if name == "first_output":
        if row.get("status") not in ("verified", "source_reported") or row.get("held_class") is not None:
            raise ValueError("first_output needs a supported status and no held_class")
        if not nonempty(row.get("support_scope")):
            raise ValueError("first_output needs support_scope")
        return "ready"
    if name == "excluded_held":
        state = {"excluded": "excluded", "on_hold": "held"}.get(row.get("held_class"))
        if state is None:
            raise ValueError("excluded_held needs held_class")
        if not legacy and not nonempty(row.get("reason_code")):
            raise ValueError("excluded_held needs reason_code")
        return state
    return "raw"


def walk(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)


def validate_batch(batch, source_root, legacy=False):
    rows = read_batch(batch, legacy)
    errors, unavailable = [], []
    counts = {"records": 0, "slots": 0, "quote_hashes": 0, "source_offsets": 0, "spans": 0}
    idsets = {}
    identities = {}
    final_candidates, slot_candidates = {}, set()

    def error(where, code, detail=""):
        errors.append({"location": where, "code": code, "detail": detail})

    for name, records in rows.items():
        ids = set()
        for line, r in enumerate(records, 1):
            where = f"{name}.jsonl:{line}"
            try:
                state = disposition(r, name, legacy)
            except (ValueError, TypeError) as exc:
                error(where, "row_contract", str(exc))
                continue
            if name != "raw":
                cid = ("candidate", r["candidate_id"]) if "candidate_id" in r else None
                if state == "unfilled" and cid is not None:
                    if cid in slot_candidates:
                        error("batch", "duplicate_slot_candidate", where)
                    slot_candidates.add(cid)
                elif state != "unfilled":
                    cid = candidate_key(r, legacy)
                    domain = r["scope"]["domain"]
                    if cid in final_candidates and final_candidates[cid] != domain:
                        error("batch", "candidate_domain_conflict", where)
                    final_candidates[cid] = domain
            if r.get("record_type") == "slot":
                counts["slots"] += 1
                continue
            counts["records"] += 1
            rid = r["record_id"]
            if rid in ids:
                error(where, "duplicate_record_id", rid)
            ids.add(rid)
            identity = (candidate_key(r, legacy), r["scope"]["domain"])
            if rid in identities and identities[rid] != identity:
                error("batch", "raw_final_identity_mismatch", where)
            identities[rid] = identity
            for field in ("claim", "conditions", "provenance"):
                if not isinstance(r.get(field), dict):
                    error(where, "object_required", field)
            if any(not isinstance(r.get(field), dict) for field in ("claim", "conditions", "provenance")):
                continue
            if not isinstance(r["provenance"].get("source"), dict):
                error(where, "object_required", "provenance.source")
                continue
            for key in ("source_text", "normalized_ja", "modality", "assertion_scope"):
                value = r.get("claim", {}).get(key)
                if not isinstance(value, str) or not value.strip():
                    error(where, "claim_field_missing", key)
            if not nonempty(r.get("claim_type")):
                error(where, "domain_or_claim_type_missing")
            if r.get("claim", {}).get("assertion_scope") == "source_reported" and r.get("status") == "verified":
                error(where, "conflicting_support_status")
            if r.get("status") == "verified" and not r.get("support_scope"):
                error(where, "support_scope_missing")
            if not isinstance(r.get("split_into", []), list):
                error(where, "invalid_split_into")
            elif rid and rid in r.get("split_into", []):
                error(where, "self_split_reference")
            if r.get("split_from") == rid and rid:
                error(where, "self_split_reference")
            conditions = r.get("conditions", {})
            if conditions.get("combinator_status") == "unresolved" and conditions.get("combinator") is not None:
                error(where, "unresolved_combinator_must_be_null")
            provenance = r.get("provenance", {})
            source = provenance.get("source", {})
            if not nonempty(source.get("source_id")) or not nonempty(source.get("url")):
                error(where, "source_identity_missing")
            elif not http_url(source["url"]):
                error(where, "invalid_source_url")
            quotes = provenance.get("quotes", [])
            if not isinstance(quotes, list):
                error(where, "invalid_quotes")
                continue
            if name == "first_output" and not quotes:
                error(where, "support_quote_missing")
            data = None
            try:
                path = safe_source(source_root, source.get("path"))
                data = path.read_bytes()
            except (ValueError, OSError) as exc:
                unavailable.append({"location": where, "path": source.get("path"), "reason": str(exc)})
            if data is not None:
                try:
                    data.decode("utf-8")
                except UnicodeDecodeError:
                    error(where, "source_not_utf8")
                expected = str(source.get("content_sha256", "")).removeprefix("sha256:")
                if digest(data) != expected:
                    error(where, "source_hash_mismatch")
            for qi, q in enumerate(quotes):
                qw = f"{where}:quote[{qi}]"
                if not isinstance(q, dict) or not isinstance(q.get("text"), str) or not q["text"].strip():
                    error(qw, "invalid_quote")
                    continue
                payload = q["text"].encode("utf-8")
                counts["quote_hashes"] += 1
                if digest(payload) != str(q.get("quote_sha256", "")).removeprefix("sha256:"):
                    error(qw, "quote_hash_mismatch")
                loc = q.get("locator", {})
                if not isinstance(loc, dict):
                    error(qw, "invalid_locator")
                    continue
                a, b = loc.get("byte_start"), loc.get("byte_end")
                if type(a) is not int or type(b) is not int or not 0 <= a <= b:
                    error(qw, "invalid_byte_range")
                elif data is not None:
                    counts["source_offsets"] += 1
                    if b > len(data) or data[a:b] != payload:
                        error(qw, "source_offset_mismatch")
                if loc.get("path") != source.get("path"):
                    error(qw, "quote_source_path_mismatch")
            for item in walk(r):
                for key in ("quote_ref", "justification_quote_ref"):
                    if key in item and (type(item[key]) is not int or not 0 <= item[key] < len(quotes)):
                        error(where, "invalid_quote_ref", key)
                if item.get("derivation") == "source_quoted" and not item.get("spans"):
                    error(where, "source_quoted_spans_empty")
                if "spans" not in item:
                    continue
                if not isinstance(item["spans"], list):
                    error(where, "invalid_spans")
                    continue
                pieces = []
                for span in item["spans"]:
                    if not isinstance(span, dict):
                        error(where, "invalid_span")
                        continue
                    qi = span.get("quote_ref")
                    counts["spans"] += 1
                    if type(qi) is not int or not 0 <= qi < len(quotes):
                        error(where, "invalid_quote_ref")
                        continue
                    quote = quotes[qi]
                    if not isinstance(quote, dict) or not isinstance(quote.get("text"), str):
                        error(where, "span_targets_invalid_quote")
                        continue
                    text = quote["text"]
                    bounds = span.get("span_in_quote")
                    if not isinstance(bounds, list) or len(bounds) != 2:
                        error(where, "invalid_span_range")
                        continue
                    a, b = bounds
                    if type(a) is not int or type(b) is not int or not 0 <= a < b <= len(text):
                        error(where, "invalid_span_range")
                        continue
                    pieces.append(text[a:b])
                if pieces and item.get("derivation") == "source_quoted" and item.get("text") not in ("".join(pieces), "…".join(pieces)):
                    error(where, "span_text_mismatch")
        idsets[name] = ids
    final_ids = idsets["first_output"] | idsets["excluded_held"]
    if idsets["first_output"] & idsets["excluded_held"]:
        error("batch", "output_and_excluded_overlap")
    if "raw" in idsets and idsets["raw"] != final_ids:
        error("batch", "raw_partition_mismatch", str(sorted(idsets["raw"] ^ final_ids)))
    if slot_candidates & final_candidates.keys():
        error("batch", "candidate_is_slot_and_record")
    output_issues = [issue for issue in errors + unavailable
                     if issue["location"] == "batch" or issue["location"].startswith("first_output.")]
    return {"ok": not errors and not unavailable, "checks": counts, "errors": errors,
            "unverified_sources": unavailable, "semantic_review": "not_performed",
            "first_output_ok": not output_issues, "first_output_records": len(rows["first_output"]),
            "profile": "legacy" if legacy else "collection",
            "schema_validation": "documented_core_checks_only"}


def allocations(config, total):
    domains = config["domains"]
    if not domains or type(total) is not int or total < 0:
        raise ValueError("nonempty domains and nonnegative target required")
    weights = {key: item["weight"] for key, item in domains.items()}
    if any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0 for v in weights.values()):
        raise ValueError("weights must be finite positive numbers")
    weights = {key: Fraction(str(value)) for key, value in weights.items()}
    exact = {key: total * value / sum(weights.values()) for key, value in weights.items()}
    result = {key: math.floor(value) for key, value in exact.items()}
    order = sorted(exact, key=lambda key: (-(exact[key] - result[key]), key))
    for key in order[:total - sum(result.values())]:
        result[key] += 1
    return result


def coverage(batches, config, target_total, legacy=False):
    targets = allocations(config, target_total)
    output = {key: {"ready": 0, "held": 0, "excluded": 0, "partial": 0, "unfilled": 0} for key in targets}
    candidates, seen_records, slot_candidates = {}, set(), set()
    seen_batches = set()
    fallbacks = 0
    legacy_slots = 0
    record_count = 0
    candidate_batches = {}
    for batch in batches:
        bp = str(Path(batch).resolve())
        if bp in seen_batches:
            raise ValueError("same batch supplied twice")
        seen_batches.add(bp)
        rows = read_batch(batch, legacy)
        for name in ("first_output", "excluded_held"):
            for r in rows[name]:
                state = disposition(r, name, legacy)
                if r.get("record_type") == "slot":
                    domain, n = r.get("domain"), r.get("slots")
                    if domain not in output or type(n) is not int or n <= 0:
                        raise ValueError("invalid slot domain/count")
                    cid = r.get("candidate_id")
                    if cid is not None:
                        if not isinstance(cid, str) or not cid or n != 1 or ("candidate", cid) in slot_candidates:
                            raise ValueError("individual slot needs a unique candidate_id and slots=1")
                        slot_candidates.add(("candidate", cid))
                    else:
                        legacy_slots += n
                    output[domain]["unfilled"] += n
                    continue
                rid = r.get("record_id")
                if not isinstance(rid, str) or not rid or rid in seen_records:
                    raise ValueError("missing/duplicate record_id across final files")
                seen_records.add(rid)
                cid = candidate_key(r, legacy)
                record_count += 1
                if cid[0] == "legacy_record":
                    fallbacks += 1
                if cid in candidate_batches and candidate_batches[cid] != bp:
                    raise ValueError("candidate appears in multiple batches; supply one current revision per batch")
                candidate_batches[cid] = bp
                domain = r.get("scope", {}).get("domain")
                if domain not in output:
                    raise ValueError(f"unknown domain: {domain}")
                group = candidates.setdefault(cid, {"domain": domain, "states": set()})
                if group["domain"] != domain:
                    raise ValueError("candidate spans multiple primary domains")
                group["states"].add(state)
    if slot_candidates & candidates.keys():
        raise ValueError("candidate appears as both slot and record")
    for group in candidates.values():
        state = next(iter(group["states"])) if len(group["states"]) == 1 else "partial"
        output[group["domain"]][state] += 1
    for key, values in output.items():
        values["candidate_count"] = sum(values.values())
        values["target_ready"] = targets[key]
        values["ready_gap"] = max(0, targets[key] - values["ready"])
        values["ready_fraction"] = values["ready"] / values["candidate_count"] if values["candidate_count"] else None
    return {"domains": output, "legacy_record_id_fallbacks": fallbacks,
            "legacy_unidentified_slots": legacy_slots, "final_record_count": record_count,
            "profile": "legacy" if legacy else "collection",
            "basis": "declared_output_not_validated_or_independently_accepted",
            "note": "ready_gap is for collection planning, never for replacing evaluation failures"}


def cache_key(provider, query, params):
    if not provider.strip() or not query.strip() or not isinstance(params, dict):
        raise ValueError("provider, query and a parameter object are required")
    identity = {"provider": provider, "query": query, "params": params}
    return digest(json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode())


def cache_put(directory, provider, query, params, payload, ttl, now=None):
    now = time.time() if now is None else now
    if not finite_number(ttl) or ttl < 0 or not finite_number(now) or not finite_number(now + ttl):
        raise ValueError("TTL and timestamps must be finite; TTL must be nonnegative")
    key = cache_key(provider, query, params)
    body = encode(payload)
    body_hash = digest(body)
    directory = Path(directory)
    obj = directory / "objects" / (body_hash + ".json")
    atomic_write(obj, body)
    entry = {"key": key, "provider": provider, "query": query, "params": params,
             "fetched_at_unix": now, "expires_at_unix": now + ttl,
             "payload_sha256": body_hash, "trust": "untrusted_search_result"}
    entry_bytes = encode(entry)
    atomic_write(directory / "history" / (digest(entry_bytes) + ".json"), entry_bytes)
    atomic_write(directory / "entries" / (key + ".json"), entry_bytes)
    return entry


def cache_get(directory, provider, query, params, now=None):
    key = cache_key(provider, query, params)
    directory = Path(directory)
    entry_path = directory / "entries" / (key + ".json")
    if not entry_path.exists():
        return {"cache_status": "miss", "key": key}
    entry = load_json(entry_path)
    if cache_key(entry.get("provider"), entry.get("query"), entry.get("params")) != key:
        raise ValueError("cache identity mismatch")
    history = directory / "history" / (digest(encode(entry)) + ".json")
    if history.read_bytes() != encode(entry):
        raise ValueError("cache metadata does not match saved history")
    h = entry["payload_sha256"]
    if len(h) != 64 or any(c not in "0123456789abcdef" for c in h) or entry.get("key") != key:
        raise ValueError("invalid cache entry")
    body = (directory / "objects" / (h + ".json")).read_bytes()
    if digest(body) != h:
        raise ValueError("cache payload hash mismatch")
    now = time.time() if now is None else now
    fetched, expires = entry["fetched_at_unix"], entry["expires_at_unix"]
    if not all(finite_number(v) for v in (now, fetched, expires)) or expires < fetched:
        raise ValueError("invalid cache timestamps")
    stale = now >= entry["expires_at_unix"] or now < entry["fetched_at_unix"]
    return {"cache_status": "stale" if stale else "hit", "entry": entry, "payload": strict_json(body)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    v = sub.add_parser("validate")
    v.add_argument("--batch", required=True)
    v.add_argument("--source-root", required=True)
    v.add_argument("--legacy", action="store_true", help="audit historical records without candidate IDs/raw")
    c = sub.add_parser("coverage")
    c.add_argument("--batch", action="append", required=True)
    c.add_argument("--config", required=True)
    c.add_argument("--target-total", type=int, default=500)
    c.add_argument("--legacy", action="store_true", help="allow historical records and aggregate slots")
    for command in ("cache-put", "cache-get"):
        p = sub.add_parser(command)
        p.add_argument("--cache-dir", required=True)
        p.add_argument("--provider", required=True)
        p.add_argument("--query", required=True)
        p.add_argument("--params", default="{}", help="JSON search settings, including locale/version")
        if command == "cache-put":
            p.add_argument("--input", required=True, help="saved JSON returned by search tool")
            p.add_argument("--ttl-seconds", type=int, default=86400)
    args = parser.parse_args()
    code = 0
    try:
        if args.command == "validate":
            result = validate_batch(args.batch, args.source_root, args.legacy)
            code = 0 if result["ok"] else 1
        elif args.command == "coverage":
            result = coverage(args.batch, load_json(args.config), args.target_total, args.legacy)
        else:
            params = strict_json(args.params)
            if args.command == "cache-put":
                result = cache_put(args.cache_dir, args.provider, args.query, params, load_json(args.input), args.ttl_seconds)
            else:
                result = cache_get(args.cache_dir, args.provider, args.query, params)
                code = {"hit": 0, "miss": 3, "stale": 4}[result["cache_status"]]
    except (OSError, ValueError, TypeError, KeyError, AttributeError, IndexError, OverflowError, RecursionError) as exc:
        result, code = {"ok": False, "error": str(exc)}, 2
    print(encode(result).decode(), end="")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
