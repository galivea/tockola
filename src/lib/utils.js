import { t } from "./i18n/index.js";

/** Task folder (Windows task folder) path helpers. */

export function normalizePath(path) {
  if (!path) return "\\";
  let p = String(path).replace(/\//g, "\\").trim();
  if (!p.startsWith("\\")) p = "\\" + p;
  if (!p.endsWith("\\")) p += "\\";
  return p.replace(/\\\\+/g, "\\");
}

export function joinPath(parent, name) {
  return normalizePath(normalizePath(parent) + name);
}

export function parentPath(path) {
  const p = normalizePath(path);
  if (p === "\\") return null;
  const segs = p.split("\\").filter(Boolean);
  segs.pop();
  if (!segs.length) return "\\";
  return "\\" + segs.join("\\") + "\\";
}

export function folderLabel(path) {
  const p = normalizePath(path);
  if (p === "\\") return t("group.root");
  const segs = p.split("\\").filter(Boolean);
  return segs[segs.length - 1];
}

/** Build the folder tree from the task list (direct and recursive counts).
 * `extra` adds folder paths that exist but are still empty. */
export function buildGroupTree(tasks, extra = []) {
  const direct = new Map();
  const total = new Map();

  const bump = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);

  for (const folder of extra) {
    const p = normalizePath(folder);
    if (!total.has(p)) total.set(p, 0);
  }

  for (const task of tasks) {
    const folder = normalizePath(task.path);
    bump(direct, folder);
    bump(total, "\\");
    const segs = folder.split("\\").filter(Boolean);
    let acc = "\\";
    for (const seg of segs) {
      acc = acc + seg + "\\";
      bump(total, acc);
    }
  }

  const makeNode = (path) => ({
    path,
    name: folderLabel(path),
    direct: direct.get(path) || 0,
    total: total.get(path) || 0,
    children: [],
  });

  const root = makeNode("\\");
  const index = new Map([["\\", root]]);

  const sorted = [...total.keys()].sort((a, b) => a.localeCompare(b));
  for (const path of sorted) {
    if (path === "\\") continue;
    if (index.has(path)) continue;
    // Fill in parent nodes level by level.
    const segs = path.split("\\").filter(Boolean);
    let acc = "\\";
    let parent = root;
    for (const seg of segs) {
      acc = acc + seg + "\\";
      let node = index.get(acc);
      if (!node) {
        node = makeNode(acc);
        index.set(acc, node);
        parent.children.push(node);
      }
      parent = node;
    }
  }

  const sortTree = (node) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    node.children.forEach(sortTree);
  };
  sortTree(root);

  return { root, all: [...index.values()] };
}

/**
 * A tree of folders plus task names (used by the left query panel).
 * Each node: { path, name, children: [subfolders], tasks: [tasks], total }
 * total = tasks directly in this folder + tasks in every descendant
 * `folders` is every folder path on the server, empty ones included.
 */
export function buildTaskTree(tasks, folders = []) {
  const root = { path: "\\", name: t("group.library"), children: [], tasks: [], total: 0 };
  const index = new Map([["\\", root]]);

  // Lay out the folder skeleton first; empty folders must show up too, since
  // a freshly created one is visible right away.
  for (const raw of folders) {
    const folder = normalizePath(raw);
    const segs = folder.split("\\").filter(Boolean);
    let acc = "\\";
    let parent = root;
    for (const seg of segs) {
      acc = acc + seg + "\\";
      let node = index.get(acc);
      if (!node) {
        node = { path: acc, name: seg, children: [], tasks: [], total: 0 };
        index.set(acc, node);
        parent.children.push(node);
      }
      parent = node;
    }
  }

  for (const task of tasks) {
    const folder = normalizePath(task.path);
    const segs = folder.split("\\").filter(Boolean);
    let acc = "\\";
    let parent = root;
    for (const seg of segs) {
      acc = acc + seg + "\\";
      let node = index.get(acc);
      if (!node) {
        node = { path: acc, name: seg, children: [], tasks: [], total: 0 };
        index.set(acc, node);
        parent.children.push(node);
      }
      parent = node;
    }
    parent.tasks.push({
      name: task.name,
      path: task.path ?? folder,
      enabled: !!task.enabled,
    });
  }

  const sortNode = (node) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    node.tasks.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    node.children.forEach(sortNode);
    node.total =
      node.tasks.length + node.children.reduce((sum, c) => sum + c.total, 0);
  };
  sortNode(root);

  return root;
}

