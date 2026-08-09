from __future__ import annotations

import http.client
import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from contrib_signals.github import GitHubClient, GitHubError


class FakeResponse:
    def __init__(self, payload: object) -> None:
        self.stream = io.BytesIO(json.dumps(payload).encode("utf-8"))

    def __enter__(self) -> io.BytesIO:
        return self.stream

    def __exit__(self, *_args: object) -> None:
        self.stream.close()


class GitHubClientTests(unittest.TestCase):
    @patch("contrib_signals.github.time.sleep", return_value=None)
    @patch("contrib_signals.github.urllib.request.urlopen")
    def test_retries_one_transient_disconnect(self, urlopen, _sleep) -> None:
        urlopen.side_effect = [
            http.client.RemoteDisconnected("closed"),
            FakeResponse({"ok": True}),
        ]
        result = GitHubClient(token="secret", retries=1).get("/rate_limit")
        self.assertEqual(result, {"ok": True})
        self.assertEqual(urlopen.call_count, 2)
        request = urlopen.call_args.args[0]
        self.assertEqual(request.headers["Authorization"], "Bearer secret")

    @patch("contrib_signals.github.time.sleep", return_value=None)
    @patch("contrib_signals.github.urllib.request.urlopen")
    def test_exhausted_disconnect_is_clean_and_redacted(self, urlopen, _sleep) -> None:
        urlopen.side_effect = http.client.RemoteDisconnected("closed")
        with self.assertRaises(GitHubError) as context:
            GitHubClient(token="secret", retries=1).get("/repos/acme/tool")
        self.assertIn("/repos/acme/tool", str(context.exception))
        self.assertNotIn("secret", str(context.exception))
        self.assertEqual(urlopen.call_count, 2)

    @patch("contrib_signals.github.urllib.request.urlopen")
    def test_exists_treats_404_as_missing(self, urlopen) -> None:
        urlopen.side_effect = urllib.error.HTTPError(
            "https://api.github.com/repos/acme/tool/contents/CONTRIBUTING.md",
            404,
            "Not Found",
            {},
            io.BytesIO(b'{"message":"Not Found"}'),
        )
        self.assertFalse(GitHubClient(retries=0).exists("acme/tool", "CONTRIBUTING.md"))


if __name__ == "__main__":
    unittest.main()
