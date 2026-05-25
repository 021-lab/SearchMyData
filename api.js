'use strict';

/**
 * api.js — Git-as-Backend client layer for list-manager.html
 *
 * Exports (globals):
 *   apiMode          {boolean}  true when backend is reachable
 *   apiSearch(q)     → { tsk: {...} }
 *   apiAction(author, type, payload)  → sync patch
 *   apiUndo(author)  → { status, sync_tree }
 *   tskToItems(tsk)  → items[]  (compatible with existing render())
 *   computeParent(items, id) → string id | null
 */

// ── Base URL ──────────────────────────────────────────────────────────────────
// Same-origin when served by FastAPI; absolute fallback for file:// opening.
const API_BASE =
  window.location.protocol === 'file:'
    ? 'http://localhost:8000'
    : '';

/** Set to true once a successful /api/tasks/search has been performed. */
let apiMode = false;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function _post(path, body) {
  const res = await fetch(API_BASE + path, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`${res.status} ${err.detail || res.statusText}`);
  }
  return res.json();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Search tasks.  Empty string → full tree.
 * @returns {Promise<{tsk: object}>}
 */
async function apiSearch(query = '') {
  return _post('/api/tasks/search', { query });
}

/**
 * Mutate the task tree.
 * @param {string} authorType  — usr | dsp | slv | exe | tst
 * @param {string} type        — add_node | patch | reorder
 * @param {*}      payload     — shape depends on type
 * @returns {Promise<Array>}   RFC 6902 sync patch
 */
async function apiAction(authorType, type, payload) {
  return _post('/api/tasks/action', {
    project_id: 'main',
    author_type: authorType,
    type,
    payload,
  });
}

/**
 * Revert the last commit (git revert HEAD).
 * @param {string} authorType
 * @returns {Promise<{status: string, sync_tree: {tsk: object}}>}
 */
async function apiUndo(authorType = 'usr') {
  return _post('/api/tasks/undo', { project_id: 'main', author_type: authorType });
}

// ── tskToItems ────────────────────────────────────────────────────────────────
/**
 * Convert a backend tsk dict to the flat items[] array used by render().
 *
 * Mapping:
 *   ttl  → line1
 *   sub  → line2   (optional)
 *   cld  → collapsed (optional)
 *   tgs  → tags    (optional)
 *   prt  → level   (computed by depth)
 *
 * Children are ordered by insertion order of their parent's keys in tsk.
 *
 * @param {object} tsk
 * @returns {Array}
 */
function tskToItems(tsk) {
  if (!tsk) return [];

  // ── Build children map ─────────────────────────────────────────────────────
  const childrenOf = {};  // parentId → [childId, ...]
  const roots = [];

  for (const [id, task] of Object.entries(tsk)) {
    const prt = task.prt;
    if (prt == null) {
      roots.push(id);
    } else {
      if (!childrenOf[prt]) childrenOf[prt] = [];
      childrenOf[prt].push(id);
    }
  }

  // ── DFS traversal ──────────────────────────────────────────────────────────
  const result = [];

  function traverse(id, level) {
    const task = tsk[id];
    if (!task) return;
    const item = { id, line1: task.ttl || '' };
    if (task.sub)                  item.line2     = task.sub;
    if (level > 0)                 item.level     = level;
    if (task.cld)                  item.collapsed = true;
    if (task.tgs && task.tgs.length) item.tags    = [...task.tgs];
    result.push(item);
    for (const childId of (childrenOf[id] || [])) {
      traverse(childId, level + 1);
    }
  }

  for (const rootId of roots) traverse(rootId, 0);
  return result;
}

// ── computeParent ─────────────────────────────────────────────────────────────
/**
 * Return the string task ID of the parent of item *itemId* in the flat
 * items[] array, or null if it is a root node.
 *
 * Parent = closest preceding item whose level is exactly (level - 1).
 *
 * @param {Array}  items
 * @param {*}      itemId
 * @returns {string|null}
 */
function computeParent(items, itemId) {
  const idx = items.findIndex(i => i.id == itemId);
  if (idx < 0) return null;
  const level = items[idx].level || 0;
  if (level === 0) return null;
  for (let j = idx - 1; j >= 0; j--) {
    if ((items[j].level || 0) === level - 1) return String(items[j].id);
  }
  return null;
}

// ── cascadeDeleteLocal ─────────────────────────────────────────────────────────
/**
 * Remove itemId and all its descendants from a flat items[] array.
 * Descendants are contiguous items with strictly higher level.
 *
 * @param {Array}  items
 * @param {*}      itemId
 * @returns {Array}  new array without the deleted group
 */
function cascadeDeleteLocal(items, itemId) {
  const idx = items.findIndex(i => i.id == itemId);
  if (idx < 0) return items;
  const level = items[idx].level || 0;
  let end = idx + 1;
  while (end < items.length && (items[end].level || 0) > level) end++;
  return [...items.slice(0, idx), ...items.slice(end)];
}
