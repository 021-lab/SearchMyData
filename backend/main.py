"""
Workspace Git-as-Backend — FastAPI application.

Endpoints:
  POST /api/tasks/search   — search tasks, return subtree
  POST /api/tasks/action   — mutate tree (add_node | patch | reorder)
  POST /api/tasks/undo     — revert last commit (git revert HEAD)

Static files (frontend) are served from the project root at /
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .git_store import GitStore
from .id_gen import make_id
from .models import ActionRequest, SearchRequest, UndoRequest
from .patch_ops import (
    apply_json_patch,
    build_add_patch,
    cascade_delete,
    search_subtree,
)

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent          # SearchMyData/
DATA_PATH = ROOT / "data"                    # SearchMyData/data/

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Workspace Git-as-Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

store = GitStore(DATA_PATH)


# ── API routes ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Railway healthcheck endpoint."""
    return {"status": "ok"}


@app.post("/api/tasks/search")
async def search(req: SearchRequest):
    """Return a (partial) task tree matching *query*. Empty query = full tree."""
    tree = store.read()
    return search_subtree(tree, req.query)


@app.post("/api/tasks/action")
async def action(req: ActionRequest):
    """
    Mutate the task tree and commit.

    type="add_node"
        payload: { "prt": str|null, "value": { "ttl", "sub", "tgs", "cld" } }
        → increments last_id, generates ID, adds task, returns sync patch

    type="patch"
        payload: list of RFC 6902 operations
        → applies patch; "remove /tsk/<id>" triggers cascade delete

    type="reorder"
        payload: { "items": [{ "id": str, "prt": str|null }, ...] }
        → rebuilds tsk dict in new order with updated prt values
    """
    tree = store.read()

    # ── add_node ───────────────────────────────────────────────────────────────
    if req.type == "add_node":
        tree["last_id"] += 1
        new_id = make_id(req.author_type, tree["last_id"])
        value: dict = req.payload.get("value") or {}
        task_obj = {
            "ttl": value.get("ttl") or "",
            "sub": value.get("sub") or None,
            "prt": req.payload.get("prt"),
            "tgs": value.get("tgs") or [],
            "cld": bool(value.get("cld", False)),
        }
        tree["tsk"][new_id] = task_obj
        patch = build_add_patch(new_id, task_obj)
        store.write_and_commit(
            tree,
            req.author_type,
            f"add_node {new_id}: {task_obj['ttl'][:60]}",
        )
        return patch

    # ── patch ──────────────────────────────────────────────────────────────────
    if req.type == "patch":
        ops: list[dict] = req.payload if isinstance(req.payload, list) else []
        result_ops: list[dict] = []

        for op in ops:
            operation = op.get("op", "")
            path: str = op.get("path", "")

            # Cascade-delete: remove /tsk/<id>
            if operation == "remove":
                parts = path.lstrip("/").split("/")
                if len(parts) >= 2 and parts[0] == "tsk":
                    task_id = parts[1]
                    if len(parts) == 2:
                        # Deleting the whole task node → cascade
                        removed = cascade_delete(tree, task_id)
                        result_ops.extend(
                            {"op": "remove", "path": f"/tsk/{tid}"}
                            for tid in removed
                        )
                        continue

            # All other operations applied normally
            try:
                tree = apply_json_patch(tree, [op])
            except Exception as exc:
                raise HTTPException(400, f"Invalid patch op: {exc}") from exc
            result_ops.append(op)

        store.write_and_commit(
            tree,
            req.author_type,
            f"patch by {req.author_type} ({len(ops)} op(s))",
        )
        return result_ops

    # ── reorder ────────────────────────────────────────────────────────────────
    if req.type == "reorder":
        ordered: list[dict] = req.payload.get("items") or []
        old_tsk = tree["tsk"]
        new_tsk: dict = {}

        for entry in ordered:
            tid = entry.get("id", "")
            if tid in old_tsk:
                new_tsk[tid] = {**old_tsk[tid], "prt": entry.get("prt")}

        # Append any tasks missing from the ordered list (safety net)
        for tid, task in old_tsk.items():
            if tid not in new_tsk:
                new_tsk[tid] = task

        tree["tsk"] = new_tsk
        store.write_and_commit(
            tree,
            req.author_type,
            f"reorder by {req.author_type}",
        )
        return [{"op": "replace", "path": "/tsk", "value": new_tsk}]

    raise HTTPException(400, f"Unknown action type: {req.type!r}")


@app.post("/api/tasks/undo")
async def undo(req: UndoRequest):
    """
    Undo the last commit via `git revert HEAD`.
    Returns the updated full tree after the revert.
    Raises 409 if the revert has a merge conflict.
    """
    tree = store.revert_head(req.author_type)
    return {
        "status": "success",
        "sync_tree": search_subtree(tree, ""),
    }


# ── Static frontend ────────────────────────────────────────────────────────────
# Must be registered AFTER API routes so /api/... hits the handlers above.
app.mount("/", StaticFiles(directory=str(ROOT)), name="frontend")
