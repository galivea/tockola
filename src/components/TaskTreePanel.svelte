<script>
  import IconButton from "./IconButton.svelte";
  import TaskTreeNode from "./TaskTreeNode.svelte";
  import { t } from "../lib/i18n/index.svelte.js";

  // selection: { groups: [], tasks: [{path, name}] }
  let {
    tree,
    selection,
    expanded = [],
    scrollTop = 0,
    visibleRestricted = false,
    // Width comes in from the drag handle next door; the panel does not own it
    width = 232,
    onToggleExpand,
    onToggleGroup,
    onToggleTask,
    onCreate,
    onRename,
    onRemove,
    onConfigureVisible,
    onScrollChange,
  } = $props();

  // Ticking a folder ticks every task beneath it, so what really drives the list is the
  // set of "selected tasks"
  const pickedCount = $derived(
    (selection?.groups?.length ?? 0) + (selection?.tasks?.length ?? 0)
  );

  // ---- Scroll position: restored once after mount, reported only after scrolling
  // stops, to avoid hammering the disk ----
  let bodyEl = $state(null);
  let restored = false;
  let timer = null;

  $effect(() => {
    if (!bodyEl || restored) return;
    // Before the tree renders there is not enough height for this to take effect
    if (!tree) return;
    if (scrollTop > 0) bodyEl.scrollTop = scrollTop;
    restored = true;
  });

  function onScroll() {
    if (!restored || !bodyEl) return;
    clearTimeout(timer);
    timer = setTimeout(() => onScrollChange?.(bodyEl.scrollTop), 150);
  }
</script>

<aside class="sidebar" data-testid="group-tree" style="width: {width}px">
  <div class="side-head">
    <div class="head-row">
      <span>{t("tree.groups")}</span>
      <span class="ops">
        <IconButton
          icon="eye"
          label={t("tree.visibleConfig")}
          active={visibleRestricted}
          onclick={() => onConfigureVisible?.()}
        />
      </span>
    </div>
    {#if pickedCount || visibleRestricted}
      <span class="sub" data-testid="tree-sub">
        {#if pickedCount}{t("tree.subPicked")}{:else}{t("tree.subRestricted")}{/if}
      </span>
    {/if}
  </div>
  <div class="side-body" bind:this={bodyEl} onscroll={onScroll}>
    <TaskTreeNode
      node={tree}
      {selection}
      {expanded}
      {onToggleExpand}
      {onToggleGroup}
      {onToggleTask}
      {onCreate}
      {onRename}
      {onRemove}
    />
  </div>
</aside>

<style>
  .sidebar {
    flex: none;
    display: flex;
    flex-direction: column;
    background: #fff;
    border: 1px solid #e3e8ef;
    border-radius: 8px;
    overflow: hidden;
  }

  .side-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border-bottom: 1px solid #eef2f8;
    background: #fafbfd;
  }

  .head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .head-row span {
    font-size: 12.5px;
    font-weight: 700;
    color: #22303f;
  }

  .ops {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .sub {
    font-size: 11px;
    color: #8b95a5;
  }



  .side-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 6px 4px 10px;
  }
</style>
