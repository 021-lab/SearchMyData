"""
GitStore — persists project_tree.json inside a local Git repository.

Every mutation produces a git commit.  The commit's Author field carries
the author_type (usr / dsp / slv / exe / tst) so the git log can serve
as a training dataset for AI agents.

Thread-safety: a threading.Lock serialises all write + commit operations.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
from pathlib import Path

import git
from fastapi import HTTPException

TREE_FILE = "project_tree.json"
EMPTY_TREE = {"last_id": 0, "tsk": {}}


class GitStore:
    def __init__(self, repo_path: str | Path) -> None:
        self.repo_path = Path(repo_path)
        self.file_path = self.repo_path / TREE_FILE
        self.lock = threading.Lock()

        self._ensure_repo()

    # ── Setup ──────────────────────────────────────────────────────────────────
    def _ensure_repo(self) -> None:
        """Initialise the data directory and git repo if they don't exist."""
        self.repo_path.mkdir(parents=True, exist_ok=True)

        git_dir = self.repo_path / ".git"
        if not git_dir.exists():
            self.repo = git.Repo.init(str(self.repo_path))
        else:
            self.repo = git.Repo(str(self.repo_path))

        # Ensure local git config so commits work without global config
        with self.repo.config_writer() as cw:
            cw.set_value("user", "name", "workspace-backend")
            cw.set_value("user", "email", "backend@workspace.local")

        # Create the data file and make an initial commit if needed
        if not self.file_path.exists():
            self._write_json(EMPTY_TREE)
            self.repo.index.add([TREE_FILE])
            actor = git.Actor("system", "system@workspace.local")
            self.repo.index.commit("Initial state", author=actor, committer=actor)

    # ── Read ───────────────────────────────────────────────────────────────────
    def read(self) -> dict:
        with open(self.file_path, "r", encoding="utf-8") as f:
            return json.load(f)

    # ── Write + Commit ─────────────────────────────────────────────────────────
    def write_and_commit(self, tree: dict, author_type: str, message: str) -> None:
        """Persist *tree* and record the change as a git commit authored by *author_type*."""
        with self.lock:
            self._write_json(tree)
            self.repo.index.add([TREE_FILE])
            actor = git.Actor(author_type, f"{author_type}@workspace.local")
            self.repo.index.commit(message, author=actor, committer=actor)

    # ── Revert HEAD ────────────────────────────────────────────────────────────
    def revert_head(self, author_type: str) -> dict:
        """
        Undo the last commit via `git revert HEAD --no-edit`.
        The revert commit is authored by *author_type*.

        Raises HTTP 409 if git reports a merge conflict during the revert.
        """
        with self.lock:
            env = {
                **os.environ,
                "GIT_AUTHOR_NAME": author_type,
                "GIT_AUTHOR_EMAIL": f"{author_type}@workspace.local",
                "GIT_COMMITTER_NAME": author_type,
                "GIT_COMMITTER_EMAIL": f"{author_type}@workspace.local",
            }
            result = subprocess.run(
                ["git", "revert", "HEAD", "--no-edit"],
                cwd=str(self.repo_path),
                env=env,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                # Abort the failed revert so the repo stays clean
                subprocess.run(
                    ["git", "revert", "--abort"],
                    cwd=str(self.repo_path),
                    capture_output=True,
                )
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Отмена невозможна: структура задачи была изменена "
                        "более поздними правками. Внесите исправление вручную."
                    ),
                )
            return self.read()

    # ── Helpers ────────────────────────────────────────────────────────────────
    def _write_json(self, data: dict) -> None:
        with open(self.file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
