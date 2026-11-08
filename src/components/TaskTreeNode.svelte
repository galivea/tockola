<script>
  import Icon from "./icons/Icon.svelte";
  import TaskTreeNode from "./TaskTreeNode.svelte";
  import { t } from "../lib/i18n/index.svelte.js";

  let {
    node,
    selection = { groups: [], tasks: [] },
    expanded = [],
    onToggleExpand,
    onToggleGroup,
    onToggleTask,
    onCreate,
    onRename,
    onRemove,
    depth = 0,
    // showTasks: the tree on the left hangs task nodes under folders; the visibility
    // dialog picks folders only and hangs nothing
    // ops: the three row actions (new / rename / delete); not offered inside a dialog
    // highlight: whether the selected row gets a blue background. Everything is ticked
    // by default in the dialog, so painting it all blue would say nothing — the checkbox
    // carries that meaning instead
    showTasks = true,
    ops = true,
    highlight = true,
  } = $props();

  const children = $derived(Array.isArray(node?.children) ? node.children : []);
  const tasks = $derived(Array.isArray(node?.tasks) ? node.tasks : []);
  const path = $derived(node?.path ?? "\\");
  const hasKids = $derived(children.length > 0 || (showTasks && tasks.length > 0));
  // The root is always expanded; the rest follow the persisted expansion set
  const open = $derived(depth === 0 ? true : expanded.includes(path));
  const isRoot = $derived(depth === 0);

  const groups = $derived(Array.isArray(selection.groups) ? selection.groups : []);
  const pickedTasks = $derived(Array.isArray(selection.tasks) ? selection.tasks : []);

  // One walk collects "every descendant folder path + every descendant task". When
  // showTasks is false (the visibility dialog) tasks drop out of the tick logic: the
  // unit there is the folder, not the task.
  function walk(n, withTasks) {
    const dirs = [];
    const list = [];
    const go = (x) => {
      dirs.push(x.path);
      (x.children ?? []).forEach(go);
      if (withTasks) for (const t of x.tasks ?? []) list.push(t);
    };
    go(n ?? { path: "\\", children: [], tasks: [] });
    return { dirs, tasks: list };
  }
  const subtree = $derived(walk(node, showTasks));

  // Ticking a folder means ticking every task beneath it, so the state of a row is
  // judged by its "tasks", not its "path": all ticked -> checked, some -> indeterminate,
  // none -> unchecked. (An empty folder has no tasks to judge, so it falls back to
  // whether it was ticked directly.)
  const pickedInSubtree = $derived(subtree.tasks.filter(taskChecked).length);
  const checked = $derived(
    groups.includes(path) &&
      (subtree.tasks.length === 0 || pickedInSubtree === subtree.tasks.length)
  );
  const partial = $derived(!checked && pickedInSubtree > 0);

  function toggleGroup(next) {
    onToggleGroup?.(
      path,
      next,
      [...subtree.dirs, ...subtree.tasks.map((t) => [t.path, t.name])]
    );
  }

  function pick() {
    toggleGroup(!checked);
  }

  const taskChecked = (t) =>
    pickedTasks.some((x) => x.path === t.path && x.name === t.name);

  // indeterminate is a DOM property; written in the template it becomes an attribute
  // (always true), so it has to be assigned by hand
  function semi(el, value) {
    el.indeterminate = !!value;
    return {
      update(next) {
        el.indeterminate = !!next;
      },
    };
  }
</script>

