from __future__ import annotations

import http.client
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


class GitHubError(RuntimeError):
    pass


@dataclass
class GitHubClient:
    token: str | None = None
    api_root: str = "https://api.github.com"
    timeout_seconds: float = 30
    retries: int = 1

    def __post_init__(self) -> None:
        if self.token is None:
            self.token = os.environ.get("GITHUB_TOKEN")

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        query = urllib.parse.urlencode(params or {}, doseq=True)
        url = f"{self.api_root}{path}"
        if query:
            url = f"{url}?{query}"
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "forkyssey/0.2",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        for attempt in range(self.retries + 1):
            request = urllib.request.Request(url, headers=headers)
            try:
                with urllib.request.urlopen(
                    request, timeout=self.timeout_seconds
                ) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                transient = error.code in {429, 500, 502, 503, 504}
                if transient and attempt < self.retries:
                    time.sleep(0.4)
                    continue
                detail = error.read().decode("utf-8", errors="replace")[:300]
                raise GitHubError(
                    f"GitHub returned {error.code} for {path}: {detail}"
                ) from error
            except (
                urllib.error.URLError,
                http.client.RemoteDisconnected,
                TimeoutError,
                OSError,
            ) as error:
                if attempt < self.retries:
                    time.sleep(0.4)
                    continue
                reason = getattr(error, "reason", None) or str(error)
                raise GitHubError(
                    f"Could not reach GitHub for {path}: {reason}"
                ) from error

        raise GitHubError(f"Could not reach GitHub for {path}.")

    def exists(self, repository: str, path: str) -> bool:
        try:
            self.get(f"/repos/{repository}/contents/{path}")
            return True
        except GitHubError as error:
            if "returned 404" in str(error):
                return False
            raise
