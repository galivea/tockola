<script>
  import TaskGrid from "./components/TaskGrid.svelte";
  import TaskEditor from "./components/TaskEditor.svelte";
  import TaskTreePanel from "./components/TaskTreePanel.svelte";
  import FolderDialog from "./components/FolderDialog.svelte";
  import GroupVisibleDialog from "./components/GroupVisibleDialog.svelte";
  import Icon from "./components/icons/Icon.svelte";
  import TitleBar from "./components/TitleBar.svelte";
  import WindowEdges from "./components/WindowEdges.svelte";
  import AboutDialog from "./components/AboutDialog.svelte";
  import SettingsDialog from "./components/SettingsDialog.svelte";
  import * as api from "./lib/api.js";
  import { t } from "./lib/i18n/index.svelte.js";
  import {
    buildGroupTree,
    buildTaskTree,
    collectGroupPaths,
    pruneTree,
    normalizePath,
  } from "./lib/utils.js";
  import {
    defaultFilters,
    saveFilters,
    clearFilters,
    isFilterActive,
    selectionCount,
    visibleRestricted,
    DEFAULT_SIDEBAR_WIDTH,
    SIDEBAR_RANGE,
  } from "./lib/filters.js";
  import { isFailedResult } from "./lib/resultCodes.js";
  import { errText } from "./lib/errors.js";
  import { checkForUpdate } from "./lib/updater.js";
  import { watchWindow } from "./lib/windowState.js";
  import HistoryDrawer from "./components/HistoryDrawer.svelte";
  import ImportTaskDialog from "./components/ImportTaskDialog.svelte";

  // Persistent state is read by main.js before mount (load-then-render), so it
  // arrives here ready to use as the initial value.
  let { initialFilters = null } = $props();

  let tasks = $state([]);
  let folders = $state([]);
  let loading = $state(false);
  let editor = $state(null); // null = new task, an object = edit — same page
  let pendingDelete = $state(null);
  let folderDialog = $state(null); // { mode, path, name }
  let folderBusy = $state(false);
  let visibleDialog = $state(false);
  let historyTask = $state(null); // Task currently shown in the history drawer
  let importOpen = $state(false); // Import dialog
  let aboutOpen = $state(false); // About box, opened from the menu bar
  let settingsOpen = $state(false); // Settings dialog, opened from the menu bar
  let toast = $state("");
  let updaterBusy = $state(false);
  let exportBusy = $state(false);

  // Query conditions and UI state; initial values come from the persisted store.
  let filters = $state(initialFilters ?? defaultFilters());

  // Left panel width. Kept in local state while dragging so every mouse move
  // does not round-trip through the store; only the final width is persisted.
  let sidebarWidth = $state(filters.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH);

  function clampSidebar(x) {
    return Math.min(SIDEBAR_RANGE[1], Math.max(SIDEBAR_RANGE[0], Math.round(x)));
  }

  function startSidebarDrag(ev) {
    ev.preventDefault();
    if (ev.button !== 0) return;
    const startX = ev.clientX;
    const startWidth = sidebarWidth;
    const [min, max] = SIDEBAR_RANGE;

    // Following the pointer on the document, not on the handle: once the cursor
    // outruns the 5 px strip the element stops receiving the moves.
    const move = (e) => {
      sidebarWidth = Math.min(max, Math.max(min, Math.round(startWidth + e.clientX - startX)));
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      filters.sidebarWidth = clampSidebar(sidebarWidth);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function resetSidebarWidth() {
    sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
    filters.sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
  }

  // Folder tree (path candidates for new tasks), empty folders included.
  const groupTree = $derived(buildGroupTree(tasks, folders));
  // Left query tree: folder -> task name
  const taskTree = $derived(buildTaskTree(tasks, folders));
  // The tree actually rendered is the one pruned by the display config
  // (unconfigured means the full tree).
  const visibleTree = $derived(pruneTree(taskTree, filters.visibleGroups));
  const visibleLimited = $derived(visibleRestricted(filters));

  const filterActive = $derived(isFilterActive(filters));

  // Only visible folders contribute to the set of group paths used by the
  // visible-config dialog.
  const groupPaths = $derived(collectGroupPaths(visibleTree));

  // Filtering only uses fields that appear in the list: task name / next run /
  // enabled, plus the folders and tasks ticked in the left tree.
  const visibleTasks = $derived.by(() => {
    const kw = filters.name.trim().toLowerCase();
    const sel = filters.selection ?? { groups: [], tasks: [] };
    // The list shows only "selected tasks": ticking a folder already ticks
    // every task beneath it, so there is no folder-path prefix match here —
    // what is ticked is what is shown.
    const groups = (sel.groups ?? []).map((g) => normalizePath(g));
    const picked = new Set(
      (sel.tasks ?? []).map((t) => `${normalizePath(t.path)}|${t.name}`)
    );
    const hasPick = groups.length > 0 || picked.size > 0;
    const from = filters.nextRunFrom;
    const to = filters.nextRunTo;

    const list = tasks.filter((t) => {
      if (kw && !String(t.name ?? "").toLowerCase().includes(kw)) return false;

      if (hasPick) {
        const p = normalizePath(t.path);
        if (!picked.has(`${p}|${t.name}`)) return false;
      }

      if (from || to) {
        // Next run looks like "2026-10-16 02:00"; compare on the date part.
        const day = String(t.nextRun ?? "").slice(0, 10);
        if (!day) return false;
        if (from && day < from) return false;
        if (to && day > to) return false;
      }

      if (filters.enabled === "enabled" && !t.enabled) return false;
      if (filters.enabled === "disabled" && t.enabled) return false;

      // Run state follows `state` rather than the enabled switch: disabled /
      // ready / running / queued are four different things.
      const sf = filters.stateFilter ?? "all";
      if (sf === "Running" && t.state !== "Running") return false;
      if (sf === "Disabled" && t.state !== "Disabled") return false;
      if (sf === "Failed" && !isFailedResult(t.lastResult)) return false;

      // Hidden tasks always show: the native "show hidden tasks" toggle does
      // not apply here. Visibility belongs to the left folder tree (display
      // config); a task's own hidden flag is just one of its settings, not a
      // reason for the list to quietly filter it out.
      return true;
    });

    return sortTasks(list, filters.sort);
  });

  // Header sorting: an empty key returns to the default (by name). Empty
  // values always sink to the bottom, otherwise tasks that "never ran" would
  // sort first because of their empty string.
  function sortTasks(list, sort) {
    const key = sort?.key ?? "";
    const out = [...list];
    out.sort((a, b) => {
      if (!key) return a.name.localeCompare(b.name, "zh");
      const va = String(a[key] ?? "");
      const vb = String(b[key] ?? "");
      if (!va && vb) return 1;
      if (va && !vb) return -1;
      const c = va.localeCompare(vb, "zh", { numeric: true });
      const dir = sort?.dir === "desc" ? -1 : 1;
      return c !== 0 ? c * dir : a.name.localeCompare(b.name, "zh");
    });
    return out;
  }

  // Persist as soon as the conditions change. The write is async: a store
  // file under Tauri (with built-in 100 ms debouncing), Web storage in
  // browser demo mode. Deliberately not awaited — a failed write must not
  // block the UI.
  $effect(() => {
    void saveFilters({
      ...filters,
      selection: {
        groups: [...(filters.selection?.groups ?? [])],
        tasks: [...(filters.selection?.tasks ?? [])],
      },
      expanded: [...filters.expanded],
      visibleGroups: [...(filters.visibleGroups ?? [])],
    });
  });

  function resetFilters() {
    // The panel width is a layout choice, not a query condition — resetting
    // queries should not rearrange your desk.
    const layout = {
      sidebarWidth: filters.sidebarWidth,
    };
    clearFilters();
    filters = { ...defaultFilters(), ...layout };
    notify(t("app.resetFilters"));
  }

  // ---- Left tree: checkbox multi-select ----

  function handleToggleExpand(path) {
    filters.expanded = filters.expanded.includes(path)
      ? filters.expanded.filter((p) => p !== path)
      : [...filters.expanded, path];
  }

  // Tree scroll offset: stored in filters and persisted with the conditions.
  function handleTreeScroll(top) {
    filters.treeScroll = top;
  }

  // "Display config": an empty `paths` array means no restriction, show all.
  function handleVisibleConfirm(paths) {
    filters.visibleGroups = [...paths];
    visibleDialog = false;
    notify(paths.length ? t("app.groupVisibleSaved") : t("app.groupAllShown"));
  }

  // Ticking a folder ticks every task beneath it (the list shows only
  // selected tasks); unticking removes those tasks too, so nothing looks
  // unticked while still filtering.
  function handleToggleGroup(path, next, subPaths = []) {
    const sel = filters.selection ?? { groups: [], tasks: [] };
    let groups = [...(sel.groups ?? [])];
    let picked = [...(sel.tasks ?? [])];

    const subDirs = new Set(subPaths.filter((x) => typeof x === "string"));
    const subTasks = new Set(
      subPaths.filter((x) => Array.isArray(x)).map(([p, n]) => `${normalizePath(p)}|${n}`)
    );
    const key = (t) => `${normalizePath(t.path)}|${t.name}`;

    if (next) {
      if (!groups.includes(path)) groups = [...groups, path];
      // Tick every task under the folder, one by one.
      const have = new Set(picked.map(key));
      const add = subPaths
        .filter((x) => Array.isArray(x))
        .map(([p, n]) => ({ path: normalizePath(p), name: n }))
        .filter((t) => !have.has(key(t)));
      picked = [...picked, ...add];
      // Subfolders ticked separately inside the subtree are redundant; drop
      // them to keep the semantics clean.
      if (subDirs.size) groups = groups.filter((g) => g === path || !subDirs.has(g));
      if (!filters.expanded.includes(path)) {
        filters.expanded = [...filters.expanded, path];
      }
    } else {
      groups = groups.filter((g) => !subDirs.has(g));
      picked = picked.filter((t) => !subTasks.has(key(t)));
    }

    filters.selection = { groups, tasks: picked };
  }

  function handleToggleTask(task, next) {
    const sel = filters.selection ?? { groups: [], tasks: [] };
    let picked = [...(sel.tasks ?? [])];
    const key = (t) => `${normalizePath(t.path)}|${t.name}`;
    if (next) {
      if (!picked.some((t) => key(t) === key(task))) picked = [...picked, { ...task }];
    } else {
      picked = picked.filter((t) => key(t) !== key(task));
    }
    filters.selection = { groups: [...(sel.groups ?? [])], tasks: picked };
  }

  // ---- Create / rename / delete folders ----

  function openCreateFolder(parentPath) {
    folderDialog = { mode: "create", path: parentPath, name: "" };
  }

  function openRenameFolder(path, name) {
    folderDialog = { mode: "rename", path, name };
  }

  function openDeleteFolder(path, name) {
    folderDialog = { mode: "delete", path, name };
  }

  async function confirmFolderDialog(value) {
    const dlg = folderDialog;
    if (!dlg) return;
    folderBusy = true;
    try {
      if (dlg.mode === "create") {
        const created = await api.createFolder(normalizePath(dlg.path) + value);
        notify(t("app.folderCreated", { name: created }));
        filters.expanded = dedupe([...filters.expanded, normalizePath(dlg.path), normalizePath(dlg.path) + value + "\\"]);
      } else if (dlg.mode === "rename") {
        const newPath = await api.renameFolder(dlg.path, value);
        notify(t("app.folderRenamed", { path: newPath }));
        // Selections that touch the old path follow the rename, or filtering
        // breaks.
        filters.selection = {
          groups: (filters.selection?.groups ?? []).map((g) =>
            g === dlg.path || g.startsWith(dlg.path) ? newPath + g.slice(dlg.path.length) : g
          ),
          tasks: (filters.selection?.tasks ?? []).map((t) =>
            t.path === dlg.path || normalizePath(t.path).startsWith(dlg.path)
              ? { ...t, path: newPath + normalizePath(t.path).slice(dlg.path.length) }
              : t
          ),
        };
        filters.expanded = dedupe([
          ...filters.expanded.map((p) =>
            p === dlg.path || p.startsWith(dlg.path) ? newPath + p.slice(dlg.path.length) : p
          ),
        ]);
      } else {
        await api.deleteFolder(dlg.path);
        notify(t("app.folderDeleted", { path: dlg.path }));
        const gone = (p) => p === dlg.path || p.startsWith(dlg.path);
        filters.selection = {
          groups: (filters.selection?.groups ?? []).filter((g) => !gone(g)),
          tasks: (filters.selection?.tasks ?? []).filter((t) => !gone(normalizePath(t.path))),
        };
        filters.expanded = filters.expanded.filter((p) => !gone(p));
      }
      folderDialog = null;
      await refresh();
    } catch (e) {
      notify(errText(e, "app.folderFailed"), "error");
    } finally {
      folderBusy = false;
    }
  }

  function dedupe(list) {
    return [...new Set(list.filter(Boolean))];
  }

  function notify(message, tone = "info") {
    toast = `${tone === "error" ? "✕ " : "✓ "}${message}`;
    setTimeout(() => (toast = ""), 3200);
  }

  async function refresh() {
    loading = true;
    try {
      const result = await Promise.allSettled([api.listTasks(), api.listFolders()]);
      const [listRes, folderRes] = result;
      if (listRes.status === "fulfilled") {
        tasks = Array.isArray(listRes.value) ? listRes.value : [];
      } else {
        notify(errText(listRes.reason, "app.loadFailed"), "error");
      }
      // A failed folder listing does not block the main flow; the tree just
      // shows fewer empty folders.
      folders =
        folderRes.status === "fulfilled" && Array.isArray(folderRes.value)
          ? folderRes.value
          : [];
    } finally {
      loading = false;
    }
  }

  async function handleToggle(row, next) {
    try {
      await api.setTaskEnabled(row.name, row.path, next);
      const hit = tasks.find((t) => t.name === row.name && t.path === row.path);
      if (hit) {
        hit.enabled = next;
        hit.state = next ? "Ready" : "Disabled";
      }
      notify(t("app.toggled", { verb: next ? t("app.verbEnable") : t("app.verbDisable"), name: row.name }));
    } catch (e) {
      notify(errText(e, "app.toggleFailed"), "error");
    }
  }

  async function handleRun(row) {
    try {
      await api.runTask(row.name, row.path);
      notify(t("app.ran", { name: row.name }));
      setTimeout(refresh, 1200);
    } catch (e) {
      notify(errText(e, "app.runFailed"), "error");
    }
  }

  // Ending a running task: the native Action pane's End. The backend command
  // was always there, it simply had no UI entry point.
  async function handleStop(row) {
    try {
      await api.stopTask(row.name, row.path);
      notify(t("app.stopped", { name: row.name }));
      setTimeout(refresh, 800);
    } catch (e) {
      notify(errText(e, "app.stopFailed"), "error");
    }
  }

  function handleHistory(row) {
    historyTask = { name: row.name, path: row.path };
  }

  // Header sorting cycles through three states: ascending -> descending ->
  // default (by name). Stored in filters, persisted with the conditions.
  function handleSort(key) {
    const cur = filters.sort ?? { key: "", dir: "asc" };
    if (cur.key !== key) filters.sort = { key, dir: "asc" };
    else if (cur.dir === "asc") filters.sort = { key, dir: "desc" };
    else filters.sort = { key: "", dir: "asc" };
  }

  // Inline cell editing: only the changed field is submitted; the backend
  // keeps the rest of the config.
  async function handleUpdateInfo(patch) {
    try {
      const updated = await api.updateTaskInfo(patch);
      const oldName = patch.originalName;
      const oldPath = patch.originalPath;
      const hit = tasks.find((t) => t.name === oldName && t.path === oldPath);
      if (hit && updated) Object.assign(hit, updated);
      else await refresh();
      notify(t("app.saved"));
    } catch (e) {
      notify(errText(e, "app.saveFailed"), "error");
      await refresh();
    }
  }

  // The edit page and the new-task page are the same page: "Edit" opens the
  // full form (all five sections). There is no separate "basic settings" /
  // "run settings" pair of entries any more — splitting them left users
  // unable to find the field they wanted, and the full page already has
  // anchor navigation to jump straight to a section.
  function handleEdit(row) {
    editor = { task: row, mode: "full" };
  }

  function handleCreate() {
    editor = { task: null, mode: "full" };
  }

  // The update itself is asked for before anything is downloaded; see lib/updater.js.
  async function handleCheckUpdate() {
    if (updaterBusy) return;
    updaterBusy = true;
    try {
      const result = await checkForUpdate();
      if (result.kind === "demo") notify(t("app.updaterDemo"));
      else if (result.kind === "up-to-date") notify(t("app.updaterNone"));
      else if (result.kind === "installed") notify(t("app.updaterDone"));
    } catch (e) {
      notify(errText(e, "app.updaterFailed"), "error");
    } finally {
      updaterBusy = false;
    }
  }

  function handleRemove(row) {
    pendingDelete = row;
  }

  // Export what the list is showing right now — the filtered, sorted selection,
  // not the whole library. Windows has no bulk export, so this is a directory of
  // XML files, one per task, each of them importable as it stands.
  async function handleExport() {
    if (!api.isTauri || exportBusy || !visibleTasks.length) return;
    exportBusy = true;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        directory: true,
        multiple: false,
        title: t("app.exportPickDir"),
      });
      const dir = Array.isArray(picked) ? picked[0] : picked;
      // Cancelling the dialog is not an error worth reporting.
      if (!dir) return;

      const result = await api.exportTasksXml(
        visibleTasks.map((x) => ({ name: x.name, path: x.path ?? "\\" })),
        dir
      );
      const failed = result?.failed?.length ?? 0;
      if (failed) {
        notify(t("app.exportedPartial", { ok: result?.ok ?? 0, failed }), "error");
      } else {
        notify(t("app.exportedMany", { n: result?.ok ?? 0 }));
      }
    } catch (e) {
      notify(errText(e, "app.exportFailed"), "error");
    } finally {
      exportBusy = false;
    }
  }

  async function confirmDelete() {
    const row = pendingDelete;
    if (!row) return;
    try {
      await api.deleteTask(row.name, row.path);
      tasks = tasks.filter((t) => !(t.name === row.name && t.path === row.path));
      notify(t("app.deleted", { name: row.name }));
    } catch (e) {
      notify(errText(e, "app.deleteFailed"), "error");
    } finally {
      pendingDelete = null;
    }
  }

  const defaultPath = $derived(
    selectionCount(filters) === 1 && filters.selection?.groups?.length === 1
      ? filters.selection.groups[0]
      : "\\"
  );

  $effect(() => {
    refresh();
  });

  // Window geometry follows the window, not any piece of state, so it gets its
  // own effect. The subscription is async, hence the deferred teardown.
  $effect(() => {
    let stop = null;
    void watchWindow().then((fn) => (stop = fn));
    return () => stop?.();
  });
