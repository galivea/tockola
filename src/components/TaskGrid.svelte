<script>
  import { Grid, Willow } from "@svar-ui/svelte-grid";
  import { setContext } from "svelte";
  import NameCell from "./cells/NameCell.svelte";
  import StateCell from "./cells/StateCell.svelte";
  import NextRunCell from "./cells/NextRunCell.svelte";
  import SortHeaderCell from "./cells/SortHeaderCell.svelte";
  import EnableCell from "./cells/EnableCell.svelte";
  import IconButtonCell from "./cells/IconButtonCell.svelte";
  import { t } from "../lib/i18n/index.svelte.js";

  let {
    tasks = [],
    sort = { key: "", dir: "asc" },
    onSortChange,
    onToggle,
    onRun,
    onStop,
    onHistory,
    onEdit,
    onRemove,
    onUpdateInfo,
  } = $props();

  // Header sorting: the sortable column ids match TaskGrid's columns; toggling is App's
  // job (it lands in filters)
  const SORTABLE = ["name", "state", "nextRun"];

  setContext("grid-sort", {
    keys: SORTABLE,
    get state() {
      return sort ?? { key: "", dir: "asc" };
    },
    toggle: (key) => onSortChange?.(key),
  });

  setContext("task-actions", {
    toggle: (row, next) => onToggle?.(row, next),
    run: (row) => onRun?.(row),
    stop: (row) => onStop?.(row),
    history: (row) => onHistory?.(row),
    edit: (row) => onEdit?.(row),
    remove: (row) => onRemove?.(row),
    // Inline cell editing: only the one changed field is submitted, the rest is sent
    // along untouched
    updateField: async (row, field, value) => {
      const patch = {
        name: row.name,
        path: row.path,
        description: row.description ?? "",
        author: row.author ?? "",
        originalName: row.name,
        originalPath: row.path,
      };
      patch[field] = value;
      await onUpdateInfo?.(patch);
    },
  });

  // Folder filtering moved to the tree on the left, and description / author / folder
  // are edited on the editor page, so the list keeps three kinds of columns only:
  // identity, run state and actions. Column order follows Windows Task Scheduler:
  // name -> state -> next run time. (Last run time and result are not listed: those
  // two are only read while troubleshooting, and the history drawer shows them far
  // more clearly as an event chain.)
  //
  // Widths start from what is inside each column and are then scaled as a whole
  // — see measureContent / stretch below. The widths here are only what the
  // first frame shows, before the measure lands.
  const columns = $derived([
    // Passing an object as header means a custom header cell (clickable for sorting);
    // label is the text other components read, because the object replaces
    // column.header itself
    { id: "name", label: t("grid.colName"), header: { cell: SortHeaderCell }, width: 200, cell: NameCell },
    { id: "state", label: t("grid.colState"), header: { cell: SortHeaderCell }, width: 76, cell: StateCell },
    { id: "nextRun", label: t("grid.colNextRun"), header: { cell: SortHeaderCell }, width: 150, cell: NextRunCell },
    { id: "enabled", header: t("grid.colEnabled"), width: 76, cell: EnableCell },
    // Run -> History -> Edit -> Delete: what you actually do to a task, most
    // frequent first. Edit used to lead this group, but reading state comes
    // before changing it
    { id: "run", header: t("grid.colRun"), width: 58, cell: IconButtonCell },
    { id: "history", header: t("grid.colHistory"), width: 58, cell: IconButtonCell },
    { id: "edit", header: t("grid.colEdit"), width: 58, cell: IconButtonCell },
    { id: "remove", header: t("grid.colRemove"), width: 58, cell: IconButtonCell },
  ]);

  const rows = $derived(
    tasks.map((t) => ({
      ...t,
      id: `${t.path}|${t.name}`,
      group: t.path ?? "\\",
      edit: "",
      run: "",
      history: "",
      remove: "",
    }))
  );

  // Two steps, and only two: ask what the content needs, then give the whole row
  // one scale factor.
  //
  // 1. The text columns are measured by the grid itself (resize-column with
  //    auto): it renders the header and the body cells off-screen and reads the
  //    widest, in its own font, padding and skin — no guessing at character
  //    counts. A column holding a control instead of text has nothing to
  //    measure, so it keeps the size of that control.
  // 2. The row is then scaled to the space it has: one factor shared by every
  //    column, so each keeps the share of the row its content asked for. Wide
  //    window, wide columns, no empty gap on the right; narrow window, the same
  //    proportions squeezed down to the floors below, and only then a
  //    scrollbar.
  const IDS = ["name", "state", "nextRun", "enabled", "run", "history", "edit", "remove"];
  const AUTO = ["name", "state", "nextRun"];
  // Measured text has no idea what a column is for: a list of one-word task
  // names would come back barely wider than the header.
  const FLOOR = { name: 160, state: 76, nextRun: 120, enabled: 76, run: 58, history: 58, edit: 58, remove: 58 };
  // Where shrinking stops. A name you cannot read or an icon button you cannot
  // hit is worse than a scrollbar.
  const MIN = { name: 120, state: 60, nextRun: 90, enabled: 60, run: 44, history: 44, edit: 44, remove: 44 };
  // Measuring every row would be a waste on a long list; anything past this
  // many rows cannot widen a column the eye would notice anyway.
  const MEASURE_ROWS = 200;

  let gridApi = $state(null);
  let hostEl;
  let contentWidths = $state(null); // { column id: px the content needs }
  let hostWidth = $state(0); // inner width of the grid, i.e. what to fill

  function measureContent() {
    const out = {};
    for (const id of IDS) out[id] = FLOOR[id];
    for (const id of AUTO) {
      gridApi.exec("resize-column", { id, auto: true, maxRows: MEASURE_ROWS });
      const col = gridApi.getState().columns.find((c) => c.id === id);
      if (col) out[id] = Math.max(FLOOR[id], Math.round(col.width));
    }
    contentWidths = out;
  }

  // The grid draws a hairline of its own inside the host. Filling the host's
  // width to the last pixel pushes the row two pixels past what is visible and
  // buys a horizontal scrollbar for nothing.
  const CHROME = 2;

  function stretch() {
    const target = hostWidth - CHROME;
    if (!gridApi || !contentWidths || target <= 0) return;
    const total = IDS.reduce((n, id) => n + contentWidths[id], 0);
    if (!total) return;
    const factor = target / total;

    const widths = {};
    for (const id of IDS) widths[id] = Math.max(MIN[id], Math.round(contentWidths[id] * factor));
    // Rounding leaves a pixel or two over; hand them to the name column so the
    // row ends flush with the grid instead of leaving a hairline gap.
    const used = IDS.reduce((n, id) => n + widths[id], 0);
    if (used < target) widths.name += target - used;

    for (const id of IDS) {
      const col = gridApi.getState().columns.find((c) => c.id === id);
      if (!col || col.width === widths[id]) continue;
      gridApi.exec("resize-column", { id, width: widths[id] });
    }
  }

  // Re-measure when the content or the language changes: a different set of
  // tasks means a different longest name, and the header text is part of the
  // measure too. Deliberately keyed on those two things and nothing else —
  // reading the columns back here would make the write below re-trigger this.
  const contentKey = $derived.by(() => {
    const longest = (field) => rows.reduce((n, r) => Math.max(n, String(r[field] ?? "").length), 0);
    return `${rows.length}|${longest("name")}|${longest("nextRun")}|${t("grid.colName")}`;
  });

  $effect(() => {
    if (!gridApi) return;
    void contentKey;
    measureContent();
  });

  // Scale on every change of either input: the content it has to fit, and the
  // space it has to fill.
  $effect(() => {
    void contentWidths;
    void hostWidth;
    stretch();
  });

  $effect(() => {
    if (!hostEl) return;
    const observer = new ResizeObserver(([entry]) => {
      hostWidth = Math.round(entry.contentRect.width);
    });
    observer.observe(hostEl);
    return () => observer.disconnect();
  });
</script>

<div class="grid-host" bind:this={hostEl}>
  <Willow fonts={false}>
    <Grid
      data={rows}
      {columns}
      init={(api) => (gridApi = api)}
      sizes={{ rowHeight: 46, headerHeight: 40 }}
      footer={false}
      reorder={false}
      select={true}
    />
  </Willow>
</div>

<style>
  .grid-host {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: #fff;
    border: 1px solid #e3e8ef;
    border-radius: 8px;
    width: 100%;
  }

  .grid-host :global(.wx-grid) {
    height: 100%;
  }
</style>
