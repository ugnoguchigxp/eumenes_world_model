#!/usr/bin/env python3
"""Locate LLM-selected evidence and assemble an immutable batch. No semantic decisions."""
import argparse
import copy
import json
from pathlib import Path
import tempfile

from collector_tools import atomic_write, digest, encode, load_json, nonempty, safe_source, validate_batch


def require_text(obj, key):
    value = obj.get(key)
    if not nonempty(value):
        raise ValueError(f"explicit {key} is required")
    return value


def locate(haystack, needle, start=None):
    """Bytes for quotes; code points for conditions. Never choose an ambiguous match."""
    if not needle:
        raise ValueError("empty quote/span")
    if start is not None:
        if type(start) is not int or start < 0 or haystack[start:start + len(needle)] != needle:
            raise ValueError("specified evidence offset does not match")
        return start
    first = haystack.find(needle)
    if first < 0:
        raise ValueError("selected evidence not found; whitespace is not normalized")
    if haystack.find(needle, first + 1) >= 0:
        raise ValueError("ambiguous evidence; specify byte_start or start explicitly")
    return first


def assemble_record(spec, root):
    # Keep the original short field names for Grok's records_spec workflow.
    s = copy.deepcopy(spec)
    for key in ("cid", "rid", "d", "url", "ja", "type", "mod", "as", "st", "ss", "cstat", "ver", "retrieved_at"):
        require_text(s, key)
    source = s["source"]
    if "url" in source and source["url"] != s["url"]:
        raise ValueError("source URL conflicts with selected URL")
    for key in ("source_id", "path", "text_extraction"):
        require_text(source, key)
    data = safe_source(root, source["path"]).read_bytes()
    data.decode("utf-8")
    calculated = digest(data)
    if "content_sha256" in source and source["content_sha256"] != calculated:
        raise ValueError("declared source hash mismatch")
    source.update(url=s["url"], content_sha256=calculated)
    if "raw_path" in source:
        raw_hash = digest(safe_source(root, source["raw_path"]).read_bytes())
        if "raw_sha256" in source and source["raw_sha256"] != raw_hash:
            raise ValueError("declared raw hash mismatch")
        source["raw_sha256"] = raw_hash
    elif "raw_sha256" in source:
        raise ValueError("raw_sha256 requires raw_path")
    quotes = []
    if not isinstance(s["quotes"], list) or not s["quotes"]:
        raise ValueError("nonempty quotes list required")
    for selected in s["quotes"]:
        selected = {"text": selected} if isinstance(selected, str) else selected
        text = require_text(selected, "text")
        body = text.encode("utf-8")
        start = locate(data, body, selected.get("byte_start"))
        quotes.append({"text": text, "quote_sha256": digest(body), "locator": {
            "path": source["path"], "byte_start": start, "byte_end": start + len(body)}})
    items = []
    if not isinstance(s["conds"], list):
        raise ValueError("conds must be a list")
    for condition in s["conds"]:
        text = require_text(condition, "text")
        role = require_text(condition, "role")
        qi = condition.get("qref", 0)
        if type(qi) is not int or not 0 <= qi < len(quotes):
            raise ValueError("invalid condition qref")
        start = locate(quotes[qi]["text"], text, condition.get("start"))
        items.append({"text": text, "role": role, "derivation": "source_quoted",
                      "spans": [{"quote_ref": qi, "span_in_quote": [start, start + len(text)]}]})
    conditions = {"status": s["cstat"], "items": items}
    if len(items) > 1 or "comb" in s or "combinator_status" in s:
        state = require_text(s, "combinator_status")
        comb = s["comb"]
        if state not in {"resolved", "unresolved"} or (state == "unresolved" and comb is not None) or (state == "resolved" and not nonempty(comb)):
            raise ValueError("explicit combinator decision required; unresolved needs null")
        conditions.update(combinator_status=state, combinator=comb)
    if s["cstat"] == "unconditional_with_justification":
        conditions["justification"] = require_text(s, "justification")
        ref = s["justification_quote_ref"]
        if type(ref) is not int or not 0 <= ref < len(quotes):
            raise ValueError("invalid justification_quote_ref")
        conditions["justification_quote_ref"] = ref
    # Review, license and time are declarations from the operator, never inferred.
    review = s["review"]
    for key in ("by", "method", "result"):
        require_text(review["self_check"], key)
    require_text(review, "independent_review")
    for key in ("storage", "redistribution", "basis", "checked_at"):
        require_text(s["license"], key)
    for key in ("method", "version"):
        require_text(s["extraction"], key)
    if s["extraction"].get("first_output") is not True:
        raise ValueError("assembler is for initial extraction only; first_output must be true")
    held = s["st"] in {"on_hold", "excluded"}
    status = require_text(s, "raw_status") if held else s["st"]
    if status not in {"verified", "source_reported"}:
        raise ValueError("unsupported status")
    if not held and review["self_check"]["result"] != "pass":
        raise ValueError("ready record requires an explicit self-check pass")
    record = {"record_id": s["rid"], "schema_version": "1.1", "candidate_id": s["cid"],
              "claim": {"source_text": " … ".join(q["text"] for q in quotes), "normalized_ja": s["ja"],
                        "modality": s["mod"], "assertion_scope": s["as"]},
              "claim_type": s["type"], "scope": {"domain": s["d"], "version": s["ver"],
                  "retrieved_at": s["retrieved_at"], "published_at": s.get("published_at", "unknown"),
                  "valid_time": s.get("valid_time", "unknown")},
              "provenance": {"source": source, "quotes": quotes}, "conditions": conditions,
              "status": status, "support_scope": s["ss"], "review": review,
              "license": s["license"], "extraction": s["extraction"]}
    if "note" in s:
        record["provenance"]["fetch_note"] = s["note"]
    final = copy.deepcopy(record)
    if held:
        final.pop("status")
        final.update(held_class=s["st"], reason_code=require_text(s, "reason"), detail=require_text(s, "detail"))
    return record, final, held


