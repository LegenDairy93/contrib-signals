from __future__ import annotations

import json
import os
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
            "User-Agent": "contrib-signals/0.1",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise GitHubError(f"GitHub returned {error.code} for {url}: {detail}") from error
        except urllib.error.URLError as error:
            raise GitHubError(f"Could not reach GitHub for {url}: {error.reason}") from error

    def exists(self, repository: str, path: str) -> bool:
        try:
            self.get(f"/repos/{repository}/contents/{path}")
            return True
        except GitHubError as error:
            if "returned 404" in str(error):
                return False
            raise
