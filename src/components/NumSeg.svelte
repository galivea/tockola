<script>
  /**
   * Number cell with a stepper: an input on the left, always-visible up/down buttons
   * on the right
   *
   * While editing it shows exactly what the user typed; normalisation happens on blur,
   * back in the parent, so the caret never jumps. The arrow keys work the same as the
   * stepper buttons.
   */
  import { t } from "../lib/i18n/index.svelte.js";

  let {
    value = 0,
    min = 0,
    max = 99,
    disabled = false,
    title = "",
    aria = "",
    testid = "",
    onchange,
  } = $props();

  // Raw text while editing; null means not editing, so the parent's normalised value
  // is shown
  let raw = $state(null);

  const shown = $derived(
    raw ?? String(Math.max(min, Math.round(Number(value) || 0))).padStart(2, "0")
  );

  function input(e) {
    const digits = e.currentTarget.value.replace(/\D/g, "").slice(0, 2);
    raw = digits;
    // Whatever parses is sent straight up and the parent decides how to clamp it;
    // an empty string waits for blur
    if (digits !== "") onchange?.(Number(digits));
  }
  function commit() {
    if (raw !== null) {
      const n = Number(raw || 0);
      raw = null;
      onchange?.(Math.max(min, n));
    }
  }
  function bump(d) {
    const n = Math.min(max, Math.max(min, (Math.round(Number(value) || 0)) + d));
    raw = null;
    onchange?.(n);
  }
  function key(e) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      bump(1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      bump(-1);
    }
  }
</script>

<span class="seg" class:disabled {title}>
  <input
    class="val"
    type="text"
    inputmode="numeric"
    maxlength="2"
    {disabled}
    aria-label={aria}
    value={shown}
    data-testid={testid}
    oninput={input}
    onblur={commit}
    onkeydown={key}
  />
  <span class="step">
    <button type="button" tabindex="-1" {disabled} aria-label={t("field.stepUp", { name: aria })} onclick={() => bump(1)}>
      <svg viewBox="0 0 8 5" width="7" height="5" aria-hidden="true"><path d="M4 0l4 5H0z" fill="currentColor" /></svg>
    </button>
    <button type="button" tabindex="-1" {disabled} aria-label={t("field.stepDown", { name: aria })} onclick={() => bump(-1)}>
      <svg viewBox="0 0 8 5" width="7" height="5" aria-hidden="true"><path d="M0 0h8L4 5z" fill="currentColor" /></svg>
    </button>
  </span>
</span>

<style>
  .seg {
    display: inline-flex;
    align-items: stretch;
    height: 26px;
    border: 1px solid #d6dde7;
    border-radius: 4px;
    background: #fff;
    overflow: hidden;
    flex: none;
  }
  .seg:focus-within {
    border-color: #1a73e8;
    box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.14);
  }
  .seg.disabled { background: #f5f7fa; }

  .val {
    width: 21px;
    border: none;
    outline: none;
    padding: 0;
    text-align: center;
    font-size: 12px;
    color: #2f3742;
    background: transparent;
    font-family: inherit;
    min-width: 0;
  }
  .val:disabled { color: #9aa5b5; }

  .step {
    display: flex;
    flex-direction: column;
    width: 13px;
    border-left: 1px solid #e4eaf2;
    flex: none;
  }
  .step button {
    flex: 1;
    border: none;
    background: #f7f9fc;
    color: #7a8699;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }
  .step button:hover:not(:disabled) { background: #eaf1fb; color: #1a73e8; }
  .step button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