/**
 * Collect every folder path in the tree (root excluded, it is always open).
 * Used by "expand all / collapse all": if every path is listed everything is
 * expanded, otherwise something is still collapsed.
 */
export function collectGroupPaths(node) {
  const out = [];
  const go = (n) => {
    for (const c of n?.children ?? []) {
      if (c?.path && c.path !== "\\") out.push(c.path);
      go(c);
    }
  };
  go(node);
  return out;
}

/**
 * Flatten the folder tree into [{ path, name, depth }] in display order.
 * The "display config" dialog checkbox list is built from this.
 */
export function flattenGroups(node) {
  const out = [];
  const go = (n, depth = 0) => {
    if (!n) return;
    out.push({ path: normalizePath(n.path ?? "\\"), name: n.name ?? "", depth });
    for (const c of n?.children ?? []) go(c, depth + 1);
  };
  go(node);
  return out;
}

/**
 * Prune the folder tree according to the display config.
 *
 * An empty `visible` array means "no restriction": the tree comes back
 * unchanged (the default). Rules:
 *   1. A checked folder keeps its whole subtree, tasks included;
 *   2. An unchecked folder sitting above a checked one is kept as a dimmed
 *      path skeleton without tasks — otherwise deep folders would be
 *      unreachable in the tree;
 *   3. Everything else is pruned — that is what "unchecked folders are
 *      hidden" means.
 * Fallback: if none of the checked folders exist in the tree any more
 * (deleted, say), behave as "show everything" so nobody is stuck with an
 * empty tree.
 */
export function pruneTree(node, visible) {
  const list = (Array.isArray(visible) ? visible : [])
    .map((p) => normalizePath(p))
    .filter(Boolean);
  if (!node || !list.length) return node;

  const all = new Set(flattenGroups(node).map((x) => x.path));
  if (!list.some((p) => all.has(p))) return node;

  // Checked itself, or an ancestor is checked (checking a parent covers its
  // whole subtree).
  const inScope = (p) => list.some((v) => v === "\\" || p === v || p.startsWith(v));

  const build = (n) => {
    const path = normalizePath(n?.path ?? "\\");
    const children = (n?.children ?? []).map(build).filter(Boolean);
    const scope = inScope(path);
    if (!scope && !children.length && path !== "\\") return null;
    const tasks = scope ? n.tasks ?? [] : [];
    return {
      path,
      name: n.name,
      children,
      tasks,
      total: tasks.length + children.reduce((s, c) => s + c.total, 0),
      dimmed: !scope,
    };
  };

  return build(node);
}

export function stateLabel(state) {
  switch (state) {
    case "Ready":
      return t("state.Ready");
    case "Running":
      return t("state.Running");
    case "Disabled":
      return t("state.Disabled");
    case "Queued":
      return t("state.Queued");
    default:
      return state || t("state.unknown");
  }
}

export function formatDateTime(value) {
  if (!value) return "—";
  return value;
}

const pad2 = (n) => String(n).padStart(2, "0");

/** Timestamp (ms) -> "YYYY-MM-DD HH:MM:SS". */
export function formatStamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Engine "YYYY-MM-DD HH:MM:SS" -> epoch ms; NaN when unparseable. */
export function parseStamp(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(
    String(s ?? "").trim()
  );
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), 0).getTime();
}

/** Relative wording such as "in 3 days 2 hours"; past 100 days it stops
 * being chatty. */
export function formatRelative(ms, now = Date.now()) {
  const diff = ms - now;
  if (diff < 0) return t("relative.expired");
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("relative.underMinute");
  if (min < 60) return t("relative.minutes", { count: min });
  const h = Math.floor(min / 60);
  if (h < 24) {
    const rest = min % 60 ? ` ${t("relative.minutes", { count: min % 60 })}` : "";
    return t("relative.hours", { h, m: rest });
  }
  const d = Math.floor(h / 24);
  if (d < 100) {
    const rest = h % 24 ? ` ${t("relative.hours", { h: h % 24, m: "" })}` : "";
    return t("relative.days", { d, h: rest });
  }
  return t("relative.months", { count: Math.round(d / 30) });
}
