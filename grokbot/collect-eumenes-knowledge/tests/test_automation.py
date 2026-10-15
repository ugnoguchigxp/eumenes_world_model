from email.message import Message
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from urllib.error import HTTPError

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import fetch_sources as fetch
import assemble_bookkeeping as book
from collector_tools import digest, encode, load_json, validate_batch


class AutomationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.input = self.root / "input.jsonl"
        self.output = self.root / "output"
        self.rows = [{"candidate_id": f"c{i}", "url": f"https://example.org/{i}", "domain": "AI"} for i in range(3)]
        self.input.write_bytes(b"".join(encode(r).replace(b"\n", b"") + b"\n" for r in self.rows))

    def fake_fetch(self, url, directory, max_bytes, timeout):
        if url.endswith("/1"):
            return {"status": "handoff", "reason": "pdf_needs_extraction"}
        text = "導入。\n対象は日本語。\n末尾。".encode()
        for name in ("response.bin", "text.txt"):
            (Path(directory) / name).write_bytes(text)
        return {"status": "fetched", "raw_sha256": digest(text), "text_sha256": digest(text)}

    def run_fetch(self, **kwargs):
        return fetch.run_plan(self.input, self.output, interval=0, fetcher=self.fake_fetch, **kwargs)

    def spec(self, path="source.txt"):
        return {"cid": "c0", "rid": "r0", "d": "AI", "url": "https://example.org/0",
                "source": {"source_id": "s0", "path": path, "text_extraction": "fixture"},
                "quotes": ["対象は日本語。"], "ja": "対象は日本語。", "type": "definition",
                "mod": "defined", "as": "source_asserted", "st": "verified", "ss": "full_text",
                "conds": [], "cstat": "unconditional_with_justification", "ver": "fixture",
                "justification": "試験用の定義。", "justification_quote_ref": 0,
                "retrieved_at": "unknown",
                "review": {"self_check": {"by": "fixture", "method": "fixture", "result": "pass"},
                           "independent_review": "not_performed"},
                "license": {"storage": "unknown", "redistribution": "unknown", "basis": "fixture", "checked_at": "unknown"},
                "extraction": {"method": "fixture", "version": "1", "first_output": True}}

    def save_spec(self, specs, slots=None):
        path = self.root / "spec.json"
        path.write_bytes(encode({"records": specs, "slots": slots or []}))
        return path

    def test_html_conversion_drops_code_preserves_table_and_unicode(self):
        text, method, _ = fetch.convert('<head><title>Hidden</title></head><script>attack()</script><p>日本語 &amp; 😀</p><table><tr><td>A</td><td>B</td></tr></table>'.encode(), 'text/html')
        self.assertNotIn(b'attack', text)
        self.assertNotIn(b'Hidden', text)
        self.assertIn('日本語 & 😀'.encode(), text)
        self.assertIn(b'A\tB', text)
        self.assertEqual(method, 'html-visible-text-v1')

    def test_plain_json_xml_preserve_content(self):
        for body, mime in [(b'  hello\r\n', 'text/plain'), (b'{"a": 1}', 'application/json'), (b'<x/>', 'application/xml')]:
            self.assertEqual(fetch.convert(body, mime)[0], body)

    def test_conversion_handoffs(self):
        for body, mime, reason in [(b'%PDF-1', 'application/pdf', 'pdf_needs_extraction'),
                (b'xx', 'image/png', 'unsupported_content_type'), (b'\xff', 'text/plain', 'encoding_needs_review'),
                (b'{"a":NaN}', 'application/json', 'invalid_json'), (b'<script>x</script>', 'text/html', 'no_text_extracted')]:
            with self.subTest(reason=reason), self.assertRaises(fetch.Handoff) as caught:
                fetch.convert(body, mime)
            self.assertEqual(caught.exception.reason, reason)

    def test_url_guards_and_mixed_dns(self):
        for url in ('file:///etc/hosts', 'http://127.0.0.1', 'http://[::1]', 'https://user:pass@example.org', 'https://example.org:8000'):
            with self.assertRaises(fetch.Handoff):
                fetch.public_url(url)
        with mock.patch.object(fetch.socket, 'getaddrinfo', return_value=[(0,0,0,'',('1.1.1.1',443)), (0,0,0,'',('127.0.0.1',443))]):
            with self.assertRaises(fetch.Handoff):
                fetch.public_url('https://example.org', resolve=True)

    def response(self, body, headers):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.geturl.return_value = 'https://example.org'
        response.headers = Message()
        for key, value in headers.items():
            response.headers[key] = value
        response.read.side_effect = lambda n: body[:n]
        opener = mock.Mock()
        opener.open.return_value = response
        with mock.patch.object(fetch, 'public_url'):
            return fetch.fetch_once('https://example.org', self.root, 100, 1, opener)

    def test_fetch_stores_raw_pdf_for_handoff(self):
        result = self.response(b'%PDF-1', {'Content-Type': 'application/pdf'})
        self.assertEqual(result['reason'], 'pdf_needs_extraction')
        self.assertEqual(digest((self.root / 'response.bin').read_bytes()), result['raw_sha256'])

    def test_fetch_bounds_and_incomplete_body(self):
        for body, headers, reason in [(b'a'*101, {}, 'body_too_large'), (b'x', {'Content-Length':'101'}, 'body_too_large'),
                (b'x', {'Content-Length':'3'}, 'incomplete_body'), (b'x', {'Content-Encoding':'gzip'}, 'unsupported_content_encoding')]:
            self.assertEqual(self.response(body, headers)['reason'], reason)

    def test_http_errors_are_not_retried(self):
        for code in (302, 403, 429):
            headers = Message()
            headers['Location'] = 'https://example.org/moved'
            headers['Retry-After'] = '600'
            opener = mock.Mock()
            opener.open.side_effect = HTTPError('https://example.org', code, 'failed', headers, io.BytesIO())
            with mock.patch.object(fetch, 'public_url'):
                result = fetch.fetch_once('https://example.org', self.root, 100, 1, opener)
            self.assertEqual(result['status'], 'handoff')
            self.assertEqual(result['retry_after'], '600')
            self.assertEqual(opener.open.call_count, 1)

    def test_attempt_timeout_hands_off(self):
        with mock.patch.object(fetch.subprocess, 'run', side_effect=subprocess.TimeoutExpired('worker', .01)):
            result = fetch.isolated_fetch('https://example.org', self.root, 100, .01)
        self.assertEqual(result['reason'], 'attempt_deadline')

    def test_actual_stalled_child_is_terminated(self):
        real_run = subprocess.run
        def stalled(command, **kwargs):
            return real_run([sys.executable, '-c', 'import time; time.sleep(10)'], **kwargs)
        with mock.patch.object(fetch.subprocess, 'run', side_effect=stalled):
            result = fetch.isolated_fetch('https://example.org', self.root, 100, .1)
        self.assertEqual(result['reason'], 'attempt_deadline')

    def test_unavailable_child_hands_off(self):
        with mock.patch.object(fetch.subprocess, 'run', side_effect=PermissionError('disabled')):
            result = fetch.isolated_fetch('https://example.org', self.root, 100, 1)
        self.assertEqual(result['reason'], 'worker_unavailable')

    def test_budget_expiring_during_interval_does_not_start_request(self):
        calls = mock.Mock(side_effect=self.fake_fetch)
        with mock.patch.object(fetch.time, 'monotonic', side_effect=[0, 0, 0, 1, 11, 11]), mock.patch.object(fetch.time, 'sleep'):
            summary = fetch.run_plan(self.input, self.output, interval=1, max_seconds=10, fetcher=calls)
        self.assertEqual(calls.call_count, 1)
        self.assertEqual(summary['counts']['deferred'], 2)

    def test_resume_skips_success_and_failure_processes_pending(self):
        self.assertEqual(self.run_fetch(limit=2)['counts'], {'fetched': 1, 'handoff': 1, 'deferred': 1})
        second = self.run_fetch()
        self.assertEqual(second['attempts_this_invocation'], 1)
        self.assertEqual(second['counts'], {'fetched': 2, 'handoff': 1, 'deferred': 0})
        self.assertEqual(self.run_fetch()['attempts_this_invocation'], 0)

    def test_corrupt_snapshot_stops_without_refetch(self):
        self.run_fetch()
        next((self.output / 'sources').glob('*.txt')).write_text('corrupt')
        with self.assertRaises(ValueError), mock.patch.object(self, 'fake_fetch', side_effect=AssertionError('must not fetch')):
            self.run_fetch()

    def test_interrupted_attempt_is_not_retried(self):
        with self.assertRaises(RuntimeError):
            fetch.run_plan(self.input, self.output, interval=0, fetcher=mock.Mock(side_effect=RuntimeError('crash')))
        self.run_fetch()
        first = json.loads((self.output / 'results.jsonl').read_text().splitlines()[0])
        self.assertEqual(first['reason'], 'interrupted_attempt')

    def test_changed_plan_and_duplicate_url_rejected(self):
        self.run_fetch()
        with self.assertRaises(ValueError):
            self.run_fetch(timeout=5)
        self.input.write_text(json.dumps(self.rows[0])+'\n'+json.dumps({**self.rows[0], 'candidate_id':'another'})+'\n')
        with self.assertRaises(ValueError):
            fetch.input_rows(self.input)

    def test_budget_does_not_turn_pending_into_handoff(self):
        with mock.patch.object(fetch.time, 'monotonic', side_effect=[0, 20, 20, 20]):
            summary = self.run_fetch(max_seconds=10)
        self.assertEqual(summary['counts'], {'fetched':0,'handoff':0,'deferred':3})

    def test_actual_cli_worker_rejects_private_url_and_resumes(self):
        self.input.write_text(json.dumps({**self.rows[0], 'url':'http://127.0.0.1'})+'\n')
        command = [sys.executable, str(SCRIPTS/'fetch_sources.py'), 'run', '--input', str(self.input), '--output', str(self.output)]
        first = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(first.returncode, 1, first.stderr + first.stdout)
        self.assertEqual(json.loads(first.stdout)['counts']['handoff'], 1)
        second = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(json.loads(second.stdout)['attempts_this_invocation'], 0)

    def test_fetch_assemble_validate_integration(self):
        self.run_fetch(limit=1)
        result = json.loads((self.output/'results.jsonl').read_text().splitlines()[0])
        selected = self.spec(result['text_path'])
        selected['source'].update(raw_path=result['raw_path'], content_sha256=result['text_sha256'])
        selected['conds'] = [{'text':'日本語', 'role':'scope'}]
        selected['cstat'] = 'extracted'
        batch = self.root/'batch'
        spec = self.save_spec([selected])
        command = [sys.executable, str(SCRIPTS/'assemble_bookkeeping.py'), '--spec', str(spec), '--source-root', str(self.output), '--output', str(batch)]
        proc = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stdout+proc.stderr)
        self.assertTrue(validate_batch(batch, self.output)['ok'])
        record = json.loads((batch/'first_output.jsonl').read_text())
        self.assertEqual(record['conditions']['items'][0]['spans'][0]['span_in_quote'], [3,6])
        self.assertEqual(record['scope']['retrieved_at'], 'unknown')
        self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)

    def test_ambiguous_quote_and_span_require_offsets(self):
        for haystack, needle in [(b'aaa',b'aa'), ('😀日本語 日本語','日本語')]:
            with self.assertRaises(ValueError):
                book.locate(haystack, needle)
            self.assertEqual(book.locate(haystack, needle, haystack.find(needle)), haystack.find(needle))
        for bad in (-1, True, 99):
            with self.assertRaises(ValueError):
                book.locate('abc', 'a', bad)

    def test_bookkeeping_requires_metadata_and_combination_decision(self):
        (self.root/'source.txt').write_text('対象は日本語。')
        for field in ('retrieved_at', 'review', 'license', 'source', 'justification'):
            selected = self.spec()
            del selected[field]
            with self.assertRaises((ValueError, KeyError)):
                book.assemble_record(selected, self.root)
        selected = self.spec()
        selected['conds'] = [{'text':'対象', 'role':'scope'}, {'text':'日本語', 'role':'scope'}]
        with self.assertRaises(ValueError):
            book.assemble_record(selected, self.root)
        selected.update(combinator_status='unresolved', comb=None)
        self.assertIsNone(book.assemble_record(selected, self.root)[0]['conditions']['combinator'])

    def test_failed_assembly_leaves_no_partial_batch(self):
        (self.root/'source.txt').write_text('対象は日本語。')
        broken = self.spec()
        broken['quotes'] = ['missing']
        with self.assertRaises(ValueError):
            book.assemble(self.save_spec([self.spec(), broken]), self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_held_and_slots_are_explicit_not_hardcoded(self):
        (self.root/'source.txt').write_text('対象は日本語。')
        selected = self.spec()
        selected.update(st='on_hold', raw_status='source_reported', reason='needs_review', detail='test')
        selected['review']['self_check']['result'] = 'hold'
        slot = {'record_type':'slot','candidate_id':'failed','domain':'R','slots':1,'reason_code':'fetch_failed','detail':'fixture'}
        report = book.assemble(self.save_spec([selected], [slot]), self.root, self.output)
        self.assertEqual(report['counts'], {'raw':1,'first_output':0,'excluded_held':2})
        held = [json.loads(line) for line in (self.output/'excluded_held.jsonl').read_text().splitlines()]
        self.assertNotIn('status', held[1])
        self.assertEqual(held[1]['review']['self_check']['result'], 'hold')

    def test_source_hash_and_path_checked(self):
        (self.root/'source.txt').write_text('対象は日本語。')
        selected = self.spec()
        selected['source']['content_sha256'] = '0'*64
        with self.assertRaises(ValueError):
            book.assemble_record(selected, self.root)
        selected = self.spec()
        selected['source']['url'] = 'https://example.org/different'
        with self.assertRaises(ValueError):
            book.assemble_record(selected, self.root)
        selected = self.spec('../outside')
        with self.assertRaises(ValueError):
            book.assemble_record(selected, self.root)


if __name__ == '__main__':
    unittest.main()
