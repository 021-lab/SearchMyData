"""
JSON-Patch operations and tree utilities for workspace tasks.

Tree schema (project_tree.json):
{
  "last_id": <int>,
  "tsk": {
    "<id>": { "ttl": str, "sub": str|null, "prt": str|null, "tgs": [], "cld": bool }
  }
}
"""
from __future__ import annotations
import jsonpatch


def apply_json_patch(tree: dict, patch: list) -> dict:
    """Apply an RFC 6902 JSON Patch list to *tree* and return the result."""
    return jsonpatch.apply_patch(tree, patch, in_place=False)


def cascade_delete(tree: dict, task_id: str) -> list[str]:
    """
    Remove *task_id* and all its descendants from tree["tsk"].
    Returns the list of removed IDs (BFS order, root first).
    """
    tsk = tree.get("tsk", {})
    removed: list[str] = []
    queue: list[str] = [task_id]

    while queue:
        tid = queue.pop(0)
        if tid not in tsk:
            continue
        removed.append(tid)
        # Collect direct children
        queue.extend(cid for cid, t in tsk.items() if t.get("prt") == tid)

    for tid in removed:
        tsk.pop(tid, None)

    return removed


def build_add_patch(task_id: str, task_obj: dict) -> list[dict]:
    """Return a single-op RFC 6902 patch that adds *task_id* to /tsk."""
    return [{"op": "add", "path": f"/tsk/{task_id}", "value": task_obj}]


def search_subtree(tree: dict, query: str) -> dict:
    """
    Search *tree["tsk"]* for tasks whose ttl or tgs contain *query*
    (case-insensitive).  Returns a partial tree that includes every
    matching task plus all its ancestors up to the root.

    If *query* is empty/blank, returns the full tree.
    """
    tsk: dict = tree.get("tsk", {})

    if not query.strip():
        return {"tsk": dict(tsk)}

    q = query.strip().lower()

    # ── Find matching task IDs ─────────────────────────────────────────────────
    matches: set[str] = set()
    for tid, task in tsk.items():
        ttl = (task.get("ttl") or "").lower()
        tgs = [(t or "").lower() for t in task.get("tgs") or []]
        if q in ttl or any(q in tag for tag in tgs):
            matches.add(tid)

    # ── Collect ancestors ─────────────────────────────────────────────────────
    all_ids: set[str] = set(matches)
    for tid in list(matches):
        current = tid
        while True:
            prt = (tsk.get(current) or {}).get("prt")
            if prt is None or prt in all_ids:
                break
            all_ids.add(prt)
            current = prt

    result_tsk = {tid: tsk[tid] for tid in tsk if tid in all_ids}
    return {"tsk": result_tsk}
