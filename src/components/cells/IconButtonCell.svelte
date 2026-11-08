<script>
  import { getContext } from "svelte";
  import Icon from "../icons/Icon.svelte";
  import { t } from "../../lib/i18n/index.svelte.js";

  let { row, column } = $props();
  const actions = getContext("task-actions");

  // One button per column: column.id decides the icon, the tooltip and the behaviour
  const META = {
    edit: { icon: "edit", label: () => t("cell.actEdit") },
    run: { icon: "run", label: () => t("cell.actRun") },
    history: { icon: "history", label: () => t("cell.actHistory") },
    remove: { icon: "remove", label: () => t("cell.actRemove") },
  };

  // Run and stop share one slot: once the state is Running this cell becomes Stop
  // instead of taking a column of its own — the action column already holds four
  // buttons and a fifth would burst it.
  const stopping = $derived(column.id === "run" && row.state === "Running");
  const meta = $derived(
    stopping
      ? { icon: "stop", label: t("cell.actStop") }
      : { icon: META[column.id]?.icon ?? "detail", label: META[column.id]?.label() ?? t("cell.actGeneric") }
  );
  const action = $derived(stopping ? "stop" : column.id);
  let busy = $state(false);

  async function handle() {
    if (busy) return;
    busy = true;
    try {
      await actions?.[action]?.(row);
    } finally {
      busy = false;
    }
  }
</script>

<button
  class="icon-btn"
  class:danger={column.id === "remove"}
  class:busy
  type="button"
  title={meta.label}
  aria-label={t("cell.ariaAct", { label: meta.label, name: row.name })}
  data-action={column.id}
  data-mode={column.id === "run" ? (stopping ? "stop" : "run") : undefined}
  data-task={row.name}
  disabled={busy}
  onclick={handle}
>
  <Icon name={meta.icon} size={17} />
</button>

<style>
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: #5a6678;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }

  .icon-btn:hover:not(:disabled) {
    background: #eaf1fb;
    border-color: #cfe0f8;
    color: #1a73e8;
  }

  .icon-btn.danger:hover:not(:disabled) {
    background: #fdeceb;
    border-color: #f8cfcb;
    color: #d93025;
  }

  .icon-btn:active:not(:disabled) {
    transform: translateY(0.5px);
  }

  .icon-btn:disabled {
    opacity: 0.5;
    cursor: progress;
  }
</style>
