<script>
  /**
   * Compact toggle used inside a table
   *
   * Identical to EnableCell in the task list, just smaller (40px is a tight fit inside
   * a cell). The field name comes from the header, so no text here.
   */
  import { t } from "../lib/i18n/index.svelte.js";

  let { checked = $bindable(false), label = "", disabled = false } = $props();

  // Without a field name it falls back to "enabled", same meaning as the list column
  const name = $derived(label || t("grid.colEnabled"));
</script>

<button
  class="switch"
  class:on={checked}
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={checked ? t("field.toggleOn", { label: name }) : t("field.toggleOff", { label: name })}
  title={checked ? t("cell.enableOn") : t("cell.enableOff")}
  {disabled}
  onclick={() => (checked = !checked)}
  data-testid="toggle"
>
  <span class="knob"></span>
</button>

<style>
  .switch {
    position: relative;
    width: 36px;
    height: 20px;
    border-radius: 10px;
    border: 1px solid #c3ccd8;
    background: #e6eaf1;
    cursor: pointer;
    padding: 0;
    flex: none;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .switch.on { background: #1a73e8; border-color: #1a73e8; }
  .switch:disabled { opacity: 0.6; cursor: not-allowed; }

  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    transition: transform 0.15s ease;
  }

  .switch.on .knob { transform: translateX(16px); }
</style>
