/**
 * Persisting query conditions and UI state.
 *
 * Storage backend: under Tauri this goes through tauri-plugin-store into
 * filters.json in the app data directory; in browser demo mode (npm run dev
 * straight to localhost) it falls back to Web storage — the same two-channel
 * structure as isTauri in api.js.
 *
 * WebView browser storage is deliberately not the primary store: it lives in
 * the WebView cache directory, gets wiped by system cache cleanup, and is lost
 * wholesale when a Tauri upgrade changes the webview origin.
 *
 * The left tree is a checkbox multi-select:
 *   selection.groups = [folder path, ...]  a ticked folder includes every
 *                                          subfolder and task beneath it
 *   selection.tasks  = [{ path, name }]    a ticked task shows only that one
 * expanded = folder paths expanded in the left tree, treeScroll = its scroll
 * offset. visibleGroups = folders ticked under "display config"; an empty
 * array means no restriction, show everything.
 *
 * The last one is a layout preference rather than a query condition:
 *   sidebarWidth = px              width of the left tree
 * It survives resetFilters — losing a hand-tuned layout to a button that says
 * "reset filters" is the most irritating kind of surprise.
 */

import { isTauri } from "./api.js";

// Drag limits for the left panel. The low end keeps the tree readable, the high
// end only has to stop nonsense numbers from a hand-edited file.
export const DEFAULT_SIDEBAR_WIDTH = 232;
export const SIDEBAR_RANGE = [180, 520];

// Store file name: relative to the app data directory. An absolute path would
// step outside the per-app sandbox.
const STORE_FILE = "filters.json";
const STORE_KEY = "filters";

// Keys used by the browser fallback. v1 / v2 and the pre-rename branded key
// are read once and migrated to WEB_KEY on the first load; only the old names
// below need to keep the former brand, since they point at existing data.
const WEB_KEY = "tockola.filters.v3";
const LEGACY_BRAND_V3 = "rhyzal.filters.v3";
const LEGACY_V2 = "rhyzal.filters.v2";
const LEGACY_V1 = "rhyzal.filters.v1";

export function defaultSelection() {
  return { groups: [], tasks: [] };
}

export function defaultFilters() {
  return {
    name: "", // Task name (substring match)
    nextRunFrom: "", // Earliest next run time (YYYY-MM-DD)
    nextRunTo: "", // Latest next run time (YYYY-MM-DD)
    enabled: "all", // all | enabled | disabled
    stateFilter: "all", // all | Running | Disabled | Failed
    // No showHidden here: hidden tasks always show. Visibility belongs to the
    // folder display config; the task's own hidden flag is just one of its
    // settings, not a list filter.
    sort: { key: "", dir: "asc" }, // List sort; empty key = default by name
    selection: defaultSelection(),
    expanded: ["\\"], // Folder paths expanded in the left tree
    treeScroll: 0, // Scroll offset of the left tree
    visibleGroups: [], // Folders ticked under "display config"; empty = all
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH, // Left tree width (draggable)
  };
}

function asPathArray(raw, fallback = []) {
  const list = Array.isArray(raw) ? raw.filter((p) => typeof p === "string" && !!p) : [];
  return list.length ? list : fallback;
}

function asTaskArray(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    if (typeof t.name !== "string" || !t.name) continue;
    out.push({ path: typeof t.path === "string" ? t.path : "\\", name: t.name });
  }
  return out;
}

