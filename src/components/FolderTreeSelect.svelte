<script>
  // Tree picker for "Folder" on the editor page. Unlike the query tree on the left it
  // only lists folders (no task names); picking one writes the path, while typing a
  // path by hand stays possible (to move a task into a folder that does not exist yet).
  import Icon from "./icons/Icon.svelte";
  import { normalizePath } from "../lib/utils.js";
  import { t } from "../lib/i18n/index.svelte.js";

  let { tree, value = "\\", onSelect } = $props();

  let open = $state(false);
  // Expands to every ancestor of the current path by default, so opening the panel shows
  // where you are. The folder loads asynchronously on the editor page — value starts
  // as "\" and only later becomes the real path — so this has to track the prop
  // ($state(ancestors(value)) would freeze the initial value).
  let expanded = $state([]);
  $effect(() => {
    expanded = ancestors(value);
  });

  function ancestors(p) {
    const set = new Set(["\\"]);
    const segs = normalizePath(p).split("\\").filter(Boolean);
    let acc = "";
    for (const s of segs) {
      acc = acc + "\\" + s;
      set.add(acc + "\\");
    }
    return [...set];
  }

  function toggle(node) {
    const has = expanded.includes(node.path);
    expanded = has ? expanded.filter((p) => p !== node.path) : [...expanded, node.path];
  }

  function pick(node) {
    onSelect?.(node.path);
    open = false;
  }

  const isOpen = $derived((p) => expanded.includes(p));
</script>

<div class="picker" data-testid="group-tree-select">
  <button class="trigger" type="button" onclick={() => (open = !open)} aria-expanded={open}>
    <span class="tri-path" data-testid="group-tree-value">{normalizePath(value)}</span>
    <span class="caret" class:up={open}>▾</span>
  </button>

  {#if open}
    <div class="panel">
      <div class="panel-head">
        <span>{t("tree.groups")}</span>
        <button class="mini" type="button" onclick={() => pick({ path: "\\" })}>{t("tree.pickRoot")}</button>
      </div>
      <div class="panel-body">
        <ul class="tree">
          <li>
            <div class="row">
              {#if tree.children?.length}
                <button
                  class="tw"
                  type="button"
                  onclick={() => toggle(tree)}
                  aria-label={isOpen(tree.path) ? t("tree.nodeCollapse") : t("tree.nodeExpand")}>{isOpen(tree.path) ? "▾" : "▸"}</button
                >
              {:else}
                <span class="tw placeholder"></span>
              {/if}
              <button
                class="node"
                class:active={normalizePath(value) === normalizePath(tree.path)}
                type="button"
                onclick={() => pick(tree)}
                ><span class="fico"><Icon name="folder" size={13} /></span>{tree.name}</button
              >
            </div>
            {#if tree.children?.length && isOpen(tree.path)}
              <ul class="children">
                {#each tree.children as child (child.path)}
                  {@render node(child)}
                {/each}
              </ul>
            {/if}
          </li>
        </ul>
      </div>
    </div>
  {/if}
</div>

{#snippet node(n)}
  <li>
    <div class="row">
      {#if n.children?.length}
        <button
          class="tw"
          type="button"
          onclick={() => toggle(n)}
          aria-label={isOpen(n.path) ? t("tree.nodeCollapse") : t("tree.nodeExpand")}>{isOpen(n.path) ? "▾" : "▸"}</button
        >
      {:else}
        <span class="tw placeholder"></span>
      {/if}
      <button
        class="node"
        class:active={normalizePath(value) === normalizePath(n.path)}
        type="button"
        onclick={() => pick(n)}
        ><span class="fico"><Icon name="folder" size={13} /></span>{n.name}</button
      >
    </div>
    {#if n.children?.length && isOpen(n.path)}
      <ul class="children">
        {#each n.children as child (child.path)}
          {@render node(child)}
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

<style>
  .picker {
    position: relative;
  }

  .trigger {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 8px;
    border: 1px solid #d6dde7;
    border-radius: 5px;
    background: #fff;
    font-size: 12.5px;
    color: #22303f;
    cursor: pointer;
    text-align: left;
  }
  .trigger:hover {
    border-color: #b9c6d8;
  }

  .tri-path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #2f3742;
    font-size: 12.5px;
  }
  .caret {
    flex: none;
    color: #8b95a5;
    transition: transform 0.15s;
  }
  .caret.up {
    transform: rotate(180deg);
  }

  .panel {
    position: absolute;
    z-index: 30;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: #fff;
    border: 1px solid #d6dde7;
    border-radius: 6px;
    box-shadow: 0 8px 20px rgba(20, 30, 45, 0.12);
    overflow: hidden;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    border-bottom: 1px solid #eef2f8;
    background: #fafbfd;
    font-size: 12px;
    font-weight: 700;
    color: #22303f;
  }

  .panel-body {
    max-height: 220px;
    overflow: auto;
    padding: 6px 8px 8px;
  }

  .tree,
  .children {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .children {
    margin-left: 14px;
    border-left: 1px dashed #e3e8ef;
    padding-left: 4px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .tw {
    width: 16px;
    height: 20px;
    flex: none;
    border: none;
    background: none;
    color: #8b95a5;
    cursor: pointer;
    font-size: 10px;
    padding: 0;
  }
  .tw.placeholder {
    cursor: default;
  }

  .node {
    flex: 1;
    text-align: left;
    border: none;
    background: none;
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 12.5px;
    color: #3c4a5c;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fico {
    display: inline-flex;
    margin-right: 5px;
    vertical-align: -2px;
    color: #8b95a5;
  }

  .node.active .fico {
    color: #1a56c4;
  }

  .node:hover {
    background: #eef4fd;
  }
  .node.active {
    background: #e6efff;
    color: #1a56c4;
    font-weight: 600;
  }

  .mini {
    border: 1px solid #d6dde7;
    background: #fff;
    border-radius: 4px;
    font-size: 11.5px;
    padding: 2px 7px;
    cursor: pointer;
    color: #4a5a70;
  }
  .mini:hover {
    border-color: #1a73e8;
    color: #1a73e8;
  }
</style>
