<script>
  import { getContext } from "svelte";
  import { t } from "../../lib/i18n/index.svelte.js";

  let { column } = $props();

  // TaskGrid publishes the sort state and its toggle through context; App persists it
  // into filters
  const sortCtl = getContext("grid-sort");
  const sortable = $derived(!!sortCtl?.keys?.includes(column.id));
  const title = $derived(column?.label ?? column?.header ?? "");
  const state = $derived(sortCtl?.state ?? { key: "", dir: "asc" });
  const active = $derived(state.key === column.id);

  function toggle() {
    if (!sortable) return;
    sortCtl?.toggle?.(column.id);
  }
</script>

{#if sortable}
  <button
    class="hcell"
    class:active
    type="button"
    onclick={toggle}
    title={t("cell.sortTip")}
    data-testid={`sort-${column.id}`}
    data-dir={active ? state.dir : ""}
  >
    <span class="txt">{title}</span>
    <span class="arrow">{active ? (state.dir === "desc" ? "↓" : "↑") : "↕"}</span>
  </button>
{:else}
  <span class="plain">{title}</span>
{/if}

<style>
  /* Header button: looks like an unsorted column until it is the active sort */
  .hcell {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    max-width: 100%;
    padding: 0 2px;
    border: none;
    background: transparent;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  .hcell:hover .txt {
    color: #1a73e8;
  }

  .hcell.active {
    color: #1a73e8;
  }

  .txt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .arrow {
    font-size: 10px;
    opacity: 0.45;
    flex: none;
  }

  .hcell.active .arrow {
    opacity: 1;
  }

  .plain {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