</script>

<div class="app">
  <!-- Self-drawn title bar: wordmark + help/about + window controls. The
       native frame is disabled, so this row replaces its chrome and absorbs
       the menu bar that would otherwise take another line. -->
  <TitleBar
    updaterBusy={updaterBusy}
    onCheckUpdate={handleCheckUpdate}
    onAbout={() => (aboutOpen = true)}
    onSettings={() => (settingsOpen = true)}
  />
  <WindowEdges />

  <main class="main">
    <div class="workspace">
      <TaskTreePanel
        tree={visibleTree}
        width={sidebarWidth}
        selection={filters.selection}
        expanded={filters.expanded}
        scrollTop={filters.treeScroll}
        visibleRestricted={visibleLimited}
        onToggleExpand={handleToggleExpand}
        onToggleGroup={handleToggleGroup}
        onToggleTask={handleToggleTask}
        onCreate={openCreateFolder}
        onRename={openRenameFolder}
        onRemove={openDeleteFolder}
        onConfigureVisible={() => (visibleDialog = true)}
        onScrollChange={handleTreeScroll}
      />

      <!-- Widening boundary between the group tree and the list. A real divider
           rather than a border in the panel CSS: it needs its own hit area, a
           resize cursor and somewhere to double-click for "back to default". -->
      <div
        class="sash"
        role="separator"
        aria-orientation="vertical"
        title={t("app.resizeHint")}
        data-testid="sidebar-sash"
        onmousedown={startSidebarDrag}
        ondblclick={resetSidebarWidth}
      ></div>

      <div class="content">
      <section class="filter-bar">
        <!-- 查询区（第一行）：筛选字段 + 查询/重置，独立白卡片 -->
        <div class="filter-conditions query-card">
          <label class="field">
            <span class="label">{t("app.filterName")}</span>
          <input
            class="input"
            type="text"
            placeholder={t("app.namePlaceholder")}
            data-testid="filter-name"
            bind:value={filters.name}
          />
        </label>

        <label class="field range">
          <span class="label">{t("app.filterNextRun")}</span>
          <span class="range-inputs">
            <span class="date-wrap">
              <input
                class="input date"
                class:empty={!filters.nextRunFrom}
                type="date"
                bind:value={filters.nextRunFrom}
                onclick={(e) => {
                  try {
                    e.currentTarget.showPicker();
                  } catch {}
                }}
              />
              {#if !filters.nextRunFrom}<span class="date-ph">{t("app.filterFrom")}</span>{/if}
            </span>
            <span class="tilde">~</span>
            <span class="date-wrap">
              <input
                class="input date"
                class:empty={!filters.nextRunTo}
                type="date"
                bind:value={filters.nextRunTo}
                onclick={(e) => {
                  try {
                    e.currentTarget.showPicker();
                  } catch {}
                }}
              />
              {#if !filters.nextRunTo}<span class="date-ph">{t("app.filterTo")}</span>{/if}
            </span>
          </span>
        </label>

        <label class="field">
          <span class="label">{t("app.filterEnabled")}</span>
          <select class="input" bind:value={filters.enabled}>
            <option value="all">{t("app.enabledAll")}</option>
            <option value="enabled">{t("app.enabledYes")}</option>
            <option value="disabled">{t("app.enabledNo")}</option>
          </select>
        </label>

        <label class="field">
          <span class="label">{t("app.filterState")}</span>
          <select
            class="input"
            bind:value={filters.stateFilter}
            data-testid="filter-state"
          >
            <option value="all">{t("app.enabledAll")}</option>
            <option value="Running">{t("app.stateRunning")}</option>
            <option value="Disabled">{t("app.stateDisabled")}</option>
            <option value="Failed">{t("app.stateFailed")}</option>
          </select>
        </label>

          <!-- 查询 / 重置 属于「查询区」，与筛选字段同行、靠右收尾这组条件 -->
          <span class="filter-submit">
            <!-- 查询：按当前条件重新从系统取一次。跟着条件走，名字说的是「再问一次系统」。 -->
            <button
              class="tb primary"
              type="button"
              onclick={refresh}
              disabled={loading}
              title={t("app.searchTip")}
              data-testid="query-tasks"
            >
              <Icon name="search" size={14} />
              <span>{loading ? t("app.loading") : t("app.search")}</span>
            </button>

            <button
              class="tb reset"
              type="button"
              onclick={resetFilters}
              disabled={!filterActive}
              title={`${t("app.resetTip")} · ${t("app.resetLayoutTip")}`}
              data-testid="reset-filters"
            >
              <Icon name="reset" size={14} />
              <span>{t("app.reset")}</span>
            </button>
          </span>
        </div>

        <!-- 操作区（第二行）：新建 / 导入 / 导出，独立浅色容器，与上方查询卡片明显分开 -->
        <div class="filter-actions action-card">
          <button class="tb primary" type="button" onclick={handleCreate} data-testid="create-task">
            <Icon name="plus" size={14} />
            <span>{t("app.create")}</span>
          </button>
          <button
            class="tb"
            type="button"
            onclick={() => (importOpen = true)}
            disabled={!api.isTauri}
            title={api.isTauri ? t("app.importTip") : t("app.importTipDemo")}
            data-testid="import-task"
          >
            <Icon name="upload" size={14} />
            <span>{t("app.importTask")}</span>
          </button>
          <button
            class="tb"
            type="button"
            onclick={handleExport}
            disabled={!api.isTauri || exportBusy || !visibleTasks.length}
            title={api.isTauri ? t("app.exportTip") : t("app.exportTipDemo")}
            data-testid="export-tasks"
          >
            <Icon name="export" size={14} />
            <span>{exportBusy ? t("app.exporting") : t("app.exportTask")}</span>
          </button>
        </div>
      </section>

      <TaskGrid
        tasks={visibleTasks}
        sort={filters.sort}
        onSortChange={handleSort}
        onToggle={handleToggle}
        onRun={handleRun}
        onStop={handleStop}
        onHistory={handleHistory}
        onEdit={handleEdit}
        onRemove={handleRemove}
        onUpdateInfo={handleUpdateInfo}
      />

      <!-- 底部只报一件事：当前筛选后有多少条、库里一共多少条。
           其余（启用数、运行中、最后查询时间…）都能从列表本身看出来，不再占一行。 -->
      <div class="statusbar">
        <span>{t("app.showing", { visible: visibleTasks.length, total: tasks.length })}</span>
      </div>
      </div>
    </div>
  </main>

  {#if aboutOpen}
    <AboutDialog onClose={() => (aboutOpen = false)} />
  {/if}

  {#if settingsOpen}
    <SettingsDialog onClose={() => (settingsOpen = false)} />
  {/if}

  {#if editor}
    <TaskEditor
      task={editor.task}
      {defaultPath}
      groupTree={groupTree.root}
      onClose={() => (editor = null)}
      onSaved={refresh}
    />
  {/if}

  {#if pendingDelete}
    <div class="mask" role="presentation" onclick={(e) => e.target === e.currentTarget && (pendingDelete = null)}>
      <div class="confirm" role="dialog" aria-modal="true">
        <h4>{t("app.confirmDelete")}</h4>
        <p>
          {t("app.confirmAskPre")}<b>{pendingDelete.name}</b>{t("app.confirmSuffix")}<br />
          <span class="muted">{t("app.confirmFolder")}{normalizePath(pendingDelete.path)}</span>
        </p>
        <div class="confirm-actions">
          <button class="btn" type="button" onclick={() => (pendingDelete = null)}>{t("app.cancel")}</button>
          <button class="btn danger" type="button" onclick={confirmDelete}>{t("app.delete")}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if importOpen}
    <ImportTaskDialog
      onClose={() => (importOpen = false)}
      onImported={(result) => {
        importOpen = false;
        const ok = result?.ok ?? [];
        const failed = result?.failed ?? [];
        if (failed.length) {
          notify(t("app.importedPartial", { ok: ok.length, failed: failed.length }), "error");
        } else if (ok.length > 1) {
          notify(t("app.importedMany", { n: ok.length }));
        } else {
          notify(t("app.imported", { name: ok[0] ?? "" }));
        }
        refresh();
      }}
    />
  {/if}

  {#if toast}
    <div class="toast" class:error={toast.startsWith("✕")}>{toast}</div>
  {/if}

  {#if folderDialog}
    <FolderDialog
      mode={folderDialog.mode}
      path={folderDialog.path}
      name={folderDialog.name}
      busy={folderBusy}
      onConfirm={confirmFolderDialog}
      onClose={() => !folderBusy && (folderDialog = null)}
    />
  {/if}

  {#if visibleDialog}
    <GroupVisibleDialog
      tree={taskTree}
      visible={filters.visibleGroups}
      onConfirm={handleVisibleConfirm}
      onClose={() => (visibleDialog = false)}
    />
  {/if}

  {#if historyTask}
    <HistoryDrawer task={historyTask} onClose={() => (historyTask = null)} />
  {/if}
</div>

<style>
  /* 标题栏铺满窗口宽度（ incl. 右上角那三个按钮），
     工作区才是内容区：左右留 36px，顶部只留一小条间距。 */
  .app {
    height: 100vh;
    background: #f2f4f8;
    display: flex;
    flex-direction: column;
  }

  .main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 6px 36px 12px;
    gap: 10px;
  }

  /* 下面不再有菜单行：任务组树与任务列表共享同一条顶边 */
  .tb {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 30px;
    border: 1px solid #d8e0ea;
    background: #fff;
    border-radius: 5px;
    padding: 0 10px;
    font-size: 12.5px;
    color: #44506b;
    cursor: pointer;
  }

  .tb:hover:not(:disabled) {
    border-color: #1a73e8;
    color: #1a73e8;
  }

  .tb.primary {
    background: #1a73e8;
    border-color: #1a73e8;
    color: #fff;
  }

  .tb.primary:hover {
    background: #1665cc;
    color: #fff;
  }

  .tb:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tb:disabled:hover {
    border-color: #d8e0ea;
    color: #44506b;
  }

  .tb.danger {
    color: #d93025;
  }

  .tb.danger:hover:not(:disabled) {
    border-color: #d93025;
    color: #d93025;
  }

  /* Left: folder tree query panel. Right: filter bar + task list. */
  .workspace {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 10px;
  }

  /* The sash occupies part of the old 10px gap: 5px handle + 5px breathing room
     on either side, so the tree and the list still read as separate panels. */
  .sash {
    flex: none;
    /* 5px handle inside the container's 10px gap: 2.5px of air either side, so
       tree and list still read as two panels. The negative margin also widens
       the hit area past the visible strip without moving anything. */
    width: 5px;
    margin: 0 -7.5px;
    border-radius: 3px;
    cursor: col-resize;
    background: transparent;
    transition: background 0.15s ease;
  }

  .sash:hover,
  .sash:focus-visible {
    background: #c9d7ea;
    outline: none;
  }

  .content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* 查询区与操作区各自成卡，外层只负责纵向排列与间距 */
  .filter-bar {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }

  /* 第一行：查询区，独立白卡片。窗口宽时四个字段等宽铺满，窄时先压缩、再整组换行。 */
  .filter-conditions {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 8px;
    background: #fff;
    border: 1px solid #e3e8ef;
    border-radius: 8px;
    padding: 10px 12px;
  }

  /* 查询 / 重置 与筛选字段同属「查询区」，靠右收尾这一行 */
  .filter-submit {
    margin-left: auto;
    display: flex;
    align-items: flex-end;
    gap: 6px;
  }

  /* 第二行：操作区，独立浅色容器，与上方查询白卡片明显区分（分明） */
  .filter-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    background: #fafbfd;
    border: 1px solid #eef1f6;
    border-radius: 8px;
    padding: 8px 10px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    /* 四个筛选字段统一弹性增长：窗口拉宽时等宽铺满，窗口收窄时先压缩、再整组换行 */
    flex: 1 1 200px;
    min-width: 150px;
  }

  /* 日期区间字段内容较宽，下限放宽，避免两个日期框被挤掉 */
  .field.range {
    min-width: 200px;
  }

  .label {
    font-size: 11.5px;
    color: #7a8699;
  }

  .running {
    color: #378add;
  }

  .input {
    height: 30px;
    min-width: 104px;
    border: 1px solid #d8e0ea;
    border-radius: 5px;
    padding: 0 8px;
    font-size: 12.5px;
    color: #2f3742;
    background: #fff;
    outline: none;
  }

  .input:focus {
    border-color: #1a73e8;
  }

  .range-inputs {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .date {
    min-width: 90px;
    padding: 0 4px;
  }

  /* Date range inputs: hide the native yyyy/mm/dd placeholder while empty. */
  .date-wrap {
    position: relative;
    display: inline-flex;
  }

  .date-ph {
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    color: #9aa4b2;
    font-size: 12.5px;
    pointer-events: none;
    user-select: none;
  }

  .date.empty::-webkit-datetime-edit,
  .date.empty::-webkit-datetime-edit-fields-wrapper,
  .date.empty::-webkit-datetime-edit-text,
  .date.empty::-webkit-datetime-edit-month-field,
  .date.empty::-webkit-datetime-edit-day-field,
  .date.empty::-webkit-datetime-edit-year-field {
    color: transparent;
  }

  .tilde {
    color: #8b95a5;
    font-size: 12px;
  }

  .statusbar {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #7a8699;
    padding: 0 2px;
  }

  .mask {
    position: fixed;
    inset: 0;
    background: rgba(24, 33, 46, 0.42);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
  }

  .confirm {
    width: 380px;
    background: #fff;
    border-radius: 8px;
    padding: 18px;
    box-shadow: 0 16px 40px rgba(20, 30, 45, 0.25);
  }

  .confirm h4 {
    margin: 0 0 8px;
    font-size: 15px;
    color: #22303f;
  }

  .confirm p {
    margin: 0 0 16px;
    font-size: 13px;
    color: #4d5867;
    line-height: 1.6;
  }

  .muted {
    color: #8b95a5;
    font-size: 12px;
  }

  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn {
    min-width: 76px;
    height: 30px;
    border: 1px solid #d6dde7;
    background: #fff;
    border-radius: 5px;
    font-size: 13px;
    color: #44506b;
    cursor: pointer;
  }

  .btn.danger {
    background: #d93025;
    border-color: #d93025;
    color: #fff;
  }

  .toast {
    position: fixed;
    left: 50%;
    bottom: 26px;
    transform: translateX(-50%);
    background: #22303f;
    color: #fff;
    font-size: 13px;
    padding: 9px 16px;
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(20, 30, 45, 0.28);
    z-index: 90;
  }

  .toast.error {
    background: #c5221f;
  }
</style>
