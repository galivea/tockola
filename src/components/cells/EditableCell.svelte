<script>
  import { getContext } from "svelte";
  import { t } from "../../lib/i18n/index.svelte.js";

  // field: name of the field to edit; display: custom display text; parse: turns the
  // displayed value back into the stored value before submit
  let {
    row,
    field,
    display = null,
    parse = null,
    multiline = false,
    placeholder = "",
    mono = false,
    allowEmpty = false,
    // When the outer layer supplies its own hover card, drop the native title so two
    // tooltips never fight
    nativeTip = true,
  } = $props();

  const actions = getContext("task-actions");

  let editing = $state(false);
  let value = $state("");
  let el = $state(null);
  let anchor = $state(null);
  let cancelled = false;
  let busy = $state(false);

  const text = $derived(display ? display(row) : row[field] ?? "");

  $effect(() => {
    if (editing && el) {
      el.focus();
      if (typeof el.select === "function") el.select();
    }
  });

  function start(event) {
    event?.stopPropagation?.();
    if (busy) return;
    value = display ? String(row[field] ?? "") : String(row[field] ?? "");
    const node = event?.currentTarget;
    if (node && multiline) {
      const r = node.getBoundingClientRect();
      anchor = {
        top: r.bottom + 2,
        left: r.left,
        width: Math.max(r.width, 260),
      };
    }
    editing = true;
  }

  async function commit() {
    if (!editing) return;
    editing = false;
    const raw = String(value ?? "");
    const next = parse ? parse(raw) : raw;
    if (next === String(row[field] ?? "")) return;
    if (!next && !allowEmpty) {
      // Task name and folder may not be emptied
      return;
    }
    busy = true;
    try {
      await actions?.updateField?.(row, field, next);
    } finally {
      busy = false;
    }
  }

  function cancel() {
    cancelled = true;
    editing = false;
  }

  function onBlur() {
    if (cancelled) {
      cancelled = false;
      return;
    }
    commit();
  }

  function onKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "Enter") {
      // Multi-line: Enter inserts a newline, Ctrl+Enter submits
      if (multiline && !event.ctrlKey) return;
      event.preventDefault();
      commit();
    }
  }
</script>

{#if editing}
  {#if multiline}
    <div
      class="float"
      style="top:{anchor.top}px; left:{anchor.left}px; width:{anchor.width}px"
    >
      <textarea
        bind:this={el}
        bind:value
        rows="5"
        onkeydown={onKeydown}
        onblur={onBlur}
      ></textarea>
      <div class="tips">{t("cell.editHint")}</div>
    </div>
  {:else}
    <input
      class="inline"
      class:mono
      bind:this={el}
      bind:value
      onkeydown={onKeydown}
      onblur={onBlur}
    />
  {/if}
{:else}
  <span
    class="text"
    class:mono
    class:empty={!text}
    class:busy
    data-testid={`cell-${field}`}
    title={nativeTip ? text || placeholder : null}
    role="button"
    tabindex="0"
    onclick={start}
    onkeydown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        start(e);
      }
    }}>{text || placeholder}</span
  >
{/if}

<style>
  .text {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    color: #1f2b3d;
    cursor: text;
    border-radius: 3px;
    padding: 2px 4px;
    margin: -2px -4px;
  }
  .text:hover {
    background: #eef3fb;
    box-shadow: inset 0 0 0 1px #c8d8f0;
  }
  .text.empty {
    color: #9aa5b5;
  }
  .text.busy {
    opacity: 0.55;
  }
  .text.mono {
    font-family: "Cascadia Mono", Consolas, monospace;
    font-size: 12.5px;
  }

  .inline {
    width: 100%;
    box-sizing: border-box;
    font-size: 13px;
    padding: 2px 4px;
    border: 1px solid #4a86e8;
    border-radius: 3px;
    outline: none;
    font-family: inherit;
  }
  .inline.mono {
    font-family: "Cascadia Mono", Consolas, monospace;
    font-size: 12.5px;
  }

  .float {
    position: fixed;
    z-index: 9999;
    background: #fff;
    border: 1px solid #4a86e8;
    border-radius: 6px;
    padding: 6px;
    box-shadow: 0 6px 20px rgba(20, 40, 80, 0.18);
  }
  .float textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    font: inherit;
    font-size: 13px;
    line-height: 1.5;
    padding: 4px;
    border: 1px solid #d7deea;
    border-radius: 4px;
    outline: none;
  }
  .tips {
    margin-top: 4px;
    font-size: 11px;
    color: #7b8798;
  }
</style>
