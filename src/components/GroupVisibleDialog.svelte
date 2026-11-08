<script>
  /**
   * Folder visibility settings
   *
   * Shares one data source with the tree on the left (the taskTree handed in by App)
   * and the same renderer, TaskTreeNode. Only two things differ:
   *   1. the tree shows the visibility-pruned tree, this shows every folder;
   *   2. the tree hangs task nodes under folders (showTasks), this only picks folders.
   * Everything else (indentation, folder icon, expand / collapse, a ticked parent
   * covering its children) is reused so the two never drift apart.
   *
   * Everything ticked = the same as "no restriction", stored as an empty array;
   * ticking nothing at all cannot be confirmed (that would empty the tree).
   */
  import TaskTreeNode from "./TaskTreeNode.svelte";
  import { collectGroupPaths, flattenGroups, normalizePath } from "../lib/utils.js";
  import { t } from "../lib/i18n/index.svelte.js";

  let { tree, visible = [], onConfirm, onClose } = $props();

  const groups = $derived(flattenGroups(tree));
  const groupPaths = $derived(collectGroupPaths(tree));
  // Path -> order of appearance in the tree, used to sort the selection back into
  // tree order
  const rank = $derived(new Map(groups.map((g, i) => [g.path, i])));

  const wanted = (visible ?? []).map((p) => normalizePath(p));
  const byRank = (list) => [...list].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));

  // A fresh instance every time it opens, so $state can be seeded straight from props
  let picked = $state(
    // Empty storage means "show everything", so the dialog starts fully ticked
    byRank(
      wanted.length
        ? groups.filter((g) => wanted.includes(g.path)).map((g) => g.path)
        : groups.map((g) => g.path)
    )
  );
  // Defaults to fully expanded: a folder you cannot see cannot be ticked
  let expanded = $state(["\\", ...groupPaths]);

  const allPicked = $derived(groups.length > 0 && picked.length === groups.length);

  function toggleExpand(path) {
    expanded = expanded.includes(path)
      ? expanded.filter((p) => p !== path)
      : [...expanded, path];
  }

  // Same semantics as the tree: ticking a parent drops children that were ticked
  // redundantly, unticking takes the whole subtree with it
  function toggleGroup(path, next, subPaths = []) {
    const dirs = new Set(subPaths.filter((x) => typeof x === "string"));
    const rest = picked.filter((p) => !dirs.has(p));
    picked = byRank(next ? [...rest, path] : rest);
  }

  function submit() {
    if (!picked.length) return;
    // Fully ticked is the same as unrestricted, so store an empty array — a cleaner
    // meaning
    onConfirm?.(allPicked ? [] : [...picked]);
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose?.();
    }
  }}
/>

<div class="mask" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose?.()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={t("visible.title")} data-testid="visible-dialog">
    <div class="head">
      <h3>{t("visible.title")}</h3>
      <button class="close" type="button" aria-label={t("common.close")} onclick={() => onClose?.()}>✕</button>
    </div>

    <div class="body">
      <p class="hint">
        {t("visible.hint")}
      </p>

      <div class="list" data-testid="visible-tree">
        <TaskTreeNode
          node={tree}
          selection={{ groups: picked, tasks: [] }}
          {expanded}
          onToggleExpand={toggleExpand}
          onToggleGroup={toggleGroup}
          showTasks={false}
          ops={false}
          highlight={false}
        />
      </div>

      {#if !picked.length}
        <p class="err">{t("visible.errNone")}</p>
      {:else if allPicked}
        <p class="tip">{t("visible.tipAll")}</p>
      {/if}
    </div>

    <div class="foot">
      <button class="btn" type="button" onclick={() => onClose?.()}>{t("common.cancel")}</button>
      <button
        class="btn primary"
        type="button"
        onclick={submit}
        disabled={!picked.length}
        data-testid="visible-confirm"
      >
        {t("common.confirm")}
      </button>
    </div>
  </div>
</div>

<style>
  .mask {
    position: fixed;
    inset: 0;
    background: rgba(24, 33, 46, 0.42);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 80;
  }

  .dialog {
    width: 440px;
    max-width: calc(100vw - 40px);
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 18px 48px rgba(20, 30, 45, 0.3);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #eef2f8;
  }

  .head h3 {
    margin: 0;
    font-size: 14.5px;
    color: #22303f;
  }

  .close {
    width: 26px;
    height: 26px;
    border: none;
    background: none;
    border-radius: 4px;
    color: #7a8699;
    font-size: 14px;
    cursor: pointer;
  }

  .close:hover {
    background: #f1f4f8;
    color: #22303f;
  }

  .body {
    padding: 12px 16px;
  }

  .hint {
    margin: 0 0 10px;
    font-size: 12.5px;
    color: #5a6678;
    line-height: 1.6;
  }

  .list {
    max-height: 320px;
    overflow: auto;
    padding: 6px 4px;
  }

  .tip {
    margin: 8px 0 0;
    font-size: 12px;
    color: #7a8699;
  }

  .err {
    margin: 8px 0 0;
    font-size: 12px;
    color: #c5221f;
  }

  .foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid #eef2f8;
    background: #fafbfd;
  }

  .btn {
    min-width: 72px;
    height: 30px;
    border: 1px solid #d6dde7;
    background: #fff;
    border-radius: 5px;
    font-size: 13px;
    color: #44506b;
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    border-color: #1a73e8;
    color: #1a73e8;
  }

  .btn.primary {
    background: #1a73e8;
    border-color: #1a73e8;
    color: #fff;
  }

  .btn.primary:hover:not(:disabled) {
    background: #1668d1;
    color: #fff;
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
</style>
