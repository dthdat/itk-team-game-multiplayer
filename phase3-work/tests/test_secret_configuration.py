"""Secret setup regression checks; no network or real credentials."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

spec = importlib.util.spec_from_file_location(
    'secret_setup', Path(__file__).resolve().parents[1] / 'tools/configure-production-secrets.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
FAKE_KEY = 'test-key-synthetic-regression-only'


class SecretConfigurationTests(unittest.TestCase):
    def test_models_request_identifies_application_and_makes_no_inference(self):
        data = {'data': [{'id': 'openai/gpt-oss-20b'}]}
        with patch.object(setup.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(data).encode())) as call:
            self.assertEqual(setup.validate_groq_key(FAKE_KEY), data)
        request = call.call_args.args[0]
        self.assertEqual(request.full_url, 'https://api.groq.com/openai/v1/models')
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(request.get_header('User-agent'), 'ITK-BGSV-Setup/1.0')
        self.assertEqual(request.get_header('Accept'), 'application/json')
        self.assertEqual(request.get_header('Authorization'), 'Bearer ' + FAKE_KEY)

    def test_http_and_network_errors_never_echo_response_or_key(self):
        errors = [HTTPError('https://api.groq.com', status, FAKE_KEY, {}, io.BytesIO(FAKE_KEY.encode())) for status in (401, 403, 429, 500)]
        errors.append(URLError(FAKE_KEY))
        for error in errors:
            with self.subTest(error=type(error).__name__), patch.object(setup.urllib.request, 'urlopen', side_effect=error):
                with self.assertRaises(RuntimeError) as caught:
                    setup.validate_groq_key(FAKE_KEY)
                self.assertNotIn(FAKE_KEY, str(caught.exception))
                self.assertIn('No configuration changed', str(caught.exception))

    def test_rejected_key_does_not_touch_protected_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / 'service.env'
            before = 'GRADING_PROVIDER=mock\nGROQ_API_KEY=\n'
            env.write_text(before)
            with patch.object(setup, 'ENV', env), patch.object(setup.os, 'geteuid', return_value=0), patch.object(setup.sys.stdin, 'isatty', return_value=True), patch.object(setup.sys, 'argv', ['setup', 'groq']), patch('builtins.input', return_value='FREE'), patch.object(setup.getpass, 'getpass', return_value=FAKE_KEY), patch.object(setup.urllib.request, 'urlopen', side_effect=HTTPError('https://api.groq.com', 403, 'Forbidden', {}, None)):
                with self.assertRaises(RuntimeError):
                    setup.main()
            self.assertEqual(env.read_text(), before)
            self.assertFalse(env.with_suffix('.env.new').exists())


if __name__ == '__main__':
    unittest.main()