function asNumber(raw, fallback = 0) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function clampNumber(raw, [min, max], fallback) {
  // Only a real positive number counts. Number(null) and Number("") are both 0,
  // so an absent or empty value has to be rejected before it is clamped into a
  // usable-looking answer.
  if (typeof raw === "object" || typeof raw === "boolean" || raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Sortable columns, aligned with the TaskGrid column ids (last run time and
// result are no longer columns, so they no longer take part in sorting).
export const SORT_KEYS = ["name", "state", "nextRun"];

// Task run state filter options
export const STATE_FILTERS = ["all", "Running", "Disabled", "Failed"];

function asSort(raw) {
  const base = { key: "", dir: "asc" };
  if (!raw || typeof raw !== "object") return base;
  return {
    key: SORT_KEYS.includes(raw.key) ? raw.key : "",
    dir: raw.dir === "desc" ? "desc" : "asc",
  };
}

/** Normalize the structure (tolerates legacy data with missing fields). */
function normalizeSelection(raw) {
  const base = defaultSelection();
  if (!raw || typeof raw !== "object") return base;
  return {
    groups: asPathArray(raw.groups),
    tasks: asTaskArray(raw.tasks),
  };
}

export function normalizeFilters(raw) {
  const base = defaultFilters();
  if (!raw || typeof raw !== "object") return base;
  return {
    name: typeof raw.name === "string" ? raw.name : base.name,
    nextRunFrom: typeof raw.nextRunFrom === "string" ? raw.nextRunFrom : base.nextRunFrom,
    nextRunTo: typeof raw.nextRunTo === "string" ? raw.nextRunTo : base.nextRunTo,
    enabled: ["all", "enabled", "disabled"].includes(raw.enabled) ? raw.enabled : base.enabled,
    stateFilter: STATE_FILTERS.includes(raw.stateFilter) ? raw.stateFilter : base.stateFilter,
    sort: asSort(raw.sort),
    selection: normalizeSelection(raw.selection),
    expanded: asPathArray(raw.expanded, base.expanded),
    treeScroll: asNumber(raw.treeScroll, base.treeScroll),
    // No fallback on purpose: an empty array means "show all" and must not be
    // treated as dirty data and filled in with something else.
    visibleGroups: (Array.isArray(raw.visibleGroups) ? raw.visibleGroups : []).filter(
      (p) => typeof p === "string" && !!p
    ),
    sidebarWidth: clampNumber(raw.sidebarWidth, SIDEBAR_RANGE, DEFAULT_SIDEBAR_WIDTH),
  };
}

/** v2 -> v3: turn the old single radio selection into multi-select and keep
 * every other condition as is. */
function migrateV2(saved) {
  const base = defaultFilters();
  if (!saved || typeof saved !== "object") return base;
  const sel = saved.selection && typeof saved.selection === "object" ? saved.selection : {};
  const kind = ["all", "group", "task"].includes(sel.kind) ? sel.kind : "all";
  const selection =
    kind === "group"
      ? { groups: typeof sel.path === "string" ? [sel.path] : [], tasks: [] }
      : kind === "task"
        ? { groups: [], tasks: [{ path: sel.path ?? "\\", name: sel.name ?? "" }] }
        : defaultSelection();
  return {
    ...base,
    name: typeof saved.name === "string" ? saved.name : base.name,
    nextRunFrom: typeof saved.nextRunFrom === "string" ? saved.nextRunFrom : base.nextRunFrom,
    nextRunTo: typeof saved.nextRunTo === "string" ? saved.nextRunTo : base.nextRunTo,
    enabled: ["all", "enabled", "disabled"].includes(saved.enabled)
      ? saved.enabled
      : base.enabled,
    selection,
    expanded: Array.isArray(saved.expanded)
      ? saved.expanded.filter((p) => typeof p === "string")
      : base.expanded,
  };
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ---- Store handle ----
// load() returns the same instance for a given path, cached as a promise so
// reads and writes do not start over each time. When it cannot be obtained
// (plugin not registered / capability missing) it returns null and the caller
// falls back to Web storage — the UI must always come up.

let storePromise = null;

function getStore() {
  if (!isTauri) return Promise.resolve(null);
  if (!storePromise) {
    storePromise = import("@tauri-apps/plugin-store")
      // autoSave: 100 -> consecutive writes (dragging the scrollbar, say)
      // collapse into a single flush.
      .then((m) => m.load(STORE_FILE, { autoSave: 100 }))
      .catch((e) => {
        console.warn("store plugin unavailable, falling back to Web storage", e);
        storePromise = null;
        return null;
      });
  }
  return storePromise;
}

// ---- Public API ----
// Everything is async: file IO on the Tauri side, a bare Promise on the Web.

/**
 * Read once at startup. Under Tauri the store file is read first; when it is
 * empty the legacy Web storage data is migrated over. Always returns a
 * complete normalized object, so callers never check for null.
 */
export async function loadFilters() {
  if (isTauri) {
    try {
      const store = await getStore();
      if (store) {
        const saved = await store.get(STORE_KEY);
        if (saved) return normalizeFilters(saved);
      }
    } catch (e) {
      console.warn("failed to read the store, falling back to Web storage", e);
    }
  }

  const current = readJson(WEB_KEY);
  const branded = readJson(LEGACY_BRAND_V3);
  const filters = current
    ? normalizeFilters(current)
    : branded
      ? normalizeFilters(branded)
      : migrateV2(readJson(LEGACY_V2) ?? readJson(LEGACY_V1));

  // One-time rename migration: persist under the new key and drop the old one,
  // otherwise every startup would keep reading two sources of truth.
  if (!current && branded) {
    try {
      localStorage.setItem(WEB_KEY, JSON.stringify(filters));
      localStorage.removeItem(LEGACY_BRAND_V3);
    } catch {
      /* ignore */
    }
  }

  // Under Tauri, move legacy data into the store and clear Web storage, so
  // two copies of the state never diverge.
  if (isTauri) {
    await saveFilters(filters);
    clearWebKeys();
  }
  return filters;
}

export async function saveFilters(filters) {
  const payload = normalizeFilters(filters);
  if (isTauri) {
    try {
      const store = await getStore();
      if (store) {
        await store.set(STORE_KEY, payload);
        return;
      }
    } catch (e) {
      console.warn("failed to write the store, falling back to Web storage", e);
    }
  }
  try {
    localStorage.setItem(WEB_KEY, JSON.stringify(payload));
  } catch {
    // Failing to write in private mode does not affect usage.
  }
}

export async function clearFilters() {
  if (isTauri) {
    try {
      const store = await getStore();
      if (store) await store.delete(STORE_KEY);
    } catch {
      /* ignore */
    }
  }
  clearWebKeys();
}

function clearWebKeys() {
  try {
    [WEB_KEY, LEGACY_BRAND_V3, LEGACY_V2, LEGACY_V1].forEach((k) =>
      localStorage.removeItem(k)
    );
  } catch {
    /* ignore */
  }
}

export function selectionCount(filters) {
  const sel = filters?.selection;
  if (!sel) return 0;
  return (sel.groups?.length ?? 0) + (sel.tasks?.length ?? 0);
}

/** Whether the display config is active: ticked folders restrict the view,
 * empty means show everything. */
export function visibleRestricted(filters) {
  return (filters?.visibleGroups ?? []).length > 0;
}

export function isFilterActive(filters) {
  return (
    !!filters.name.trim() ||
    !!filters.nextRunFrom ||
    !!filters.nextRunTo ||
    filters.enabled !== "all" ||
    (filters.stateFilter ?? "all") !== "all" ||
    selectionCount(filters) > 0 ||
    visibleRestricted(filters)
  );
}