def assemble(spec_path, source_root, output):
    spec = load_json(spec_path)
    if not isinstance(spec, dict) or not isinstance(spec.get("records"), list) or not isinstance(spec.get("slots"), list):
        raise ValueError('expected {"records": [...], "slots": [...]} with explicit metadata; see bookkeeping.md')
    output = Path(output)
    if output.exists():
        raise ValueError("output already exists; preserve prior extraction and use a new batch path")
    rows = {"raw": [], "first_output": [], "excluded_held": copy.deepcopy(spec["slots"])}
    for slot in rows["excluded_held"]:
        if slot.get("record_type") != "slot":
            raise ValueError("slots must contain only slot records")
        require_text(slot, "detail")
    for selected in spec["records"]:
        raw, final, held = assemble_record(selected, source_root)
        rows["raw"].append(raw)
        rows["excluded_held" if held else "first_output"].append(final)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".assemble-", dir=output.parent) as temporary:
        batch = Path(temporary) / "batch"
        batch.mkdir()
        for name, records in rows.items():
            atomic_write(batch / (name + ".jsonl"), b"".join(
                (json.dumps(r, ensure_ascii=False, allow_nan=False) + "\n").encode() for r in records))
        report = validate_batch(batch, source_root)
        if not report["ok"]:
            raise ValueError("assembled batch failed validation: " + json.dumps(report, ensure_ascii=False))
        atomic_write(batch / "validation.json", encode(report))
        batch.rename(output)
    return {"ok": True, "counts": {k: len(v) for k, v in rows.items()},
            "semantic_review": "not_performed", "output": str(output.resolve())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        result, code = assemble(args.spec, args.source_root, args.output), 0
    except (OSError, ValueError, KeyError, TypeError, AttributeError, RecursionError) as exc:
        result, code = {"ok": False, "error": str(exc)}, 2
    print(encode(result).decode(), end="")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