<div class="node">
  <div
    class="row"
    class:sel={highlight && checked}
    class:dim={node?.dimmed}
    style="padding-left: {4 + depth * 13}px"
  >
    <button
      class="twist"
      class:hidden={!hasKids}
      type="button"
      aria-label={open ? t("tree.nodeCollapse") : t("tree.nodeExpand")}
      onclick={() => onToggleExpand?.(path)}
    >
      <span class="arrow" class:open><Icon name="chevron" size={10} /></span>
    </button>

    <input
      class="cb"
      type="checkbox"
      data-testid="tree-group-cb"
      data-path={path}
      checked={checked}
      use:semi={partial}
      onchange={(e) => toggleGroup(e.currentTarget.checked)}
      aria-label={t("tree.selectGroup")}
      title={checked ? t("tree.unselectGroup") : t("tree.selectGroupTip")}
    />

    <button
      class="pick"
      class:root={isRoot}
      type="button"
      data-testid="tree-group"
      data-path={path}
      title={path}
      onclick={pick}
    >
      <span class="gicon"><Icon name="folder" size={13} /></span>
      <span class="label">{isRoot ? t("tree.root") : node?.name ?? t("tree.unnamed")}</span>
    </button>

    {#if ops}
      <span class="ops">
        <button
          class="op"
          type="button"
          title={isRoot ? t("tree.newAtRoot") : t("tree.newSub")}
          data-testid="tree-group-add"
          data-path={path}
          onclick={() => onCreate?.(path)}>＋</button
        >
        {#if !isRoot}
          <button
            class="op"
            type="button"
            title={t("tree.rename")}
            data-testid="tree-group-rename"
            data-path={path}
            onclick={() => onRename?.(path, node?.name ?? "")}>✎</button
          >
          <button
            class="op danger"
            type="button"
            title={t("tree.remove")}
            data-testid="tree-group-del"
            data-path={path}
            onclick={() => onRemove?.(path, node?.name ?? "")}>✕</button
          >
        {/if}
      </span>
    {/if}
  </div>

  {#if open}
    {#each children as child (child.path)}
      <TaskTreeNode
        node={child}
        {selection}
        {expanded}
        {onToggleExpand}
        {onToggleGroup}
        {onToggleTask}
        {onCreate}
        {onRename}
        {onRemove}
        depth={depth + 1}
        {showTasks}
        {ops}
        {highlight}
      />
    {/each}

    {#if showTasks}
      {#each tasks as tk (tk.path + "|" + tk.name)}
        <div
          class="task"
          class:off={!tk.enabled}
          class:sel={taskChecked(tk)}
          style="padding-left: {4 + (depth + 1) * 13 + 18}px"
        >
          <input
            class="cb"
            type="checkbox"
            data-testid="tree-task-cb"
            data-path={tk.path}
            data-name={tk.name}
            checked={taskChecked(tk)}
            onchange={(e) => onToggleTask?.(tk, e.currentTarget.checked)}
            aria-label={t("tree.selectTask")}
            title={tk.name}
          />
          <button
            class="tbtn"
            type="button"
            data-testid="tree-task"
            data-path={tk.path}
            data-name={tk.name}
            title={tk.name}
            onclick={() => onToggleTask?.(tk, !taskChecked(tk))}
          >
            <span class="tico" class:off={!tk.enabled}><Icon name="clock" size={12} /></span>
            <span class="tname">{tk.name}</span>
          </button>
        </div>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .node {
    display: block;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 28px;
    padding-right: 4px;
    border-radius: 4px;
  }

  .row:hover {
    background: #f1f5fa;
  }

  .row.sel {
    background: #e7f0fe;
  }

  .twist {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    color: #8b95a5;
    flex: none;
  }

  .twist.hidden {
    visibility: hidden;
  }

  .arrow {
    display: inline-flex;
    transition: transform 0.15s ease;
  }

  .arrow.open {
    transform: rotate(90deg);
  }

  .cb {
    width: 13px;
    height: 13px;
    margin: 0 4px 0 0;
    flex: none;
    accent-color: #1a73e8;
    cursor: pointer;
  }

  .pick {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }

  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    color: #3c4757;
  }

  .row.sel .label {
    color: #14508f;
    font-weight: 600;
  }

  /* Folder action buttons: hidden until hover so they do not get in the way while
     reading */
  .ops {
    display: none;
    gap: 1px;
    flex: none;
  }

  .row:hover .ops,
  .row:focus-within .ops {
    display: flex;
  }

  .op {
    width: 17px;
    height: 17px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    background: none;
    border-radius: 3px;
    font-size: 11px;
    line-height: 1;
    color: #6b7789;
    cursor: pointer;
    padding: 0;
  }

  .op:hover {
    background: #fff;
    border-color: #c3cfe0;
    color: #14508f;
  }

  .op.danger:hover {
    color: #c5221f;
    border-color: #e6b3b1;
  }

  /* Path skeleton kept by the visibility dialog: it only exists to reach a deep
     ticked folder, carries no tasks, and is dimmed to read as "passing through" */
  .row.dim .label {
    color: #a3acba;
  }

  .row.dim .gicon {
    color: #c2cad6;
  }

  .task {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 26px;
    padding-right: 6px;
    border-radius: 4px;
  }

  .task:hover {
    background: #f1f5fa;
  }

  .task.sel {
    background: #e7f0fe;
  }

  .tbtn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }

  /* Tasks use a clock icon; the colour carries enabled / disabled */
  .tico {
    display: inline-flex;
    color: #22a06b;
    flex: none;
  }

  .tico.off {
    color: #c2cad6;
  }

  /* Folders use a directory icon */
  .gicon {
    display: inline-flex;
    color: #8b95a5;
    flex: none;
  }

  .row.sel .gicon {
    color: #14508f;
  }

  .tname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: #4d5867;
  }

  .task.sel .tname {
    color: #14508f;
    font-weight: 600;
  }

  .task.off .tname {
    color: #9aa4b2;
  }
</style>
