<script>
  /**
   * Toggle that carries its field name
   *
   * Same shape as the toggle in the task list's Enabled column, but with the field name
   * in front, for the settings area. The title sits on the outer label, so hovering
   * anywhere on the block shows the property description.
   */
  let {
    checked = $bindable(false),
    label = "",
    title = "",
    disabled = false,
    muted = false,
  } = $props();
</script>

<label class="sw-field" class:muted class:disabled {title} data-testid="switch-field">
  <button
    class="switch"
    class:on={checked}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label || title}
    {disabled}
    onclick={() => !disabled && (checked = !checked)}
  >
    <span class="knob"></span>
  </button>
  {#if label}
    <span class="lb">{label}</span>
  {/if}
</label>

<style>
  .sw-field {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: #3c4757;
    cursor: pointer;
    user-select: none;
  }
  .sw-field.muted { color: #8b95a5; }
  .sw-field.disabled { opacity: 0.45; cursor: not-allowed; }

  /* Same toggle as EnableCell in the task list */
  .switch {
    position: relative;
    width: 34px;
    height: 19px;
    flex: none;
    border-radius: 10px;
    border: 1px solid #c3ccd8;
    background: #e6eaf1;
    cursor: pointer;
    padding: 0;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .switch.on { background: #1a73e8; border-color: #1a73e8; }
  .switch:disabled { opacity: 0.6; cursor: not-allowed; }

  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    transition: transform 0.15s ease;
  }
  .switch.on .knob { transform: translateX(15px); }

  .lb { font-size: 12.5px; font-weight: 600; }
</style>
