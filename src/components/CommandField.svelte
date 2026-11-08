<script>
  import { splitCommand } from "../lib/command.js";
  import { t } from "../lib/i18n/index.svelte.js";

  /**
   * Command line
   *
   * One whole command line (exactly as typed into cmd); splitCommand breaks it into
   * program + arguments on save.
   *   - normally a single-line input
   *   - clicking turns it multi-line (once it holds a newline it stays that way, and
   *     only collapses back when it is left with no newline)
   *   - while non-empty, hovering floats a card: the full command plus a preview of
   *     the split, so the user knows before saving how it will be cut up
   */
  let { value = $bindable(""), placeholder = "" } = $props();

  // Falls back to the language pack when no placeholder is passed
  const ph = $derived(placeholder || t("field.cmdPlaceholder"));

  let multi = $state(false);
  // The hover card uses fixed positioning: the table container clips overflow, so
  // absolute would be cut off
  let wrapEl = $state(null);
  let pos = $state({ left: 0, top: 0, width: 280 });
  function place() {
    const r = wrapEl?.getBoundingClientRect();
    if (r) pos = { left: r.left, top: r.bottom + 5, width: Math.max(r.width, 280) };
  }
  const parts = $derived(splitCommand(value));
  const has = $derived(!!String(value || "").trim());

  function toMulti(node) {
    node.focus();
    const end = node.value.length;
    node.setSelectionRange(end, end);
    autoGrow(node);
  }

  function autoGrow(node) {
    node.style.height = "auto";
    node.style.height = Math.min(node.scrollHeight, 132) + "px";
  }

  function onBlur() {
    // Anything containing a newline (a multi-line script argument, say) stays
    // multi-line; otherwise it folds back to one line
    if (!String(value || "").includes("\n")) multi = false;
  }
</script>

<span class="cmd" class:multi bind:this={wrapEl} onmouseenter={place}>
  {#if multi}
    <textarea
      class="ta"
      rows="2"
      spellcheck="false"
      bind:value
      placeholder={ph}
      use:toMulti
      oninput={(e) => autoGrow(e.currentTarget)}
      onblur={onBlur}
      data-testid="cmd-input"
    ></textarea>
  {:else}
    <input
      class="inp"
      type="text"
      spellcheck="false"
      bind:value
      placeholder={ph}
      onfocus={() => (multi = true)}
      data-testid="cmd-input"
    />
  {/if}

  {#if has}
    <span
      class="tip"
      aria-hidden="true"
      style={`left:${pos.left}px; top:${pos.top}px; width:${pos.width}px`}
    >
      <span class="tip-cmd">{value}</span>
      <span class="tip-split">
        <span class="k">{t("field.cmdProgram")}</span><span class="v mono">{parts.command || t("field.cmdEmpty")}</span>
      </span>
      <span class="tip-split">
        <span class="k">{t("field.cmdArgs")}</span><span class="v mono">{parts.arguments || t("field.cmdNone")}</span>
      </span>
    </span>
  {/if}
</span>

<style>
  .cmd {
    position: relative;
    display: block;
    width: 100%;
    min-width: 150px;
  }

  .inp,
  .ta {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #d6dde7;
    border-radius: 5px;
    padding: 6px 8px;
    font-size: 12.5px;
    font-family: inherit;
    color: #2f3742;
    background: #fff;
    outline: none;
  }
  .ta {
    resize: vertical;
    min-height: 46px;
    line-height: 1.5;
  }
  .inp:focus,
  .ta:focus {
    border-color: #1a73e8;
    box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.14);
  }
  .inp::placeholder,
  .ta::placeholder { color: #b6c0cf; }

  /* Hover card: full command + split preview. pointer-events:none keeps it from
     swallowing clicks */
  .tip {
    position: fixed;
    z-index: 70;
    display: none;
    flex-direction: column;
    gap: 4px;
    max-width: 520px;
    padding: 7px 9px;
    background: #2f3742;
    color: #f2f5f9;
    border-radius: 5px;
    box-shadow: 0 6px 18px rgba(20, 30, 45, 0.22);
    font-size: 11.5px;
    line-height: 1.55;
    pointer-events: none;
  }
  .cmd:hover > .tip,
  .cmd:focus-within > .tip { display: flex; }

  .tip-cmd {
    white-space: pre-wrap;
    word-break: break-all;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.16);
  }

  .tip-split { display: flex; gap: 6px; align-items: baseline; }
  .k { flex: none; color: #9fb0c6; }
  .v { flex: 1; word-break: break-all; }
  .mono { font-family: "Cascadia Mono", Consolas, "Courier New", monospace; }
</style>
