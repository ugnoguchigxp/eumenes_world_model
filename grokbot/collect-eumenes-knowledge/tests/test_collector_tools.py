import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "collector_tools.py"
spec = importlib.util.spec_from_file_location("collector_tools", SCRIPT)
tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tools)


class CollectionToolsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.batch = self.root / "batch"
        self.batch.mkdir()
        self.text = "導入。\n対象は日本語。\n末尾。"
        self.quote = "対象は日本語。"
        data = self.text.encode()
        (self.root / "source.txt").write_bytes(data)
        start = data.index(self.quote.encode())
        self.record = {
            "schema_version": "1.1",
            "record_id": "r1", "candidate_id": "c1", "claim_type": "definition",
            "claim": {"source_text": self.quote, "normalized_ja": self.quote,
                      "modality": "defined", "assertion_scope": "source_asserted"},
            "scope": {"domain": "AI"}, "status": "verified", "support_scope": "full_text",
            "conditions": {"status": "unconditional_with_justification", "items": []},
            "provenance": {
                "source": {"source_id": "s1", "url": "https://example.org/fixture",
                           "path": "source.txt", "content_sha256": tools.digest(data)},
                "quotes": [{"text": self.quote, "quote_sha256": tools.digest(self.quote.encode()),
                            "locator": {"path": "source.txt", "byte_start": start,
                                        "byte_end": start + len(self.quote.encode())}}]
            }
        }
        self.config = {"domains": {"AI": {"weight": 36}, "R": {"weight": 20},
                                   "M": {"weight": 16}, "L": {"weight": 20}, "F": {"weight": 8}}}
        self.save()

    def save(self, ready=None, excluded=None, raw=None):
        ready = [self.record] if ready is None else ready
        excluded = [] if excluded is None else excluded
        raw = ready + [r for r in excluded if r.get("record_type") != "slot"] if raw is None else raw
        for name, rows in (("raw", raw), ("first_output", ready), ("excluded_held", excluded)):
            (self.batch / (name + ".jsonl")).write_text(
                "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")

    def validate(self):
        return tools.validate_batch(self.batch, self.root)

    def test_valid_multibyte_offsets_and_no_condition_definition(self):
        report = self.validate()
        self.assertTrue(report["ok"])
        self.assertEqual(report["semantic_review"], "not_performed")
        self.assertEqual(report["checks"]["source_offsets"], 2)

    def test_unicode_span_uses_characters(self):
        self.record["conditions"]["items"] = [{
            "text": "日本語", "derivation": "source_quoted",
            "spans": [{"quote_ref": 0, "span_in_quote": [3, 6]}]}]
        self.save()
        self.assertTrue(self.validate()["ok"])
        self.record["conditions"]["items"][0]["spans"][0]["span_in_quote"] = [9, 18]
        self.save()
        self.assertIn("invalid_span_range", {e["code"] for e in self.validate()["errors"]})

    def test_hash_and_byte_position_fail_independently(self):
        self.record["provenance"]["quotes"][0]["locator"]["byte_start"] = 0
        self.record["provenance"]["source"]["content_sha256"] = "0" * 64
        self.save()
        codes = {e["code"] for e in self.validate()["errors"]}
        self.assertTrue({"source_hash_mismatch", "source_offset_mismatch"} <= codes)

    def test_missing_source_is_not_pass(self):
        (self.root / "source.txt").unlink()
        report = self.validate()
        self.assertFalse(report["ok"])
        self.assertTrue(report["unverified_sources"])

    def test_paths_cannot_escape(self):
        for path in ("../source.txt", "/etc/hosts"):
            with self.assertRaises(ValueError):
                tools.safe_source(self.root, path)
        (self.root / "outside").symlink_to(self.root.parent)
        with self.assertRaises(ValueError):
            tools.safe_source(self.root, "outside/file.txt")

    def test_invalid_reference_and_unresolved_logic(self):
        self.record["conditions"] = {"combinator_status": "unresolved", "combinator": "all",
            "items": [{"text": "x", "derivation": "source_quoted",
                       "spans": [{"quote_ref": 9, "span_in_quote": [0, 1]}]}]}
        self.save()
        codes = {e["code"] for e in self.validate()["errors"]}
        self.assertTrue({"invalid_quote_ref", "unresolved_combinator_must_be_null"} <= codes)

    def test_raw_cannot_drop_failed_records(self):
        self.save(ready=[], raw=[self.record])
        self.assertIn("raw_partition_mismatch", {e["code"] for e in self.validate()["errors"]})

    def test_missing_claim_and_empty_quote_rejected(self):
        self.record["claim"] = {}
        self.record["provenance"]["quotes"][0]["text"] = ""
        self.save()
        codes = {e["code"] for e in self.validate()["errors"]}
        self.assertTrue({"claim_field_missing", "invalid_quote"} <= codes)

    def test_malformed_json_and_duplicate_keys(self):
        for text in ('{"v":NaN}', '{"v":1,"v":2}'):
            with self.assertRaises(ValueError):
                tools.strict_json(text)
        (self.batch / "first_output.jsonl").write_text("[]\n")
        with self.assertRaises(ValueError):
            self.validate()

    def test_allocation_rounding_preserves_total(self):
        self.assertEqual(tools.allocations(self.config, 500), {"AI": 180, "R": 100, "M": 80, "L": 100, "F": 40})
        for total in (0, 1, 7, 83, 501):
            self.assertEqual(sum(tools.allocations(self.config, total).values()), total)

    def test_coverage_counts_candidates_not_raw_or_split_children(self):
        child = copy.deepcopy(self.record)
        child["record_id"] = "r2"
        held = copy.deepcopy(self.record)
        held.update(record_id="r3", candidate_id="c2", held_class="on_hold", reason_code="needs_review")
        slot = {"record_type": "slot", "domain": "AI", "slots": 3, "reason_code": "fetch_failed"}
        self.save(ready=[self.record, child], excluded=[held, slot])
        ai = tools.coverage([self.batch], self.config, 500, legacy=True)["domains"]["AI"]
        self.assertEqual((ai["ready"], ai["held"], ai["unfilled"], ai["candidate_count"]), (1, 1, 3, 5))
        self.assertEqual(ai["ready_fraction"], 0.2)

    def test_mixed_candidate_not_wholly_ready(self):
        child = copy.deepcopy(self.record)
        child.update(record_id="r2", held_class="on_hold", reason_code="needs_review")
        self.save(excluded=[child])
        ai = tools.coverage([self.batch], self.config, 500)["domains"]["AI"]
        self.assertEqual((ai["ready"], ai["partial"], ai["candidate_count"]), (0, 1, 1))

    def test_identified_slot_cannot_double_count_a_candidate(self):
        slot = {"record_type": "slot", "domain": "AI", "candidate_id": "c1",
                "slots": 1, "reason_code": "fetch_failed"}
        self.save(excluded=[slot])
        with self.assertRaises(ValueError):
            tools.coverage([self.batch], self.config, 500)
        slot["candidate_id"] = "c2"
        self.save(excluded=[slot, slot])
        with self.assertRaises(ValueError):
            tools.coverage([self.batch], self.config, 500)

    def test_duplicate_batches_and_records_rejected(self):
        with self.assertRaises(ValueError):
            tools.coverage([self.batch, self.batch], self.config, 500)
        self.save(ready=[self.record, self.record])
        with self.assertRaises(ValueError):
            tools.coverage([self.batch], self.config, 500)

    def test_cache_identity_expiry_and_history(self):
        cache = self.root / "cache"
        self.assertEqual(tools.cache_get(cache, "p", "q", {}, now=100)["cache_status"], "miss")
        tools.cache_put(cache, "p", "q", {}, {"results": []}, 10, now=100)
        self.assertEqual(tools.cache_get(cache, "p", "q", {}, now=109)["cache_status"], "hit")
        for now in (99, 110):
            self.assertEqual(tools.cache_get(cache, "p", "q", {}, now=now)["cache_status"], "stale")
        self.assertEqual(tools.cache_get(cache, "p", "q", {"language": "ja"}, now=101)["cache_status"], "miss")
        tools.cache_put(cache, "p", "q", {}, {"results": [1]}, 10, now=120)
        self.assertEqual(len(list((cache / "history").glob("*.json"))), 2)
        self.assertEqual(tools.cache_get(cache, "p", "q", {}, now=120)["payload"], {"results": [1]})

    def test_cache_corruption_detected(self):
        cache = self.root / "cache"
        entry = tools.cache_put(cache, "p", "q", {}, {}, 10, now=100)
        (cache / "objects" / (entry["payload_sha256"] + ".json")).write_text("{}")
        with self.assertRaises(ValueError):
            tools.cache_get(cache, "p", "q", {}, now=101)

    def test_cli_reports_pass_and_missing_source_failure(self):
        command = [sys.executable, str(SCRIPT), "validate", "--batch", str(self.batch), "--source-root", str(self.root)]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        (self.root / "source.txt").unlink()
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(json.loads(result.stdout)["ok"])

    def test_source_quoted_requires_explicit_nonempty_spans(self):
        for spans in (None, [], "bad", [None], [{"quote_ref": 0}]):
            with self.subTest(spans=spans):
                item = {"text": self.quote, "derivation": "source_quoted"}
                if spans is not None:
                    item["spans"] = spans
                self.record["conditions"]["items"] = [item]
                self.save()
                self.assertFalse(self.validate()["ok"])

    def test_justification_reference_must_exist(self):
        self.record["conditions"]["justification_quote_ref"] = 99
        self.save()
        self.assertIn("invalid_quote_ref", {e["code"] for e in self.validate()["errors"]})

    def test_output_scope_is_required_for_source_reported(self):
        self.record["status"] = "source_reported"
        self.record.pop("support_scope")
        self.save()
        self.assertFalse(self.validate()["ok"])
        with self.assertRaises(ValueError):
            tools.coverage([self.batch], self.config, 20)

    def test_held_record_cannot_be_ready(self):
        self.record["held_class"] = "on_hold"
        self.save()
        self.assertFalse(self.validate()["ok"])
        with self.assertRaises(ValueError):
            tools.coverage([self.batch], self.config, 20)

    def test_unknown_schema_is_not_silently_supported(self):
        self.record["schema_version"] = "999"
        self.save()
        for legacy in (False, True):
            self.assertFalse(tools.validate_batch(self.batch, self.root, legacy)["ok"])

    def test_new_collection_requires_raw_and_candidate_id(self):
        self.record.pop("candidate_id")
        self.save()
        self.assertFalse(self.validate()["ok"])
        self.assertTrue(tools.validate_batch(self.batch, self.root, legacy=True)["ok"])
        (self.batch / "raw.jsonl").unlink()
        with self.assertRaises(ValueError):
            self.validate()
        self.assertTrue(tools.validate_batch(self.batch, self.root, legacy=True)["ok"])

    def test_falsey_candidate_ids_are_errors_even_in_legacy(self):
        for cid in ("", " ", False, 0, None, []):
            with self.subTest(cid=cid):
                self.record["candidate_id"] = cid
                self.save()
                self.assertFalse(tools.validate_batch(self.batch, self.root, legacy=True)["ok"])
                with self.assertRaises(ValueError):
                    tools.coverage([self.batch], self.config, 20, legacy=True)

    def test_slot_in_ready_is_rejected_by_both_commands(self):
        slot = {"record_type": "slot", "candidate_id": "c1", "domain": "AI",
                "slots": 1, "reason_code": "fetch_failed"}
        self.save(ready=[slot], raw=[])
        self.assertFalse(self.validate()["ok"])
        with self.assertRaises(ValueError):
            tools.coverage([self.batch], self.config, 20)

    def test_validator_detects_candidate_double_count_and_domain_conflict(self):
        slot = {"record_type": "slot", "candidate_id": "c1", "domain": "AI",
                "slots": 1, "reason_code": "fetch_failed"}
        self.save(excluded=[slot])
        self.assertFalse(self.validate()["ok"])
        child = copy.deepcopy(self.record)
        child.update(record_id="r2")
        child["scope"]["domain"] = "R"
        self.save(ready=[self.record, child])
        self.assertFalse(self.validate()["ok"])

    def test_legacy_record_id_does_not_alias_real_candidate_id(self):
        legacy = copy.deepcopy(self.record)
        legacy.update(record_id="c1")
        legacy.pop("candidate_id")
        self.save(ready=[self.record, legacy])
        result = tools.coverage([self.batch], self.config, 20, legacy=True)
        self.assertEqual(result["domains"]["AI"]["candidate_count"], 2)
        self.assertEqual(result["legacy_record_id_fallbacks"], 1)

    def test_candidate_from_two_batch_revisions_is_not_silently_merged(self):
        original_batch = self.batch
        self.batch = self.root / "revision"
        self.batch.mkdir()
        self.record["record_id"] = "revision-r1"
        self.save()
        with self.assertRaises(ValueError):
            tools.coverage([original_batch, self.batch], self.config, 20)

    def test_raw_identity_cannot_change_during_self_check(self):
        raw = copy.deepcopy(self.record)
        raw["candidate_id"] = "other"
        self.save(raw=[raw])
        report = self.validate()
        self.assertFalse(report["ok"])
        self.assertFalse(report["first_output_ok"])

    def test_corrected_output_does_not_require_rewriting_raw_evidence(self):
        raw = copy.deepcopy(self.record)
        raw["provenance"]["quotes"][0]["quote_sha256"] = "0" * 64
        self.save(raw=[raw])
        report = self.validate()
        self.assertFalse(report["ok"])
        self.assertTrue(report["first_output_ok"])
        self.assertEqual(report["first_output_records"], 1)
        raw["claim"] = None
        self.save(raw=[raw])
        report = self.validate()
        self.assertFalse(report["ok"])
        self.assertTrue(report["first_output_ok"])

    def test_bad_nested_input_reports_errors_and_checks_later_records(self):
        for invalid in (None, [], "x"):
            bad = copy.deepcopy(self.record)
            bad.update(record_id="bad", candidate_id="bad", claim=invalid)
            self.save(ready=[bad, self.record])
            report = self.validate()
            self.assertFalse(report["ok"])
            self.assertGreater(report["checks"]["source_offsets"], 0)

    def test_jsonl_allows_unicode_line_separator_inside_string(self):
        self.record["claim"]["normalized_ja"] = "a\u2028b"
        self.save()
        self.assertTrue(self.validate()["ok"])

    def test_nonfinite_number_not_allowed(self):
        for payload in ('{"value":1e999}', '{"value":-1e999}'):
            with self.assertRaises(ValueError):
                tools.strict_json(payload)

    def test_large_finite_weights_preserve_allocation(self):
        config = {"domains": {"a": {"weight": 1e308}, "b": {"weight": 1e308}}}
        self.assertEqual(tools.allocations(config, 500), {"a": 250, "b": 250})
        for total in (True, 2.5, -1):
            with self.assertRaises(ValueError):
                tools.allocations(config, total)

    def test_cache_changed_metadata_is_not_hit(self):
        for key, value in (("query", "other"), ("expires_at_unix", 100000)):
            cache = self.root / key
            entry = tools.cache_put(cache, "p", "q", {}, {}, 10, now=100)
            path = cache / "entries" / (entry["key"] + ".json")
            entry[key] = value
            path.write_bytes(tools.encode(entry))
            with self.assertRaises((ValueError, OSError)):
                tools.cache_get(cache, "p", "q", {}, now=120)

    def test_cache_rejects_nonfinite_or_negative_time_values(self):
        for ttl, now in ((float("inf"), 100), (1, float("nan")), (-1, 100), (True, 100)):
            with self.assertRaises(ValueError):
                tools.cache_put(self.root / "cache", "p", "q", {}, {}, ttl, now=now)

    def test_failed_cache_publish_preserves_previous_entry(self):
        cache = self.root / "cache"
        tools.cache_put(cache, "p", "q", {}, {"version": 1}, 100, now=100)
        replace = tools.os.replace

        def fail_entry(source, target):
            if Path(target).parent.name == "entries":
                raise OSError("simulated interrupted publication")
            return replace(source, target)

        with mock.patch.object(tools.os, "replace", side_effect=fail_entry):
            with self.assertRaises(OSError):
                tools.cache_put(cache, "p", "q", {}, {"version": 2}, 100, now=101)
        self.assertEqual(tools.cache_get(cache, "p", "q", {}, now=102)["payload"], {"version": 1})
        self.assertEqual(list(cache.rglob(".write-*")), [])

    def test_cli_cache_miss_stale_and_corruption_are_distinct(self):
        cache = self.root / "cache"
        command = [sys.executable, str(SCRIPT), "cache-get", "--cache-dir", str(cache),
                   "--provider", "p", "--query", "q"]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 3)
        entry = tools.cache_put(cache, "p", "q", {}, {}, 0, now=0)
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 4)
        path = cache / "entries" / (entry["key"] + ".json")
        path.write_text('{"expires_at_unix": 1e999}')
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(json.loads(result.stdout)["ok"])

    def test_source_symlink_cycle_is_a_controlled_error(self):
        (self.root / "loop").symlink_to("loop")
        with self.assertRaises(ValueError):
            tools.safe_source(self.root, "loop")

    def test_source_snapshot_must_be_utf8_text(self):
        path = self.root / "source.txt"
        data = path.read_bytes() + b"\xff"
        path.write_bytes(data)
        self.record["provenance"]["source"]["content_sha256"] = tools.digest(data)
        self.save()
        self.assertIn("source_not_utf8", {e["code"] for e in self.validate()["errors"]})

    def test_cli_collection_helpers_end_to_end(self):
        search = self.root / "search.json"
        result = {"results": [{"url": self.record["provenance"]["source"]["url"]}]}
        search.write_bytes(tools.encode(result))
        cache_args = ["--cache-dir", str(self.root / "cache"), "--provider", "fixture", "--query", "test"]

        def run(args):
            proc = subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            return json.loads(proc.stdout)

        run(["cache-put", *cache_args, "--input", str(search)])
        cached = run(["cache-get", *cache_args])
        self.assertEqual(cached["payload"], result)
        self.assertTrue(run(["validate", "--batch", str(self.batch), "--source-root", str(self.root)])["first_output_ok"])
        config = self.root / "distribution.json"
        config.write_bytes(tools.encode(self.config))
        coverage = run(["coverage", "--batch", str(self.batch), "--config", str(config), "--target-total", "20"])
        self.assertEqual(coverage["domains"]["AI"]["ready"], 1)
        self.assertEqual(coverage["final_record_count"], 1)


if __name__ == "__main__":
    unittest.main()
